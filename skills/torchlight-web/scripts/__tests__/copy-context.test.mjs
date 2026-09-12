// copy-context.test.mjs — 同字段多场景翻译（任务3）的单元测试。
// 跑法：node --test scripts/__tests__/copy-context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveContext, buildAncestorMap, validateCopyOverlay, resolveContextualRow,
} from '../lib/figma-copy-context.mjs';
import { assertPhaseOneRows, extractCopy, parsePhaseRows } from '../lib/figma-copy-match.mjs';
const PHASE_ONE = Array.from({ length: 52 }, (_, i) => i + 3);
import { assessCopyCoverage, collectInventoryTexts } from '../lib/figma-copy-coverage.mjs';
import { buildHandoffCopyEnvelope, designationsToOverlay } from '../lib/figma-copy-adapter.mjs';

/* ── deriveContext：场景信号机械派生，不手填 ─────────────────────────── */
test('deriveContext: 目录/toggle 场景判 nav，正文判 content', () => {
  const nav = deriveContext({
    name: '溢流', type: 'TEXT',
    ancestors: [{ name: 'switch/源器', type: 'INSTANCE' }, { name: 'sec/5-新源器', type: 'FRAME' }],
  });
  assert.equal(nav.scene, 'nav');
  assert.equal(nav.toggle, true);
  assert.equal(nav.section, 'sec/5');
  assert.equal(nav.contextKey, 'nav/toggle/component/sec/5');

  const body = deriveContext({
    name: '文案内容', type: 'TEXT',
    ancestors: [{ name: '标题', type: 'FRAME' }, { name: 'sec/11-优化', type: 'FRAME' }],
  });
  assert.equal(body.scene, 'content');
  assert.equal(body.toggle, false);
  assert.equal(body.contextKey, 'content/sec/11');

  const noSec = deriveContext({ name: '首页', type: 'TEXT', ancestors: [] });
  assert.equal(noSec.section, null);
  assert.equal(noSec.scene, 'content');
});

/* ── buildAncestorMap：从 children 索引 locator 认亲 ────────────────── */
test('buildAncestorMap: DFS 先序 + children 索引链认亲', () => {
  const leaf = (id, name, type, locator) => ({
    id: { value: id, provenance: { locator } },
    name: { value: name }, type: { value: type },
  });
  const nodes = [
    leaf('A', 'sec/5-新源器', 'FRAME', '/nodes/1:679/document/id'),
    leaf('B', 'switch/源器', 'INSTANCE', '/nodes/1:679/document/children/1/id'),
    leaf('C', '溢流', 'TEXT', '/nodes/1:679/document/children/1/children/0/id'),
  ];
  const map = buildAncestorMap(nodes);
  const ancC = map.get('C');
  assert.equal(ancC.length, 2);
  assert.equal(ancC[0].name, 'switch/源器'); // 近→远：父在前
  assert.equal(ancC[1].name, 'sec/5-新源器');
  assert.equal(map.get('A').length, 0);
});

test('buildAncestorMap: 传 at+figSnap 时回查 fixture，补被跳过的纯容器祖先', () => {
  // 纯容器(switch/源器)被 figma-geo 跳过、不进 truth.nodes，但 nav/toggle 信号来自它。
  const snap = {
    nodes: { '1:679': { document: {
      id: '1:679', name: 'sec/5-新源器', type: 'FRAME',
      children: [null, {
        id: 'M', name: '模块内容', type: 'FRAME', fills: [],
        children: [null, {
          id: 'S', name: 'switch/源器', type: 'INSTANCE', fills: [],
          children: [null, { id: 'T', name: '溢流', type: 'TEXT', fills: [{ type: 'SOLID' }] }],
        }],
      }],
    } },
    },
  };
  const at = (p) => p.split('/').slice(1).reduce((c, x) => { if (c == null) throw 0; return c[x]; }, snap);
  // truth 里只有 TEXT 溢流（容器都被跳过），locator 仍指向完整索引链。
  const nodes = [{
    id: { value: 'T', provenance: { locator: '/nodes/1:679/document/children/1/children/1/children/1/id' } },
    name: { value: '溢流' }, type: { value: 'TEXT' },
  }];
  const anc = buildAncestorMap(nodes, { at, figSnap: snap, sectionId: '1:679' }).get('T');
  assert.deepEqual(anc.map((a) => a.name), ['switch/源器', '模块内容']);
  assert.deepEqual(anc.map((a) => a.type), ['INSTANCE', 'FRAME']);
  // 有了 switch/ 祖先，deriveContext 应判 toggle/nav。
  const ctx = deriveContext({ name: '溢流', type: 'TEXT', ancestors: anc });
  assert.equal(ctx.toggle, true);
  assert.equal(ctx.component, true);
  assert.equal(ctx.scene, 'nav');
});

/* ── validateCopyOverlay：引用不存在的行/未知键即报 ────────────────── */
test('validateCopyOverlay: 未知 match 键与不存在的行都被揪出', () => {
  const rowExists = (r) => Number(r) < 100;
  const bad = validateCopyOverlay({
    contextMap: { '体验优化|nav/toggle': { row: 250 } },          // 行不存在
    rules: [
      { match: { bogus: 1 }, row: 5 },                            // 未知键
      { match: {}, row: 6 },                                      // 空 match（无条件压缩）
    ],
  }, { rowExists });
  assert.equal(bad.length, 3);
  assert.ok(bad.some((p) => p.includes('250')));
  assert.ok(bad.some((p) => p.includes('bogus')));
  assert.ok(bad.some((p) => p.includes('match 为空')));

  const good = validateCopyOverlay({
    contextMap: { '体验优化|nav/toggle': { row: 13 } },
    rules: [{ match: { scene: 'content' }, row: 86 }],
  }, { rowExists });
  assert.deepEqual(good, []);
});

/* ── resolveContextualRow：优先级 explicit > scene > length > group-default ── */
const at = (snap, p) => p.split('/').slice(1).reduce((c, s) => (c == null ? c : c[s]), snap);
const larkSnap = {
  _meta: { langCols: { D: 'zh-CN', J: 'ko' }, phaseRows: [13, 86] },
  rows: {
    13: { 'zh-CN': '体验优化', ko: '최적화', 'zh-TW': '體驗優化' },        // 目录短译
    86: { 'zh-CN': '体验优化', ko: 'UX 최적화', 'zh-TW': '體驗優化' },     // 内容长译(ko 不同)
  },
};
const LANGS = ['zh-CN', 'ko', 'zh-TW'];
const CANDS = [{ row: 13, rawZh: '体验优化' }, { row: 86, rawZh: '体验优化' }];

test('resolveContextualRow: 显式映射最优先', () => {
  const ctx = { contextKey: 'content/sec/11', scene: 'content' };
  const r = resolveContextualRow({
    zhNorm: '体验优化', candidates: CANDS, ctx,
    overlay: { contextMap: { '体验优化|content/sec/11': { row: 86 } } },
    larkSnap, at, langs: LANGS,
  });
  assert.equal(r.row, 86);
  assert.equal(r.via, 'explicit');
});

test('resolveContextualRow: 场景规则在组内默认之前', () => {
  const ctx = { contextKey: 'nav/toggle/sec/5', scene: 'nav', nav: true, toggle: true };
  const r = resolveContextualRow({
    zhNorm: '体验优化', candidates: CANDS, ctx,
    overlay: { rules: [{ match: { scene: 'nav' }, row: 13 }] },
    larkSnap, at, langs: LANGS,
  });
  assert.equal(r.row, 13);
  assert.equal(r.via, 'rule-scene');
});

