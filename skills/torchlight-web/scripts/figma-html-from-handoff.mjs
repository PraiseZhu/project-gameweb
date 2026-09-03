#!/usr/bin/env node
/**
 * Ready handoff pack → demo/index.html (Main static candidate).
 * `figma:from-handoff` stays consume-only. This command is the official HTML path.
 *
 *   node scripts/figma-html-from-handoff.mjs --handoff <dir> --demo <dir>
 *
 * Preview-first is required before showing `?product=1`. Tests may pass
 * `skipPreview: true` to `buildHtmlFromHandoff`; the CLI never skips it.
 * After HTML is written, `figma-fonts` copies registered source families into
 * the demo. Consume already fail-closes when a source family is missing from
 * fonts/registry.json — Figma REST cannot download font binaries. Register
 * with `npm run fonts:register` once; later restores copy it automatically.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runFromHandoff } from './figma-from-handoff.mjs';
import { EMPTY_PLATFORM_SCOPE, platformTruthFromInventory, readyPlatformTruth } from './lib/ready-handoff-truth.mjs';
import { DEFAULT_MAX_HTML_BYTES, QA_TRUTH_RE, externalizeQaTruthIfOverLimit } from './lib/html-volume.mjs';
import { safeJsonForScript } from './lib/fs-utils.mjs';
import { workflowDeclaration } from './lib/workflows.mjs';
import { runInventoryStaticGate } from './lib/inventory-static-gate.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INIT = join(SKILL_ROOT, 'scripts/init.mjs');
const INLINE = join(SKILL_ROOT, 'scripts/figma-inline.mjs');
const FONTS = join(SKILL_ROOT, 'scripts/figma-fonts.mjs');
const ASSETS = join(SKILL_ROOT, 'scripts/figma-assets.mjs');
const PREVIEW = join(SKILL_ROOT, 'scripts/preview-first.mjs');

function fail(message, extra = {}) {
  process.stdout.write(JSON.stringify({ ok: false, problems: [message], ...extra }, null, 2) + '\n');
  process.exit(1);
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function runNode(script, args, extra = {}) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: extra.timeout ?? 180000,
  });
  if (res.status !== 0) {
    const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
    throw new Error(`${script} failed (${res.status}): ${output || res.error?.message || 'no output'}`);
  }
  return res;
}

function failBuild(consume, problems, extra = {}) {
  return { ok: false, wroteHtml: false, consume, problems, ...extra };
}

export function parsePreviewJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

function volumeError(htmlVolume) {
  return new Error(
    `index.html exceeds ${htmlVolume.limitBytes} bytes after truth externalize (${htmlVolume.bytes} bytes, action=${htmlVolume.action})`,
  );
}

function assertHtmlVolume(demoDir, limitBytes, htmlVolume = externalizeQaTruthIfOverLimit(demoDir, { limitBytes })) {
  if (!htmlVolume.ok) throw volumeError(htmlVolume);
  return htmlVolume;
}

function writeDemoShell(demoDir, consume, pc, mobile, htmlLimitBytes = DEFAULT_MAX_HTML_BYTES) {
  const indexPath = join(demoDir, 'index.html');
  if (!existsSync(indexPath)) {
    const slug = `handoff-${String(consume.fingerprint || 'pack').replace(/[^a-z0-9-]/gi, '').slice(0, 24).toLowerCase() || 'pack'}`;
    runNode(INIT, ['--dir', demoDir, '--name', slug, '--workflow', 'figma-showcase']);
  }
  if (!existsSync(indexPath)) throw new Error(`init did not write ${indexPath}`);
  const truth = readyPlatformTruth({ fingerprint: consume.fingerprint, source: pc.source, pc, mobile });
  assertHtmlVolume(demoDir, htmlLimitBytes, embedOrExternalizeTruth(demoDir, truth, htmlLimitBytes));
  patchShowcaseSpec(demoDir, consume);
  runNode(INLINE, ['--demo', demoDir]);
  /* Figma REST cannot ship font binaries. Main copies registered files into
     the demo and fail-closes when a source family is missing — never swap in
     PingFang/YaHei as if the page matched the file. */
  runNode(FONTS, ['--demo', demoDir]);
  return { indexPath, htmlVolume: assertHtmlVolume(demoDir, htmlLimitBytes) };
}

