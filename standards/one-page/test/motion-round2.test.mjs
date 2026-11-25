import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { autoMotions } from '../src/motion-auto.mjs';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';

const box = { x: 0, y: 0, width: 80, height: 20 };
function frame(id, name, children = []) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 }, children };
}

/** 丰富夹具：首屏 list+item、次屏 title、grp、轮播 switch——覆盖嵌套组合全类。 */
function richDoc() {
  return {
    id: '1:2', name: '规范页', type: 'CANVAS', children: [
      frame('10:1', 'cn_pc', [
        frame('10:2', 'sec/1-首页', [
          { id: '20:1', name: 'list/奖励列表', type: 'FRAME', layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 }, children: [
            { id: '20:2', name: 'item/条目', type: 'FRAME', absoluteBoundingBox: box, children: [
              { id: '20:3', name: '名称', type: 'TEXT', characters: '金币', absoluteBoundingBox: box, style: { fontFamily: 'F', fontWeight: 400 } },
            ] },
          ] },
        ]),
        frame('11:2', 'sec/2-详情', [
          frame('11:3', 'title/标题', []),
        ]),
      ]),
    ],
  };
}

function motionIssuesOf(inv) {
  return (inv.issues || []).filter((row) => String(row.code).startsWith('MOTION'));
}

test('autoMotions 规范化幂等：产出喂回三次 motions/bindings 深度相等', () => {
  const inv1 = compileOnePage(richDoc(), { config: {} });
  assert.equal(inv1.ok, true, JSON.stringify(inv1.issues));
  const p1 = autoMotions({ pc: inv1 }, {});
  assert.ok(p1.applied.length >= 3, '第一轮应补出多种动效');
  assert.ok(p1.applied.some((row) => row.rule === 'cards-center'));

  let config = { motions: p1.motions, bindings: p1.bindings };
  for (let round = 2; round <= 3; round += 1) {
    const inv = compileOnePage(richDoc(), { config });
    assert.deepEqual(motionIssuesOf(inv), [], `第 ${round} 轮编译不应出现动效冲突`);
    const patch = autoMotions({ pc: inv }, config);
    assert.equal(patch.applied.length, 0, `第 ${round} 轮不应再补任何动效`);
    assert.equal(isDeepStrictEqual(patch.motions, config.motions), true, `第 ${round} 轮 motions 必须深度稳定`);
    assert.equal(isDeepStrictEqual(patch.bindings, config.bindings), true, `第 ${round} 轮 bindings 必须深度稳定`);
    config = { motions: patch.motions, bindings: patch.bindings };
  }
});

test('父 list 已有动效时子 item 不再被二次补 content-left', () => {
  const inv1 = compileOnePage(richDoc(), { config: {} });
  const p1 = autoMotions({ pc: inv1 }, {});
  // 第一轮后 list/奖励列表 已套 cards-center（content-left 类覆盖）
  const config = { motions: p1.motions, bindings: p1.bindings };
  const inv2 = compileOnePage(richDoc(), { config });
  const p2 = autoMotions({ pc: inv2 }, config);
  const itemMotion = p2.applied.filter((row) => row.ref === 'node:20:2');
  assert.equal(itemMotion.length, 0, 'item/条目 不应在第二轮补动效（父级覆盖必须延续）');
});

test('显式输入的 motion 不被覆盖/改写，显式冲突仍由编译器照报', () => {
  // 显式给 item 配 content-left（与父 list 的自动 cards-center 嵌套合法）
  const explicitMotions = {
    'item-anim': { rule: 'content-left', unit: 'whole', trigger: 'section-enter', source: '用户显式配置' },
  };
  const explicitConfig = {
    motions: explicitMotions,
    bindings: { 'node:20:2': { motion: 'item-anim' } },
  };
  const inv = compileOnePage(richDoc(), { config: explicitConfig });
  assert.deepEqual(motionIssuesOf(inv), [], JSON.stringify(motionIssuesOf(inv)));
  const patch = autoMotions({ pc: inv }, explicitConfig);
  assert.equal(patch.motions['item-anim'], explicitMotions['item-anim'], '显式动效条目不得改写');
  assert.equal(patch.applied.some((row) => row.ref === 'node:20:2'), false, '显式节点不得再补动效');
  // 显式冲突：sec 配 section-fade 同时子 title 配 menu-fade（非法组合）→ 编译器照报
  const conflictConfig = {
    motions: {
      secA: { rule: 'section-fade', unit: 'whole', trigger: 'section-change', source: '用户显式配置' },
      bad: { rule: 'menu-fade', unit: 'whole', trigger: 'open-close', source: '用户显式配置' },
    },
    bindings: {
      'node:10:2': { motion: 'secA' },
      'node:11:3': { motion: 'secA' },
    },
  };
  const conflictInv = compileOnePage(richDoc(), { config: conflictConfig });
  // title 在另一 sec，改为同 sec 内冲突：sec/2 配 section-fade 且其 title 配 menu-fade 不合法（menu-fade 角色不符则报 CONTRACT）
  assert.ok(motionIssuesOf(conflictInv).length > 0, '显式非法组合/角色必须仍报 MOTION_*');
});

test('显式父子真冲突（无嵌套白名单）仍报 MOTION_COMPOSITION/OVERLAP', () => {
  // item 配 content-left、父 list 也配 content-left：content-left 不在自身嵌套白名单 → 编译器必报
  const config = {
    motions: {
      pm: { rule: 'content-left', unit: 'whole', trigger: 'section-enter', source: '用户显式配置' },
      cm: { rule: 'content-left', unit: 'whole', trigger: 'section-enter', source: '用户显式配置' },
    },
    bindings: {
      'node:20:1': { motion: 'pm' },
      'node:20:2': { motion: 'cm' },
    },
  };
  const inv = compileOnePage(richDoc(), { config });
  const codes = motionIssuesOf(inv).map((row) => row.code);
  assert.ok(codes.includes('MOTION_COMPOSITION') || codes.includes('MOTION_OVERLAP'), `应报显式冲突，实际：${JSON.stringify(codes)}`);
});

test('autoMotions 不吞掉输入库存里已有的显式动效（即便 binding 丢失仍视为覆盖）', () => {
  // 直接构造 node.motion 已存在但 bindings 键不在 existing 里的情形：
  // chosen 覆盖判断只看节点动效事实，不依赖配置是否可寻回。
  const inv = compileOnePage(richDoc(), {
    config: {
      motions: { pm: { rule: 'content-left', unit: 'whole', trigger: 'section-enter', source: '用户显式配置' } },
      bindings: { 'node:20:1': { motion: 'pm' } },
    },
  });
  assert.deepEqual(motionIssuesOf(inv), []);
  // existing 传空：模拟配置寻回失败场景——item 仍不应被补动效，因为 node.motion 事实在库存里
  const patch = autoMotions({ pc: inv }, {});
  assert.equal(patch.applied.some((row) => row.ref === 'node:20:2'), false, '父级已有动效（即便不在 existing）时子 item 不得二次补');
});