test('resolveContextualRow: section/component 也是场景规则，不会降成长度规则', () => {
  const ctx = { contextKey: 'content/component/sec/11', scene: 'content', section: 'sec/11', component: true };
  const r = resolveContextualRow({
    zhNorm: '体验优化', candidates: CANDS, ctx,
    overlay: { rules: [{ match: { section: 'sec/11', component: true }, row: 86 }] },
    larkSnap, at, langs: LANGS,
  });
  assert.equal(r.row, 86);
  assert.equal(r.via, 'rule-scene');
});

test('validateCopyOverlay: 拒绝类型错误、场景冲突和不可能的长度区间', () => {
  const bad = validateCopyOverlay({
    contextMap: { '|nav': { row: 0 } },
    rules: [{
      match: { scene: 'content', nav: true, component: 'true', zhMinLen: 8, zhMaxLen: 2 },
      row: 'x',
    }],
  }, { rowExists: () => true });
  assert.ok(bad.some((p) => p.includes('contextMap 键必须')));
  assert.ok(bad.some((p) => p.includes('row 必须是正整数')));
  assert.ok(bad.some((p) => p.includes('component 必须是 boolean')));
  assert.ok(bad.some((p) => p.includes('zhMinLen 不能大于 zhMaxLen')));
  assert.ok(bad.some((p) => p.includes('scene=content')));
});

test('resolveContextualRow: 无映射/规则且译文不同 → unresolved 不猜', () => {
  const ctx = { contextKey: 'content/sec/11', scene: 'content' };
  const r = resolveContextualRow({
    zhNorm: '体验优化', candidates: CANDS, ctx, overlay: null,
    larkSnap, at, langs: LANGS,
  });
  assert.equal(r.unresolved, true);
  assert.equal(r.via, 'unresolved');
});

test('resolveContextualRow: 候选行译文完全一致 → group-default 取最小行号', () => {
  const same = { rows: { 5: { 'zh-CN': 'X', en: 'X' }, 9: { 'zh-CN': 'X', en: 'X' } } };
  const ctx = { contextKey: 'content', scene: 'content' };
  const r = resolveContextualRow({
    zhNorm: 'X', candidates: [{ row: 9 }, { row: 5 }], ctx, overlay: null,
    larkSnap: same, at, langs: ['zh-CN', 'en'],
  });
  assert.equal(r.row, 5);
  assert.equal(r.via, 'group-default');
});

/* ── extractCopy 集成：多场景经 overlay 解析后落唯一行、进 contextual 留痕 ── */
test('extractCopy: 同名多场景按 overlay 场景规则选定，留 contextual 痕迹', () => {
  const texts = [
    { nodeId: 'N-nav', name: '溢流', characters: '体验优化' },
    { nodeId: 'N-body', name: '文案内容', characters: '体验优化' },
  ];
  const contexts = new Map([
    ['N-nav', { contextKey: 'nav/toggle/sec/5', scene: 'nav', nav: true, toggle: true }],
    ['N-body', { contextKey: 'content/sec/11', scene: 'content' }],
  ]);
  const overlay = {
    rules: [
      { match: { scene: 'nav' }, row: 13 },
      { match: { scene: 'content' }, row: 86 },
    ],
  };
  const leaf = (p) => ({ value: at(larkSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap, at, larkLeaf: leaf, texts, copyOverlay: overlay, contexts });
  assert.equal(out.byNode['N-nav'].row, 13);
  assert.equal(out.byNode['N-body'].row, 86);
  assert.equal(out.byNode['N-nav'].context.via, 'rule-scene');
  const resolved = out.report.contextual.filter((c) => c.resolved);
  assert.equal(resolved.length, 2);
  assert.equal(out.report.ambiguous, 0); // 都被场景解析收编，不再 ambiguous
});

test('extractCopy: 无 overlay 时多场景仍 ambiguous 报红（诚实默认不丢）', () => {
  const texts = [{ nodeId: 'N1', name: 'x', characters: '体验优化' }];
  const contexts = new Map([['N1', { contextKey: 'content', scene: 'content' }]]);
  const leaf = (p) => ({ value: at(larkSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap, at, larkLeaf: leaf, texts, contexts });
  assert.equal(out.report.ambiguous, 1);
  assert.equal(out.byNode['N1'].matchKind, 'ambiguous');
  assert.equal(out.report.contextual.filter((c) => !c.resolved).length, 1);
});

/* ── copy coverage：有 copy fixture 时，空 truth/report 不许误绿 ─────── */
const leaf = (value, locator) => ({
  value,
  provenance: { source: 'fixtures/lark-copy.json', sourceKind: 'fixture', locator },
});
const sourceTexts = [{ nodeId: 'N1', name: '标题', characters: '体验优化' }];

test('copy coverage: copy fixture 存在但 truth/report 未接线必须报红', () => {
  const out = assessCopyCoverage({
    sourceTexts, truth: { copy: { byNode: {} } }, report: {}, larkSnapshot: larkSnap,
  });
  assert.equal(out.ok, false);
  assert.ok(out.errors.some((e) => e.kind === 'copy-unwired-truth'));
  assert.ok(out.errors.some((e) => e.kind === 'copy-unwired-report'));
  assert.ok(out.errors.some((e) => e.kind === 'unaccounted-text'));
});

test('copy coverage: 表叶子 + contextual 证据齐全才通过', () => {
  const out = assessCopyCoverage({
    sourceTexts,
    truth: { copy: { byNode: {
      N1: {
        translations: { 'zh-CN': leaf('体验优化', '/rows/86/zh-CN'), ko: leaf('UX 최적화', '/rows/86/ko') },
        context: { contextKey: 'content/sec/11', scene: 'content', via: 'explicit' },
      },
    } } },
    report: { copy: { unread: [], report: { contextual: [{ nodeId: 'N1', resolved: true, via: 'explicit' }] } } },
    larkSnapshot: larkSnap,
  });
  assert.equal(out.ok, true);
  assert.equal(out.contextualCount, 1);
});

test('extractCopy: one table sentence can occupy adjacent time and title TEXT layers', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' }, phaseRows: PHASE_ONE },
    rows: {
      26: {
        'zh-CN': '16:30 主创演讲\n16:50 现场提问&主创答疑',
        en: '1:30 AM PDT: Developer Talk\n1:50 AM PDT: Q&A',
        'zh-TW': '16:30 開發團隊分享\n16:50 Q&A 問答',
      },
    },
  };
  const pc = [
    { nodeId: 'T1', name: 'time', characters: '16:30', parentId: 'row1', orderKey: '1.0' },
    { nodeId: 'N1', name: 'title', characters: '主创演讲', parentId: 'row1', orderKey: '1.1' },
    { nodeId: 'T2', name: 'time', characters: '16:50', parentId: 'row2', orderKey: '2.0' },
    { nodeId: 'N2', name: 'title', characters: '现场提问&主创答疑', parentId: 'row2', orderKey: '2.1' },
  ];
  const mobile = [
    { nodeId: 'N1m', name: 'title', characters: '主创演讲', parentId: 'm1', orderKey: '1.1' },
    { nodeId: 'T1m', name: 'time', characters: '16:30', parentId: 'm1', orderKey: '1.2' },
    { nodeId: 'N2m', name: 'title', characters: '现场提问&主创答疑', parentId: 'm2', orderKey: '2.1' },
    { nodeId: 'T2m', name: 'time', characters: '16:50', parentId: 'm2', orderKey: '2.2' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const outPc = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts: pc });
  assert.equal(outPc.byNode.T1.matchKind, 'cell-split');
  assert.equal(String(outPc.byNode.T1.row), '26');
  assert.equal(outPc.byNode.T1.translations.en.value, '1:30');
  assert.equal(outPc.byNode.N1.translations.en.value, 'AM PDT: Developer Talk');
  assert.equal(outPc.byNode.N2.translations['zh-TW'].value, 'Q&A 問答');
  const outMobile = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts: mobile });
  assert.equal(outMobile.byNode.N1m.matchKind, 'cell-split');
  assert.equal(outMobile.byNode.T1m.translations.en.value, '1:30');
  assert.equal(outMobile.byNode.N1m.translations.en.value, 'AM PDT: Developer Talk');
  assert.equal(outMobile.report.none, 0);
});

