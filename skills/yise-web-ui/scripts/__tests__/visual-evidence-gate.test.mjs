// visual-evidence-gate.test.mjs — 视觉证据硬门(2026-08-14 用户拍板:candidate 级必须脚本层拦截)
//
// 覆盖两项落地:
//   ① pr-block 对「零视觉证据」(spec.baselines 为空 / 可信 pixel 结论 candidate)硬阻断 exit 2,
//     且拦截发生在任何可信 spawn 之前(无 playwright 环境也能真跑、不 skip);
//   ② verify.mjs 顶层 report 暴露 evidenceLevel(与 pr-block 共用 aggregateEvidenceLevel 聚合,
//     最保守优先:candidate < unverified < confirmed-final)。
// confirmed-final 正常放行的阳性路径需要真 playwright + 真像素比对,沿用 r6「条目 2 阳性对照」
// 的手法,无 QA_HIFI_MODULE_ROOT 时按既有惯例 skip(CI 有 playwright 时会真跑)。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInputHashes, hashFile, safeJsonForScript, TOOL_VERSION } from '../lib/fs-utils.mjs';
import { aggregateEvidenceLevel } from '../lib/report.mjs';
import { loadPngApi } from '../lib/png-compare.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VERIFY = join(ROOT, 'scripts/verify.mjs');
const PIXEL = join(ROOT, 'scripts/pixel-compare.mjs');
const PRBLOCK = join(ROOT, 'scripts/pr-block.mjs');
const MODULE_ROOT = process.env.QA_HIFI_MODULE_ROOT;
const env = () => (MODULE_ROOT ? { QA_HIFI_MODULE_ROOT: MODULE_ROOT } : {});
const NEEDS_BROWSER = '端到端需要真 playwright(产品仓 node_modules)——可信 verify 重跑必须过浏览器门';

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

function run(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd ?? ROOT, encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) }, timeout: opts.timeout ?? 300000,
  });
}

/* 最小非组件 demo(与 comp-fix-r8/r9 同款 fixture):不需要 esbuild/tailwind;
   门 A 无浏览器可跑(verify --gate A 在任何环境 exit 0),pr-block 硬门在 spawn 之前判定。 */
