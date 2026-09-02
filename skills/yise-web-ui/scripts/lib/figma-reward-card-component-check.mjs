/* Complete source-backed 02 component gate.
 *
 * Unlike a leaf-node sample, this validates the Figma card group, every source
 * card owner, every visual band, card-to-card overlap, and actual loaded text
 * typography. It intentionally fails on a missing or fallback font.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSafeStaticServer } from './safe-server.mjs';
import { launchChromium } from './resolve-playwright.mjs';
import { buildTruthIndex, compareGeometry, expectedRenderedBox, expectedRelativeBox } from './figma-source-geometry-browser-check.mjs';
import { withQaShell } from './replay.mjs';

const unwrap = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && v.provenance) return v.value;
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
};

export const REWARD_CARD_COMPONENT = {
  sectionId: '1:467',
  row: '2:31284',
  cards: [
    { id: '1:468', frame: '1:469', art: '12:48529', title: '1:474', reward: '1:475', detail: '1:472' },
    { id: '2:31178', frame: '12:48585', art: '12:48590', title: '12:39103', reward: '12:48752', detail: '2:31229' },
    { id: '2:31231', frame: '12:48597', art: '12:48599', title: '12:39106', reward: '12:48813', detail: '2:31282' },
  ],
  code: '12:48635',
};

const abs = (demoDir) => resolve(demoDir);
const list = (value) => Array.isArray(value) ? value : Object.values(value || {});
const toExpected = (id, index, sectionMeta) => {
  const node = index.get(String(id));
  return node ? { id: String(id), node, expected: expectedRenderedBox(node, index, sectionMeta) } : { id: String(id), missingTruth: true };
};

export function validateRewardRelations(index, measured, tolerance = 12) {
  const node = (id) => measured.get(String(id));
  const failures = [];
  const row = node(REWARD_CARD_COMPONENT.row);
  const cards = REWARD_CARD_COMPONENT.cards.map((card) => ({ ...card, actual: node(card.id), source: index.get(card.id) }));
  if (!row?.actual) failures.push({ issue: 'missing-card-row' });
  for (const card of cards) {
    if (!card.actual?.actual || !card.source?.box) { failures.push({ id: card.id, issue: 'missing-card-owner' }); continue; }
    for (const band of ['frame', 'art', 'title', 'reward', 'detail']) {
      const entry = node(card[band]);
      if (!entry?.actual) { failures.push({ id: card[band], card: card.id, issue: 'missing-component-band' }); continue; }
      const source = index.get(card[band]);
      const actualLocalY = entry.actual.y - card.actual.actual.y;
      /* expectedRenderedBox already applies owner padding in the documented
         equal-origin case; an absolute child whose own box already sits inside
         the owner padding (detail.y - owner.y === paddingTop) must NOT add the
         padding a second time. The old unconditional `+ paddingTop` on detail
         double-counted it and misread the correctly rendered band as 27px high. */
      const rel = expectedRelativeBox(source, card.source.box);
      const detailParent = band === 'detail' ? index.get(source.parentId) : null;
      const equalOrigin = detailParent && Math.abs(Number(source.box?.y) - Number(detailParent.box?.y)) <= 0.5;
      const expectedLocalY = rel.y
        + (band === 'detail' && equalOrigin ? Number(detailParent?.layout?.paddingTop || 0) : 0);
      if (Math.abs(actualLocalY - expectedLocalY) > tolerance) {
        failures.push({ id: card[band], card: card.id, issue: 'band-y-mismatch', expectedLocalY, actualLocalY, delta: actualLocalY - expectedLocalY });
      }
    }
    const title = node(card.title)?.actual;
    const reward = node(card.reward)?.actual;
    const detail = node(card.detail)?.actual;
    if (title && reward && detail && !(title.y + title.h < reward.y && reward.y + reward.h < detail.y)) {
      failures.push({ id: card.id, issue: 'component-band-order', title, reward, detail });
    }
  }
  for (let i = 1; i < cards.length; i++) {
    const previous = cards[i - 1]; const current = cards[i];
    if (!previous.actual?.actual || !current.actual?.actual || !previous.source?.box || !current.source?.box) continue;
    const actualDelta = current.actual.actual.x - previous.actual.actual.x;
    const expectedDelta = Number(current.source.box.x) - Number(previous.source.box.x);
    if (Math.abs(actualDelta - expectedDelta) > tolerance) {
      failures.push({ id: current.id, issue: 'card-row-spacing-mismatch', expectedDelta, actualDelta, delta: actualDelta - expectedDelta });
    }
  }
  return failures;
}

