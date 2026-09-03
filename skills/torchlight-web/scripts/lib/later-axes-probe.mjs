/**
 * Later-axes Chrome probe (B1): interaction wiring still exists / unresolved
 * stays inert, and 1126/1127 composition + 10vw ruler match DESIGN.md.
 * Does not write human-review accepted.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { inspectPackPath, packRoot, sha256File } from './pack-demo.mjs';
import { requireOrchestratorTicket } from './orchestrator-ticket.mjs';
import { compositionForView, DESIGN_POLICY, OFFICIAL_ROOT_FONT_VW, widthScale } from './resize/index.mjs';

export const LATER_AXES_PROBE_SCHEMA = 'torchlightweb-later-axes-probe/v1';
export const LATER_AXES_PROBE_FILE = 'later-axes-probe.json';
export const LATER_AXES_PROBE_WIDTHS = Object.freeze([1126, 1127]);

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WIDTHS = LATER_AXES_PROBE_WIDTHS;

export function inertControlLooksClickable({
  cursor,
  pointerEvents,
  wiredAttrs = {},
} = {}) {
  if (String(cursor || '') === 'pointer') return true;
  const wired = Boolean(
    wiredAttrs.go
    || wiredAttrs.switch
    || wiredAttrs.scrollspy
    || wiredAttrs.dropmenu
    || wiredAttrs.hscroll
    || wiredAttrs.secTarget
    || wiredAttrs.switchAction
    || wiredAttrs.link,
  );
  return wired && String(pointerEvents || '') !== 'none';
}

export function laterAxesDemoDigest(demoDir) {
  const root = packRoot(demoDir);
  const files = ['index.html', 'truth.json'];
  const h = createHash('sha256');
  for (const rel of files) {
    const path = join(root, rel);
    h.update(rel);
    h.update('\0');
    if (existsSync(path)) h.update(sha256File(path));
    h.update('\n');
  }
  return h.digest('hex');
}

export function laterAxesProbeEvidenceComplete(parsed, { demoDir } = {}) {
  if (!parsed || parsed.schema !== LATER_AXES_PROBE_SCHEMA) return false;
  if (!Array.isArray(parsed.problems) || parsed.problems.length) return false;
  if (typeof parsed.demoDigest !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.demoDigest)) return false;
  if (demoDir) {
    if (laterAxesDemoDigest(demoDir) !== parsed.demoDigest) return false;
  }
  const samples = Array.isArray(parsed.samples) ? parsed.samples : [];
  const byWidth = new Map(samples.map((sample) => [Number(sample?.width), sample]));
  for (const width of WIDTHS) {
    const sample = byWidth.get(width);
    if (!sample) return false;
    if (!sample.measuredComposition || sample.measuredComposition !== sample.expectedComposition) return false;
    if (!Number.isFinite(Number(sample.clickableInertCount)) || Number(sample.clickableInertCount) !== 0) return false;
    const expectedFont = Number(sample.expectedOfficialRootPx);
    const measuredFont = Number(sample.measuredOfficialRootPx);
    if (!Number.isFinite(expectedFont) || expectedFont <= 0) return false;
    if (!Number.isFinite(measuredFont) || Math.abs(measuredFont - expectedFont) > 0.5) return false;
  }
  return true;
}

export function laterAxesProbeRecordIsGreen(parsed, extra = {}) {
  return parsed?.ok === true && parsed?.probed === true && laterAxesProbeEvidenceComplete(parsed, extra);
}

export function greenLaterAxesProbeFixture({
  at = '2026-09-03T00:00:00.000Z',
  mobileComposition = 'mobile',
  pcComposition = 'pc',
  demoDir = null,
} = {}) {
  return {
    schema: LATER_AXES_PROBE_SCHEMA,
    ok: true,
    probed: true,
    at,
    demoDigest: demoDir ? laterAxesDemoDigest(demoDir) : '0'.repeat(64),
    problems: [],
    samples: WIDTHS.map((width) => {
      const composition = width <= 1126 ? mobileComposition : pcComposition;
      const expectedOfficialRootPx = width * (OFFICIAL_ROOT_FONT_VW / 100);
      return {
        width,
        expectedComposition: composition,
        measuredComposition: composition,
        expectedOfficialRootPx,
        measuredOfficialRootPx: expectedOfficialRootPx,
        clickableInertCount: 0,
        wiredCount: 0,
        inertCount: 0,
      };
    }),
  };
}

function platformsOfTruth(truth) {
  const platforms = truth?.platforms && typeof truth.platforms === 'object' ? truth.platforms : {};
  return {
    pc: Boolean(platforms.pc),
    mobile: Boolean(platforms.mobile),
    pad: Boolean(platforms.pad),
  };
}

function expectedComposition(width, platforms) {
  const key = compositionForView({ width, platforms })?.key;
  return key === 'mobile' ? 'mobile' : 'pc';
}

function expectedRootFontPx(width) {
  return width * (OFFICIAL_ROOT_FONT_VW / 100);
}

export function laterAxesProbePath(demoDir) {
  return join(packRoot(demoDir), LATER_AXES_PROBE_FILE);
}

export function readLaterAxesProbe(demoDir) {
  const root = packRoot(demoDir);
  const inspected = inspectPackPath(root, laterAxesProbePath(root));
  if (!inspected.ok) return { ok: false, probed: false, missing: true, error: inspected.error };
  try {
    const parsed = JSON.parse(readFileSync(inspected.path, 'utf8'));
    if (parsed?.schema !== LATER_AXES_PROBE_SCHEMA) {
      return { ok: false, probed: false, invalid: true, error: 'later-axes-probe-schema' };
    }
    return {
      ...parsed,
      green: laterAxesProbeRecordIsGreen(parsed, { demoDir: root }),
    };
  } catch {
    return { ok: false, probed: false, invalid: true, error: 'later-axes-probe-unreadable' };
  }
}

function writeProbe(demoDir, payload) {
  const root = packRoot(demoDir);
  const file = laterAxesProbePath(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

function loadTruth(demoDir) {
  const path = join(packRoot(demoDir), 'truth.json');
  if (!existsSync(path)) throw new Error('demo truth.json missing; cannot probe later axes');
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function measurePage(page, width) {
  await page.setViewportSize({ width: Math.max(width, 400), height: 1080 });
  await page.evaluate((w) => {
    if (typeof window.__qa?.resize === 'function') window.__qa.resize(w, 1080);
  }, width);
  await page.evaluate(() => new Promise((resolveWait) => setTimeout(resolveWait, 250)));
  return page.evaluate((w) => {
    const frame = document.querySelector('.frame') || document.body;
    const composition = frame.getAttribute('data-render-base') || null;
    const probeEl = document.createElement('div');
    probeEl.setAttribute('data-later-axes-root-font', '1');
    probeEl.style.cssText = 'position:absolute;visibility:hidden;font-size:var(--fx-official-root)';
    document.documentElement.appendChild(probeEl);
    const htmlPx = parseFloat(getComputedStyle(probeEl).fontSize);
    probeEl.remove();
    const wired = [...frame.querySelectorAll('[data-go],[data-switch],[data-scrollspy],[data-dropmenu],[data-hscroll]')];
    const inert = [...frame.querySelectorAll('[data-btn-press="inert"],[aria-disabled="true"]')];
    const inertSnapshots = inert.map((el) => {
      const cs = getComputedStyle(el);
      return {
        cursor: cs.cursor,
        pointerEvents: cs.pointerEvents,
        wiredAttrs: {
          go: el.getAttribute('data-go'),
          switch: el.getAttribute('data-switch'),
          scrollspy: el.getAttribute('data-scrollspy'),
          dropmenu: el.getAttribute('data-dropmenu'),
          hscroll: el.getAttribute('data-hscroll'),
          secTarget: el.getAttribute('data-sec-target'),
          switchAction: el.getAttribute('data-switch-action'),
          link: el.getAttribute('data-link'),
        },
      };
    });
    return {
      width: w,
      composition,
      htmlFontPx: Number.isFinite(htmlPx) ? htmlPx : null,
      wiredCount: wired.length,
      inertCount: inert.length,
      inertSnapshots,
      hasQa: typeof window.__qa?.resize === 'function',
    };
  }, width);
}

export async function runLaterAxesProbe({ demoDir, now = new Date().toISOString() } = {}) {
  const root = packRoot(demoDir);
  const indexPath = join(root, 'index.html');
  if (!existsSync(indexPath)) {
    const payload = {
      schema: LATER_AXES_PROBE_SCHEMA,
      ok: false,
      probed: false,
      error: 'demo index.html missing; cannot probe later axes',
      at: now,
    };
    writeProbe(root, payload);
    return payload;
  }
  const truth = loadTruth(root);
  const platforms = platformsOfTruth(truth);
  const server = createSafeStaticServer(root);
  let browser;
  const samples = [];
  const problems = [];
  if (Number(DESIGN_POLICY.officialRootFontVw) !== 10) {
    problems.push(`DESIGN.md officialRootFontVw ${DESIGN_POLICY.officialRootFontVw} != 10`);
  }
  try {
    const base = await server.listen('127.0.0.1');
    ({ browser } = await launchChromium(SKILL_ROOT, { headless: true }));
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    await page.goto(`${base}/index.html?inventory-static-gate=1`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: 120000 });
    for (const width of WIDTHS) {
      const measured = await measurePage(page, width);
      const expectedKey = expectedComposition(width, platforms);
      const expectedFont = expectedRootFontPx(width);
      const scale = widthScale({ viewportW: width, compositionKey: expectedKey });
      const clickableInertCount = (measured.inertSnapshots || []).filter(inertControlLooksClickable).length;
      const item = {
        width,
        expectedComposition: expectedKey,
        measuredComposition: measured.composition,
        expectedOfficialRootPx: expectedFont,
        measuredOfficialRootPx: measured.htmlFontPx,
        expectedK: scale.k,
        wiredCount: measured.wiredCount,
        inertCount: measured.inertCount,
        clickableInertCount,
        hasQa: measured.hasQa,
      };
      if (measured.composition !== expectedKey) {
        problems.push(`width ${width}: composition ${measured.composition} != ${expectedKey}`);
      }
      if (!Number.isFinite(scale.officialRootFontPx) || Math.abs(scale.officialRootFontPx - expectedFont) > 0.01) {
        problems.push(`width ${width}: official 10vw ruler ${scale.officialRootFontPx} != ${expectedFont}`);
      }
      if (!Number.isFinite(measured.htmlFontPx) || Math.abs(measured.htmlFontPx - expectedFont) > 0.5) {
        problems.push(`width ${width}: measured official 10vw ${measured.htmlFontPx} != ${expectedFont}`);
      }
      if (clickableInertCount > 0) {
        problems.push(`width ${width}: ${clickableInertCount} inert controls still look clickable`);
      }
      samples.push(item);
    }
  } catch (error) {
    problems.push(error && error.message ? error.message : String(error));
  } finally {
    if (browser) await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
  const payload = {
    schema: LATER_AXES_PROBE_SCHEMA,
    at: now,
    demoDigest: laterAxesDemoDigest(root),
    samples,
    problems,
  };
  const green = problems.length === 0 && laterAxesProbeEvidenceComplete(payload, { demoDir: root });
  payload.ok = green;
  payload.probed = green;
  writeProbe(root, payload);
  return payload;
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

async function main(argv = process.argv.slice(2)) {
  const ticket = requireOrchestratorTicket('scripts/lib/later-axes-probe.mjs', { argv: process.argv, env: process.env });
  if (ticket.ok !== true) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      error: `later-axes-probe CLI is locked; ${ticket.hint || 'run npm run torchlightweb -- continue --demo <dir>'} (${ticket.error})`,
    }, null, 2)}\n`);
    process.exit(2);
  }
  const demo = argOf(argv, '--demo');
  if (!demo) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: 'usage: node scripts/lib/later-axes-probe.mjs --demo <dir>' }, null, 2)}\n`);
    process.exit(2);
  }
  const result = await runLaterAxesProbe({ demoDir: resolve(demo) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