test('extractCopy: fewer locale sentences keep their own line count and mark extra layers absent', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' }, phaseRows: PHASE_ONE },
    rows: {
      26: {
        'zh-CN': '16:30 主创演讲\n16:50 现场提问&主创答疑\n17:40 游园体验\n18:40 开场秀\n19:00 赛季前瞻',
        en: '1:30 AM PDT: Developer Talk\n1:50 AM PDT: Q&A\n2:40 AM PDT: Venue Tour\n3:00 AM PDT: Special Guest Talk',
        'zh-TW': '16:30 開發團隊分享\n16:50 Q&A 問答\n17:40 現場巡禮\n18:40 開場秀\n19:00 SS13赛季前瞻',
      },
    },
  };
  const texts = [
    { nodeId: 'T1', name: '16:30', characters: '16:30', parentId: 'flow', orderKey: '1.0' },
    { nodeId: 'N1', name: '主创演讲', characters: '主创演讲', parentId: 'flow', orderKey: '1.1' },
    { nodeId: 'T2', name: '16:50', characters: '16:50', parentId: 'flow', orderKey: '2.0' },
    { nodeId: 'N2', name: '现场提问&主创答疑', characters: '现场提问&主创答疑', parentId: 'flow', orderKey: '2.1' },
    { nodeId: 'T3', name: '17:40', characters: '17:40', parentId: 'flow', orderKey: '3.0' },
    { nodeId: 'N3', name: '游园体验', characters: '游园体验', parentId: 'flow', orderKey: '3.1' },
    { nodeId: 'T4', name: '18:40', characters: '18:40', parentId: 'flow', orderKey: '4.0' },
    { nodeId: 'N4', name: '开场秀', characters: '开场秀', parentId: 'flow', orderKey: '4.1' },
    { nodeId: 'T5', name: '19:00', characters: '19:00', parentId: 'flow', orderKey: '5.0' },
    { nodeId: 'N5', name: '赛季前瞻', characters: '赛季前瞻', parentId: 'flow', orderKey: '5.1' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.T1.translations.en.value, '1:30');
  assert.equal(out.byNode.N1.translations.en.value, 'AM PDT: Developer Talk');
  assert.equal(out.byNode.T4.translations.en.value, '3:00');
  assert.equal(out.byNode.N4.translations.en.value, 'AM PDT: Special Guest Talk');
  assert.equal(out.byNode.T5.translations.en.absent, true);
  assert.equal(out.byNode.T5.translations.en.value, '');
  assert.equal(out.byNode.N5.translations.en.absent, true);
  assert.equal(out.byNode.T5.translations['zh-TW'].value, '19:00');
  assert.equal(out.byNode.N5.translations['zh-TW'].value, 'SS13赛季前瞻');
  assert.equal(out.byNode.T1.localeLineCounts.en, 4);
  assert.equal(out.byNode.T1.missingLangs.includes('en'), false);
});

test('extractCopy: designated nodeRow to a different multiline cell does not keep old split index', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      7: {
        'zh-CN': '赛季前瞻直面会\nSS13 守夜人',
        en: 'Afterlight\nNew Season Preview',
      },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
    },
  };
  const texts = [
    { nodeId: 'T1', name: 'title', characters: '赛季前瞻直面会', parentId: 'hero', orderKey: '1' },
    { nodeId: 'T2', name: 'tag', characters: 'SS13守夜人', parentId: 'hero', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { T2: { row: 8, why: 'review fixture: designated beats cell-split' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.T2.matchKind, 'designated-split-unresolved');
  assert.equal(String(out.byNode.T2.row), '8');
  assert.equal(out.byNode.T2.translations?.en, undefined);
  assert.equal(out.byNode.T1.matchKind, 'cell-split');
  assert.equal(String(out.byNode.T1.row), '7');
  const without = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(without.byNode.T2.matchKind, 'cell-split');
  assert.equal(String(without.byNode.T2.row), '7');
});


test('extractCopy: designation to another multiline row re-infers lineIndex from the new cell', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      7: {
        'zh-CN': 'A\u53e5\nB\u53e5',
        en: 'A-en\nB-en',
      },
      8: {
        'zh-CN': 'B\u53e5\nC\u53e5',
        en: 'B-en\nC-en',
      },
    },
  };
  const texts = [
    { nodeId: 'T1', name: 'a', characters: 'A句', parentId: 'hero', orderKey: '1' },
    { nodeId: 'T2', name: 'b', characters: 'B句', parentId: 'hero', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { T2: { row: 8, why: 'remap B onto B\nC row' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.T2.matchKind, 'designated');
  assert.equal(String(out.byNode.T2.row), '8');
  assert.equal(out.byNode.T2.translations.en.value, 'B-en');
  assert.equal(out.byNode.T2.cellSplit.lineIndex, 0);
  assert.notEqual(out.byNode.T2.translations.en.value, 'C-en');
  const without = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts });
  assert.equal(without.byNode.T2.matchKind, 'cell-split');
  assert.equal(String(without.byNode.T2.row), '7');
  assert.equal(without.byNode.T2.translations.en.value, 'B-en');
});
test('extractCopy: one visible TEXT can bind one line of a newline cell', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      7: {
        'zh-CN': '赛季前瞻直面会\nSS13 守夜人',
        en: 'Afterlight\nNew Season Preview',
      },
    },
  };
  const texts = [
    { nodeId: 'T', name: 'tag', characters: 'SS13守夜人', parentId: 'hero', orderKey: '1' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.T.matchKind, 'cell-split');
  assert.equal(String(out.byNode.T.row), '7');
  assert.equal(out.byNode.T.translations.en.value, 'New Season Preview');
});

test('extractCopy: one TEXT can bind two adjacent table lines that Figma merged', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      46: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请将系统设置>蜂窝网络>日历的数据打开后重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. Retry after enabling Calendar data.',
      },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '你还可以使用iCal文件导入其他常用的日历软件：', parentId: 'p', orderKey: '1' },
    { nodeId: 'B', name: 'line2', characters: '1.下载iCalendar文件；', parentId: 'p', orderKey: '2' },
    { nodeId: 'C', name: 'line3', characters: '2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请将系统设置>蜂窝网络>日历的数据打开后重试。', parentId: 'p', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.C.matchKind, 'cell-split');
  assert.equal(String(out.byNode.C.row), '46');
  assert.equal(out.byNode.C.cellSplit.lineIndex, 2);
  assert.equal(out.byNode.C.cellSplit.lineSpan, 2);
  assert.equal(out.byNode.C.translations.en.value, '2. Open the file.\n3. Retry after enabling Calendar data.');
});

