import test from 'node:test';
import assert from 'node:assert/strict';
import {
  childUsesParentLocalX,
  modalFitScale,
  textFitPolicy,
  authorizeNamedModalOpen,
  resolveModalReturn,
  persistNamedModal,
  dropmenuSelect,
  localeInvariantCopy,
  bindCopyRow,
  preserveTextMetricsOnCopySwap,
  lastSectionScrollMax,
  productInteractionEntry,
  packFreshness,
} from '../lib/page-behavior-contracts.mjs';

test('SC-07 nested children keep parent-local x and skip a second page offset', () => {
  const nested = childUsesParentLocalX({ parentX: 200, childPageX: 260 });
  assert.equal(nested.localX, 60);
  assert.equal(nested.applyPageOffset, false);
  const already = childUsesParentLocalX({ parentX: 200, childPageX: 60, alreadyAppliedPageOffset: true });
  assert.equal(already.localX, 60);
  assert.equal(already.reason, 'skip-second-page-offset');
});

test('SC-01 modal scales from its own pageBox once', () => {
  const first = modalFitScale({ modalDesignW: 750, viewportW: 390 });
  assert.equal(first.k, 390 / 750);
  const second = modalFitScale({ modalDesignW: 750, viewportW: 390, alreadyScaled: true });
  assert.equal(second.k, 1);
  assert.equal(second.reason, 'skip-second-scale');
});

test('SC-09 width-lock height-free text wraps instead of shrinking', () => {
  const open = textFitPolicy({ maxWidth: 700 });
  assert.equal(open.shrink, false);
  assert.equal(open.growHeight, true);
  const capped = textFitPolicy({ maxWidth: 700, maxHeight: 116 });
  assert.equal(capped.shrink, true);
  assert.equal(capped.growHeight, false);
});

test('SC-02 only authorized painted-hit openers open a named modal', () => {
  const box = { x: 10, y: 10, w: 40, h: 20 };
  const ok = authorizeNamedModalOpen({
    triggerFrom: ['btn-a'],
    clickNodeId: 'btn-a',
    pointer: { x: 20, y: 15 },
    paintedBox: box,
  });
  assert.equal(ok.open, true);
  const outside = authorizeNamedModalOpen({
    triggerFrom: ['btn-a'],
    clickNodeId: 'btn-a',
    pointer: { x: 90, y: 15 },
    paintedBox: box,
  });
  assert.equal(outside.open, false);
  const nested = authorizeNamedModalOpen({
    triggerFrom: ['btn-a'],
    clickNodeId: 'lang-option',
    pointer: { x: 20, y: 15 },
    paintedBox: box,
  });
  assert.equal(nested.open, false);
});

test('SC-05 complete close returns to the page; rules close return to reservation', () => {
  const done = resolveModalReturn({ currentName: 'pc预约完成', closeKind: 'close' });
  assert.equal(done.next, null);
  const rules = resolveModalReturn({
    currentName: 'modal/mobile弹窗详细规则2',
    closeKind: 'close',
    sourceName: 'modal/mobile_kr预约弹窗',
  });
  assert.equal(rules.next, 'modal/mobile_kr预约弹窗');
});

test('SC-06 composition switch keeps the same modal topic and locale', () => {
  const next = persistNamedModal({
    openName: 'modal/pc_tw预约弹窗',
    fromComposition: 'pc',
    toComposition: 'mobile',
    lang: 'zh-TW',
    catalog: ['modal/pc_tw预约弹窗', 'modal/mobile_tw预约弹窗', 'modal/mobile_kr预约弹窗'],
  });
  assert.equal(next.keep, true);
  assert.equal(next.nextName, 'modal/mobile_tw预约弹窗');
});

test('SC-03 dropmenu selection moves highlight without copying sibling labels', () => {
  const selected = dropmenuSelect({
    options: [
      { label: '台灣', value: '+886' },
      { label: '香港', value: '+852' },
      { label: '澳門', value: '+853' },
    ],
    selectedIndex: 1,
  });
  assert.equal(selected.open, false);
  assert.equal(selected.selectedValue, '+852');
  assert.equal(selected.options[0].label, '台灣');
  assert.equal(selected.options[1].selected, true);
  assert.equal(selected.options[2].label, '澳門');
});

test('SC-11 calendar brand names stay locale-invariant', () => {
  assert.equal(localeInvariantCopy('Outlook.com'), true);
  assert.equal(localeInvariantCopy('Microsoft 365'), true);
  assert.equal(localeInvariantCopy('将SS14困兽赛季前瞻直播'), false);
});

test('SC-13 copy rows fail closed when empty or ambiguous', () => {
  assert.equal(bindCopyRow({ nodeId: 'n1', row: 55, unique: true }).ok, true);
  assert.equal(bindCopyRow({ nodeId: 'n1', empty: true }).ok, false);
  assert.equal(bindCopyRow({ nodeId: 'n1', unique: false, row: 55 }).reason, 'ambiguous-or-missing-row');
});

test('SC-13 copy swap keeps letter-spacing and font metrics', () => {
  const kept = preserveTextMetricsOnCopySwap({
    before: { fontSize: 40, letterSpacing: 52.5, textAlign: 'center' },
    after: { fontSize: 40, letterSpacing: 52.5, textAlign: 'center' },
  });
  assert.equal(kept.ok, true);
  const drifted = preserveTextMetricsOnCopySwap({
    before: { letterSpacing: 52.5 },
    after: { letterSpacing: 0 },
  });
  assert.equal(drifted.ok, false);
});

test('SC-14 last section clamps scroll to authored content bottom', () => {
  const clamp = lastSectionScrollMax({ lastContentBottom: 2200, viewportH: 900 });
  assert.equal(clamp.maxScroll, 1300);
});

test('SC-16 QA keeps chrome; product default can enable interaction', () => {
  const qa = productInteractionEntry({ productQuery: null, interactionQuery: '1' });
  assert.equal(qa.qaChrome, true);
  assert.equal(qa.enablePageInteraction, true);
  const product = productInteractionEntry({ defaultProduct: true });
  assert.equal(product.productView, true);
  assert.equal(product.qaChrome, false);
  assert.equal(product.enablePageInteraction, true);
});

test('SC-17 stale zip cannot prove the current pack', () => {
  assert.equal(packFreshness({ packedHash: 'a', deployedHash: 'a' }).ok, true);
  assert.equal(packFreshness({ staleZip: true, packedHash: 'a', deployedHash: 'a' }).ok, false);
  assert.equal(packFreshness({ packedHash: 'a', deployedHash: 'b' }).reason, 'hash-mismatch');
});