function writeDemo({ name, baselines = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `qa-visual-${name}-`));
  const source = join(dir, 'source.txt');
  writeFileSync(source, 'source-v1');
  const leaf = (value, locator) => ({ value, provenance: { source: 'source.txt', locator, hash: hashFile(source) } });
  const truth = { colors: { text: leaf('#ff0000', 'text color') } };
  const spec = {
    meta: { name, summary: { what: 'what', how: 'how', accept: 'accept' } },
    matrix: { platforms: ['desk'], regions: ['cn'], systems: ['ios'], themes: ['light'], langs: ['zh-CN'] },
    states: [{ id: 'id', via: [{ expect: 'id' }] }],
    verify: {
      cases: [{ id: 'desk-cn-light', prefs: { plat: 'desk', region: 'cn', os: 'ios', mode: 'light', lang: 'zh-CN' }, via: [{ expect: 'id' }] }],
      noClip: ['.box'],
    },
    bindings: [{ sel: '.box', prop: 'color', truth: 'colors.text', kind: 'color' }],
    ...(baselines ? { baselines } : {}),
  };
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 2));
  writeFileSync(join(dir, 'extract.mjs'), `process.stdout.write(${JSON.stringify(JSON.stringify(truth))});\n`);
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><style>
    .box{color:#ff0000;white-space:nowrap}
    #frame{width:16px;height:16px;background:#f00}
  </style></head><body>
  <script id="qa-truth" type="application/json">${safeJsonForScript(truth)}</script>
  <div class="box">x</div><div id="frame" class="frame"></div>
  <script>
  const S={step:'id',prefs:{plat:'desk',region:'cn',os:'ios',mode:'light',lang:'zh-CN'}};
  window.__qa={current:()=>S.step,goto:(id)=>{if(id!=='id')throw new Error('unknown');S.step=id;},prefs:()=>({...S.prefs}),scale:()=>1,resize:(w,h)=>{}};
  </script></body></html>`);
  return { dir, spec, truth };
}

/* 手写一份能过 validateReportIntegrity 的 report.json —— 本测试测的是视觉证据硬门,
   不是防伪层(防伪层已有 comp-fix-r5/r6/r7 覆盖)。 */
function writeForgedReport(dir, spec) {
  const gate = { status: 'passed', pass: true, failures: [], passed: 1, total: 1 };
  writeFileSync(join(dir, 'report.json'), JSON.stringify({
    ok: true,
    workflow: 'product-qa',
    toolVersion: TOOL_VERSION,
    inputHashes: buildInputHashes(dir, spec),
    coverage: { cases: [{ id: 'desk-cn-light', prefs: { plat: 'desk', region: 'cn', os: 'ios', mode: 'light', lang: 'zh-CN' } }] },
    gateA: gate, gateB: gate, gateC: gate, gateD: gate, gateF: gate, gateX: gate,
    outcome: {
      workflow: 'product-qa',
      scope: 'full',
      status: 'passed',
      passed: ['gateA', 'gateB', 'gateC', 'gateD', 'gateF', 'gateX'],
      limited: [],
      notClaimed: [],
      blocked: [],
      skipped: [],
      workflowAcceptable: true,
      productPrComplete: true,
    },
    evidenceLevel: 'candidate',
    generatedAt: new Date().toISOString(),
  }, null, 2) + '\n');
}

/* ==================== ① 聚合函数单元(最保守优先) ==================== */

test('aggregateEvidenceLevel 单元: 无基准 → candidate;声明基准但无可信结果 → unverified', () => {
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 0 }), 'candidate');
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1 }), 'unverified');
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: null }), 'unverified');
});

test('aggregateEvidenceLevel 单元: 可信 pixel skipped/verified:false/candidate → candidate', () => {
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: { ok: true, skipped: true } }), 'candidate');
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: { ok: true, verified: false } }), 'candidate');
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: { ok: true, evidenceLevel: 'candidate' } }), 'candidate');
});

test('aggregateEvidenceLevel 单元: 可信 pixel ok → confirmed-final;不 ok → candidate', () => {
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: { ok: true, skipped: false } }), 'confirmed-final');
  assert.equal(aggregateEvidenceLevel({ declaredBaselines: 1, trustedPixel: { ok: false, skipped: false } }), 'candidate');
});

/* ==================== ② verify.mjs 顶层 evidenceLevel(无 playwright 真跑) ==================== */

test('verify 顶层 evidenceLevel: 未声明 baseline → candidate(门 A 真跑,不 skip)', () => {
  const { dir } = writeDemo({ name: 'verify-candidate' });
  const v = run(VERIFY, ['--demo', dir, '--gate', 'A'], { env: env() });
  assert.equal(v.status, 0, `verify --gate A 失败:${v.stdout}${v.stderr}`);
  const rep = readJson(join(dir, 'report.json'));
  assert.equal(rep.evidenceLevel, 'candidate', '无基准的 verify 顶层必须聚合为 candidate');
});

test('verify 顶层 evidenceLevel: 声明了 baseline → unverified(门 E 结论不在本报告,不 skip)', () => {
  const { dir } = writeDemo({ name: 'verify-unverified', baselines: [{ key: 'one', frameSel: '#frame' }] });
  // 落一张占位基准图:buildInputHashes 只按字节 hash,门 A 不比对像素(比对侧会报 MISSING 由门 E 兜)
  mkdirSync(join(dir, 'baselines'), { recursive: true });
  writeFileSync(join(dir, 'baselines/one.png'), 'NOT-A-PNG');
  const v = run(VERIFY, ['--demo', dir, '--gate', 'A'], { env: env() });
  assert.equal(v.status, 0, `verify --gate A 失败:${v.stdout}${v.stderr}`);
  const rep = readJson(join(dir, 'report.json'));
  assert.equal(rep.evidenceLevel, 'unverified', '声明基准但本报告未比对像素,顶层必须是 unverified(confirmed-final 只能由 pr-block 聚合)');
});

/* ==================== ③ pr-block 硬阻断(无 playwright 真跑:拦截发生在任何 spawn 之前) ==================== */

test('pr-block 硬阻断: spec.baselines 为空 → exit 2,且唯一的 problem 就是视觉证据门(不 skip)', () => {
  const { dir, spec } = writeDemo({ name: 'prblock-candidate' });
  writeForgedReport(dir, spec);
  const pr = run(PRBLOCK, ['--demo', dir], { env: env() });
  assert.equal(pr.status, 2, `零视觉证据的 demo 居然出了块:${pr.stdout}${pr.stderr}`);
  const out = JSON.parse(pr.stdout);
  assert.equal(out.problems.length, 1, '除视觉证据门外不该有其它 problem(说明拦截发生在可信 spawn 之前,且 fixture 其余全绿)');
  assert.match(out.problems[0], /spec\.baselines 为空/);
  assert.match(out.problems[0], /evidenceLevel=candidate/);
  assert.match(out.problems[0], /capture-baseline/, '修法必须点名采集真实基准的入口');
  assert.match(out.problems[0], /adjudications/, '修法必须点名 WARN 人工裁决路径');
});

/* ==================== ④ 阳性路径:confirmed-final 证据正常放行(需真 playwright,CI 真跑) ==================== */

test('阳性: 有基准、可信 pixel PASS → pr-block exit 0 且 stderr 打出 evidenceLevel: confirmed-final', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const baselines = [{ key: 'one', frameSel: '#frame' }];
  const { dir } = writeDemo({ name: 'prblock-confirmed', baselines });
  // 与 r6「条目 2 阳性对照」同手法:#frame 是 16x16 纯红 × 默认 baselineDpr 2 → 32x32 纯红基准
  const { PNG } = await loadPngApi(dir);
  const png = new PNG({ width: 32, height: 32 });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 0; png.data[i + 3] = 255; }
  mkdirSync(join(dir, 'baselines'), { recursive: true });
  writeFileSync(join(dir, 'baselines/one.png'), PNG.sync.write(png));

  const v = run(VERIFY, ['--demo', dir], { env: env(), timeout: 600000 });
  assert.equal(v.status, 0, `verify 失败:${v.stdout}${v.stderr}`);
  const px = run(PIXEL, ['--demo', dir], { env: env(), timeout: 600000 });
  assert.equal(px.status, 0, `pixel-compare 失败:${px.stdout}${px.stderr}`);
  assert.equal(readJson(join(dir, 'report-pixel.json')).results[0].status, 'PASS');
  const pr = run(PRBLOCK, ['--demo', dir, '--url', 'https://demo.workers.xd.team'], { env: env(), timeout: 600000 });
  assert.equal(pr.status, 0, `confirmed-final 证据被误伤:${pr.stdout}${pr.stderr}`);
  assert.match(pr.stderr, /evidenceLevel: confirmed-final/, '出块时 stderr 必须给出最终证据等级');
  assert.match(pr.stdout, /像素基准/);
  assert.ok(!pr.stdout.includes('未运行 pixel-compare'), '门 E 真跑过,不该打「未运行」');
});

/* ==================== ⑤ 源码契约:硬门位置与聚合实现(不 skip) ==================== */

test('源码契约: 硬门在可信 spawn 之前;verify 与 pr-block 共用 aggregateEvidenceLevel', () => {
  const pr = readFileSync(PRBLOCK, 'utf8');
  assert.ok(pr.includes('aggregateEvidenceLevel'), 'pr-block 必须使用共享聚合函数');
  assert.ok(
    pr.indexOf('spec.baselines 为空——视觉层零像素基准') < pr.indexOf("spawnSync(process.execPath, [CANONICAL_PIXEL"),
    '视觉证据硬门必须排在可信 pixel spawn 之前(否则无 playwright 环境拦不住、白跑一轮浏览器)',
  );
  assert.ok(pr.includes('evidenceLevel: ${aggregateEvidenceLevel'), '出块前必须打印最终证据等级');
  const v = readFileSync(VERIFY, 'utf8');
  assert.ok(v.includes('aggregateEvidenceLevel'), 'verify 必须使用共享聚合函数');
  assert.ok(v.includes('evidenceLevel,'), 'verify 顶层 report 必须带 evidenceLevel 字段');
});