function attachSliceAssets(payload, demoDir, { reuseExisting = false } = {}) {
  try {
    runNode(ASSETS, ['--demo', demoDir, ...(reuseExisting ? ['--reuse-existing'] : [])], { timeout: 900000 });
    payload.sliceAssets = { ok: true };
    return payload;
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    payload.sliceAssets = { ok: false, error: message };
    return blockProductView(
      payload,
      'figma-assets red; product preview still has missing slices',
      [message],
    );
  }
}

function endsOfConsume(consume) {
  if (Array.isArray(consume?.ends) && consume.ends.length) return consume.ends;
  return [
    consume?.consume?.pc ? 'pc' : null,
    consume?.consume?.mobile ? 'mobile' : null,
  ].filter(Boolean);
}

function sourcePlatformsOf(ends) {
  const platforms = [];
  if (ends.includes('pc')) platforms.push('desktop');
  if (ends.includes('mobile')) platforms.push('mobile');
  return platforms;
}

function showcaseWorkflow(ends) {
  const workflow = workflowDeclaration('figma-showcase');
  const platforms = sourcePlatformsOf(ends);
  return {
    ...workflow,
    sourcePlatforms: platforms,
    claimedCapabilities: {
      ...workflow.claimedCapabilities,
      desktopSourcePlatform: ends.includes('pc') ? 'claimed' : 'not-claimed',
      mobileSourcePlatform: ends.includes('mobile') ? 'claimed' : 'not-claimed',
    },
  };
}

