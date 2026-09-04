/**
 * figma-copy-adapter.mjs —— 语言对应的「可直接接入」copy 提取适配器。【通用 Skill 层新增件】
 *
 * ═══ 解决什么 ═══
 * 语言对应此前停在 matcher（figma-copy-match）与 coverage（figma-copy-coverage）两件**零件**，
 * 没有一个把整条管线拼起来的入口：Figma fixture 的 TEXT → Lark 覆盖源 → context 派生 →
 * canonical extractCopy → truth copy envelope / report。extract.mjs 目前只留 `copy:{byNode:{}}`。
 * 本适配器把这条管线收成**一个函数**，主线（extract.mjs）稍后只需一次 import + 一次调用。
 *
 * ═══ 纪律（lead 决策，逐条落实）═══
 *   1. Figma fixture 的 TEXT 是分母：texts 由 collectFigmaTexts(fixture) 机械收集，不由 truth 反推。
 *      PC / mobile 分别处理（各自 fixture 快照），互不串。
 *   2. Lark fixture 是唯一翻译覆盖源：所有采用值都由 larkLeaf(pointer) 造（值与 locator 同源），
 *      手打译文过不了 makeFixtureLeaf 的值绑定校验（对抗测试专门防这个）。
 *   3. context 机械派生：buildAncestorMap + deriveContext，不手填。
 *   4. 解析优先级 explicit > scene > length > identical group > unresolved：
 *      由 extractCopy 内部（resolveContextualRow）按 overlay/contexts 执行；本适配器只负责把
 *      overlay 与 contexts 备齐喂进去，不自己实现优先级（避免双份规则漂移）。
 *   5. designations（copy-designations.json）是**人工行号指认**，不是第三真源：它只把 nodeId 指到
 *      Lark 行号，采用值仍由 larkLeaf 从该行机械取。本适配器把它转成 extractCopy 的 explicit
 *      overlay 形态；绝不在这里手填任何译文。
 *
 * ═══ 接线 ═══
 *   extract.mjs 当前并发中（禁改）。本文件纯新增、无副作用。
 *   主线最小接入（见 docs/copy-extraction-adapter.md 的 diff 草图）：
 *     import { buildCopyEnvelope } from '<skill>/scripts/lib/figma-copy-adapter.mjs';
 *     const copyEnv = buildCopyEnvelope({ demoDir, spec, at: main.at, larkLeaf: main.fig, figSnap: snap });
 *     truth.copy = copyEnv.byNode;  report.copy = copyEnv.report;
 *
 * 纯函数 + 只读 fixture；不写任何文件（写 truth/report 是调用方的事）。
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractCopy } from './figma-copy-match.mjs';
import { collectFigmaTexts } from './figma-copy-coverage.mjs';
import { buildAncestorMap, deriveContext } from './figma-copy-context.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ── 单端（pc 或 mobile）的 copy 提取 ───────────────────────────────────
 * snap        该端的 Figma fixture 快照对象
 * sectionIds  该端要算 context 的分区 id 数组（context 按分区建祖先链）
 * larkSnap    Lark 表快照（唯一翻译覆盖源）
 * at          闭包取指针（locator 同源）；签名 at(pointer)
 * larkLeaf    造叶子唯一通道（= makeFixtureLeaf 绑到 lark fixture）
 * overlay     demo 运营覆盖层（explicit 映射/规则），已校验后由 extractCopy 启用
 * designations 人工行号指认（→ explicit overlay），可为 null
 */
function extractOnePlat({ snap, sectionIds, larkSnap, at, larkLeaf, overlay, designations }) {
  // ① Figma TEXT 分母（机械收集，不由 truth 反推）
  const texts = collectFigmaTexts(snap, { treeKey: String(sectionIds?.[0] || 'page') });
  // ② context 机械派生：对每个分区的 TEXT 节点建祖先链 → deriveContext
  const contexts = new Map();
  /* at 兼容两种形态：extractCopy 内部对 lark 用 at(larkSnap, ptr)（2参）；buildAncestorMap 对 fig 用 at(ptr)（1参，snap 由调用方闭包锁）。按参数数分流。 */
  const callAt = (a, b) => {
    if (b === undefined) return at.length >= 2 ? at(snap, a) : at(a);
    return at.length >= 2 ? at(a, b) : at(b);
  };
  for (const sid of sectionIds) {
    const docRoot = (snap.nodes || {})[sid] && (snap.nodes || {})[sid].document;
    if (!docRoot) continue;
    // 该分区的 TEXT 节点（带 id/locator）→ 建祖先链
    const secTexts = [];
    (function walk(n) {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'TEXT' && n.id != null) secTexts.push({ id: { value: String(n.id) }, name: { value: String(n.name ?? '') }, type: { value: n.type } });
      for (const c of n.children || []) walk(c);
    })(docRoot);
    // buildAncestorMap 需要 id 叶子带 provenance.locator；从 fixture 直接造薄叶子（locator=JSON Pointer）
    const withLoc = secTexts.map((t) => ({
      id: { value: t.id.value, provenance: { locator: locatorOfText(snap, sid, t.id.value) } },
      name: t.name, type: t.type,
    }));
    const ancMap = buildAncestorMap(withLoc, { at: callAt, figSnap: snap, sectionId: sid });
    for (const [nodeId, ancestors] of ancMap) {
      const t = secTexts.find((x) => x.id.value === nodeId);
      contexts.set(nodeId, deriveContext({ name: t ? t.name.value : '', type: 'TEXT', ancestors }));
    }
  }
  // ③ 调 canonical extractCopy（优先级 explicit>scene>length>group>unresolved 在其内部）
  return extractCopy({ figSnap: snap, larkSnap, at: callAt, larkLeaf, texts, copyOverlay: overlay, contexts });
}