test('extractCopy: btn-wrapped iCal step still cell-splits with merged following lines', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      46: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请将系统设置>蜂窝网络>日历的数据打开后重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. Retry after enabling Calendar data.',
      },
      50: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请将系统设置>蜂窝网络>日历的数据打开后重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. Retry after enabling Calendar data.',
      },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '你还可以使用iCal文件导入其他常用的日历软件：', parentId: 'p', ancestorIds: ['modal', 'p'], orderKey: '1', treeKey: 'pc' },
    { nodeId: 'B', name: 'line2', characters: '1.下载iCalendar文件；', parentId: 'btn', ancestorIds: ['modal', 'p', 'btn'], orderKey: '2', treeKey: 'pc' },
    { nodeId: 'C', name: 'line3', characters: '2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请将系统设置>蜂窝网络>日历的数据打开后重试。', parentId: 'p', ancestorIds: ['modal', 'p'], orderKey: '3', treeKey: 'pc' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.A.matchKind, 'cell-split');
  assert.equal(out.byNode.B.matchKind, 'cell-split');
  assert.equal(out.byNode.C.matchKind, 'cell-split');
  assert.equal(String(out.byNode.C.row), '46');
  assert.equal(out.byNode.C.cellSplit.lineSpan, 2);
  assert.equal(out.byNode.C.translations.en.value, '2. Open the file.\n3. Retry after enabling Calendar data.');
});

test('extractCopy: _meta.phaseRows drops later-phase colliding rows from matching', () => {
  const snap = {
    _meta: {
      langCols: { D: 'zh-CN', F: 'en' },
      phaseRows: [9, 26],
    },
    rows: {
      9: { 'zh-CN': '立即下载', en: 'Download Now' },
      26: { 'zh-CN': '查看更多', en: 'View More' },
      81: { 'zh-CN': '查看更多', en: 'More' },
      86: { 'zh-CN': '立即下载', en: 'Install' },
    },
  };
  const texts = [
    { nodeId: 'more', name: '查看更多', characters: '查看更多', parentId: 'later', orderKey: '1' },
    { nodeId: 'dl', name: '立即下载', characters: '立即下载', parentId: 'cta', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.more.matchKind, 'exact');
  assert.equal(String(out.byNode.more.row), '26');
  assert.equal(out.byNode.more.translations.en.value, 'View More');
  assert.equal(out.byNode.dl.matchKind, 'exact');
  assert.equal(String(out.byNode.dl.row), '9');
  assert.equal(out.byNode.dl.translations.en.value, 'Download Now');
});

test('extractCopy: leftover siblings after a cell-split group do not block the match', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '1' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p', orderKey: '2' },
    { nodeId: 'C', name: 'tag', characters: 'SS13守夜人', parentId: 'p', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.A.matchKind, 'cell-split');
  assert.equal(out.byNode.B.matchKind, 'cell-split');
  assert.equal(out.byNode.C.matchKind, 'none');
});

test('extractCopy: table cell newlines bind consecutive sibling TEXT layers', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', J: 'ko' }, phaseRows: PHASE_ONE },
    rows: {
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11, 10 AM PDT\nSEASON LAUNCH: July 16, 7 PM PDT',
        ko: '시즌 프리뷰 방송시간 : 7월11일(토) 20:00\n시즌 오픈 시간 : 7월17일(금) 11:00',
      },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '1' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.A.matchKind, 'cell-split');
  assert.equal(out.byNode.B.matchKind, 'cell-split');
  assert.equal(out.byNode.A.row, '8');
  assert.equal(out.byNode.A.translations.en.value, 'WATCH THE PREVIEW: July 11, 10 AM PDT');
  assert.equal(out.byNode.B.translations.ko.value, '시즌 오픈 시간 : 7월17일(금) 11:00');
  assert.equal(out.report.cellSplit, 2);
  assert.equal(out.report.none, 0);
  assert.equal(out.report.review.length, 2);
});

test('extractCopy: duplicate newline cells stay ambiguous until unique neighbors pick one', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' }, phaseRows: [7, 8, 23, 25, 28, 56] },
    rows: {
      7: { 'zh-CN': '赛季前瞻直面会', en: 'Afterlight', 'zh-TW': '賽季前瞻發佈會' },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11, 10 AM PDT\nSEASON LAUNCH: July 16, 7 PM PDT',
        'zh-TW': '前瞻發布會時間：7月11日 19:00\n賽季開啟時間：7月17日 10:00',
      },
      23: { 'zh-CN': '火炬嘉年华正文', en: 'Carnival body', 'zh-TW': '火炬嘉年華正文' },
      25: { 'zh-CN': '嘉年华直播目录', en: 'TorchCon 2026 Rundown', 'zh-TW': '嘉年華直播目錄' },
      28: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11, 10 AM PDT\nSEASON LAUNCH: July 16, 7 PM PDT',
        'zh-TW': '前瞻發佈會時間：7月11日 19:00\n賽季開啟時間：7月17日 10:00',
      },
      56: { 'zh-CN': '订阅赛季日程', en: 'Subscribe', 'zh-TW': '訂閱賽季行程' },
    },
  };
  const texts = [
    { nodeId: 'H', name: 'hero', characters: '赛季前瞻直面会', parentId: 'sec1', orderKey: '1' },
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p1', orderKey: '2' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p1', orderKey: '3' },
    { nodeId: 'BODY', name: 'body', characters: '火炬嘉年华正文', parentId: 'sec2', orderKey: '4' },
    { nodeId: 'C', name: 'dir', characters: '嘉年华直播目录', parentId: 'sec3', orderKey: '5' },
    { nodeId: 'D', name: 'line1b', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p3', orderKey: '6' },
    { nodeId: 'E', name: 'line2b', characters: '赛季开启时间：7月17日 10:00', parentId: 'p3', orderKey: '7' },
    { nodeId: 'F', name: 'cal', characters: '订阅赛季日程', parentId: 'modal', orderKey: '8' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.A.matchKind, 'inferred-neighbor');
  assert.equal(out.byNode.B.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.A.row), '8');
  assert.equal(out.byNode.A.translations.en.value, 'WATCH THE PREVIEW: July 11, 10 AM PDT');
  assert.equal(out.byNode.B.translations['zh-TW'].value, '賽季開啟時間：7月17日 10:00');
  assert.equal(out.byNode.D.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.D.row), '28');
  assert.equal(out.byNode.E.translations['zh-TW'].value, '賽季開啟時間：7月17日 10:00');
  assert.equal(out.report.none, 0);
  assert.equal(out.report.inferredNeighbor, 4);
});

test('extractCopy: unique already-bound neighbors pick one ambiguous row', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', J: 'ko' }, phaseRows: PHASE_ONE },
    rows: {
      28: { 'zh-CN': '赛季开启时间：7月17日 10:00', en: 'SEASON LAUNCH', ko: '시즌 오픈' },
      29: { 'zh-CN': '查看更多', en: 'View More', ko: '더 보기' },
      24: { 'zh-CN': '查看更多', en: 'Learn More', ko: null },
      30: { 'zh-CN': '直播平台', en: 'Platforms', ko: '플랫폼' },
    },
  };
  const texts = [
    { nodeId: 'T', name: 'time', characters: '赛季开启时间：7月17日 10:00', parentId: 'sec', orderKey: '1' },
    { nodeId: 'M', name: 'more', characters: '查看更多', parentId: 'sec', orderKey: '2' },
    { nodeId: 'P', name: 'plat', characters: '直播平台', parentId: 'sec', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.M.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.M.row), '29');
  assert.equal(out.byNode.M.translations.en.value, 'View More');
  assert.equal(out.report.inferredNeighbor, 1);
  assert.equal(out.report.ambiguous, 0);
});

test('extractCopy: a later neighbor alone does not pick among two earlier rows', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      24: { 'zh-CN': '查看更多', en: 'Learn More' },
      29: { 'zh-CN': '查看更多', en: 'View More' },
      40: { 'zh-CN': '直播平台', en: 'Platforms' },
    },
  };
  const texts = [
    { nodeId: 'M', name: 'more', characters: '查看更多', parentId: 'sec', orderKey: '1' },
    { nodeId: 'P', name: 'plat', characters: '直播平台', parentId: 'sec', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.M.matchKind, 'ambiguous');
});

