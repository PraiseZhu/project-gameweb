#!/usr/bin/env node
/**
 * figma-fetch.mjs — 把 Figma 设计稿拉成 demo 内的 fixture 快照。【本 Skill 对老师版的新增】
 *
 * ═══ 为什么必须单独一个脚本，而不是在 extract.mjs 里顺手拉 ═══
 *
 * 老师 SKILL.md 的「执行时序原则」（r7 条目 1，CRITICAL）写死：
 *   「可信侧重跑」成立的前提是：canonical runner 自己不能在核心观察之前执行被审方的代码。
 *
 * 门 A 的判定方式是「验收时现跑 extract.mjs，与 truth.json 比对（extractor drift）」。
 * 如果 extract.mjs 自己联网拉 Figma：
 *   - 两次运行拉到的可能不是同一份稿（稿是活的），比对会得出假红/假绿；
 *   - 提取器成了唯一的数据来源，比对退化成"拿自己的输出跟自己比"，等于自证。
 *
 * 所以：**联网取数只发生在这里，extract.mjs 一律只读本地 fixture、绝不联网。**
 * 这样 extract.mjs 是纯函数（同一份 fixture → 同一份 truth），门 A 才有意义。
 *
 * ═══ 为什么快照落在 demo 的 fixtures/ 下 ═══
 *
 * 老师的 makeFixtureLeaf 硬要求 fixture 在 demo 内 `fixtures/` 下（extract-helpers.mjs
 * 第 296 行），理由是「reviewer 打不开的 fixture 等于没有溯源」。
 * Figma 稿正好符合 fixture 的定性：值不在代码里，只存在于外部系统的响应里。
 * 于是我们白拿三样：
 *   ① 快照文件 hash 进防伪链；
 *   ② validateFixtureValueBinding 会解析快照、按 locator 取值、与叶子 value 比对
 *      —— 机械证明「这个数字真出自稿」，不是 AI 手打的；
 *   ③ 门 A 的 extractor drift 自动生效。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-fetch.mjs --demo <dir>                 # 按 spec.json 的 figma 段拉
 *   node scripts/figma-fetch.mjs --demo <dir> --node 1:467
 *   node scripts/figma-fetch.mjs --demo <dir> --meta-only     # 只刷新稿版本信息
 *
 * token：环境变量 FIGMA_TOKEN，或往上找 .env 里的 FIGMA_TOKEN=
 *   只需 file_content:read / file_metadata:read / file_versions:read —— 不要给写权限。
 *   本 Skill 对 Figma 只读：改不了稿，稿因此是天然可信的真源（比老师那边的产品代码更干净）。
 *
 * ⚠️ token 绝不写进任何产物 / 快照 / truth.json。
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const API = 'https://api.figma.com/v1';

/* ─────────────── args ─────────────── */

function parseArgs(argv) {
  const a = { nodes: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--demo') a.demo = argv[++i];
    else if (k === '--node') a.nodes.push(argv[++i]);
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--depth') a.depth = Number(argv[++i]);
    else if (k === '--meta-only') a.metaOnly = true;
    else fail(`未知参数：${k}`);
  }
  if (!a.demo) fail('必须给 --demo <dir>');
  return a;
}

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

/* ─────────────── token ─────────────── */

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
  fail(
    '找不到 FIGMA_TOKEN。设环境变量，或在工作区根放 .env 写 FIGMA_TOKEN=figd_xxx\n' +
    '  token 只需 file_content:read + file_metadata:read + file_versions:read，不要给写权限。'
  );
}

/* ─────────────── fetch ─────────────── */

async function figmaGet(url, token) {
  const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    fail(`Figma 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 300)}`);
  }
  if (!res.ok || Number(json.status) >= 400) {
    fail(`Figma API 失败 HTTP ${res.status}：${json.err || text.slice(0, 300)}`);
  }
  return json;
}

/**
 * 文件级 meta：版本号 + 修改时间。
 * 每份快照都带上它 —— 稿是活的，不记版本就没法回答「这份产物照的是哪一版」。
 * 我们只处理定稿，所以这不是防漂移，是**可追溯**：出争议时一秒定位。
 */
