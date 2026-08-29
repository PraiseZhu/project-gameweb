// pixel-reportonly-exit.test.mjs — reportOnly 退出码分级(2026-08-14 GPT-5.4 review fix)。
//
// reportOnly(阈值未拍板的只报不判开关)只豁免「完整跑完比对、纯差异超阈值」;
// MISSING/ERROR(基准图缺失、比对未真正执行)与 manifest 漂移是硬故障,无条件 exit 2 ——
// 单独跑 pixel-compare 只看退出码的用法(README 标准流程第 3 步)必须能靠退出码区分
// 「没跑成」与「跑成了但差异大」。fixture 自给自足,与 gate-e-v2 同手法。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, safeJsonForScript } from '../lib/fs-utils.mjs';
import { loadPngApi } from '../lib/png-compare.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PIXEL = join(ROOT, 'scripts/pixel-compare.mjs');
const MODULE_ROOT = process.env.QA_HIFI_MODULE_ROOT;
const NEEDS_BROWSER = '需要真 playwright(产品仓 node_modules)';

const env = () => (MODULE_ROOT ? { QA_HIFI_MODULE_ROOT: MODULE_ROOT } : {});

function run(script, args, opts = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: opts.cwd ?? ROOT, encoding: 'utf8',
    env: { ...process.env, ...(opts.env ?? {}) }, timeout: opts.timeout ?? 90000,
  });
}