test('extractCopy: neighbor inference stays inside one page tree', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' }, phaseRows: PHASE_ONE },
    rows: {
      7: { 'zh-CN': '赛季前瞻直面会', en: 'Afterlight', 'zh-TW': '賽季前瞻發佈會' },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11, 10 AM PDT\nSEASON LAUNCH: July 16, 7 PM PDT',
        'zh-TW': '前瞻發布會時間：7月11日 19:00\n賽季開啟時間：7月17日 10:00',
      },
      23: { 'zh-CN': '火炬嘉年华正文', en: 'Carnival body', 'zh-TW': '火炬嘉年華正文' },
      25: { 'zh-CN': '嘉年华直播目录', en: 'TorchCon 2026 Rundown', 'zh-TW': '嘉年華直播目錄' },
      28: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11, 10 AM PDT\nSEASON LAUNCH: July 16, 7 PM PDT',
        'zh-TW': '前瞻發佈會時間：7月11日 19:00\n賽季開啟時間：7月17日 10:00',
      },
      56: { 'zh-CN': '订阅赛季日程', en: 'Subscribe', 'zh-TW': '訂閱賽季行程' },
    },
  };
  const texts = [
    { nodeId: 'H', name: 'hero', characters: '赛季前瞻直面会', parentId: 'sec1', orderKey: '1', treeKey: 'pc' },
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p1', orderKey: '2', treeKey: 'pc' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p1', orderKey: '3', treeKey: 'pc' },
    { nodeId: 'BODY', name: 'body', characters: '火炬嘉年华正文', parentId: 'sec2', orderKey: '4', treeKey: 'pc' },
    { nodeId: 'C', name: 'dir', characters: '嘉年华直播目录', parentId: 'sec3', orderKey: '1', treeKey: 'mobile' },
    { nodeId: 'D', name: 'line1b', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p3', orderKey: '2', treeKey: 'mobile' },
    { nodeId: 'E', name: 'line2b', characters: '赛季开启时间：7月17日 10:00', parentId: 'p3', orderKey: '3', treeKey: 'mobile' },
    { nodeId: 'F', name: 'cal', characters: '订阅赛季日程', parentId: 'modal', orderKey: '4', treeKey: 'mobile' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.A.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.A.row), '8');
  assert.equal(out.byNode.D.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.D.row), '28');
});

test('extractCopy: leftover unique row in the same tree binds after neighbor pass', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      5: { 'zh-CN': '首充双倍', en: 'Double' },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      25: { 'zh-CN': '嘉年华直播目录', en: 'Rundown' },
      28: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW: July 11\nSEASON LAUNCH: July 16',
      },
      56: { 'zh-CN': '订阅赛季日程', en: 'Subscribe' },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p1', orderKey: '1', treeKey: 'pc' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p1', orderKey: '2', treeKey: 'pc' },
    { nodeId: 'NAV', name: 'nav', characters: '首充双倍', parentId: 'nav', orderKey: '3', treeKey: 'pc' },
    { nodeId: 'C', name: 'dir', characters: '嘉年华直播目录', parentId: 'sec3', orderKey: '4', treeKey: 'pc' },
    { nodeId: 'D', name: 'line1b', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p3', orderKey: '5', treeKey: 'pc' },
    { nodeId: 'E', name: 'line2b', characters: '赛季开启时间：7月17日 10:00', parentId: 'p3', orderKey: '6', treeKey: 'pc' },
    { nodeId: 'F', name: 'cal', characters: '订阅赛季日程', parentId: 'modal', orderKey: '7', treeKey: 'pc' },
  ];
  const leaf = (p) => ({ value: at(splitSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.D.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.D.row), '28');
  assert.equal(out.byNode.A.matchKind, 'inferred-leftover');
  assert.equal(String(out.byNode.A.row), '8');
  assert.equal(out.byNode.B.translations.en.value, 'SEASON LAUNCH');
});

test('extractCopy: two 查看更多 in one tree bind different rows from unique sandwiches', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      23: { 'zh-CN': '火炬嘉年华正文', en: 'Carnival body' },
      24: { 'zh-CN': '查看更多', en: 'Learn More' },
      25: { 'zh-CN': '嘉年华直播目录', en: 'Rundown' },
      29: { 'zh-CN': '查看更多', en: 'View More' },
      56: { 'zh-CN': '订阅赛季日程', en: 'Subscribe' },
    },
  };
  const texts = [
    { nodeId: 'BODY', name: 'body', characters: '火炬嘉年华正文', parentId: 'sec2', orderKey: '1', treeKey: 'pc' },
    { nodeId: 'M1', name: 'more1', characters: '查看更多', parentId: 'sec2', orderKey: '2', treeKey: 'pc' },
    { nodeId: 'DIR', name: 'dir', characters: '嘉年华直播目录', parentId: 'sec3', orderKey: '3', treeKey: 'pc' },
    { nodeId: 'M2', name: 'more2', characters: '查看更多', parentId: 'sec3', orderKey: '4', treeKey: 'pc' },
    { nodeId: 'CAL', name: 'cal', characters: '订阅赛季日程', parentId: 'modal', orderKey: '5', treeKey: 'pc' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.M2.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.M2.row), '29');
  assert.equal(out.byNode.M1.matchKind, 'inferred-neighbor');
  assert.equal(String(out.byNode.M1.row), '24');
});

test('extractCopy: adjacent bound table row uniquely picks among duplicate zh rows', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: [8, 9, 91] },
    rows: {
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      9: { 'zh-CN': '立即下载', en: 'PRE-REGISTER NOW!' },
      91: { 'zh-CN': '立即下载', en: 'Download Now' },
    },
  };
  const texts = [
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '1' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p', orderKey: '2' },
    { nodeId: 'D', name: 'cta', characters: '立即下载', parentId: 'btn', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.D.matchKind, 'inferred-adjacent');
  assert.equal(String(out.byNode.D.row), '9');
  assert.equal(out.byNode.D.translations.en.value, 'PRE-REGISTER NOW!');
});

test('extractCopy: a layer earlier than a bound cluster still keeps the unique cluster-edge row', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: [7, 8, 9, 91] },
    rows: {
      7: {
        'zh-CN': '赛季前瞻直面会\nSS13 守夜人',
        en: 'Afterlight\nNew Season Preview',
      },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      9: { 'zh-CN': '立即下载', en: 'PRE-REGISTER NOW!' },
      91: { 'zh-CN': '立即下载', en: 'Download Now' },
    },
  };
  const texts = [
    { nodeId: 'D', name: 'cta', characters: '立即下载', parentId: 'btn', orderKey: '0.1' },
    { nodeId: 'H', name: 'tag', characters: 'SS13守夜人', parentId: 'hero', orderKey: '0.3' },
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '0.4' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p', orderKey: '0.5' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.H.matchKind, 'cell-split');
  assert.equal(String(out.byNode.H.row), '7');
  assert.equal(out.byNode.H.translations.en.value, 'New Season Preview');
  assert.equal(String(out.byNode.A.row), '8');
  assert.equal(String(out.byNode.B.row), '8');
  assert.equal(out.byNode.D.matchKind, 'inferred-adjacent');
  assert.equal(String(out.byNode.D.row), '9');
  assert.equal(out.byNode.D.translations.en.value, 'PRE-REGISTER NOW!');
});

