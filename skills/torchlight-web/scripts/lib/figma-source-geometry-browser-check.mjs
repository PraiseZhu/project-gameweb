/*
 * Source-backed browser geometry gate.
 *
 * This is deliberately different from a screenshot-only check: every expected
 * coordinate comes from Figma truth, and every actual coordinate comes from
 * getBoundingClientRect in the rendered page. The comparison is done in design
 * pixels after dividing out the active preview zoom.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const arrOf = (v) => Array.isArray(v) ? v : Object.values(v || {});
const unwrap = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && v.provenance) return v.value;
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
};

export function flattenTruth(truth) {
  const out = [];
  const visit = (scope, nodes) => {
    for (const node of arrOf(nodes)) {
      if (!node || node.id == null) continue;
      out.push({ ...node, __scope: scope });
    }
  };
  for (const [sid, section] of Object.entries(truth.sections || {})) visit(sid, section?.nodes);
  visit('__page__', truth.pageChrome?.nodes);
  visit('__fixed__', truth.fixedOverlays?.nodes);
  return out;
}

export function buildTruthIndex(truth) {
  const nodes = flattenTruth(truth);
  return new Map(nodes.map((node) => [String(node.id), node]));
}

export function expectedRelativeBox(node, origin) {
  const box = node?.box || {};
  const ox = Number(origin?.x || 0);
  const oy = Number(origin?.y || 0);
  return {
    x: Number(box.x || 0) - ox,
    y: Number(box.y || 0) - oy,
    w: Number(box.w || 0),
    h: Number(box.h || 0),
  };
}

export function expectedRenderedBox(node, index, origin) {
  const expected = expectedRelativeBox(node, origin);
  /* Auto Layout children are rendered as flex items by the renderer (flexbox
     handles padding/alignment internally), so their truth box coordinates are
     already the final flow position — no additional padding offset is needed.
     The padding adjustment only applies when the child is NOT in an Auto Layout
     flow (absolute positioning inside a non-auto-layout parent). */
  const parent = node?.parentId != null ? index.get(String(node.parentId)) : null;
  const parentLayout = parent?.layout || {};
  const mode = String(parentLayout.layoutMode || '').toUpperCase();
  const inherits = String(node?.layout?.layoutAlign || '').toUpperCase() === 'INHERIT';
  const inAutoLayout = ['HORIZONTAL', 'VERTICAL'].includes(mode) && inherits;
  if (inAutoLayout) return expected;
  /* Non-auto-layout absolute child: Figma may report its bounding box at the
     parent's origin even though the rendered glyph box begins at the parent's
     padding. Consume the source layout padding only in that documented
     equal-origin case; otherwise the child absolute box already contains the
     flow offset. */
  const parentBox = parent?.box || {};
  if (Math.abs(Number(node.box?.x) - Number(parentBox.x)) <= 0.5) {
    expected.x += Number(parentLayout.paddingLeft || 0);
  }
  if (Math.abs(Number(node.box?.y) - Number(parentBox.y)) <= 0.5) {
    expected.y += Number(parentLayout.paddingTop || 0);
  }
  return expected;
}

/* Compare geometry. For Auto Layout children (layoutAlign=INHERIT inside a
   HORIZONTAL/VERTICAL parent), the flexbox layout may center the content box
   within the allocated space — the truth box is the allocated slot, not the
   final content position. In that case the rendered element box is the content
   box and the comparison should use the renderBox (visible ink bounds) instead
   of the absoluteBoundingBox (allocated slot). */
export function compareGeometryAutoLayoutAware(expected, actual, node, index, tolerance = {}) {
  const parent = node?.parentId != null ? index.get(String(node.parentId)) : null;
  const parentLayout = parent?.layout || {};
  const mode = String(parentLayout.layoutMode || '').toUpperCase();
  const inherits = String(node?.layout?.layoutAlign || '').toUpperCase() === 'INHERIT';
  const inAutoLayout = ['HORIZONTAL', 'VERTICAL'].includes(mode) && inherits;
  const pos = Number(tolerance.position ?? 8);
  const size = Number(tolerance.size ?? 12);
  if (inAutoLayout) {
    /* Flexbox centers content in the allocated slot; compare renderBox to
       rendered bounds (both are content/ink boxes, not allocated slots). */
    const renderBox = node?.renderBox || {};
    const rbExpected = {
      x: Number(renderBox.x || expected.x),
      y: Number(renderBox.y || expected.y),
      w: Number(renderBox.w || expected.w),
      h: Number(renderBox.h || expected.h),
    };
    const dx = actual.x - rbExpected.x;
    const dy = actual.y - rbExpected.y;
    const dw = actual.w - rbExpected.w;
    const dh = actual.h - rbExpected.h;
    return {
      ok: Math.abs(dx) <= pos && Math.abs(dy) <= pos && Math.abs(dw) <= size && Math.abs(dh) <= size,
      delta: { x: dx, y: dy, w: dw, h: dh },
      tolerance: { position: pos, size },
      autoLayoutContentBox: true,
    };
  }
  return compareGeometry(expected, actual, tolerance);
}

