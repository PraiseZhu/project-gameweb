import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCopy,
  collectInventoryTexts,
  consumeReadyCopy,
  verifySplitIntegrity,
} from '../lib/copy-consumer.mjs';
import { makeLark, mobileInventory, pcInventory } from './helpers/ready-fixture.mjs';
import { cellLines, overflowAltIndex, parseOverflowAlt, preserveSourceLeadingAsterisks } from '../lib/figma-copy-structure.mjs';
import { createScreenController, deviceOf, rootFontPx, shouldAdvanceFromScroll, WHEEL_INTENT_PX } from '../../assets/runtime/ews-screen-runtime.mjs';

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

test('authorized original keep is preview-ok but never translationAccepted', () => {
  const p = pcInventory();
  p.nodes.find((node) => node.id === '100:5').characters = '找不到的原文';
  p.nodes.find((node) => node.id === '100:5').text.characters = '找不到的原文';
  const blocked = buildCopy({ inventories: { pc: p }, larkSnapshot: makeLark(), locales: ['zh-CN', 'en'] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.translationAccepted, false);
  const kept = buildCopy({
    inventories: { pc: p },
    larkSnapshot: makeLark(),
    locales: ['zh-CN', 'en'],
    designations: { deliberatelyUnbound: { '100:5': { why: 'user authorized original' } } },
  });
  assert.equal(kept.ok, true, JSON.stringify(kept.problems));
  assert.equal(kept.translationAccepted, false);
  assert.equal(kept.byPlatform.pc.byNode['100:5'].matchKind, 'deliberately-unbound');
  assert.ok((kept.notices || []).some((item) => item.reason === 'authorized-original' && item.nodeId === '100:5'));
});

test('unique A&B heading binds the full cell; source locale keeps Figma text', () => {
  const lark = makeLark();
  lark._meta.phaseRows = [...lark._meta.phaseRows, 50, 51];
  lark.rows[50] = { 'zh-CN': '赛程信息&赛事奖励', en: 'Schedule & Rewards' };
  lark.rows[51] = { 'zh-CN': '全球总决赛选手名单', en: 'Global Finals Roster' };
  const inventory = pcInventory();
  const title = inventory.nodes.find((node) => node.id === '100:5');
  title.characters = '赛程信息';
  title.text.characters = '赛程信息';
  const bound = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    platform: 'pc',
    locales: ['zh-CN', 'en'],
  });
  assert.equal(bound.ok, true, JSON.stringify(bound.problems));
  const node = bound.byNode['100:5'];
  assert.equal(node.matchKind, 'joined-heading');
  assert.equal(String(node.row), '50');
  assert.equal(node.translations['zh-CN'].value, '赛程信息&赛事奖励');
  assert.equal(node.translations.en.value, 'Schedule & Rewards');
  assert.equal(node.translations.en.locator, '/rows/50/en');

  title.characters = '全球总决赛';
  title.text.characters = '全球总决赛';
  const prefix = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    platform: 'pc',
    locales: ['zh-CN', 'en'],
  });
  assert.notEqual(prefix.byNode['100:5']?.matchKind, 'joined-heading');
  assert.notEqual(String(prefix.byNode['100:5']?.row || ''), '51');

  const rebound = pcInventory();
  rebound.nodes.find((node) => node.id === '100:5').characters = '赛程信息';
  rebound.nodes.find((node) => node.id === '100:5').text.characters = '赛程信息';
  const stillUnbound = consumeReadyCopy({
    inventory: rebound,
    larkSnap: lark,
    platform: 'pc',
    locales: ['zh-CN', 'en'],
    designations: { deliberatelyUnbound: { '100:5': { why: 'keep original' } } },
  });
  assert.equal(stillUnbound.byNode['100:5'].matchKind, 'deliberately-unbound');

  lark.rows[52] = { 'zh-CN': '赛程信息&别的', en: 'Other Rewards' };
  lark._meta.phaseRows = [...lark._meta.phaseRows, 52];
  title.characters = '赛程信息';
  title.text.characters = '赛程信息';
  const ambiguous = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    platform: 'pc',
    locales: ['zh-CN', 'en'],
  });
  assert.equal(ambiguous.byNode['100:5'].matchKind, 'ambiguous');
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
  listeners.wheel({ deltaY: WHEEL_INTENT_PX, preventDefault() {} });
  assert.equal(wheel.getState().screen, 'b');
  assert.ok(Object.keys(listeners).includes('pointerdown'));
  assert.ok(Object.keys(listeners).includes('touchstart'));
  controller.destroy();
  wheel.destroy();
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

test('live copy ignores component-set masters and keeps modal TEXT', () => {
  const texts = collectInventoryTexts(pcInventory());
  const ids = texts.map((item) => item.nodeId);
  assert.ok(ids.includes('100:5'));
  assert.ok(ids.includes('100:25'));
  assert.ok(!ids.includes('100:35'));
  assert.ok(!ids.includes('100:36'));
});