async function fetchMeta(fileKey, token) {
  const d = await figmaGet(`${API}/files/${fileKey}?depth=1`, token);
  return {
    fileKey,
    name: d.name,
    version: d.version,
    lastModified: d.lastModified,
    role: d.role,
    editorType: d.editorType,
    pages: (d.document?.children || []).map((p) => ({ id: p.id, name: p.name })),
  };
}

async function fetchNodes(fileKey, ids, token, depth) {
  const q = new URLSearchParams({ ids: ids.join(',') });
  if (depth != null && Number.isFinite(depth)) q.set('depth', String(depth));
  return figmaGet(`${API}/files/${fileKey}/nodes?${q}`, token);
}

/* ─────────────── main ─────────────── */

async function main() {
  const a = parseArgs(process.argv);
  const demoDir = resolve(a.demo);
  const specPath = join(demoDir, 'spec.json');
  if (!existsSync(specPath)) fail(`缺 ${specPath}（先跑 scripts/init.mjs 生成骨架）`);

  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const fig = spec.figma;
  if (!fig?.fileKey) fail('spec.json 缺 figma.fileKey（本 Skill 在老师的 spec 上新增了 figma 段）');

  const nodes = a.nodes.length ? a.nodes : [...(fig.fetchNodes || [])];
  if (!a.nodes.length && fig.pageChrome) {
    const entries = fig.pageChrome.frame ? [fig.pageChrome] : Object.values(fig.pageChrome);
    for (const cfg of entries) {
      if (cfg?.frame && !nodes.includes(cfg.frame)) nodes.push(cfg.frame);
    }
  }
  const token = readToken(demoDir);

  const meta = await fetchMeta(fig.fileKey, token);
  const out = { ok: true, file: meta.name, version: meta.version, lastModified: meta.lastModified, role: meta.role, written: [] };

  // 稿版本变化提示：不阻断（我们只处理定稿），但必须说出来
  const metaPath = join(demoDir, 'fixtures', 'figma-meta.json');
  if (existsSync(metaPath)) {
    const old = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (old.version !== meta.version) {
      out.versionChanged = {
        from: { version: old.version, lastModified: old.lastModified },
        to: { version: meta.version, lastModified: meta.lastModified },
        note: '稿版本变了，快照与 truth.json 都需重跑；旧产物照的是上一版，不要混用',
      };
    }
  }

  writeFixture(demoDir, 'figma-meta.json', meta, out);

  if (!a.metaOnly) {
    if (!nodes.length) fail('没有要拉的节点：给 --node <id>，或在 spec.json 的 figma.fetchNodes 里写');
    const raw = await fetchNodes(fig.fileKey, nodes, token, a.depth);

    // 快照 = 我们加的 _meta + Figma 原始响应（原始部分一个字节不改：门 A 复算要用）
    const snap = {
      _meta: { ...meta, fetchedAt: new Date().toISOString(), requestedNodes: nodes, depth: a.depth ?? null },
      ...raw,
    };
    const name = a.out || fig.snapshotFile || 'figma-nodes.json';
    writeFixture(demoDir, name, snap, out);

    out.nodes = nodes.map((id) => {
      const doc = raw.nodes?.[id]?.document;
      if (!doc) return { id, ok: false, error: '没拿到该节点（id 写错？或无权限）' };
      let total = 0, texts = 0;
      (function walk(x) { total++; if (x.type === 'TEXT') texts++; for (const c of x.children || []) walk(c); })(doc);
      return { id, ok: true, name: doc.name, nodeCount: total, textCount: texts };
    });
  }

  console.log(JSON.stringify(out, null, 2));
}

function writeFixture(demoDir, name, data, out) {
  const dir = join(demoDir, 'fixtures');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data, null, 1));
  out.written.push({ file: `fixtures/${name}`, kb: Math.round(statSync(p).size / 1024) });
}

main().catch((e) => fail(e?.message || String(e)));
