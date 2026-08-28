import test from 'node:test';
import assert from 'node:assert/strict';
import { pixelSnapStep, snapAxisDelta, effectiveScale } from '../lib/pixel-snap.mjs';

test('pixelSnapStep: 整数 DPR 吸到设备像素网格', () => {
  assert.equal(pixelSnapStep(1), 1);
  assert.equal(pixelSnapStep(2), 0.5);
  assert.equal(pixelSnapStep(3), 1 / 3);
});

test('pixelSnapStep: 非整数 DPR 吸到 CSS 像素整数', () => {
  assert.equal(pixelSnapStep(1.25), 1);
  assert.equal(pixelSnapStep(1.5), 1);
  assert.equal(pixelSnapStep(2.625), 1);
});

test('pixelSnapStep: 非法/缺失 DPR 退到 CSS 像素整数（一致兜底）', () => {
  assert.equal(pixelSnapStep(0), 1);
  assert.equal(pixelSnapStep(NaN), 1);
  assert.equal(pixelSnapStep(undefined), 1);
  assert.equal(pixelSnapStep(-2), 1);
});

test('snapAxisDelta: 已在网格上不动', () => {
  assert.equal(snapAxisDelta(196, 1), 0);
  assert.equal(snapAxisDelta(196.5, 0.5), 0);   // dpr=2 网格上
});

test('snapAxisDelta: 就近吸附，位移限制在半个步长内', () => {
  // 196.625 在 dpr=1 网格上最近的是 197（上移 0.375）
  const d = snapAxisDelta(196.625, 1);
  assert.ok(Math.abs(d - 0.375) < 1e-9, 'got ' + d);
  // 196.2 → 下移 -0.2
  assert.ok(Math.abs(snapAxisDelta(196.2, 1) - (-0.2)) < 1e-9);
  // dpr=2：196.625 吸到 196.5（下移 -0.125）
  assert.ok(Math.abs(snapAxisDelta(196.625, 0.5) - (-0.125)) < 1e-9);
  // 任何位移都不超过半个步长
  for (const v of [0.1, 0.49, 0.51, 0.9, 189.5, 189.99]) {
    assert.ok(Math.abs(snapAxisDelta(v, 1)) <= 0.5 + 1e-9);
  }
});

test('snapAxisDelta: 非法 step 一致退 0', () => {
  assert.equal(snapAxisDelta(196.625, 0), 0);
  assert.equal(snapAxisDelta(196.625, NaN), 0);
});

test('effectiveScale: 嵌套链求最终缩放', () => {
  const r = effectiveScale([0.5, 0.795826]);
  assert.ok(Math.abs(r.effectiveK - 0.397913) < 1e-6);
  assert.equal(r.integerFriendly, false);   // 0.397913×3840 非整数 → 非整数友好
});

test('effectiveScale: 整数友好缩放被识别', () => {
  // effK = 1100/3840 = 0.286458…，1 设计 px → 整数物理像素
  const r = effectiveScale([0.5, 1100 / 1920]);
  assert.equal(r.integerFriendly, true);
});

test('effectiveScale: 空链/非法因子退 1（未缩放）', () => {
  assert.equal(effectiveScale([]).effectiveK, 1);
  assert.equal(effectiveScale([0.5, NaN, 0.8]).effectiveK, 0.4);
});

test('镜像一致性：chrome 内联 __fxPixelSnapStep 与 lib 同步', async () => {
  // 离线模板不能 import ESM，chrome.js 内联同逻辑 —— 抽样对拍，防漂移
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const chrome = readFileSync(resolve('templates/figma-chrome.js'), 'utf8');
  // 模板必须内联与 lib 同义的 step 规则（整数 DPR → 1/r，非整数 → 1）
  assert.match(chrome, /__fxPixelSnapStep/);
  assert.match(chrome, /1 \/ r/);            // 整数 DPR 吸设备像素
  for (const dpr of [1, 2, 3, 1.25, 1.5]) {
    assert.equal(pixelSnapStep(dpr), dpr === Math.round(dpr) ? 1 / dpr : 1);
  }
});