async function measure(page, ids, sectionId) {
  return page.evaluate(({ ids, sectionId }) => {
    const stage = document.querySelector('.frame [data-node-id="section-' + CSS.escape(sectionId) + '"]');
    const frame = document.querySelector('.frame');
    const style = getComputedStyle(frame);
    const matrix = /^matrix\(([^,]+)/.exec(style.transform || '');
    const outerScale = matrix ? Number(matrix[1]) || 1 : 1;
    const rendererScale = Number(window.__qa?.scale?.() || 1);
    const scale = outerScale * rendererScale;
    const stageRect = stage?.getBoundingClientRect();
    const one = (id) => {
      const elements = [...document.querySelectorAll('.frame [data-node="' + CSS.escape(id) + '"]')];
      const el = elements.find((candidate) => {
        const s = getComputedStyle(candidate); const r = candidate.getBoundingClientRect();
        return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0 && r.width > 0 && r.height > 0;
      }) || elements[0];
      if (!el || !stageRect) return { id, missing: true };
      const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
      const actual = { x: (r.left - stageRect.left) / scale, y: (r.top - stageRect.top) / scale, w: r.width / scale, h: r.height / scale };
      /* hscroll shadow-gutter hosts expand their total box to absorb shadow bleed.
         The visual clip edge is the gutter padding box, not the style height.
         Compare against the effective visual box, not the expanded style box. */
      const gutterH = Number(el.getAttribute('data-hscroll-gutter-h') || 0);
      if (gutterH > 0) {
        const gutterTop = Number(el.style.paddingTop ? parseFloat(el.style.paddingTop) : 0);
        actual.y += gutterTop / scale;
        actual.h -= gutterH / scale;
      }
      return {
        id,
        actual,
        text: el.classList.contains('fx-t') ? {
          family: s.fontFamily, weight: s.fontWeight, size: s.fontSize,
          lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
          width: el.getBoundingClientRect().width / scale, height: el.getBoundingClientRect().height / scale,
        } : null,
        visible: s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) !== 0,
        parent: el.parentElement?.getAttribute('data-node') || null,
      };
    };
    return { scale, entries: ids.map(one) };
  }, { ids, sectionId });
}

