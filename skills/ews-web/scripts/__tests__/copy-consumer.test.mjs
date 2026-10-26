import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopy,
  consumeReadyCopy,
  verifySplitIntegrity,
} from '../lib/copy-consumer.mjs';
import { makeLark, mobileInventory, pcInventory } from './helpers/ready-fixture.mjs';
import { cellLines } from '../lib/figma-copy-structure.mjs';
import { createScreenController, deviceOf, rootFontPx, shouldAdvanceFromScroll } from '../../assets/runtime/ews-screen-runtime.mjs';

test('C1 unique neighbor is adopted with locator/hash', () => {
  const lark = makeLark();
  lark.rows[99] = { 'zh-CN': '重复词', en: 'Word-Far' };
  delete lark.rows[15];
  const result = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
    designations: {
      designations: {
        '100:5': { row: 10, why: 'user' },
        '100:7': { row: 12, why: 'user' },
      },
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const mid = result.byNode['100:6'];
  assert.ok(mid, 'middle node should bind');
  assert.equal(String(mid.row), '11');
  const leaf = mid.translations.en;
  assert.equal(leaf.value, 'Word-One');
  assert.equal(leaf.locator, '/rows/11/en');
  assert.equal(leaf.hash, result.source.hash);
});

test('C2 same zh different translations stay unresolved; leftover outside phaseRows is not auto-adopted', () => {
  const lark = makeLark();
  const leftoverIgnored = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
  });
  assert.equal(String(leftoverIgnored.byNode['100:6']?.row), '11');
  assert.notEqual(leftoverIgnored.byNode['100:6']?.translations?.en?.value, 'Word-Two');
  lark._meta.phaseRows = [10, 11, 15, 21];
  lark.rows[12] = { 'zh-CN': '其他', en: 'Other' };
  const result = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
  });
  const unread = result.unread || [];
  const mid = result.byNode['100:6'];
  const midUnresolved = !mid?.translations?.en || unread.some((item) => /100:6|重复词|ambiguous/.test(JSON.stringify(item)));
  assert.ok(midUnresolved, JSON.stringify({ unread, mid }));
  const outOfRange = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    designations: { designations: { '100:5': { row: 99, why: 'bad' } } },
  });
  assert.equal(outOfRange.ok, false);
  assert.ok(outOfRange.problems.some((item) => /out-of-phase/.test(String(item))));
});

test('C3 designation span covers exact lines; out of range / zero take / duplicate same-end rejected; cross-end reuse allowed', () => {
  const lark = makeLark();
  const pc = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
    designations: {
      designations: {
        '100:10': { row: 21, lineIndex: 0, takeCount: 1, why: 'user' },
        '100:11': { row: 21, lineIndex: 1, takeCount: 2, why: 'user' },
      },
    },
  });
  assert.equal(pc.ok, true, JSON.stringify(pc.problems));
  assert.equal(pc.byNode['100:10'].translations['zh-CN'].value, '第一句');
  assert.equal(pc.byNode['100:11'].translations['zh-CN'].value, '第二句\n第三句');

  const oob = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
    designations: { designations: { '100:10': { row: 21, lineIndex: 9, takeCount: 1 } } },
  });
  assert.equal(oob.ok, false);
  assert.ok(oob.problems.some((item) => /lineIndex-out-of-range/.test(String(item))));

  const zero = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
    designations: { designations: { '100:10': { row: 21, lineIndex: 0, takeCount: 0 } } },
  });
  assert.equal(zero.ok, false);

  const dup = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    platform: 'pc',
    designations: {
      designations: {
        '100:10': { row: 21, lineIndex: 0, takeCount: 1 },
        '100:11': { row: 21, lineIndex: 0, takeCount: 1 },
      },
    },
  });
  assert.equal(dup.ok, false);
  assert.ok(dup.problems.some((item) => item.reason === 'duplicate-line-claim' || /duplicate-line-claim/.test(String(item))));

  const both = buildCopy({
    inventories: { pc: pcInventory(), mobile: mobileInventory() },
    larkSnapshot: lark,
    designations: {
      pc: { designations: { '100:5': { row: 10 } } },
      mobile: { designations: { '200:5': { row: 10 } } },
    },
  });
  assert.equal(both.ok, true, JSON.stringify(both.problems));
  assert.equal(both.byPlatform.pc.byNode['100:5'].row, 10);
  assert.equal(both.byPlatform.mobile.byNode['200:5'].row, 10);
});