export function compareGeometry(expected, actual, tolerance = {}) {
  const pos = Number(tolerance.position ?? 8);
  const size = Number(tolerance.size ?? 12);
  const dx = actual.x - expected.x;
  const dy = actual.y - expected.y;
  const dw = actual.w - expected.w;
  const dh = actual.h - expected.h;
  return {
    ok: Math.abs(dx) <= pos && Math.abs(dy) <= pos && Math.abs(dw) <= size && Math.abs(dh) <= size,
    delta: { x: dx, y: dy, w: dw, h: dh },
    tolerance: { position: pos, size },
  };
}

const browserProbe = async ({ page, truth, probe }) => page.evaluate(({ probe, truth }) => {
  const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
  const visible = (el) => {
    if (!el) return false;
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0 && r.width > 0 && r.height > 0;
  };
  const find = (id) => [...document.querySelectorAll('.frame [data-node="' + cssEscape(id) + '"]')].find(visible)
    || document.querySelector('.frame [data-node="' + cssEscape(id) + '"]');
  const stage = probe.stage === 'fixed'
    ? document.querySelector('.frame [data-node-id="page-fixed-overlays"]')
    : document.querySelector('.frame [data-node-id="section-' + cssEscape(probe.sectionId) + '"]');
  if (!stage) return { ok: false, reason: 'missing-stage', stage: probe.stage, sectionId: probe.sectionId };
  const stageRect = stage.getBoundingClientRect();
  const cssScale = (() => {
    const raw = getComputedStyle(document.querySelector('.frame')).transform;
    const match = /^matrix\(([^,]+)/.exec(raw || '');
    return match ? Number(match[1]) || 1 : 1;
  })();
  /* The renderer applies design鈫抎evice zoom on its content stages, while the
     fixed overlay carries the same source coordinate system but no stage zoom.
     The outer preview transform affects both and is intentionally divided out
     separately. */
  const rendererScale = probe.stage === 'fixed' ? 1 : Number(window.__qa?.scale?.() || 1);
  const scale = rendererScale * cssScale;
  const frame = document.querySelector('.frame');
  const nodeReports = [];
  for (const id of probe.nodeIds || []) {
    const el = find(id);
    if (!el) {
      nodeReports.push({ id, ok: false, issue: 'missing-node' });
      continue;
    }
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const actual = {
      x: (r.left - stageRect.left) / scale,
      y: (r.top - stageRect.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
    const style = {
      position: cs.position,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      zIndex: cs.zIndex,
      overflow: cs.overflow,
    };
    nodeReports.push({ id, actual, style, visible: visible(el), parent: el.parentElement?.getAttribute('data-node') || null });
  }
  return {
    ok: true,
    scale,
    chromeScale: cssScale,
    frame: frame ? { scrollTop: frame.scrollTop, scrollHeight: frame.scrollHeight, clientHeight: frame.clientHeight } : null,
    stage: { left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height },
    nodes: nodeReports,
  };
}, { probe, truth: null });

export async function runSourceGeometryBrowserCheck({
  demoDir,
  probes,
  viewport = { w: 3840, h: 2160 },
  timeoutMs = 180000,
  screenshotDir = null,
} = {}) {
  const absDemo = resolve(demoDir);
  const truth = unwrap(JSON.parse(readFileSync(join(absDemo, 'truth.json'), 'utf8')));
  const index = buildTruthIndex(truth);
  const server = createSafeStaticServer(absDemo);
  let browser;
  const report = { ok: false, demoDir: absDemo, viewport, probes: [] };
  try {
    const base = await server.listen();
    ({ browser } = await launchChromium(absDemo, { headless: true }));
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: timeoutMs });
    await page.evaluate(({ w, h }) => window.__qa.resize(w, h), viewport);
    await page.waitForTimeout(250);

    /* This gate measures STATIC source geometry. Decorative entry animations
       (data-motion-role slide/fade primitives) animate `translate` in the same
       property the rect probe reads, and their rest state only settles after
       the keyframe finishes. A section probe that scrolls a fresh element into
       view would otherwise measure the mid-animation position and report a
       false source offset (observed: titles read 30-50px high at scroll-in).
       Freeze animations exactly like the motion browser check does, so every
       comparison is truth-vs-rest-state, never truth-vs-animation-frame. */
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-geometry-gate-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
    });

    for (const probe of probes || []) {
      const section = probe.stage === 'fixed' ? null : truth.sections?.[probe.sectionId];
      const origin = probe.stage === 'fixed'
        ? (truth.pageChrome?.meta || truth.fixedOverlays?.meta || {})
        : (section?.meta || {});
      const expectedNodes = (probe.nodeIds || []).map((id) => {
        const node = index.get(String(id));
        return node ? { id: String(id), name: node.name, expected: expectedRenderedBox(node, index, origin), sourceBox: node.box, ownerPath: node.ownerPath } : { id: String(id), missingTruth: true };
      });
      const missingTruth = expectedNodes.filter((entry) => entry.missingTruth).map((entry) => entry.id);
      if (probe.stage !== 'fixed' && section) {
        await page.evaluate((id) => document.querySelector('.frame [data-node-id="section-' + CSS.escape(id) + '"]')?.scrollIntoView({ block: 'start' }), probe.sectionId);
        await page.waitForTimeout(100);
      }
      const raw = await browserProbe({ page, truth, probe: { ...probe, designWidth: Number(probe.designWidth || 3840) } });
      const byId = new Map((raw.nodes || []).map((entry) => [String(entry.id), entry]));
      const tolerance = probe.tolerance || {};
      const nodes = expectedNodes.map((entry) => {
        const actual = byId.get(entry.id);
        if (!entry.expected) return { ...entry, ok: false, issue: 'missing-truth' };
        if (!actual || !actual.actual) return { ...entry, actual: actual || null, ok: false, issue: actual?.issue || 'missing-node' };
        const cmp = compareGeometry(entry.expected, actual.actual, tolerance);
        return { ...entry, ...actual, ...cmp };
      });
      const failures = nodes.filter((entry) => !entry.ok);
      let screenshot = null;
      if (failures.length && screenshotDir) {
        const safe = String(probe.name || probe.sectionId || 'geometry').replace(/[^\w\-]+/g, '_');
        screenshot = join(resolve(screenshotDir), safe + '.png');
        try { await page.screenshot({ path: screenshot, fullPage: false }); } catch {}
      }
      report.probes.push({ name: probe.name || probe.sectionId || 'geometry', stage: probe.stage || 'section', sectionId: probe.sectionId || null, nodeCount: nodes.length, failures, screenshot, rawStage: raw.stage || null });
    }
    report.pageErrors = pageErrors;
    report.ok = pageErrors.length === 0 && report.probes.every((probe) => probe.failures.length === 0);
    return report;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server.close(); } catch {}
  }
}

function defaultProbes() {
  return [
    {
      name: '02-reward-card-owner-local', sectionId: '1:467',
      nodeIds: ['2:31284', '1:468', '1:474', '1:475', '1:472', '2:31229', '2:31282'],
      tolerance: { position: 10, size: 16 },
    },
    {
      name: 'fixed-directory-source-position', stage: 'fixed',
      nodeIds: ['52:3263', 'I52:3263;17:53006', 'I52:3263;12:47356', 'I52:3263;12:47360', 'I52:3263;12:47364'],
      tolerance: { position: 10, size: 16 },
    },
  ];
}

if (process.argv[1]?.endsWith('figma-source-geometry-browser-check.mjs')) {
  const i = process.argv.indexOf('--demo');
  const demoDir = i >= 0 ? process.argv[i + 1] : process.cwd();
  const w = Number(process.argv[process.argv.indexOf('--width') + 1] || 3840);
  const h = Number(process.argv[process.argv.indexOf('--height') + 1] || 2160);
  const report = await runSourceGeometryBrowserCheck({ demoDir, probes: defaultProbes(), viewport: { w, h } });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