test('extractCopy: remaining sibling of an adjacent-bound cell-split shares that row', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      7: {
        'zh-CN': '赛季前瞻直面会\nSS13 守夜人',
        en: 'Afterlight\nNew Season Preview',
      },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      28: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH BODY',
      },
    },
  };
  const texts = [
    { nodeId: 'H', name: 'tag', characters: 'SS13守夜人', parentId: 'hero', orderKey: '1' },
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '2' },
    { nodeId: 'B', name: 'line2', characters: '赛季开启时间：7月17日 10:00', parentId: 'p', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(String(out.byNode.A.row), '8');
  assert.equal(String(out.byNode.B.row), '8');
  assert.equal(out.byNode.B.translations.en.value, 'SEASON LAUNCH');
  assert.ok(out.byNode.B.matchKind === 'inferred-adjacent' || out.byNode.B.matchKind === 'inferred-split-share');
});

test('extractCopy: two cluster-edge candidates stay ambiguous', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      5: { 'zh-CN': '首充双倍', en: 'Double' },
      6: { 'zh-CN': '立即下载', en: 'Before' },
      9: { 'zh-CN': '立即下载', en: 'PRE-REGISTER NOW!' },
      10: { 'zh-CN': '订阅赛季日程', en: 'Subscribe' },
    },
  };
  const texts = [
    { nodeId: 'NAV', name: 'nav', characters: '首充双倍', parentId: 'nav', orderKey: '1' },
    { nodeId: 'D', name: 'cta', characters: '立即下载', parentId: 'btn', orderKey: '2' },
    { nodeId: 'CAL', name: 'cal', characters: '订阅赛季日程', parentId: 'modal', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.D.matchKind, 'ambiguous');
});

test('extractCopy: two remaining parents on the same cluster edge stay ambiguous', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: [7, 8, 9, 91] },
    rows: {
      7: {
        'zh-CN': '赛季前瞻直面会\nSS13 守夜人',
        en: 'Afterlight\nNew Season Preview',
      },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      9: { 'zh-CN': '立即下载', en: 'PRE-REGISTER NOW!' },
      91: { 'zh-CN': '立即下载', en: 'Download Now' },
    },
  };
  const texts = [
    { nodeId: 'D1', name: 'cta1', characters: '立即下载', parentId: 'btn1', orderKey: '0.1' },
    { nodeId: 'D2', name: 'cta2', characters: '立即下载', parentId: 'btn2', orderKey: '0.2' },
    { nodeId: 'H', name: 'tag', characters: 'SS13守夜人', parentId: 'hero', orderKey: '0.3' },
    { nodeId: 'A', name: 'line1', characters: '嘉年华直播时间：7月11日16:30', parentId: 'p', orderKey: '0.4' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.D1.matchKind, 'ambiguous');
  assert.equal(out.byNode.D2.matchKind, 'ambiguous');
});

test('extractCopy: leftover does not zip two remaining parents by appearance order', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      24: { 'zh-CN': '查看更多', en: 'Learn More' },
      29: { 'zh-CN': '查看更多', en: 'View More' },
    },
  };
  const texts = [
    { nodeId: 'M1', name: 'more1', characters: '查看更多', parentId: 'sec2', orderKey: '1', treeKey: 'pc' },
    { nodeId: 'M2', name: 'more2', characters: '查看更多', parentId: 'sec3', orderKey: '2', treeKey: 'pc' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.M1.matchKind, 'ambiguous');
  assert.equal(out.byNode.M2.matchKind, 'ambiguous');
  assert.equal(out.report.inferredLeftover, 0);
});

test('extractCopy: two remaining neighbor rows stay ambiguous', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: [1, 2, 3] },
    rows: {
      1: { 'zh-CN': '查看更多', en: 'Learn More' },
      2: { 'zh-CN': '查看更多', en: 'View More' },
      3: { 'zh-CN': '查看更多', en: 'More' },
    },
  };
  const texts = [
    { nodeId: 'M', name: 'more', characters: '查看更多', parentId: 'sec', orderKey: '1' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.M.matchKind, 'ambiguous');
  assert.equal(out.report.inferredNeighbor, 0);
});

test('extractCopy: phase-1 designation binds later-section 查看更多 to row 26, not 81', () => {
  const moreSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW', J: 'ko' }, phaseRows: PHASE_ONE },
    rows: {
      26: { 'zh-CN': '查看更多', en: 'View More', 'zh-TW': '查看更多', ko: '더 보기' },
      81: { 'zh-CN': '查看更多', en: 'More', 'zh-TW': '查看更多', ko: '더 보기' },
    },
  };
  const texts = [
    { nodeId: 'I949:5195;949:5333', name: '立即下载', characters: '查看更多', parentId: 'pc-sec2', orderKey: '1', treeKey: 'pc' },
    { nodeId: 'I949:6080;949:6214', name: '立即下载', characters: '查看更多', parentId: 'mo-sec2', orderKey: '1', treeKey: 'mobile' },
  ];
  const leaf = (p) => ({ value: at(moreSnap, p), provenance: { locator: p } });
  const overlay = {
    nodeRow: {
      'I949:5195;949:5333': { row: 26, why: 'phase-1 later-section CTA on PC' },
      'I949:6080;949:6214': { row: 26, why: 'phase-1 later-section CTA on mobile' },
    },
  };
  const out = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode['I949:5195;949:5333'].matchKind, 'designated');
  assert.equal(String(out.byNode['I949:5195;949:5333'].row), '26');
  assert.equal(out.byNode['I949:5195;949:5333'].translations.en.value, 'View More');
  assert.equal(out.byNode['I949:5195;949:5333'].translations.ko.value, '더 보기');
  assert.equal(out.byNode['I949:6080;949:6214'].matchKind, 'designated');
  assert.equal(String(out.byNode['I949:6080;949:6214'].row), '26');
  assert.equal(out.byNode['I949:6080;949:6214'].translations.en.value, 'View More');
  const unbound = extractCopy({ figSnap: {}, larkSnap: moreSnap, at, larkLeaf: leaf, texts });
  assert.equal(unbound.byNode['I949:5195;949:5333'].matchKind, 'exact');
  assert.equal(String(unbound.byNode['I949:5195;949:5333'].row), '26');
  assert.equal(unbound.byNode['I949:6080;949:6214'].matchKind, 'exact');
  assert.equal(String(unbound.byNode['I949:6080;949:6214'].row), '26');
});

test('extractCopy: phase-1 3–54 drops row 81 same-copy so 查看更多 binds 26', () => {
  const snap = { _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE }, rows: { 26: { 'zh-CN': '查看更多', en: 'View More' }, 81: { 'zh-CN': '查看更多', en: 'More' } } };
  const texts = [{ nodeId: 'later-more', name: '立即下载', characters: '查看更多', parentId: 'later-sec', orderKey: '1', treeKey: 'mobile' }];
  const leaf = (path) => ({ value: at(snap, path), provenance: { locator: path } });
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode['later-more'].matchKind, 'exact');
  assert.equal(String(out.byNode['later-more'].row), '26');
  assert.equal(out.byNode['later-more'].translations.en.value, 'View More');
});

