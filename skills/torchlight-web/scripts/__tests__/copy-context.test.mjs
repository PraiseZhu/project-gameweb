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
