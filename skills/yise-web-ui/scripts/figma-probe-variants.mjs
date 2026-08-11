#!/usr/bin/env node
/**
 * figma-probe-variants.mjs — 组件变体探路（只读，不进验收链）。【第 9 项】
 *
 * ═══ 为什么有这个脚本 ═══
 *
 * 状态切换（normal/hover/选中…）在稿里靠组件变体或「X + X-选中状态」命名对（§5.4）。
 * 之前误判过「组件母版停在画布上、抓取范围够不着」—— 错：/nodes?ids= 能按 id 拉
 * 文件里任何节点，画布位置无关；真正的障碍只是不知道 id，而 id 能从 INSTANCE 的
 * componentId / componentSetId 推出来。
 *
 * 本脚本只回答事实问题，不改任何产物：
 *   1) 快照里的 INSTANCE 各属于哪个组件、哪个 componentSet
 *   2) 每个 componentSet 有哪些变体（按 id 拉 componentSet 节点实测）
 *   3) 变体节点的结构长什么样（能不能直接当图导出）
 *
 * ═══ 用法 ═══
 *   node scripts/figma-probe-variants.mjs --demo <dir>            # 只读本地快照
 *   node scripts/figma-probe-variants.mjs --demo <dir> --fetch    # 允许联网按 id 拉 componentSet
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const API = 'https://api.figma.com/v1';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--fetch') args.fetch = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const spec = JSON.parse(readFileSync(join(demoDir, 'spec.json'), 'utf8'));
const snapFile = join(demoDir, 'fixtures', spec.figma?.snapshotFile || 'figma-sec3.json');
if (!existsSync(snapFile)) fail(`缺快照 ${snapFile}`);
const snap = JSON.parse(readFileSync(snapFile, 'utf8'));

function readToken(startDir) {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN.trim();
  let dir = resolve(startDir);
  for (let i = 0; i < 8; i++) {
    const p = join(dir, '.env');
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/^\s*FIGMA_TOKEN\s*=\s*(.+?)\s*$/m);
      if (m) return m[1].trim();
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

async function figmaGet(url, token) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { fail(`Figma 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`); }
  if (!res.ok || Number(json.status) >= 400) fail(`Figma API 失败 HTTP ${res.status}：${json.err || ''}`);
  return json;
}

/* ── 1) 本地快照里的组件使用情况 ── */
const instances = [];
const compDict = {};     // componentId → { name, setId, tree }
const setDict = {};      // componentSetId → { name, tree }
for (const treeId of Object.keys(snap.nodes || {})) {
  const node = snap.nodes[treeId];
  for (const [cid, c] of Object.entries(node.components || {})) {
    compDict[cid] = { name: c.name, setId: c.componentSetId || null, tree: treeId };
  }
  for (const [sid, s] of Object.entries(node.componentSets || {})) {
    setDict[sid] = { name: s.name, tree: treeId };
  }
  (function walk(n) {
    if (n.type === 'INSTANCE') {
      instances.push({
        id: n.id, name: n.name, tree: treeId,
        componentId: n.componentId || null,
        componentSetId: (n.componentId && compDict[n.componentId] && compDict[n.componentId].setId) || null,
        variantProps: n.componentProperties
          ? Object.fromEntries(Object.entries(n.componentProperties).map(([k, v]) => [k, v && v.value]))
          : {},
        overrides: (n.overrides || []).length,
      });
    }
    (n.children || []).forEach(walk);
  })(node.document);
}

const usedSetIds = [...new Set(instances.map((i) => i.componentSetId).filter(Boolean))];

const out = {
  ok: true,
  snapshot: spec.figma.snapshotFile,
  fileKey: spec.figma.fileKey,
  instances,
  componentsInSnapshot: compDict,
  componentSetsInSnapshot: setDict,
  usedComponentSets: usedSetIds.map((sid) => ({ id: sid, name: (setDict[sid] || {}).name || '（不在快照字典里）' })),
};

console.log('组件变体探路（只读）');
console.log('');
console.log(`快照里的 INSTANCE：${instances.length} 个`);
for (const i of instances) {
  console.log(`  ${i.id.padEnd(10)} ${String(i.name).slice(0, 20).padEnd(22)} 组件 ${i.componentId} · 变体取值 ${JSON.stringify(i.variantProps)} · overrides ${i.overrides}`);
}
console.log('');
console.log(`快照字典：components ${Object.keys(compDict).length} 个 · componentSets ${Object.keys(setDict).length} 个`);
console.log(`本分区用到的 componentSet：${usedSetIds.length} 个 → ${usedSetIds.map((s) => `${s}(${(setDict[s] || {}).name})`).join('、') || '无'}`);

/* ── 2) 联网按 id 拉 componentSet 节点，枚举变体 ── */
if (args.fetch) {
  const token = readToken(demoDir);
  if (!token) fail('--fetch 需要 FIGMA_TOKEN（环境变量或 .env）');
  console.log('');
  console.log('联网按 id 拉 componentSet 节点（只读）…');
  const fetchResults = [];
  for (const sid of usedSetIds) {
    const r = await figmaGet(`${API}/files/${spec.figma.fileKey}/nodes?ids=${encodeURIComponent(sid)}`, token);
    const doc = r.nodes && r.nodes[sid] && r.nodes[sid].document;
    if (!doc) {
      fetchResults.push({ id: sid, ok: false, why: 'nodes 响应里没有这个 id' });
      console.log(`  ${sid}：拉不到`);
      continue;
    }
    const variants = (doc.children || []).map((c) => ({
      id: c.id, name: c.name, type: c.type,
      box: c.absoluteBoundingBox ? `${Math.round(c.absoluteBoundingBox.width)}x${Math.round(c.absoluteBoundingBox.height)}` : null,
      children: (c.children || []).length,
    }));
    fetchResults.push({
      id: sid, ok: true, name: doc.name, type: doc.type,
      variantCount: variants.length, variants,
    });
    console.log(`  ${sid} 「${doc.name}」(${doc.type})：${variants.length} 个变体`);
    for (const v of variants) {
      console.log(`     ${v.id.padEnd(10)} ${String(v.name).padEnd(28)} ${String(v.type).padEnd(10)} ${v.box || '?'} 子级 ${v.children}`);
    }
  }
  out.fetched = fetchResults;
}

/* ── 3) 结论 ── */
console.log('');
if (usedSetIds.length === 0) {
  console.log('结论：本分区没有使用任何组件变体 —— 这是有效结论，状态切换在本分区无对象。');
} else {
  const singletons = (out.fetched || []).filter((f) => f.ok && f.variantCount <= 1);
  const multi = (out.fetched || []).filter((f) => f.ok && f.variantCount > 1);
  if (args.fetch) {
    if (multi.length === 0) {
      console.log(`结论：${usedSetIds.length} 个 componentSet 全部只有 1 个变体 —— 本分区没有可切换的状态变体（${singletons.map((s) => s.name).join('、')}）。`);
      console.log('      「X + X-选中状态」命名对的另一头不在这两个 set 里；要探它得按名字在页面框里找兄弟组件（§5.4 的配对规律）。');
    } else {
      console.log(`结论：${multi.length} 个 componentSet 有多个变体：${multi.map((s) => `${s.name}(${s.variantCount})`).join('、')}`);
    }
  } else {
    console.log('结论：本地快照只能确认用到了哪些 set；变体清单要加 --fetch 联网按 id 拉。');
  }
}
