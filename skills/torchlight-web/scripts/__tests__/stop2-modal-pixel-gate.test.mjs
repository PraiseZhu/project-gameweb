/**
 * 停2 预约弹窗三屏像素门（停1 口径：活字遮罩 + 用户拍板的「边缘锯齿/亚像素线跳过」）。
 *
 * 依据：
 *   - standards/stop1-figma-pixel/SKILL.md ——「活字 TEXT 由清单静态闸对字符/字号/框，
 *     像素门遮掉这些区，不拿 Figma 栅格当字」；
 *   - 用户追加口径（2026-09-10）——「边缘锯齿和亚像素线不考虑在内，跳过」，但
 *     「成块错位 / 贴错图」不能跳。
 *
 * 本测试锁四件事：
 *   1) 阈值与停1 共享常量一致（DEFAULT_STOP1_PIXEL_THRESHOLD），相位容差半径 = 2px；
 *   2) 活字遮罩来自共享 gate 的 sectionLiveCopyMasks（不是第二套判据）；
 *   3) 亚像素线遮罩只认清单里 h*scale ≤ 2 的 LINE / 退化成线的 VECTOR；
 *   4) 相位容差能跳过 ≤2px 相位差，但 ≥3px 的成块错位照样报 bad（不许把真错位跳掉）。
 * 不依赖私有 demo：全部用合成清单 / 合成位图。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_STOP1_PIXEL_THRESHOLD, sectionLiveCopyMasks } from '../lib/stop1-figma-pixel-gate.mjs';
import {
  STOP2_PIXEL_THRESHOLD,
  PHASE_TOLERANCE_RADIUS,
  STOP2_MAX_MASK_RATIO,
  BLOCK_SHIFT_MIN_PX,
  screensFromInventory,
  runStop2ModalPixelProbe,
  liveTextMasks,
  subpixelLineMasks,
  phaseTolerantDiff,
  judgeStop2Pixel,
  frameExceedsPanel,
} from '../stop2-modal-pixel.mjs';

const PNG_CTOR = (await import('pngjs')).PNG;
const cropKr = { x: 786, y: 486, w: 352, h: 114 };
const panelCss = { x: 0, y: 100, w: 1920, h: 670 };

const modal = {
  id: '949:5675',
  pageBox: { x: 0, y: 0, w: 3840, h: 2160 },
  nodes: [
    { id: '949:5675', type: 'FRAME', name: 'modal/pc_kr预约弹窗', pageBox: { x: 0, y: 0, w: 3840, h: 2160 } },
    { id: '949:5726', type: 'TEXT', name: '모두 동의합니다', parentId: '949:5675', pageBox: { x: 1666, y: 977, w: 214, h: 38 } },
    { id: '949:5728', type: 'VECTOR', name: 'Line 1', parentId: '949:5675', pageBox: { x: 1574, y: 1033.6, w: 691, h: 0.0002 } },
    { id: '949:5600', type: 'VECTOR', name: 'Line 2 (thick)', parentId: '949:5675', pageBox: { x: 100, y: 200, w: 400, h: 8 } },
    { id: '949:5732', type: 'INSTANCE', name: 'btn/勾选按钮', parentId: '949:5675', pageBox: { x: 1574, y: 1050.6, w: 46.4, h: 38.7 } },
  ],
};

const solid = (w, h, r, g, b) => {
  const p = new PNG_CTOR({ width: w, height: h });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return p;
};
const stamp = (p, ox, oy, w, h, r, g, b) => {
  for (let y = oy; y < oy + h; y++) {
    for (let x = ox; x < ox + w; x++) {
      const i = (y * p.width + x) * 4;
      p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
    }
  }
  return p;
};

test('stop2 阈值与停1 共享常量一致，相位容差 = 2px', () => {
  assert.equal(STOP2_PIXEL_THRESHOLD, DEFAULT_STOP1_PIXEL_THRESHOLD);
  assert.equal(typeof STOP2_PIXEL_THRESHOLD, 'number');
  assert.ok(STOP2_PIXEL_THRESHOLD > 0);
  assert.equal(PHASE_TOLERANCE_RADIUS, 2);
});


test('清单没有预约弹窗时停2 fail-closed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'stop2-empty-'));
  writeFileSync(join(dir, 'inventory.json'), JSON.stringify({ attachments: { modals: [] } }));
  const out = await runStop2ModalPixelProbe({ demoDir: dir, inventory: { attachments: { modals: [] } } });
  assert.equal(out.ok, false);
  assert.ok((out.problems || []).includes('inventory-no-reservation-modals'));
});
test('停2 屏幕从清单预约弹窗来，不写死节点 id', () => {
  const screens = screensFromInventory({
    attachments: {
      modals: [{
        id: 'm-kr',
        name: 'modal/pc_kr预约弹窗',
        pageBox: { x: 0, y: 200, w: 3840, h: 1340 },
        nodes: [
          { id: 'm-kr', type: 'FRAME', name: 'modal/pc_kr预约弹窗', pageBox: { x: 0, y: 200, w: 3840, h: 1340 } },
          { id: 'panel', type: 'RECTANGLE', name: 'img/弹窗背景', pageBox: { x: 0, y: 200, w: 3840, h: 1340 } },
          { id: 'rules-btn', type: 'INSTANCE', name: 'btn/详细规则@go=modal/pc详细规则1', go: 'modal/pc详细规则1', pageBox: { x: 10, y: 10, w: 80, h: 40 } },
        ],
      }],
    },
  });
  assert.equal(screens.length, 1, '没有独立规则 modal 时只出预约屏');
  assert.equal(screens[0].nodeId, 'm-kr');
  assert.equal(screens[0].go, 'modal/pc_kr预约弹窗');
  assert.equal(screens[0].lang, 'ko');
  assert.deepEqual(screens[0].frame, { x: 0, y: 100, w: 1920, h: 670 });
  assert.equal(screensFromInventory({ attachments: { modals: [] } }).length, 0);
});


test('规则屏走独立规则 modal 的清单，不复用预约弹窗', () => {
  const screens = screensFromInventory({
    attachments: {
      modals: [
        {
          id: 'm-reserve',
          name: 'modal/pc_kr预约弹窗',
          pageBox: { x: 0, y: 200, w: 3840, h: 1340 },
          nodes: [
            { id: 'm-reserve', type: 'FRAME', name: 'modal/pc_kr预约弹窗', pageBox: { x: 0, y: 200, w: 3840, h: 1340 } },
            { id: 'rules-btn', type: 'INSTANCE', name: 'btn/详细规则@go=modal/pc详细规则1', go: 'modal/pc详细规则1' },
          ],
        },
        {
          id: 'm-rules',
          name: 'modal/pc详细规则1',
          pageBox: { x: 10, y: 400, w: 2000, h: 1200 },
          nodes: [
            { id: 'm-rules', type: 'FRAME', name: 'modal/pc详细规则1', pageBox: { x: 10, y: 400, w: 2000, h: 1200 } },
            { id: 'rules-panel', type: 'RECTANGLE', name: 'img/弹窗背景', pageBox: { x: 10, y: 400, w: 2000, h: 1200 } },
          ],
        },
      ],
    },
  });
  assert.equal(screens.length, 2);
  assert.equal(screens[0].nodeId, 'm-reserve');
  assert.equal(screens[1].nodeId, 'm-rules');
  assert.equal(screens[1].rulesNode, 'rules-btn');
  assert.equal(screens[1].rulesGo, 'modal/pc详细规则1');
  assert.equal(screens[1].sourceNodeId, 'm-reserve');
  assert.deepEqual(screens[1].frame, { x: 5, y: 200, w: 1000, h: 600 });
});

test('规则标题 TEXT 没有 @go 时不挡住真正的规则按钮', () => {
  const screens = screensFromInventory({
    attachments: {
      modals: [
        {
          id: 'm-reserve',
          name: 'modal/pc_kr预约弹窗',
          pageBox: { x: 0, y: 200, w: 3840, h: 1340 },
          nodes: [
            { id: 'title', type: 'TEXT', name: '详细规则', pageBox: { x: 0, y: 0, w: 100, h: 20 } },
            { id: 'rules-btn', type: 'INSTANCE', name: 'btn/详细规则@go=modal/pc详细规则1', go: 'modal/pc详细规则1' },
          ],
        },
        {
          id: 'm-rules',
          name: 'modal/pc详细规则1',
          pageBox: { x: 10, y: 400, w: 2000, h: 1200 },
          nodes: [
            { id: 'rules-panel', type: 'RECTANGLE', name: 'img/弹窗背景', pageBox: { x: 10, y: 400, w: 2000, h: 1200 } },
          ],
        },
      ],
    },
  });
  assert.equal(screens[1].nodeId, 'm-rules');
  assert.equal(screens[1].rulesNode, 'rules-btn');
});

test('规则 modal 没有几何时不回退预约框', () => {
  const screens = screensFromInventory({
    attachments: {
      modals: [
        {
          id: 'm-reserve',
          name: 'modal/pc_kr预约弹窗',
          pageBox: { x: 0, y: 200, w: 3840, h: 1340 },
          nodes: [
            { id: 'rules-btn', type: 'INSTANCE', name: 'btn/详细规则@go=modal/pc详细规则1', go: 'modal/pc详细规则1' },
          ],
        },
        {
          id: 'm-rules',
          name: 'modal/pc详细规则1',
          nodes: [{ id: 'm-rules', type: 'FRAME', name: 'modal/pc详细规则1' }],
        },
      ],
    },
  });
  assert.equal(screens.length, 1);
  assert.equal(screens[0].nodeId, 'm-reserve');
});
test('遮罩复用共享 gate：只遮活字，不遮 VECTOR/勾选/线', () => {
  const shared = sectionLiveCopyMasks({ nodes: modal.nodes }, modal);
  assert.equal(shared.length, 1, 'sectionLiveCopyMasks 应只认那一个活字 TEXT');
  const masks = liveTextMasks({ nodes: modal.nodes }, modal, cropKr, 0.5);
  assert.equal(masks.length, 1);
  // 活字设计框 x1666 y977 w214 h38，scale .5 → x833 y488.5 w107 h19；crop x786 y486 → x47 y3
  assert.deepEqual(masks[0], { x: 47, y: 3, w: 107, h: 19 });
});

test('亚像素线遮罩只认 h*scale ≤ 2 的 LINE / Line n VECTOR', () => {
  const crop = { x: 0, y: 0, w: 1920, h: 1080 };
  const { masks, nodes } = subpixelLineMasks({ nodes: modal.nodes }, crop, 0.5);
  assert.deepEqual(nodes, ['949:5728'], '只应命中 0 高的 Line 1，8px 高的 Line 2 不算');
  assert.equal(masks.length, 1);
  // 设计 x1574 y1033.6 w691 → CSS x787 y516.8 w345.5；外扩 1px、高至少 3px
  assert.equal(masks[0].x, 786);
  assert.equal(masks[0].w, 348);
  assert.ok(masks[0].h >= 3 && masks[0].h <= 6, `线遮罩高度=${masks[0].h}`);
});

test('相位容差：≤2px 相位差跳过，≥3px 成块错位照样报 bad（不许跳真错位）', () => {
  const W = 120;
  const H = 60;
  const make = () => solid(W, H, 20, 20, 20);
  const base = stamp(make(), 50, 25, 20, 10, 255, 246, 237);
  const run = (dx, dy) => {
    const actual = stamp(make(), 50 + dx, 25 + dy, 20, 10, 255, 246, 237);
    return phaseTolerantDiff({ PNG: PNG_CTOR, baseline: base, actual, masks: [], radius: PHASE_TOLERANCE_RADIUS, threshold: 0.1 });
  };
  const judge = (dx, dy) => {
    const compared = run(dx, dy);
    return { compared, judged: judgeStop2Pixel(compared, { width: W, height: H }) };
  };
  assert.equal(run(1, 0).bad, 0, '1px 相位差应被跳过');
  assert.ok(run(1, 0).phaseSkipped > 0, '1px 相位差应计入 phaseSkipped；未计入说明容差没生效');
  assert.equal(judge(1, 0).judged.ok, true, '1px 相位差最终必须 PASS');
  assert.equal(run(2, 0).bad, 0, '2px 相位差应被跳过');
  assert.equal(judge(2, 0).judged.ok, true, '2px 相位差最终必须 PASS');
  const shifted3 = judge(3, 0);
  assert.equal(shifted3.compared.blockShift.hit, true, '3px 成块必须打上 blockShift');
  assert.equal(shifted3.judged.ok, false, '3px 成块错位最终必须 FAIL，不能只 bad>0 却因 0.22% 过线');
  assert.ok(shifted3.judged.ratio < STOP2_PIXEL_THRESHOLD, '回归夹具：3px/20×10 比例仍低于 0.5%，必须靠成块闸红');
  assert.equal(judge(20, 0).judged.ok, false, '20px 成块错位必须 FAIL');
  assert.equal(judge(20, 10).judged.ok, false, '双向成块错位必须 FAIL');
});

test('相位容差：贴错图 / 新增细结构必须 FAIL，单向邻域不得吞掉', () => {
  const W = 120;
  const H = 60;
  const make = () => solid(W, H, 20, 20, 20);
  const base = stamp(make(), 50, 25, 20, 10, 255, 246, 237);
  const wrong = stamp(make(), 50, 25, 20, 10, 10, 80, 200);
  const wrongDiff = phaseTolerantDiff({ PNG: PNG_CTOR, baseline: base, actual: wrong, masks: [], radius: PHASE_TOLERANCE_RADIUS, threshold: 0.1 });
  const wrongJudge = judgeStop2Pixel(wrongDiff, { width: W, height: H });
  assert.equal(wrongJudge.ok, false, '同位置贴错色块必须 FAIL');
  assert.ok(wrongDiff.newStructure.hit || wrongDiff.blockShift.hit || wrongDiff.bad > 0);

  const extra = stamp(make(), 8, 8, 18, 1, 220, 40, 40);
  const extraDiff = phaseTolerantDiff({ PNG: PNG_CTOR, baseline: make(), actual: extra, masks: [], radius: PHASE_TOLERANCE_RADIUS, threshold: 0.1 });
  const extraJudge = judgeStop2Pixel(extraDiff, { width: W, height: H });
  assert.equal(extraJudge.ok, false, '新增细结构必须 FAIL，不能被邻域背景吞掉');
  assert.equal(extraDiff.newStructure.hit, true);
});

test('过度遮罩必须 FAIL', () => {
  const base = solid(40, 40, 10, 10, 10);
  const actual = solid(40, 40, 10, 10, 10);
  const compared = phaseTolerantDiff({
    PNG: PNG_CTOR, baseline: base, actual, masks: [[0, 0, 40, 22]], radius: 2, threshold: 0.1,
  });
  const judged = judgeStop2Pixel(compared, { width: 40, height: 40, maxMaskRatio: STOP2_MAX_MASK_RATIO });
  assert.ok(judged.maskRatio > STOP2_MAX_MASK_RATIO);
  assert.equal(judged.ok, false);
  assert.equal(judged.overMask, true);
});

test('规则2 框越出弹窗必须红', () => {
  assert.equal(BLOCK_SHIFT_MIN_PX, 3);
  assert.equal(frameExceedsPanel(panelCss, panelCss), false, '当前规则2 框必须在面板内');
  const overflow = { x: 0, y: 440, w: 1920, h: 380 };
  assert.equal(frameExceedsPanel(overflow, panelCss), true, '越出面板的比较框必须红');
});

test('遮罩区不计入 total，也不计 bad；遮罩在 diff 图上涂灰留痕', () => {
  const base = solid(40, 40, 0, 0, 0);
  const actual = solid(40, 40, 255, 0, 0);
  const masked = phaseTolerantDiff({
    PNG: PNG_CTOR, baseline: base, actual, masks: [[0, 0, 40, 40]], radius: 2, threshold: 0.1,
  });
  assert.equal(masked.total, 0, '整幅被遮时应没有可比像素');
  assert.equal(masked.bad, 0);
  assert.equal(masked.diff.data[0], 180, '被遮像素在 diff 图上涂灰');
});