function embedOrExternalizeTruth(demoDir, truth, limitBytes = DEFAULT_MAX_HTML_BYTES) {
  const indexPath = join(demoDir, 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  if (!QA_TRUTH_RE.test(html)) {
    throw new Error('index.html missing #qa-truth');
  }
  const next = html.replace(QA_TRUTH_RE, `<script id="qa-truth" type="application/json">${safeJsonForScript(truth)}</script>`);
  writeFileSync(indexPath, next);
  writeFileSync(join(demoDir, 'truth.json'), `${JSON.stringify(truth, null, 2)}\n`);
  return externalizeQaTruthIfOverLimit(demoDir, { limitBytes });
}

function patchShowcaseSpec(demoDir, consume) {
  const specPath = join(demoDir, 'spec.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const ends = endsOfConsume(consume);
  const platforms = sourcePlatformsOf(ends);
  spec.workflow = showcaseWorkflow(ends);
  spec.figma = {
    sourcePlatforms: platforms,
    source: 'ready-handoff',
    fileKey: consume?.consume?.pc?.fileKey
      ?? consume?.consume?.mobile?.fileKey
      ?? null,
    pcPageId: consume?.consume?.pc?.pageId ?? null,
    mobilePageId: consume?.consume?.mobile?.pageId ?? null,
    exportScale: 1,
  };
  spec.matrix = {
    ...(spec.matrix || {}),
    platforms,
  };
  writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
}

function consumeReadyPack(handoffDir) {
  const consume = runFromHandoff(handoffDir);
  if (!consume.ok) {
    return { error: failBuild(consume, consume.problems, { note: 'handoff consume gate red; no HTML written' }) };
  }
  if (consume.kind !== 'ready' || consume.ready !== true) {
    return { error: failBuild(consume, [
      `html-from-handoff only accepts kind=ready packs; got kind=${consume.kind} ready=${consume.ready}`,
    ]) };
  }
  const adaptOptions = { allowDraft: false, platformScopeInput: EMPTY_PLATFORM_SCOPE };
  const ends = endsOfConsume(consume);
  const pcPath = join(handoffDir, 'inventory-pc.json');
  const mobilePath = join(handoffDir, 'inventory-mobile.json');
  const pc = ends.includes('pc') && existsSync(pcPath)
    ? platformTruthFromInventory(JSON.parse(readFileSync(pcPath, 'utf8')), adaptOptions)
    : null;
  const mobile = ends.includes('mobile') && existsSync(mobilePath)
    ? platformTruthFromInventory(JSON.parse(readFileSync(mobilePath, 'utf8')), adaptOptions)
    : null;
  const problems = [];
  if (ends.includes('pc') && !pc?.ok) problems.push(...(pc?.problems || ['pc inventory missing']));
  if (ends.includes('mobile') && !mobile?.ok) problems.push(...(mobile?.problems || ['mobile inventory missing']));
  if (!ends.length) problems.push('handoff pack has no pc or mobile end');
  if (problems.length) return { error: failBuild(consume, problems) };
  return { consume, pc, mobile, ends };
}

export function buildHtmlFromHandoff({
  handoffDir,
  demoDir,
  skipPreview = false,
  htmlLimitBytes = DEFAULT_MAX_HTML_BYTES,
  staticGateProbe = null,
  reuseExistingAssets = false,
}) {
  const loaded = consumeReadyPack(handoffDir);
  if (loaded.error) return loaded.error;
  const { consume, pc, mobile } = loaded;

  mkdirSync(demoDir, { recursive: true });
  let written;
  try {
    written = writeDemoShell(demoDir, consume, pc, mobile, htmlLimitBytes);
  } catch (err) {
    return failBuild(consume, [err && err.message ? err.message : String(err)], {
      wroteHtml: existsSync(join(demoDir, 'index.html')),
    });
  }
  const { indexPath, htmlVolume } = written;

  const payload = {
    ok: true,
    wroteHtml: true,
    handoffDir,
    demoDir,
    indexPath,
    fingerprint: consume.fingerprint,
    consume,
    htmlVolume,
    note: 'unknown 只画不接线。skipped 不画。preview-first 与清单对账绿之前禁止给人打开产品视图，禁止开 Interaction / Resize。',
    completionStandard: 'eat ready pack → write demo/index.html → preview-first must be green → inventory static gate must be green → then show ?product=1. Stop at Main static.',
  };

  if (skipPreview) {
    payload.previewFirst = { skipped: true, ok: false };
    payload.ok = false;
    payload.problems = ['preview-first skipped; product view not allowed'];
  } else {
    attachSliceAssets(payload, demoDir, { reuseExisting: reuseExistingAssets });
    if (payload.ok === true) attachPreviewFirst(payload, demoDir);
  }
  return attachInventoryStaticGate(payload, { handoffDir, demoDir, skipPreview, staticGateProbe });
}

function blockProductView(payload, reason, extraProblems = []) {
  payload.ok = false;
  payload.productViewAllowed = false;
  payload.humanStopPreviewAllowed = false;
  payload.productView = { url: null, command: null, blocked: true, reason };
  payload.problems = [...new Set([...(payload.problems || []), reason, ...extraProblems])];
  return payload;
}

function attachInventoryStaticGate(payload, { handoffDir, demoDir, skipPreview, staticGateProbe }) {
  const ends = endsOfConsume(payload.consume).filter((end) => end === 'pc' || end === 'mobile');
  const platforms = ends.length ? ends : ['pc'];
  const gates = platforms.map((platform) => runInventoryStaticGate({
    handoffDir,
    platform,
    lang: 'zh-CN',
    viewportKind: 'design',
    probe: staticGateProbe || (skipPreview
      ? failClosedStaticGateProbe(demoDir)
      : defaultStaticGateProbe(demoDir, handoffDir, platform)),
  }));
  const gate = {
    ok: gates.every((item) => item?.ok === true),
    skipped: gates.some((item) => item?.skipped === true),
    platforms: Object.fromEntries(platforms.map((platform, index) => [platform, gates[index]])),
    problems: gates.flatMap((item, index) => asArray(item?.problems).map((problem) => `${platforms[index]}: ${problem}`)),
    failureCount: gates.reduce((sum, item) => sum + Number(item?.failureCount || 0), 0),
  };
  payload.inventoryStaticGate = gate;
  if (gate?.skipped === true && skipPreview) {
    return blockProductView(payload, 'preview-first skipped; product view not allowed; static gate not skipped-ok');
  }
  if (!gate || gate.ok !== true) {
    return blockProductView(
      payload,
      'inventory-static-gate red; do not open product view, do not start Interaction / Resize',
      asArray(gate?.problems),
    );
  }
  if (skipPreview) {
    return blockProductView(payload, 'preview-first skipped; product view not allowed');
  }
  if (payload.ok !== true) {
    return blockProductView(
      payload,
      payload.productView?.reason || 'preview-first red; do not open product view, do not start Interaction / Resize',
    );
  }
  payload.productViewAllowed = true;
  payload.humanStopPreviewAllowed = true;
  return payload;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function failClosedStaticGateProbe(demoDir) {
  return () => {
    if (!existsSync(join(demoDir, 'index.html'))) {
      throw new Error('demo index.html missing; cannot measure DOM');
    }
    throw new Error('DOM probe required; refusing to mark inventory-static-gate green from JSON-only truth');
  };
}

function defaultStaticGateProbe(demoDir, handoffDir, platform) {
  return () => {
    if (!existsSync(join(demoDir, 'index.html'))) {
      throw new Error('demo index.html missing; cannot measure DOM');
    }
    const probeScript = join(SKILL_ROOT, 'scripts/lib/inventory-static-gate-probe.mjs');
    if (!existsSync(probeScript)) {
      throw new Error('inventory-static-gate-probe.mjs missing; cannot mark green without DOM');
    }
    const res = spawnSync(process.execPath, [
      probeScript,
      '--demo', demoDir,
      '--handoff', handoffDir,
      '--platform', platform || 'pc',
      '--lang', 'zh-CN',
    ], {
      cwd: SKILL_ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 180000,
    });
    if (res.status !== 0) {
      const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
      throw new Error(output || 'DOM probe required; Chromium measurement failed');
    }
    const text = String(res.stdout || '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw new Error('DOM probe required; refusing to mark inventory-static-gate green from JSON-only truth');
    }
    return JSON.parse(text.slice(start, end + 1));
  };
}

function attachPreviewFirst(payload, demoDir) {
  const previewOut = join(demoDir, 'artifacts', 'preview-first');
  const preview = spawnSync(process.execPath, [PREVIEW, '--demo', demoDir, '--out', previewOut], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 180000,
  });
  const previewJson = parsePreviewJson(preview.stdout);
  payload.previewFirst = previewJson || { ok: false, status: preview.status, stderr: preview.stderr };
  payload.ok = preview.status === 0 && previewJson?.ok === true;
  payload.productViewAllowed = payload.ok === true;
  payload.humanStopPreviewAllowed = payload.ok === true;
  payload.productView = payload.ok ? (previewJson?.productView ?? null) : {
    url: null,
    command: null,
    blocked: true,
    reason: 'preview-first red; do not open product view, do not start Interaction / Resize',
  };
  payload.humanReview = previewJson?.humanReview ?? null;
  payload.nextHumanStep = previewJson?.nextHumanStep
    || (payload.ok
      ? 'preview:first 已绿。第一次给人看：Main 静态。等人说继续，才做交互和拉伸。'
      : 'preview:first 红了不许给人打开 ?product=1，也不许开 Interaction / Resize。');
  if (!payload.ok) {
    payload.problems = [
      'preview-first red; do not open product view, do not start Interaction / Resize',
      ...(previewJson?.contractFailures || []),
      ...(previewJson?.pageErrors || []),
    ];
  }
  return payload;
}

function main(argv = process.argv.slice(2)) {
  const handoff = argOf(argv, '--handoff') || argv.find((arg) => !arg.startsWith('--'));
  const demo = argOf(argv, '--demo');
  if (!handoff || !demo) {
    fail('usage: node scripts/figma-html-from-handoff.mjs --handoff <handoff-dir> --demo <demo-dir>');
  }
  const result = buildHtmlFromHandoff({
    handoffDir: resolve(handoff),
    demoDir: resolve(demo),
    reuseExistingAssets: argv.includes('--reuse-existing'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