export async function runRewardCardComponentCheck({ demoDir, viewport = { w: 3840, h: 2160 }, timeoutMs = 180000 } = {}) {
  const directory = abs(demoDir);
  const truth = unwrap(JSON.parse(readFileSync(join(directory, 'truth.json'), 'utf8')));
  const index = buildTruthIndex(truth);
  const section = truth.sections?.[REWARD_CARD_COMPONENT.sectionId];
  const ids = [REWARD_CARD_COMPONENT.row, REWARD_CARD_COMPONENT.code, ...REWARD_CARD_COMPONENT.cards.flatMap((card) => [card.id, card.frame, card.art, card.title, card.reward, card.detail])];
  const expected = ids.map((id) => toExpected(id, index, section?.meta || {}));
  const report = { ok: false, viewport, sectionId: REWARD_CARD_COMPONENT.sectionId, expected, failures: [] };
  if (!section || expected.some((entry) => entry.missingTruth)) {
    report.failures.push({ issue: 'missing-figma-component-truth', ids: expected.filter((entry) => entry.missingTruth).map((entry) => entry.id) });
    return report;
  }
  const server = createSafeStaticServer(directory); let browser;
  try {
    const base = await server.listen();
    ({ browser } = await launchChromium(directory, { headless: true }));
    const page = await browser.newPage({ viewport: { width: viewport.w, height: viewport.h } });
    const errors = []; page.on('pageerror', (error) => errors.push(String(error?.message || error)));
    await page.goto(withQaShell(base + '/index.html'), { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__qa && typeof window.__qa.resize === 'function', null, { timeout: timeoutMs });
    await page.evaluate(({ w, h, sid }) => { window.__qa.resize(w, h); document.querySelector('.frame [data-node-id="section-' + CSS.escape(sid) + '"]')?.scrollIntoView({ block: 'start' }); }, { ...viewport, sid: REWARD_CARD_COMPONENT.sectionId });
    /* Same static-geometry contract as the shared source-geometry gate: the
       scrollIntoView above (re)triggers decorative data-motion-role entry
       keyframes whose mid-animation translate would be read as a source offset.
       Freeze animations so every comparison is truth-vs-rest-state. */
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.setAttribute('data-geometry-gate-freeze', '1');
      style.textContent = '*,*::before,*::after{animation:none!important;animation-duration:0s!important;transition:none!important;transition-duration:0s!important}';
      document.head.appendChild(style);
    });
    await page.waitForTimeout(180);
    const captured = await measure(page, ids, REWARD_CARD_COMPONENT.sectionId);
    const measured = new Map(captured.entries.map((entry) => [entry.id, entry]));
    for (const entry of expected) {
      const actual = measured.get(entry.id);
      if (!actual?.actual) { report.failures.push({ id: entry.id, issue: 'missing-browser-node' }); continue; }
      const cmp = compareGeometry(entry.expected, actual.actual, { position: 10, size: 16 });
      if (!cmp.ok) report.failures.push({ id: entry.id, issue: 'component-geometry-mismatch', expected: entry.expected, actual: actual.actual, delta: cmp.delta, ownerPath: entry.node.ownerPath });
    }
    report.failures.push(...validateRewardRelations(index, measured));
    const numeric = (v) => Number.parseFloat(String(v || '0'));
    for (const card of REWARD_CARD_COMPONENT.cards) {
      const source = index.get(card.title); const actual = measured.get(card.title);
      const requested = source?.text || {}; const style = actual?.text;
      if (!style) { report.failures.push({ id: card.title, issue: 'missing-title-font-measurement' }); continue; }
      const familyToken = String(requested.fontFamily || '').toLowerCase();
      const actualFamily = String(style.family || '').toLowerCase();
      const familyOk = familyToken && actualFamily.includes(familyToken);
      const letterSpacing = String(style.letterSpacing || '').toLowerCase() === 'normal' ? 0 : numeric(style.letterSpacing);
      const fontOk = familyOk && numeric(style.weight) === Number(requested.fontWeight)
        && Math.abs(numeric(style.size) - Number(requested.fontSize)) <= 0.1
        && Math.abs(numeric(style.lineHeight) - Number(requested.lineHeight)) <= 0.1
        && Math.abs(letterSpacing - Number(requested.letterSpacing || 0)) <= 0.1;
      if (!fontOk) report.failures.push({ id: card.title, issue: 'title-font-mismatch', requested: { family: requested.fontFamily, weight: requested.fontWeight, size: requested.fontSize, lineHeight: requested.lineHeight, letterSpacing: requested.letterSpacing || 0 }, actual: style });
    }
    const codeSource = index.get(REWARD_CARD_COMPONENT.code);
    const codeActual = measured.get(REWARD_CARD_COMPONENT.code)?.text;
    const codeRequested = codeSource?.text || {};
    const codeFamily = String(codeActual?.family || '').toLowerCase();
    const codeLetterSpacing = String(codeActual?.letterSpacing || '').toLowerCase() === 'normal' ? 0 : numeric(codeActual?.letterSpacing);
    const codeFontOk = !!codeActual
      && codeFamily.includes(String(codeRequested.fontFamily || '').toLowerCase())
      && numeric(codeActual.weight) === Number(codeRequested.fontWeight)
      && Math.abs(numeric(codeActual.size) - Number(codeRequested.fontSize)) <= 0.1
      && Math.abs(numeric(codeActual.lineHeight) - Number(codeRequested.lineHeight)) <= 0.1
      && Math.abs(codeLetterSpacing - Number(codeRequested.letterSpacing || 0)) <= 0.1;
    if (!codeFontOk) report.failures.push({ id: REWARD_CARD_COMPONENT.code, issue: 'reward-code-font-mismatch', requested: { family: codeRequested.fontFamily, weight: codeRequested.fontWeight, size: codeRequested.fontSize, lineHeight: codeRequested.lineHeight, letterSpacing: codeRequested.letterSpacing || 0 }, actual: codeActual || null });
    report.pageErrors = errors;
    report.measured = captured.entries;
    report.ok = errors.length === 0 && report.failures.length === 0;
    return report;
  } finally {
    try { await browser?.close(); } catch {}
    try { await server.close(); } catch {}
  }
}

if (process.argv[1]?.endsWith('figma-reward-card-component-check.mjs')) {
  const i = process.argv.indexOf('--demo');
  const report = await runRewardCardComponentCheck({ demoDir: i >= 0 ? process.argv[i + 1] : process.cwd() });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