/* 在 fixture 里定位某 TEXT 节点的 JSON Pointer（供 provenance.locator）。
 * 用 nodeId 在子树里 DFS 找路径。只读。 */
function locatorOfText(snap, sectionId, nodeId) {
  const root = (snap.nodes || {})[sectionId] && (snap.nodes || {})[sectionId].document;
  let found = null;
  (function walk(n, path) {
    if (found || !n || typeof n !== 'object') return;
    if (String(n.id) === String(nodeId) && n.type === 'TEXT') { found = path; return; }
    (n.children || []).forEach((c, i) => walk(c, path + '/children/' + i));
  })(root, `/nodes/${sectionId}/document`);
  return found || `/nodes/${sectionId}/document`;
}

/* ── 把 copy-designations.json 转成 explicit overlay（绝不手填译文）─────
 * designations.designations = { nodeId: { row, designCharacters, tableZhCN, why } }
 * 只取 nodeId→row 的映射；采用值由 larkLeaf 从该行机械取（行存在性由 extractCopy 的 overlay 校验把关）。 */
function designationsToOverlay(designations) {
  if (!designations || (!designations.designations && !designations.deliberatelyUnbound)) return null;
  const nodeRow = {};
  for (const [nodeId, d] of Object.entries(designations.designations || {})) {
    if (d && typeof d.row === 'number') nodeRow[nodeId] = { row: d.row, via: 'designation', why: d.why || null };
  }
  /* deliberatelyUnbound（lead 2026-08-10 路径②）：显式"以 Figma 稿字符为准"的节点，
     转成 overlay.suppress 排除集合，extractCopy 在任何匹配（含 designation）之前消费它，
     让节点保持无绑定 → renderer 兜底显示稿内原文 + data-copy-missing。绝不在这里造译文。 */
  const suppress = {};
  for (const [nodeId, d] of Object.entries(designations.deliberatelyUnbound || {})) {
    suppress[nodeId] = { via: 'deliberatelyUnbound', why: (d && d.why) || null };
  }
  return (Object.keys(nodeRow).length || Object.keys(suppress).length)
    ? { nodeRow, suppress, _source: 'copy-designations.json (row 指认，值仍由 larkLeaf 机械取；deliberatelyUnbound 以稿为准)' }
    : null;
}

/**
 * 主入口：为整个 demo 构建 copy envelope。
 * @param {object} args
 * @param {string} args.demoDir   demo 目录
 * @param {object} args.spec      spec.json（拿 figma.sections / platformTruth）
 * @param {(snap:object,pointer:string)=>any} args.at  取指针（locator 同源，2 参形态）
 * @param {(pointer:string)=>object} args.larkLeaf     造 Lark 叶子的唯一通道
 * @param {object} [args.pcSnap]  PC fixture 快照（默认读 spec.figma.snapshotFile）
 * @returns {{ byNode:object, report:object, unread:Array }}
 */
export function buildCopyEnvelope({ demoDir, spec, at, larkLeaf, pcSnap = null }) {
  const absDemo = resolve(demoDir);
  const fig = spec.figma || {};
  const larkSnap = readJson(join(absDemo, 'fixtures', 'lark-copy.json'));
  const designations = existsSync(join(absDemo, 'copy-designations.json')) ? readJson(join(absDemo, 'copy-designations.json')) : null;
  const overlay = designationsToOverlay(designations);

  const report = { plats: {}, totals: { texts: 0, bound: 0, unread: 0 }, contextual: [] };
  const byNode = {};
  const unreadAll = [];

  const jobs = [];
  // PC 端
  const pcSnapObj = pcSnap || readJson(join(absDemo, 'fixtures', fig.snapshotFile || 'figma-page.json'));
  jobs.push({ plat: 'pc', snap: pcSnapObj, sectionIds: (fig.sections || []).map((s) => s.id) });
  // mobile 端（有 platformTruth.mobile 才做）
  const mob = (fig.platformTruth || {}).mobile;
  if (mob && mob.snapshotFile) {
    const mobSnap = readJson(join(absDemo, 'fixtures', mob.snapshotFile));
    jobs.push({ plat: 'mobile', snap: mobSnap, sectionIds: (mob.sections || []).map((s) => s.id) });
  }

  for (const job of jobs) {
    const res = extractOnePlat({ snap: job.snap, sectionIds: job.sectionIds, larkSnap, at, larkLeaf, overlay, designations });
    const env = res && res.byNode ? res : { byNode: res.byNode || {}, report: res.report || {}, _unread: res._unread || [] };
    const unread = res._unread || res.unread || [];
    report.plats[job.plat] = {
      texts: (collectFigmaTexts(job.snap)).length,
      bound: Object.values(env.byNode || {}).filter((entry) => entry && entry.translations && Object.keys(entry.translations).length > 0).length,
      unread: unread.length,
      report: res.report || null,
    };
    Object.assign(byNode, env.byNode);
    unreadAll.push(...unread);
    report.totals.texts += report.plats[job.plat].texts;
    report.totals.bound += report.plats[job.plat].bound;
    report.totals.unread += unread.length;
    report.contextual.push(...((res.report && res.report.contextual) || []).map((entry) => ({ plat: job.plat, ...entry })));
  }
  report.unread = unreadAll;
  return { byNode, report, unread: unreadAll };
}