test('identical chrome clones may reuse one note-prefixed slice; different 赛事视频 rows stay split', () => {
  const pageId = '300:1';
  const hero = '300:2';
  const nav = '300:3';
  const inventory = {
    schema: 'inventory/v2',
    status: 'ready',
    page: { id: pageId },
    nodes: [
      { id: pageId, type: 'FRAME', name: 'cn_pc', parentId: null },
      { id: hero, type: 'FRAME', name: 'sec/6', parentId: pageId },
      { id: nav, type: 'FRAME', name: 'fix/顶部导航通栏', parentId: hero },
      {
        id: '300:10', type: 'TEXT', name: '文案内容', parentId: nav, status: 'determined',
        characters: '赛事视频', text: { characters: '赛事视频' },
      },
      {
        id: '300:11', type: 'TEXT', name: '文案内容', parentId: nav, status: 'determined',
        characters: '赛事视频', text: { characters: '赛事视频' },
      },
      {
        id: '300:12', type: 'FRAME', name: '标题模块', parentId: hero,
      },
      {
        id: '300:13', type: 'TEXT', name: '文案内容', parentId: '300:12', status: 'determined',
        characters: '赛事视频', text: { characters: '赛事视频' },
      },
      {
        id: '300:14', type: 'TEXT', name: '线上赛', parentId: hero, status: 'determined',
        characters: '线上赛', text: { characters: '线上赛' },
      },
    ],
    attachments: {
      modals: [{
        id: '300:20', type: 'FRAME', name: 'modal/顶部导航-1624尺寸',
        nodes: [{
          id: '300:21', type: 'TEXT', name: '官网主页', status: 'determined',
          characters: '赛事视频', text: { characters: '赛事视频' }, parentId: '300:20',
        }],
      }],
      componentSets: [{
        id: '300:90', type: 'COMPONENT_SET', name: '顶部导航栏',
        variants: [{ id: '300:91', componentProperties: { lang: 'cn' }, nodes: [{
          id: '300:92', type: 'TEXT', status: 'determined', characters: '文案内容',
        }] }],
      }],
    },
  };
  const lark = {
    _meta: {
      langCols: { B: 'zh-CN', C: 'en', D: 'ja', E: 'ko', F: 'zh-TW' },
      phaseRows: [7, 12, 24, 34],
    },
    rows: {
      7: {
        'zh-CN': '导航栏文本，尽可能短&整齐：\n赛事视频',
        en: '导航栏文本，尽可能短&整齐：\nEvent Videos',
        ja: '导航栏文本，尽可能短&整齐：\n大会動画',
        ko: '导航栏文本，尽可能短&整齐：\n대회 영상',
        'zh-TW': '导航栏文本，尽可能短&整齐：\n賽事影片',
      },
      12: {
        'zh-CN': '【这里除了简中默认按英语翻译，如有问题请标注】\n线上赛\n线下赛',
        en: '【这里除了简中默认按英语翻译，如有问题请标注】\nOnline Stage\nOffline Stage',
        ja: 'x', ko: 'x', 'zh-TW': 'x',
      },
      24: {
        'zh-CN': '线上赛', en: 'Online Stage', ja: 'オンライン戦', ko: '온라인 파이널', 'zh-TW': '線上賽',
      },
      34: {
        'zh-CN': '页内文案，不限制：\n赛事视频',
        en: '页内文案，不限制：\nEWS Videos',
        ja: '页内文案，不限制：\n大会動画',
        ko: '页内文案，不限制：\n대회 영상',
        'zh-TW': '页内文案，不限制：\n賽事影片',
      },
    },
  };
  delete lark.rows[12];
  lark._meta.phaseRows = [7, 24, 34];
  const designations = {
    designations: {
      '300:10': { row: 7, lineIndex: 1, takeCount: 1, why: 'nav' },
      '300:11': { row: 7, lineIndex: 1, takeCount: 1, why: 'nav-clone' },
      '300:21': { row: 7, lineIndex: 1, takeCount: 1, why: 'nav-modal' },
      '300:13': { row: 34, lineIndex: 1, takeCount: 1, why: 'page' },
      '300:14': { row: 24, why: 'online-stage' },
    },
  };
  const result = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    designations,
    platform: 'pc',
    locales: ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'],
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.byNode['300:10'].translations.en.value, 'Event Videos');
  assert.equal(result.byNode['300:11'].translations.en.value, 'Event Videos');
  assert.equal(result.byNode['300:21'].translations.en.value, 'Event Videos');
  assert.equal(result.byNode['300:13'].translations.en.value, 'EWS Videos');
  assert.equal(result.byNode['300:14'].translations.en.value, 'Online Stage');
  assert.equal(result.byNode['300:13'].translations['zh-CN'].value, '赛事视频');
  assert.ok(!collectInventoryTexts(inventory).some((item) => item.nodeId === '300:92'));

  const withRow12 = {
    ...lark,
    _meta: { ...lark._meta, phaseRows: [7, 12, 24, 34] },
    rows: {
      ...lark.rows,
      12: {
        'zh-CN': '【这里除了简中默认按英语翻译，如有问题请标注】\n线上赛\n线下赛',
        en: '【注释】\nOnline Stage\nOffline Stage',
        ja: 'x', ko: '括号注释', 'zh-TW': 'x',
      },
    },
  };
  const leftover = consumeReadyCopy({
    inventory,
    larkSnap: {
      ...withRow12,
      _meta: { ...withRow12._meta, phaseRows: [7, 24, 34] },
    },
    designations,
    platform: 'pc',
    locales: ['zh-CN', 'en', 'ja', 'ko', 'zh-TW'],
  });
  assert.equal(leftover.ok, true, JSON.stringify(leftover.problems));
  assert.equal(String(leftover.byNode['300:14'].row), '24');
  assert.equal(leftover.byNode['300:14'].translations.ko.value, '온라인 파이널');
});