test('collectInventoryTexts includes determined TEXT under attachments.modals', () => {
  const texts = collectInventoryTexts({
    nodes: [{ id: 'page-copy', type: 'TEXT', role: 'copy', status: 'determined', name: '立即下载', text: { characters: '立即下载' }, parentId: 'sec1', orderKey: '1' }],
    attachments: {
      modals: [{
        id: 'modal-cal',
        name: 'modal/pc_cn订阅赛季日程',
        nodes: [
          { id: '949:5256', type: 'TEXT', role: 'copy', status: 'determined', name: '你想将日程添加至哪个日历？', text: { characters: '你想将日程添加至哪个日历？' }, parentId: '949:5254', orderKey: '2' },
          { id: 'skip-copy', type: 'TEXT', role: 'copy', status: 'skipped', name: '跳过', text: { characters: '跳过' }, parentId: '949:5254', orderKey: '3' },
        ],
      }],
    },
  }, { treeKey: 'pc' });
  assert.deepEqual(texts.map((row) => row.nodeId).sort(), ['949:5256', 'page-copy']);
  assert.equal(texts.find((row) => row.nodeId === '949:5256').treeKey, 'pc');
});

test('buildHandoffCopyEnvelope binds calendar TEXT that only lives in attachments.modals', () => {
  const demoDir = mkdtempSync(join(tmpdir(), 'handoff-copy-modal-'));
  mkdirSync(join(demoDir, 'fixtures'), { recursive: true });
  writeFileSync(join(demoDir, 'fixtures', 'lark-copy.json'), JSON.stringify({
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW', J: 'ko' }, langs: ['zh-CN', 'en', 'zh-TW', 'ko'], phaseRows: PHASE_ONE },
    rows: {
      49: {
        'zh-CN': '你想将日程添加至哪个日历？',
        en: 'Which calendar do you want to add the schedule to?',
        'zh-TW': '你想將行程加入哪個行事曆？',
        ko: '일정은 헌터님의 어느 캘린더로 추가하실 예정일까요?',
      },
    },
  }));
  const pcInventory = {
    nodes: [],
    attachments: {
      modals: [{
        id: '949:5215',
        name: 'modal/pc_cn订阅赛季日程',
        nodes: [{
          id: '949:5256',
          type: 'TEXT',
          role: 'copy',
          status: 'determined',
          name: '你想将日程添加至哪个日历？',
          text: { characters: '你想将日程添加至哪个日历？' },
          parentId: '949:5254',
          orderKey: '1',
        }],
      }],
    },
  };
  const out = buildHandoffCopyEnvelope({ demoDir, pcInventory });
  assert.equal(out.byNode['949:5256']?.matchKind, 'exact');
  assert.equal(out.byNode['949:5256']?.translations?.en?.value, 'Which calendar do you want to add the schedule to?');
  assert.equal(out.sourceTexts.some((row) => row.nodeId === '949:5256'), true);
});

test('parsePhaseRows: 缺失/空/畸形不得退成整表', () => {
  assert.equal(parsePhaseRows(null).ok, false);
  assert.equal(parsePhaseRows(undefined).ok, false);
  assert.equal(parsePhaseRows([]).ok, false);
  assert.equal(parsePhaseRows('all').ok, false);
  assert.equal(parsePhaseRows({}).ok, false);
  assert.equal(parsePhaseRows([0, 9]).ok, false);
  assert.equal(parsePhaseRows([9, 'x']).ok, false);
  assert.equal(parsePhaseRows(null).rows.size, 0);
  const ok = parsePhaseRows([9, 26]);
  assert.equal(ok.ok, true);
  assert.deepEqual([...ok.rows].sort(), ['26', '9']);
});

test('extractCopy: missing/empty/malformed phaseRows match nothing, not the whole table', () => {
  const rows = {
    9: { 'zh-CN': '立即下载', en: 'Download Now' },
    86: { 'zh-CN': '立即下载', en: 'Install' },
  };
  const texts = [{ nodeId: 'dl', name: '立即下载', characters: '立即下载' }];
  const trySnap = (phaseRows) => {
    const snap = { _meta: { langCols: { D: 'zh-CN', F: 'en' }, ...(phaseRows !== undefined ? { phaseRows } : {}) }, rows };
    const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
    return extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts });
  };
  for (const declared of [undefined, [], 'all', [0], [null]]) {
    const out = trySnap(declared);
    assert.equal(out.byNode.dl.matchKind, 'none', `phaseRows=${JSON.stringify(declared)} 不得整表命中`);
    assert.equal(out.report.phaseRowsOk, false);
    assert.equal(out.byNode.dl.row, undefined);
  }
});

test('extractCopy: phase 3–54 后同文案负例不得匹配', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: {
      9: { 'zh-CN': '立即下载', en: 'Download Now' },
      86: { 'zh-CN': '立即下载', en: 'Install' },
    },
  };
  const texts = [{ nodeId: 'dl', name: '立即下载', characters: '立即下载' }];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts });
  assert.equal(out.byNode.dl.matchKind, 'exact');
  assert.equal(String(out.byNode.dl.row), '9');
  assert.equal(out.byNode.dl.translations.en.value, 'Download Now');
});


test('buildHandoffCopyEnvelope: 入口硬验 phaseRows，缺不得匹配；不限阶段一行号', () => {
  const demoDir = mkdtempSync(join(tmpdir(), 'handoff-phase-'));
  mkdirSync(join(demoDir, 'fixtures'), { recursive: true });
  const pcInventory = {
    nodes: [{ id: 'cta', type: 'TEXT', role: 'copy', status: 'determined', name: '立即下载', text: { characters: '立即下载' } }],
  };
  writeFileSync(join(demoDir, 'fixtures', 'lark-copy.json'), JSON.stringify({
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: { 9: { 'zh-CN': '立即下载', en: 'Download Now' }, 86: { 'zh-CN': '立即下载', en: 'Install' } },
  }));
  const missing = buildHandoffCopyEnvelope({ demoDir, pcInventory });
  assert.match(String(missing.problems && missing.problems[0] || missing.unread[0]?.reason || ''), /phaseRows/);
  assert.equal(missing.byNode.cta, undefined);

  writeFileSync(join(demoDir, 'fixtures', 'lark-copy.json'), JSON.stringify({
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: [61, 63] },
    rows: {
      61: { 'zh-CN': '赛季福利', en: 'Season Rewards' },
      63: { 'zh-CN': '查看更多', en: 'More' },
    },
  }));
  const phaseTwoInv = {
    nodes: [{ id: 'reward', type: 'TEXT', role: 'copy', status: 'determined', name: '赛季福利', text: { characters: '赛季福利' } }],
  };
  const phaseTwo = buildHandoffCopyEnvelope({ demoDir, pcInventory: phaseTwoInv });
  assert.ok(!phaseTwo.problems || phaseTwo.problems.length === 0);
  assert.equal(phaseTwo.byNode.reward?.matchKind, 'exact');
  assert.equal(String(phaseTwo.byNode.reward.row), '61');
  assert.equal(phaseTwo.byNode.reward.translations.en.value, 'Season Rewards');

  writeFileSync(join(demoDir, 'fixtures', 'lark-copy.json'), JSON.stringify({
    _meta: { langCols: { D: 'zh-CN', F: 'en' }, phaseRows: PHASE_ONE },
    rows: { 9: { 'zh-CN': '立即下载', en: 'Download Now' }, 86: { 'zh-CN': '立即下载', en: 'Install' } },
  }));
  const ok = buildHandoffCopyEnvelope({ demoDir, pcInventory });
  assert.equal(ok.byNode.cta?.matchKind, 'exact');
  assert.equal(String(ok.byNode.cta.row), '9');
  assert.equal(ok.byNode.cta.translations.en.value, 'Download Now');
  assert.equal(assertPhaseOneRows(PHASE_ONE).ok, true);
  assert.equal(assertPhaseOneRows([61, 86]).ok, true);
});


