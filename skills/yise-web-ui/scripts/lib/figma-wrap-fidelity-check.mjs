/* Reusable wrap-fidelity gate for fixed-width auto-wrapping text.
 *
 * Why: a translated/fallback copy that drops the source manual line break can
 * be re-wrapped by the box width. If the renderer then applies text-wrap:balance,
 * the wrap point no longer matches the source Figma wrap point even though the
 * CSS box geometry is pixel-perfect. This gate measures each rendered line's ink
 * width in the browser and compares the longest line to the source renderBox ink
 * width (which spans the longest line for CENTER-aligned wrapped text).
 *
 * It does NOT mandate a specific fix; it reports per node whether the rendered
 * wrap matches the source, and whether a typographic fallback (balance) is the
 * cause, so the failure is visible instead of silently diverging.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';

const unwrap = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && v.provenance) return v.value;
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
};

export async function runWrapFidelityCheck({ demoDir, sectionId, nodeIds, tolerance = 12, viewport = { w: 1920, h: 1080 }, timeoutMs = 180000 } = {}) {
  const directory = resolve(demoDir);
  const truth = unwrap(JSON.parse(readFileSync(join(directory, 'truth.json'), 'utf8')));
  const section = truth.sections?.[sectionId];
  const report = { ok: false, sectionId, viewport, nodes: [], failures: [] };
  if (!section) { report.failures.push({ issue: 'missing-section', sectionId }); return report; }
  const byId = new Map(section.nodes.map((n) => [String(n.id), n]));

  const server = createSafeStaticServer(directory);
  let browser;
  try {
    const base = await server.listen('127.0.0.1');
    ({ browser } = await launchChromium(directory, { headless: true }));
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(base + '/index.html', { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: timeoutMs });
    await page.evaluate(({ w, h, sid }) => { window.__qa.resize(w, h); document.querySelector('.frame [data-node-id="section-' + CSS.escape(sid) + '"]')?.scrollIntoView({ block: 'start' }); }, { ...viewport, sid: sectionId });
    await page.waitForTimeout(200);

    for (const id of nodeIds) {
      const src = byId.get(String(id));
      if (!src || !src.renderBox || !src.box) { report.failures.push({ id, issue: 'missing-source-truth' }); continue; }
      const figmaLongest = Number(src.renderBox.w);
      const srcText = String(src.text?.characters || '');
      const measured = await page.evaluate(({ id }) => {
        const el = document.querySelector('.frame [data-node="' + CSS.escape(id) + '"]');
        if (!el) return { id, missing: true };
        const frame = document.querySelector('.frame');
        const matrix = /^matrix\(([^,]+)/.exec(getComputedStyle(frame).transform || '');
        const scale = (matrix ? Number(matrix[1]) || 1 : 1) * Number(window.__qa?.scale?.() || 1);
        const r = el.getBoundingClientRect();
        const text = el.textContent;
        const lines = [];
        for (let ci = 0; ci < text.length; ci++) {
          const rg = document.createRange();
          rg.setStart(el.firstChild, ci); rg.setEnd(el.firstChild, ci + 1);
          const rr = rg.getBoundingClientRect();
          if (rr.height === 0) continue;
          const relTop = (rr.top - r.top) / scale;
          const right = (rr.right - r.left) / scale;
          let line = lines.find((L) => Math.abs(L.top - relTop) < 5);
          if (!line) { line = { top: relTop, right, chars: 0, text: '' }; lines.push(line); }
          line.chars++;
          line.text += text[ci];
          if (right > line.right) line.right = right;
        }
        const textWrap = getComputedStyle(el).textWrap;
        return { id, lineCount: lines.length, lines: lines.map((L) => ({ chars: L.chars, inkW: L.right, text: L.text })), textWrap, domText: text };
      }, { id });
      if (measured.missing) { report.failures.push({ id, issue: 'missing-browser-node' }); continue; }
      const domLongest = Math.max(...measured.lines.map((L) => L.inkW), 0);
      /* Primary wrap-fidelity signal: the number of characters on the longest
         rendered line. Ink *width* drifts with font rasterization (the same
         correct wrap point can measure ±16px across engines), but the wrap
         point itself is stable: it is where the box width forces a break. When
         the displayed copy equals the source (fallback), the source longest
         line char count is exact; when a translated table row differs, the
         source char count is not directly comparable, so we fall back to the
         ink-width signal and additionally flag text-wrap:balance skewing the
         natural box-width wrap. */
      const domLongestChars = Math.max(...measured.lines.map((L) => L.chars), 0);
      const copyIsSource = measured.domText === srcText;
      const srcLines = srcText.split('\n');
      let wrapMatches;
      let signal;
      if (copyIsSource && srcLines.length >= 2) {
        /* Source has an explicit manual break and we render the source text:
           the break must be honored. The DOM longest-line char count can differ
           by one from the raw source line because a trailing whitespace before
           the manual \n is preserved by pre-wrap and counts toward the first
           line's width, while the source truth line is the trimmed segment.
           Compare against the trimmed segment lengths (matching the same
           normalization the copy matcher uses) and allow a 1-char slack for
           that preserved trailing space. */
        const srcSegChars = srcLines.map((L) => L.replace(/[\s ]+$/u, '').length);
        const srcLongestChars = Math.max(...srcSegChars, 0);
        wrapMatches = Math.abs(domLongestChars - srcLongestChars) <= 1;
        signal = 'char-count-vs-source-manual-break';
      } else if (copyIsSource) {
        /* Source wraps naturally (no manual break): the rendered longest line
           should pack close to the box width. Compare ink width with a wide
           font-rasterization tolerance. */
        wrapMatches = Math.abs(domLongest - figmaLongest) <= Math.max(tolerance, figmaLongest * 0.04);
        signal = 'ink-width-natural-wrap';
      } else {
        /* Translated copy differs from source: source geometry is not a valid
           oracle. Only flag when text-wrap:balance is actively re-wrapping a
           fixed-width auto-wrap text away from the natural box-width break,
           which is the regression this gate exists to catch. */
        wrapMatches = measured.textWrap !== 'balance';
        signal = 'translated-balance-check';
      }
      const balanceSkews = measured.textWrap === 'balance' && !wrapMatches;
      const entry = {
        id,
        srcText,
        domText: measured.domText,
        copyPath: copyIsSource ? 'source-fallback' : 'translated-table',
        lineCount: measured.lineCount,
        domLongestChars,
        srcLongestChars: copyIsSource && srcLines.length >= 2 ? Math.max(...srcLines.map((L) => L.replace(/[\s ]+$/u, '').length), 0) : null,
        figmaLongestInkW: Math.round(figmaLongest * 10) / 10,
        domLongestInkW: Math.round(domLongest * 10) / 10,
        textWrap: measured.textWrap,
        signal,
        wrapMatches,
        balanceSkews,
      };
      report.nodes.push(entry);
      if (!wrapMatches) report.failures.push({ id, issue: balanceSkews ? 'balance-changed-wrap-point' : 'wrap-point-mismatch', signal, domLongestChars: entry.domLongestChars, srcLongestChars: entry.srcLongestChars, figmaLongestInkW: entry.figmaLongestInkW, domLongestInkW: entry.domLongestInkW, copyPath: entry.copyPath, textWrap: entry.textWrap });
    }
    report.pageErrors = errors;
    report.ok = errors.length === 0 && report.failures.length === 0;
    return report;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server.close(); } catch {}
  }
}