test('trailing-space table cell is not value-tamper against trimmed Figma TEXT', () => {
  const inventory = {
    schema: 'inventory/v2',
    status: 'ready',
    page: { id: '400:1' },
    nodes: [
      { id: '400:1', type: 'FRAME', name: 'sec/4', parentId: null },
      {
        id: '400:2', type: 'TEXT', name: '对阵2', parentId: '400:1', status: 'determined',
        characters: '对阵2', text: { characters: '对阵2' },
      },
    ],
    attachments: { modals: [] },
  };
  const lark = {
    _meta: { langCols: { B: 'zh-CN', C: 'en' }, phaseRows: [30] },
    rows: { 30: { 'zh-CN': '对阵2 ', en: 'Match 2' } },
  };
  const result = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    designations: { designations: { '400:2': { row: 30, why: 'trim' } } },
    platform: 'pc',
    locales: ['zh-CN', 'en'],
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.byNode['400:2'].translations['zh-CN'].value, '对阵2');
  assert.equal(result.byNode['400:2'].translations.en.value, 'Match 2');
});

test('source leading asterisk is preserved on adopted locales', () => {
  assert.equal(preserveSourceLeadingAsterisks('*各赛区', '各赛区'), '*各赛区');
  assert.equal(preserveSourceLeadingAsterisks('*各赛区', '*各赛区'), '*各赛区');
  assert.equal(preserveSourceLeadingAsterisks('各赛区', '各赛区'), '各赛区');
  const inventory = {
    schema: 'inventory/v2',
    status: 'ready',
    page: { id: '500:1' },
    nodes: [
      { id: '500:1', type: 'FRAME', name: 'sec/2', parentId: null },
      {
        id: '500:2', type: 'TEXT', name: 'copy/note', parentId: '500:1', status: 'determined',
        characters: '*各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金',
        text: { characters: '*各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金' },
      },
    ],
    attachments: { modals: [] },
  };
  const lark = {
    _meta: { langCols: { B: 'zh-CN', C: 'en', D: 'ja' }, phaseRows: [38] },
    rows: {
      38: {
        'zh-CN': '各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金',
        en: 'Rankings note',
        ja: '注記',
      },
    },
  };
  const result = consumeReadyCopy({
    inventory,
    larkSnap: lark,
    designations: { designations: { '500:2': { row: 38, why: 'figma-leading-asterisk' } } },
    platform: 'pc',
    locales: ['zh-CN', 'en', 'ja'],
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.byNode['500:2'].translations['zh-CN'].value, '*各赛区巅峰榜封榜结算天梯排名时为准，第一名获得奖金');
  assert.equal(result.byNode['500:2'].translations.en.value, '*Rankings note');
  assert.equal(result.byNode['500:2'].translations.ja.value, '*注記');
});

test('table overflow-alt notes pair long forms to short forms without inventing text', () => {
  const cell = `【备注】\n온라인 파이널\n오프라인 파이널\n(EWC)\n太长放不下去的话可以改成\n온라인\n오프라인\n去掉后面的【对决】`;
  assert.deepEqual(parseOverflowAlt(cell), [
    { long: '온라인 파이널', short: '온라인' },
    { long: '오프라인 파이널', short: '오프라인' },
  ]);
  const lark = makeLark();
  lark.rows[12].en = 'Title C';
  lark.rows[99].ko = cell;
  const index = overflowAltIndex(lark);
  assert.equal(index.get('ko\n온라인 파이널'), '온라인');
});

test('consumeReadyCopy stamps overflowAlt from leftover cells onto matching values', () => {
  const lark = makeLark();
  delete lark.rows[15];
  lark.rows[99].en = 'Word-One\n太长放不下去的话可以改成\nWord';
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
  assert.equal(result.byNode['100:6'].translations.en.value, 'Word-One');
  assert.equal(result.byNode['100:6'].translations.en.overflowAlt, 'Word');
});