test('collectInventoryTexts includes modal and component-set copy', () => {
  const texts = collectInventoryTexts({
    nodes: [{ id: 'page-copy', type: 'TEXT', role: 'copy', status: 'determined', text: { characters: '立即下载' } }],
    attachments: {
      modals: [{
        id: 'modal-1',
        name: 'modal/pc_cn订阅赛季日程',
        nodes: [{ id: '949:5258', type: 'TEXT', role: 'copy', status: 'determined', text: { characters: '订阅赛季日程' } }],
      }],
      componentSets: [{
        id: 'cal',
        name: '日历',
        variants: [{ id: 'tw', name: 'lang=tw', nodes: [{ id: '949:5809', type: 'TEXT', role: 'copy', text: { characters: 'Apple' } }] }],
      }],
    },
  }, { treeKey: 'pc' });
  const ids = texts.map((row) => row.nodeId).sort();
  assert.deepEqual(ids, ['949:5258', '949:5809', 'page-copy']);
  assert.equal(texts.find((row) => row.nodeId === '949:5258').characters, '订阅赛季日程');
});
test('extractCopy: designated multiline cell without lineIndex infers the matching sentences', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      50: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件，系统会自动获取日历。\n3.如Apple日历订阅失败，请重试。',
        en: 'You can also import the iCal file into other commonly used calendar software:\n1. Download iCalendar file;\n2. Open the file, and the system will automatically retrieve the calendar.\n3. If Apple Calendar subscription fails, try again.',
      },
    },
  };
  const texts = [
    { nodeId: 'intro', name: 'intro', characters: '你还可以使用iCal文件导入其他常用的日历软件：', parentId: 'sheet', orderKey: '1' },
    { nodeId: 'step1', name: 'step1', characters: '1.下载iCalendar文件；', parentId: 'btn', orderKey: '2' },
    { nodeId: 'steps23', name: 'steps23', characters: '2.打开文件，系统会自动获取日历。\r\n3.如Apple日历订阅失败，请重试。', parentId: 'sheet', orderKey: '3' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = {
    nodeRow: {
      step1: { row: 50, why: 'share iCal row' },
      steps23: { row: 50, why: 'share iCal row' },
    },
  };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.step1.matchKind, 'designated');
  assert.equal(out.byNode.step1.translations.en.value, '1. Download iCalendar file;');
  assert.equal(out.byNode.steps23.matchKind, 'designated');
  assert.match(out.byNode.steps23.translations.en.value, /2\. Open the file[\s\S]*try again/);
  assert.equal(out.byNode.steps23.cellSplit.lineIndex, 2);
  assert.equal(out.byNode.steps23.cellSplit.takeCount, 2);
  assert.equal(String(out.byNode.steps23.translations.en.value).includes('You can also import'), false);
});

test('extractCopy: designated lineIndex takes only that sentence', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      50: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件。\n3.失败请重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. If it fails, try again.',
      },
    },
  };
  const texts = [
    { nodeId: 'steps23', name: 'steps23', characters: '2.打开文件。\n3.失败请重试。', parentId: 'sheet', orderKey: '1' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { steps23: { row: 50, lineIndex: 2, takeCount: 2, why: 'explicit span' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.steps23.translations.en.value, '2. Open the file.\n3. If it fails, try again.');
  assert.equal(String(out.byNode.steps23.translations.en.value).includes('Download'), false);
});

test('extractCopy: designated multiline cell does not dump the whole cell onto an unmatched layer', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      50: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件。\n3.失败请重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. If it fails, try again.',
      },
    },
  };
  const texts = [
    { nodeId: 'other', name: 'other', characters: '将火炬嘉年华直播同步到日历', parentId: 'sheet', orderKey: '1' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { other: { row: 50, why: 'wrong layer' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.other.matchKind, 'designated-split-unresolved');
  assert.equal(out.byNode.other.translations.en, undefined);
  assert.equal((out._unread || out.unread || []).some((item) => item.nodeId === 'other'), true);
});

test('extractCopy: Figma LINE SEPARATOR splits the same as newline for cell spans', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      50: {
        'zh-CN': '你还可以使用iCal文件导入其他常用的日历软件：\n1.下载iCalendar文件；\n2.打开文件。\n3.失败请重试。',
        en: 'You can also import the iCal file:\n1. Download iCalendar file;\n2. Open the file.\n3. If it fails, try again.',
      },
    },
  };
  const texts = [
    { nodeId: 'mobile23', name: 'mobile23', characters: '2.打开文件。\u20283.失败请重试。', parentId: 'm', orderKey: '1' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { mobile23: { row: 50, why: 'mobile span' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.mobile23.matchKind, 'designated');
  assert.equal(String(out.byNode.mobile23.translations.en.value).includes('Download'), false);
  assert.match(out.byNode.mobile23.translations.en.value, /Open the file/);
  assert.match(out.byNode.mobile23.translations.en.value, /try again/);
});

test('designationsToOverlay passes lineIndex and takeCount through to nodeRow', () => {
  const overlay = designationsToOverlay({
    designations: {
      '949:5253': { row: 50, lineIndex: 2, takeCount: 2, why: 'steps 2-3' },
    },
  });
  assert.equal(overlay.nodeRow['949:5253'].row, 50);
  assert.equal(overlay.nodeRow['949:5253'].lineIndex, 2);
  assert.equal(overlay.nodeRow['949:5253'].takeCount, 2);
});

test('extractCopy: unresolved split group does not reuse old lineIndex on a different designated row', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      7: { 'zh-CN': 'A\nB', en: 'A7\nB7' },
      8: { 'zh-CN': 'A\nB', en: 'A8\nB8' },
      9: { 'zh-CN': 'X\nY', en: 'X9\nY9' },
    },
  };
  const texts = [
    { nodeId: 'T1', name: 'a', characters: 'A', parentId: 'hero', orderKey: '1' },
    { nodeId: 'T2', name: 'b', characters: 'B', parentId: 'hero', orderKey: '2' },
  ];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { T2: { row: 9, why: 'point B at X/Y' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.T2.matchKind, 'designated-split-unresolved');
  assert.notEqual(out.byNode.T2.translations && out.byNode.T2.translations.en && out.byNode.T2.translations.en.value, 'Y9');
  assert.equal(out.byNode.T2.translations && out.byNode.T2.translations.en, undefined);
});

test('extractCopy: designated lineCount 1 does not dump a multiline cell', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      50: {
        'zh-CN': 'intro\n1.download',
        en: 'You can also import\n1. Download iCalendar file;',
      },
    },
  };
  const texts = [{ nodeId: 'step1', name: 'step1', characters: 'intro', parentId: 'sheet', orderKey: '1' }];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { step1: { row: 50, lineIndex: 0, lineCount: 1, why: 'contradictory lineCount' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.step1.matchKind, 'designated');
  assert.equal(out.byNode.step1.translations.en.value, 'You can also import');
  assert.equal(String(out.byNode.step1.translations.en.value).includes('Download'), false);
});

test('extractCopy: designated takeCount past the cell is unresolved', () => {
  const snap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: { 50: { 'zh-CN': 'A\nB', en: 'A-en\nB-en' } },
  };
  const texts = [{ nodeId: 't', name: 't', characters: 'B', parentId: 'sheet', orderKey: '1' }];
  const leaf = (p) => ({ value: at(snap, p), provenance: { locator: p } });
  const overlay = { nodeRow: { t: { row: 50, lineIndex: 1, takeCount: 2, why: 'overflow span' } } };
  const out = extractCopy({ figSnap: {}, larkSnap: snap, at, larkLeaf: leaf, texts, copyOverlay: overlay });
  assert.equal(out.byNode.t.matchKind, 'designated-split-unresolved');
  assert.equal(out.byNode.t.translations && out.byNode.t.translations.en, undefined);
});