test('C4 missing/duplicate/reordered split lines fail integrity', () => {
  const source = cellLines('第一句\n第二句\n第三句');
  assert.equal(verifySplitIntegrity(source, ['第一句', '第二句', '第三句']).ok, true);
  assert.equal(verifySplitIntegrity(source, ['第一句', '第三句']).ok, false);
  assert.equal(verifySplitIntegrity(source, ['第一句', '第二句', '第二句']).ok, false);
  assert.equal(verifySplitIntegrity(source, ['第三句', '第二句', '第一句']).ok, false);
});

test('unknown or non-TEXT designation is rejected; missing locale is not accepted', () => {
  const lark = makeLark();
  const missingNode = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    designations: { designations: { '999:999': { row: 10, why: 'adversarial' } } },
  });
  assert.equal(missingNode.ok, false);
  assert.ok(missingNode.problems.some((item) => /node-missing-or-not-text/.test(String(item))));
  const notText = consumeReadyCopy({
    inventory: pcInventory(),
    larkSnap: lark,
    designations: { designations: { '100:8': { row: 10, why: 'img' } } },
  });
  assert.equal(notText.ok, false);
  const p = pcInventory();
  p.nodes.find((node) => node.id === '100:5').characters = '找不到的原文';
  p.nodes.find((node) => node.id === '100:5').text.characters = '找不到的原文';
  const missing = buildCopy({ inventories: { pc: p }, larkSnapshot: makeLark(), locales: ['zh-CN', 'en'] });
  assert.equal(missing.translationAccepted, false);
  const lark2 = makeLark();
  delete lark2.rows[10].en;
  const missingLocale = buildCopy({ inventories: { pc: pcInventory() }, larkSnapshot: lark2, locales: ['zh-CN', 'en'] });
  assert.equal(missingLocale.translationAccepted, false);
});

test('locked goTo fails and wheel burst is throttled', () => {
  const controller = createScreenController({
    screens: ['a', 'b'],
    windowRef: { innerWidth: 1440, innerHeight: 900, addEventListener() {}, removeEventListener() {} },
  });
  controller.setLocked(true);
  const locked = controller.goTo('b');
  assert.equal(locked.ok, false);
  assert.equal(controller.getState().screen, 'a');
  const listeners = {};
  const win = { innerWidth: 1440, innerHeight: 900, addEventListener(k, f) { listeners[k] = f; }, removeEventListener() {} };
  const wheel = createScreenController({ screens: ['a', 'b', 'c'], windowRef: win });
  listeners.wheel({ deltaY: 0, deltaX: 50, preventDefault() {} });
  assert.equal(wheel.getState().screen, 'a');
  listeners.wheel({ deltaY: 1, preventDefault() {} });
  listeners.wheel({ deltaY: 1, preventDefault() {} });
  assert.equal(wheel.getState().screen, 'b');
  assert.ok(Object.keys(listeners).includes('pointerdown'));
  assert.ok(Object.keys(listeners).includes('touchstart'));
});

test('screen policy helpers: 750 mobile, 751 pc, wide aspect uses 19.2vh, short screen scrolls before flip', () => {
  assert.equal(deviceOf(750), 'mobile');
  assert.equal(deviceOf(751), 'pc');
  const wide = rootFontPx({ innerWidth: 1920, innerHeight: 1000 });
  assert.equal(wide, 192);
  const tall = rootFontPx({ innerWidth: 1440, innerHeight: 900 });
  assert.equal(tall, 144);
  assert.equal(shouldAdvanceFromScroll({
    deltaY: 40, scrollTop: 0, scrollHeight: 800, clientHeight: 500, locked: false, axis: 'y',
  }), false);
  assert.equal(shouldAdvanceFromScroll({
    deltaY: 40, scrollTop: 300, scrollHeight: 800, clientHeight: 500, locked: false, axis: 'y',
  }), true);
  assert.equal(shouldAdvanceFromScroll({
    deltaY: 40, scrollTop: 0, scrollHeight: 500, clientHeight: 500, locked: true, axis: 'y',
  }), false);
});

test('empty target translation and incomplete split groups fail in the consumer', () => {
  for (const empty of ['', '   ']) {
    const lark = makeLark();
    lark.rows[10].en = empty;
    const result = buildCopy({ inventories: { pc: pcInventory() }, larkSnapshot: lark, locales: ['zh-CN', 'en'] });
    assert.equal(result.ok, false);
    assert.equal(result.translationAccepted, false);
  }
  const result = consumeReadyCopy({
    inventory: pcInventory(), larkSnap: makeLark(), platform: 'pc', locales: ['zh-CN', 'en'],
    designations: { designations: {
      '100:10': { row: 21, lineIndex: 0, takeCount: 1 },
      '100:11': { row: 21, lineIndex: 1, takeCount: 1 },
    } },
  });
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((problem) => problem.reason === 'count-mismatch'));
});
