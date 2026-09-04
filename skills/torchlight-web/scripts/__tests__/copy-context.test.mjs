// copy-context.test.mjs — 同字段多场景翻译（任务3）的单元测试。
// 跑法：node --test scripts/__tests__/copy-context.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveContext, buildAncestorMap, validateCopyOverlay, resolveContextualRow,
} from '../lib/figma-copy-context.mjs';
import { extractCopy } from '../lib/figma-copy-match.mjs';
import { assessCopyCoverage } from '../lib/figma-copy-coverage.mjs';

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
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' } },
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

test('extractCopy: designated nodeRow wins over cell-split row but keeps split parts', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
  assert.equal(out.byNode.T2.matchKind, 'designated');
  assert.equal(String(out.byNode.T2.row), '8');
  assert.equal(out.byNode.T2.translations.en.value, 'SEASON LAUNCH');
  assert.equal(out.byNode.T2.cellSplit.lineIndex, 1);
  assert.equal(out.byNode.T2.cellSplit.lineCount, 2);
  assert.equal(out.byNode.T1.matchKind, 'cell-split');
  assert.equal(String(out.byNode.T1.row), '7');
  const without = extractCopy({ figSnap: {}, larkSnap: splitSnap, at, larkLeaf: leaf, texts });
  assert.equal(without.byNode.T2.matchKind, 'cell-split');
  assert.equal(String(without.byNode.T2.row), '7');
});

test('extractCopy: one visible TEXT can bind one line of a newline cell', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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

test('extractCopy: leftover siblings after a cell-split group do not block the match', () => {
  const splitSnap = {
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en', J: 'ko' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en', J: 'ko' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en', H: 'zh-TW' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
    rows: {
      5: { 'zh-CN': '首充双倍', en: 'Double' },
      8: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
      },
      25: { 'zh-CN': '嘉年华直播目录', en: 'Rundown' },
      28: {
        'zh-CN': '嘉年华直播时间：7月11日 16:30\n赛季开启时间：7月17日 10:00',
        en: 'WATCH THE PREVIEW\nSEASON LAUNCH',
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
    _meta: { langCols: { D: 'zh-CN', F: 'en' } },
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