/* 最小像素 demo:契约同 gate-e-v2 fixture。#frame 16x16 纯红 × baselineDpr 2 → 32x32 截图。 */
function writeDemo({ name = 'px', reportOnly = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `qa-px-exit-${name}-`));
  const source = join(dir, 'source.txt');
  writeFileSync(source, 'source-v1');
  const spec = {
    meta: { name, summary: { what: 'what', how: 'how', accept: 'accept' } },
    matrix: { platforms: ['desk'], regions: ['cn'], systems: ['ios'], themes: ['light'], langs: ['zh-CN'] },
    states: [{ id: 'id', via: [{ expect: 'id' }] }],
    verify: {
      cases: [{ id: 'desk-cn-light', prefs: { plat: 'desk', region: 'cn', os: 'ios', mode: 'light', lang: 'zh-CN' }, via: [{ expect: 'id' }] }],
      noClip: ['.box'],
    },
    bindings: [{ sel: '.box', prop: 'color', truth: 'colors.text', kind: 'color' }],
    baselines: [{ key: 'one', frameSel: '#frame' }],
    baselineDpr: 2,
    ...(reportOnly ? { baselineReportOnly: true } : {}),
  };
  const truth = { colors: { text: { value: '#ff0000', provenance: { source: 'source.txt', locator: 'fixture', hash: hashFile(source) } } } };
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  writeFileSync(join(dir, 'truth.json'), JSON.stringify(truth, null, 2));
  writeFileSync(join(dir, 'extract.mjs'), `process.stdout.write(${JSON.stringify(JSON.stringify(truth))});\n`);
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head><style>
    .box{color:#ff0000}
    #frame{width:16px;height:16px;background:#f00}
  </style></head><body>
  <script id="qa-truth" type="application/json">${safeJsonForScript(truth)}</script>
  <div class="box">x</div><div id="frame" class="frame"></div>
  <script>
  const S={step:'id',prefs:{plat:'desk',region:'cn',os:'ios',mode:'light',lang:'zh-CN'}};
  window.__qa={
    current:()=>S.step,
    goto:(id)=>{ if(id!=='id') throw new Error('unknown'); S.step=id; },
    prefs:()=>({...S.prefs}),
    scale:()=>1,
    resize:(w,h)=>{},
  };
  </script></body></html>`);
  return dir;
}

function paintPng(PNG, w, h, painter) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = painter(x, y);
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = a ?? 255;
    }
  }
  return png;
}

function writeBaseline(dir, rgba) {
  const baselineDir = join(dir, 'baselines');
  mkdirSync(baselineDir, { recursive: true });
  return join(baselineDir, 'one.png');
}

async function writeBaselinePng(dir, rgba) {
  const { PNG } = await loadPngApi(dir);
  const png = paintPng(PNG, 32, 32, () => rgba);
  writeFileSync(writeBaseline(dir, rgba), PNG.sync.write(png));
}

/* ==================== ④ MISSING/ERROR:reportOnly 也不豁免 ==================== */

test('MISSING(基准图缺失)+ reportOnly=true → exit 2(硬故障无豁免,集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const dir = writeDemo({ name: 'missing-reportonly', reportOnly: true });
  // 声明了 baseline 但故意不落 baselines/one.png
  const r = run(PIXEL, ['--demo', dir], { env: env() });
  assert.equal(r.status, 2, `MISSING 硬故障在 reportOnly 下仍必须非零退出:${r.stdout}`);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.ok, false);
  assert.equal(rep.reportOnly, true);
  assert.equal(rep.results[0].status, 'MISSING');
});

test('MISSING 对照:reportOnly=false 同样 exit 2(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const dir = writeDemo({ name: 'missing-hard' });
  const r = run(PIXEL, ['--demo', dir], { env: env() });
  assert.equal(r.status, 2, `MISSING 必须非零:${r.stdout}`);
});

/* ==================== ⑤ 纯差异超阈值:reportOnly 豁免仍为 0 ==================== */

test('WARN(纯差异超阈值)+ reportOnly=true → exit 0(完整跑完比对,只报不判,集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const dir = writeDemo({ name: 'warn-reportonly', reportOnly: true });
  // 基准绿色 vs 渲染纯红 → 大差异 → WARN,无裁决 → ok=false,但比对完整跑完
  await writeBaselinePng(dir, [0, 255, 0, 255]);
  const r = run(PIXEL, ['--demo', dir], { env: env() });
  assert.equal(r.status, 0, `纯差异超阈值在 reportOnly 下必须豁免为 0:${r.stdout}`);
  const rep = JSON.parse(r.stdout);
  assert.equal(rep.ok, false, 'ok 照算:WARN 无裁决仍非通过');
  assert.equal(rep.reportOnly, true);
  assert.equal(rep.results[0].status, 'WARN');
});

test('WARN 对照:reportOnly=false → exit 2(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const dir = writeDemo({ name: 'warn-hard' });
  await writeBaselinePng(dir, [0, 255, 0, 255]);
  const r = run(PIXEL, ['--demo', dir], { env: env() });
  assert.equal(r.status, 2, `差异超阈值无 reportOnly 必须非零:${r.stdout}`);
});

test('PASS 阳性对照:基准与渲染一致 → exit 0(集成)', async (t) => {
  if (!MODULE_ROOT) return t.skip(NEEDS_BROWSER);
  const dir = writeDemo({ name: 'pass' });
  await writeBaselinePng(dir, [255, 0, 0, 255]);
  const r = run(PIXEL, ['--demo', dir], { env: env() });
  assert.equal(r.status, 0, `基准一致必须 exit 0:${r.stdout}`);
  assert.equal(JSON.parse(r.stdout).results[0].status, 'PASS');
});

/* ==================== 源码契约(不 skip) ==================== */

test('源码契约:退出码必须区分硬故障与纯差异超阈值', () => {
  const src = readFileSync(PIXEL, 'utf8');
  const tail = src.slice(src.indexOf('const comparedComplete'));
  assert.match(tail, /results\.length === declared\.length/, '比对完整性必须按 declared 数量核对(防空 results 的 vacuous truth)');
  assert.match(tail, /results\.length > 0/, 'results 非空才可能算完整比对');
  assert.match(tail, /results\.every\(\(r\) => r\.status === 'PASS' \|\| r\.status === 'WARN'\)/, '完整比对 = 每条都 PASS/WARN(排除 MISSING/ERROR)');
  assert.match(tail, /process\.exit\(ok \|\| \(reportOnly && comparedComplete\) \? 0 : 2\)/, 'reportOnly 豁免必须被 comparedComplete 收窄');
});
