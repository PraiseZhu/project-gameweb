/**
 * Later-axes Chrome probe (B1): interaction wiring still exists / unresolved
 * stays inert, 1126/1127 composition + 10vw ruler match DESIGN.md, and
 * language/modal pixels match the authored fill / sheet pose.
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
import {
  LANG_OPTION_PAGES,
  catalogOpenedGoMatches,
  languageOptionVerdict,
  laterAxesPixelEvidenceComplete,
  mobileModalSheetVerdict,
  pcModalCloseVerdict,
  pcModalSheetVerdict,
} from './interaction-pixel-oracle.mjs';

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
  if (!laterAxesPixelEvidenceComplete(parsed)) return false;
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
    pixel: {
      ok: true,
      languages: LANG_OPTION_PAGES.map((row) => ({ lang: row.lang, label: row.label, ok: true, measured: true, skipped: false, problems: [] })),
      stalePrefs: { ok: true, measured: true, skipped: false, problems: [] },
      modal: { ok: true, measured: true, skipped: false, problems: [], lang: 'zh-CN', go: 'modal/pc适龄提示', close: { ok: true, measured: true, skipped: false } },
      mobile: { ok: true, measured: true, skipped: false, problems: [], lang: 'zh-CN', go: 'modal/mobile适龄提示', close: { ok: true, measured: true, skipped: false } },
      pcCatalog: {
        ok: true, measured: true, skipped: false, problems: [], plat: 'pc',
        openers: [{ go: 'modal/pc适龄提示', openedGo: 'pc适龄提示', ok: true, measured: true, skipped: false, opened: true, closed: true }],
        inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
      },
      mobileCatalog: {
        ok: true, measured: true, skipped: false, problems: [], plat: 'mobile',
        openers: [{ go: 'modal/mobile适龄提示', openedGo: 'mobile适龄提示', ok: true, measured: true, skipped: false, opened: true, closed: true }],
        inert: { ok: true, measured: true, skipped: false, openedModal: false, clicked: 1 },
      },
    },
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

function waitMs(page, ms) {
  return page.evaluate((delay) => new Promise((resolveWait) => setTimeout(resolveWait, delay)), ms);
}

async function waitQa(page) {
  await page.waitForFunction(() => window.__qa && typeof window.__qa.setPref === 'function', null, { timeout: 120000 });
}

async function collectLanguageOptions(page) {
  return page.evaluate(() => {
    const owner = [...document.querySelectorAll('[data-dropmenu="true"]')]
      .find((el) => /多语言|语言|language/i.test(el.getAttribute('data-dropmenu-name') || el.getAttribute('data-name') || ''));
    if (!owner) return { missing: true, options: [] };
    if (owner.getAttribute('data-dropmenu-state') !== 'on') {
      owner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    const painted = (el) => {
      if (!el || el.hidden) return false;
      if (el.closest && el.closest('[hidden], [aria-hidden="true"]')) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width >= 1 && box.height >= 1;
    };
    const fillImage = (node) => {
      if (!painted(node)) return '';
      const cs = getComputedStyle(node);
      const image = cs.backgroundImage;
      if (image && image !== 'none') return image;
      const color = cs.backgroundColor;
      if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
        return `linear-gradient(0deg, ${color} 0%, ${color} 100%)`;
      }
      const named = String(node.getAttribute('data-name') || '');
      if (/img\/(?:选中背景|未选中背景)/.test(named)) {
        const slice = node.tagName === 'IMG' ? node : node.querySelector('img');
        if (slice && slice.getAttribute('src') && painted(slice)) return named;
      }
      return '';
    };
    const options = [...owner.querySelectorAll('[data-btn-name="切换语言"]')].filter(painted).map((el) => {
      const nested = [...el.querySelectorAll('.fx-t, [data-figma-type="TEXT"]')]
        .filter((node) => painted(node))
        .map((node) => (node.textContent || '').trim())
        .filter(Boolean);
      const fillNodes = [
        el,
        ...el.querySelectorAll('[data-figma-type="VECTOR"], [data-figma-type="RECTANGLE"], [data-btn-variant-layer="true"], img'),
      ].filter(painted);
      const childFill = fillNodes.map(fillImage).find(Boolean);
      const activeLayer = [...el.querySelectorAll('[data-btn-variant-layer="true"]')].find(painted);
      const state = (activeLayer && activeLayer.getAttribute('data-btn-variant-state'))
        || el.getAttribute('data-btn-variant-state');
      return {
        text: nested[0] || (el.textContent || '').replace(/\s+/g, ' ').trim(),
        visibleCount: nested.length || ((el.textContent || '').trim() ? 1 : 0),
        state,
        fillSource: el.getAttribute('data-btn-variant-fill-source') || state,
        ownerBg: childFill || '',
      };
    });
    return { missing: false, options };
  });
}

async function measureVisibleOpenerCatalog(page, { plat }) {
  const measured = await page.evaluate(async (wantedPlat) => {
    const langs = ['zh-CN', 'zh-TW', 'en', 'ko'];
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') return false;
      const box = el.getBoundingClientRect();
      return box.width >= 1 && box.height >= 1;
    };
    const realClick = (el) => {
      if (!el) return;
      if (typeof el.click === 'function') el.click();
      else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    };
    const hitClick = (el) => {
      if (!el) return false;
      const box = el.getBoundingClientRect();
      const x = box.left + Math.min(8, Math.max(1, box.width / 2));
      const y = box.top + Math.min(8, Math.max(1, box.height / 2));
      const stack = document.elementsFromPoint(x, y);
      return stack.includes(el);
    };
    const optionFillOf = (btn) => {
      if (!btn) return false;
      const filled = (cs) => {
        if (!cs) return false;
        const color = cs.backgroundColor;
        if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return true;
        const image = cs.backgroundImage;
        if (image && image !== 'none') return true;
        const fill = cs.fill || '';
        return Boolean(fill && fill !== 'none' && fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent');
      };
      const visible = (node) => {
        if (!node || node.hidden) return false;
        if (node.closest && node.closest('[hidden], [aria-hidden="true"]')) return false;
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const box = node.getBoundingClientRect();
        return box.width >= 1 && box.height >= 1;
      };
      if (visible(btn) && filled(getComputedStyle(btn))) return true;
      return [...btn.querySelectorAll('[data-figma-type="VECTOR"], [data-figma-type="RECTANGLE"], [data-figma-type="BOOLEAN_OPERATION"], [data-btn-variant-layer="true"], path, svg, img')].some((child) => (
        visible(child) && (filled(getComputedStyle(child)) || (child.tagName === 'IMG' && child.getAttribute('src')))
      ));
    };
    const closeOpenModal = () => {
      const layer = document.querySelector('[data-modal-open="true"]');
      if (!layer) return true;
      const close = [...layer.querySelectorAll('[data-btn-name], [data-name], [data-node-name]')]
        .find((el) => /关闭按钮/.test(`${el.getAttribute('data-btn-name') || ''} ${el.getAttribute('data-name') || ''} ${el.getAttribute('data-node-name') || ''}`));
      if (close) realClick(close);
      const still = document.querySelector('[data-modal-open="true"]');
      return !still || still.hidden || still.getAttribute('data-modal-open') !== 'true';
    };
    const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
    const platOk = (go) => {
      if (wantedPlat === 'pc' && /mobile/i.test(go)) return false;
      if (wantedPlat === 'mobile' && /(?:^|\/)(?:modal\/)?pc(?![a-z])/i.test(go) && !/mobile/i.test(go)) return false;
      return true;
    };
    const collectHomepage = () => [...document.querySelectorAll('[data-go]')].filter((el) => {
      if (!visible(el)) return false;
      if (el.closest('[data-modal-open], [data-prefix="modal"], [data-name^="modal/"]')) return false;
      const go = el.getAttribute('data-go') || '';
      if (!go) return false;
      /* Visible homepage @go is in-scope. Do not guess platform from the go
         label. A mobile-labelled go on PC (or pc on mobile) is the other tree. */
      return platOk(go);
    });
    const measureOpenLayer = (el, layer, lang) => {
      const dropmenus = [];
      let calendarLang = null;
      const calendarCopy = [];
      if (!layer) return { dropmenus, calendarLang, calendarCopy };
      for (const menu of [...layer.querySelectorAll('[data-dropmenu="true"]')]) {
        const before = menu.getAttribute('data-dropmenu-state') || '';
        const invalid = before !== 'on' && before !== 'off';
        if (invalid) {
          dropmenus.push({
            name: menu.getAttribute('data-dropmenu-name') || menu.getAttribute('data-name') || null,
            before,
            after: before,
            invalid: true,
            toggled: false,
            optionFill: false,
          });
          continue;
        }
        const fieldH = Number(menu.__fxDropmenuFieldH);
        const closedHost = menu.getBoundingClientRect();
        /* Inventory default may already be on. Clicking then would close the
           panel and measure empty options. Open first, then sample fill. */
        if (before !== 'on') realClick(menu);
        const after = menu.getAttribute('data-dropmenu-state') || '';
        const openHost = menu.getBoundingClientRect();
        const panel = [...menu.querySelectorAll('[data-dropmenu-layer="true"]')].find((hit) => {
          const state = hit.getAttribute('data-dropmenu-state') || '';
          if (state !== 'on') return false;
          const cs = getComputedStyle(hit);
          return !hit.hidden && cs.display !== 'none' && cs.visibility !== 'hidden';
        });
        const optionRoot = panel || menu;
        const optionBtns = [...optionRoot.querySelectorAll('[data-btn-name], [data-name]')].filter((hit) => {
          if (hit.hidden) return false;
          const cs = getComputedStyle(hit);
          if (cs.display === 'none' || cs.visibility === 'hidden') return false;
          const box = hit.getBoundingClientRect();
          if (box.width < 1 || box.height < 1) return false;
          const raw = `${hit.getAttribute('data-btn-name') || ''} ${hit.getAttribute('data-name') || ''}`;
          return /号码地区选择/.test(raw);
        });
        const optionFill = optionBtns.length ? optionBtns.every(optionFillOf) : null;
        const hostGrew = Number.isFinite(fieldH) && fieldH > 0
          ? openHost.height > fieldH + 2
          : openHost.height > closedHost.height + 2;
        let closedConsentClickable = true;
        const consent = [...layer.querySelectorAll('[data-btn-name], [data-name]')].find((hit) => /勾选按钮/.test(`${hit.getAttribute('data-btn-name') || ''} ${hit.getAttribute('data-name') || ''}`));
        if (consent && after === 'on') {
          realClick(menu);
          closedConsentClickable = hitClick(consent);
          if (menu.getAttribute('data-dropmenu-state') !== 'on') realClick(menu);
        }
        const coversConsent = hostGrew || closedConsentClickable === false;
        dropmenus.push({
          name: menu.getAttribute('data-dropmenu-name') || menu.getAttribute('data-name') || null,
          before,
          after,
          invalid: false,
          toggled: after === 'on',
          coversConsent,
          optionFill,
          hostGrew,
          closedConsentClickable,
          fieldH: Number.isFinite(fieldH) ? fieldH : null,
          openHostH: openHost.height,
        });
        if (menu.getAttribute('data-dropmenu-state') === 'on') realClick(menu);
      }
      const calendarShell = [...layer.querySelectorAll('[data-name], [data-node-name]')].find((hit) => {
        const name = `${hit.getAttribute('data-name') || ''} ${hit.getAttribute('data-node-name') || ''}`;
        return /(?:^|[\s/>])日历(?:@|$)/.test(name.trim());
      });
      if (calendarShell || /订阅赛季日程/.test(`${layer.getAttribute('data-modal-name') || ''} ${layer.getAttribute('data-name') || ''}`)) {
        const wanted = lang === 'zh-TW' ? 'tw'
          : lang === 'en' ? 'en'
            : lang === 'ko' ? 'kr'
              : 'cn';
        const got = calendarShell
          ? (calendarShell.getAttribute('data-lang-shell-value') || calendarShell.getAttribute('data-img-lang-value') || '')
          : '';
        const missingCopy = [...layer.querySelectorAll('[data-copy-missing]')].map((hit) => ({
          node: hit.getAttribute('data-node') || hit.getAttribute('data-name') || null,
          lang: hit.getAttribute('data-copy-missing'),
          missing: true,
        }));
        calendarCopy.push(...missingCopy);
        const copyOk = missingCopy.filter((hit) => hit.lang && hit.lang !== 'zh-CN').length === 0;
        calendarLang = {
          wanted,
          got,
          matched: Boolean(calendarShell) && got === wanted && copyOk,
          copyMissing: missingCopy.length,
        };
      }
      return { dropmenus, calendarLang, calendarCopy };
    };
    const mountedNames = [...document.querySelectorAll('[data-modal-name], [data-name^="modal/"]')]
      .map((el) => el.getAttribute('data-modal-name') || String(el.getAttribute('data-name') || '').replace(/^modal\//, ''))
      .filter(Boolean);
    const homepage = [];
    const seen = new Set();
    for (const lang of langs) {
      if (window.__qa && typeof window.__qa.setPref === 'function') window.__qa.setPref('lang', lang);
      await wait(80);
      for (const el of collectHomepage()) {
        const node = el.getAttribute('data-node') || '';
        const go = el.getAttribute('data-go') || '';
        const calendar = /订阅赛季日程/.test(go);
        const key = calendar ? `${lang}::${node}::${go}` : `${node}::${go}`;
        if (seen.has(key)) continue;
        seen.add(key);
        homepage.push({ node, go, lang, calendar });
      }
    }
    const liveOpener = (row) => {
      if (window.__qa && typeof window.__qa.setPref === 'function') window.__qa.setPref('lang', row.lang);
      return [...document.querySelectorAll('[data-go]')].find((el) => {
        if ((el.getAttribute('data-node') || '') !== row.node) return false;
        if ((el.getAttribute('data-go') || '') !== row.go) return false;
        return visible(el);
      }) || null;
    };
    const openers = [];
    for (let index = 0; index < homepage.length; index += 1) {
      const row = homepage[index];
      const go = row.go;
      if (!go) continue;
      if (window.__qa && typeof window.__qa.setPref === 'function') window.__qa.setPref('lang', row.lang);
      await wait(80);
      const el = liveOpener(row);
      if (!el) {
        openers.push({
          go, index, node: row.node, lang: row.lang, opened: false, closed: true, openedGo: null,
          dropmenus: [], calendarLang: null, calendarCopy: [],
        });
        continue;
      }
      realClick(el);
      const layer = document.querySelector('[data-modal-open="true"]');
      const opened = !!layer;
      const openedGo = layer && (layer.getAttribute('data-modal-name') || layer.getAttribute('data-name') || '');
      const extra = measureOpenLayer(el, layer, row.lang);
      const closed = closeOpenModal();
      openers.push({
        go,
        index,
        node: el.getAttribute('data-node') || el.getAttribute('data-name') || null,
        lang: row.lang,
        opened,
        closed,
        openedGo,
        dropmenus: extra.dropmenus,
        calendarLang: extra.calendarLang,
        calendarCopy: extra.calendarCopy,
      });
    }
    if (window.__qa && typeof window.__qa.setPref === 'function') window.__qa.setPref('lang', 'zh-CN');
    const inertCandidates = [...document.querySelectorAll('[data-btn-name], [data-prefix="btn"]')].filter((el) => {
      if (!visible(el)) return false;
      if (el.getAttribute('data-go')) return false;
      if (el.closest('[data-dropmenu="true"]')) return false;
      if (el.closest('[data-modal-open], [data-prefix="modal"], [data-name^="modal/"]')) return false;
      return true;
    });
    let openedModal = false;
    let clicked = 0;
    for (const el of inertCandidates) {
      clicked += 1;
      realClick(el);
      if (document.querySelector('[data-modal-open="true"]')) {
        openedModal = true;
        closeOpenModal();
        break;
      }
    }
    return { plat: wantedPlat, openers, mountedNames, inert: { openedModal, clicked, visible: inertCandidates.length } };
  }, plat);
  return scoreOpenerCatalog(measured, plat);
}

export function scoreOpenerCatalog(raw, plat) {
  const platKey = raw?.plat || plat;
  const mountedNames = Array.isArray(raw?.mountedNames) ? raw.mountedNames : null;
  const openers = (Array.isArray(raw?.openers) ? raw.openers : []).map((row) => {
    const matched = Boolean(row.opened) && catalogOpenedGoMatches(row.go, row.openedGo);
    const dropmenus = Array.isArray(row.dropmenus) ? row.dropmenus : [];
    const dropOk = dropmenus.every((hit) => hit.invalid !== true && hit.toggled === true
      && hit.coversConsent !== true && hit.optionFill !== false);
    const calendarLang = row.calendarLang || null;
    const calendarOk = !calendarLang || calendarLang.matched === true;
    return {
      ...row,
      dropmenus,
      calendarLang,
      matched,
      ok: Boolean(row.opened) && Boolean(row.closed) && matched && dropOk && calendarOk,
      measured: true,
      skipped: false,
    };
  });
  const inertOpened = raw?.inert?.openedModal === true;
  const problems = [];
  if (!openers.length) problems.push(`${platKey}-catalog-opener-missing`);
  for (const row of openers) {
    const label = row.node ? `${row.go}@${row.node}` : row.go;
    if (!row.opened) problems.push(`${platKey}-opener-did-not-open:${label}`);
    if (row.opened && !row.matched) problems.push(`${platKey}-opener-opened-wrong:${label}=>${row.openedGo}`);
    if (!row.closed) problems.push(`${platKey}-opener-did-not-close:${label}`);
    for (const hit of row.dropmenus || []) {
      if (hit.invalid === true) problems.push(`${platKey}-dropmenu-invalid:${hit.name || label}`);
      else if (hit.toggled !== true) problems.push(`${platKey}-dropmenu-did-not-toggle:${hit.name || label}`);
      else if (hit.coversConsent === true) problems.push(`${platKey}-dropmenu-covers-consent:${hit.name || label}`);
      else if (hit.optionFill === false) problems.push(`${platKey}-dropmenu-option-unfilled:${hit.name || label}`);
    }
    if (row.calendarLang && row.calendarLang.matched !== true) {
      problems.push(`${platKey}-calendar-lang:${row.lang || row.calendarLang.wanted}=>${row.calendarLang.got}`);
    }
    for (const hit of row.calendarCopy || []) {
      if (hit.missing === true && hit.lang && hit.lang !== 'zh-CN') {
        problems.push(`${platKey}-calendar-copy-missing:${hit.node || label}:${hit.lang || row.lang || ''}`);
      }
    }
  }
  const inertVisible = Number(raw?.inert?.visible);
  const inertClicked = Number(raw?.inert?.clicked) || 0;
  if (Number.isFinite(inertVisible) && inertVisible > 0 && inertClicked < inertVisible && !inertOpened) {
    problems.push(`${platKey}-inert-unmeasured`);
  }
  if (inertOpened) problems.push(`${platKey}-inert-opened-modal`);
  return {
    ok: problems.length === 0,
    measured: true,
    skipped: false,
    problems,
    plat: platKey,
    openers,
    mountedNames,
    inert: {
      ok: !inertOpened,
      measured: true,
      skipped: false,
      openedModal: inertOpened,
      clicked: Number(raw?.inert?.clicked) || 0,
      visible: Number.isFinite(Number(raw?.inert?.visible)) ? Number(raw.inert.visible) : undefined,
    },
  };
}

async function measureInteractionPixels(page, { base, width }) {
  const problems = [];
  await page.setViewportSize({ width: Math.max(width, 1280), height: 1080 });
  await page.goto(`${base}/index.html?interaction=1#g=PC&d=3&w=${width}&h=1080&state=entry&plat=desktop&lang=zh-CN`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await waitQa(page);
  const languages = [];
  for (const row of LANG_OPTION_PAGES) {
    await page.evaluate((lang) => window.__qa.setPref('lang', lang), row.lang);
    await waitMs(page, 200);
    const opened = await collectLanguageOptions(page);
    const verdict = opened.missing
      ? { ok: false, measured: true, skipped: false, problems: ['language-dropmenu-missing'], currentLang: row.lang, label: row.label }
      : { ...languageOptionVerdict(opened.options, row.lang), measured: true, skipped: false };
    languages.push(verdict);
    if (!verdict.ok) {
      problems.push(`lang ${row.lang}: ${(verdict.problems || [verdict.error]).join(',')}`);
    }
    await page.evaluate(() => {
      const owner = [...document.querySelectorAll('[data-dropmenu="true"]')]
        .find((el) => /多语言|语言|language/i.test(el.getAttribute('data-dropmenu-name') || ''));
      if (owner && owner.getAttribute('data-dropmenu-state') === 'on') {
        owner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }
    });
  }
  await page.evaluate(() => window.__qa.setPref('lang', 'en'));
  await waitMs(page, 200);
  const afterEn = await collectLanguageOptions(page);
  const stalePrefs = afterEn.missing
    ? { ok: false, measured: false, skipped: false, problems: ['language-dropmenu-missing-after-en'] }
    : { ...languageOptionVerdict(afterEn.options, 'en'), measured: true, skipped: false };
  if (!stalePrefs.ok) problems.push(`stale-prefs: ${(stalePrefs.problems || []).join(',')}`);

  // modal pixels lock to zh-CN: @lang=cn 适龄 opener is gone on leftover en.
  await page.evaluate(() => window.__qa.setPref('lang', 'zh-CN'));
  await waitMs(page, 200);
  const modal = await page.evaluate(() => {
    const prefs = typeof window.__qa.prefs === 'function' ? window.__qa.prefs() : {};
    const opener = [...document.querySelectorAll('[data-go]')].find((el) => {
      if (!/适龄/.test(el.getAttribute('data-go') || '')) return false;
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width >= 1 && box.height >= 1;
    });
    if (!opener) return { missing: true, lang: prefs.lang || null };
    opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const layer = document.querySelector('[data-modal-open="true"]');
    const host = layer && layer.parentElement;
    const panel = layer && layer.querySelector('[data-name="img/弹窗背景"]');
    if (!layer || !host) return { missing: true, lang: prefs.lang || null };
    const hostRect = host.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const scroll = layer.querySelector('[data-hscroll="y"], [data-prefix="scroll"]');
    const close = layer.querySelector('[data-btn-name="关闭按钮"], [data-name="img/关闭按钮"]');
    const scrollbarHidden = !scroll || getComputedStyle(scroll).scrollbarWidth === 'none'
      || getComputedStyle(scroll, '::-webkit-scrollbar').display === 'none';
    const pose = {
      missing: false,
      lang: prefs.lang || null,
      go: opener.getAttribute('data-go'),
      panelBox: layer.getAttribute('data-modal-panel-box'),
      sheetCx: layerRect.left + layerRect.width / 2,
      sheetCy: layerRect.top + layerRect.height / 2,
      viewCx: hostRect.left + hostRect.width / 2,
      viewCy: hostRect.top + hostRect.height / 2,
      panelTopRatio: panelRect && layerRect.height
        ? (panelRect.top - layerRect.top) / layerRect.height
        : null,
      hasClose: !!close,
      hasNamedScroll: !!scroll,
      scrollbarHidden,
    };
    if (close) close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    pose.closedAfterClose = !layer.isConnected || layer.hidden || layer.getAttribute('data-modal-open') !== 'true';
    return pose;
  });
  let modalVerdict = modal.missing
    ? { ok: false, measured: false, skipped: false, problems: ['pc-modal-missing'] }
    : { ...pcModalSheetVerdict(modal), measured: true, skipped: false };
  if (modal.lang && modal.lang !== 'zh-CN') {
    modalVerdict.ok = false;
    modalVerdict.problems = [...(modalVerdict.problems || []), `pc-modal-lang:${modal.lang}`];
  }
  const pcClose = modal.missing
    ? { ok: false, measured: false, skipped: false, problems: ['pc-modal-missing'] }
    : { ...pcModalCloseVerdict(modal), measured: true, skipped: false };
  modalVerdict.close = pcClose;
  modalVerdict.lang = modal.lang || null;
  modalVerdict.go = modal.go || null;
  if (!pcClose.ok) modalVerdict.ok = false;
  if (!modalVerdict.ok) problems.push(`pc-modal: ${(modalVerdict.problems || ['pc-modal-missing']).join(',')}`);
  if (!pcClose.ok) problems.push(`pc-close: ${pcClose.problems.join(',')}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/index.html?interaction=1#g=Mobile&d=0&w=390&h=844&state=entry&plat=phone&lang=zh-CN`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await waitQa(page);
  await page.evaluate(() => {
    try { window.__qa.setPref('plat', 'phone'); } catch {}
    window.__qa.setPref('lang', 'zh-CN');
  });
  await waitMs(page, 200);
  const mobile = await page.evaluate(() => {
    const prefs = typeof window.__qa.prefs === 'function' ? window.__qa.prefs() : {};
    const opener = [...document.querySelectorAll('[data-go]')].find((el) => {
      if (!/适龄/.test(el.getAttribute('data-go') || '')) return false;
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      const box = el.getBoundingClientRect();
      return box.width >= 1 && box.height >= 1;
    });
    if (!opener) return { missing: true, lang: prefs.lang || null, plat: prefs.plat || null };
    opener.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const layer = document.querySelector('[data-modal-open="true"]');
    const host = layer && layer.parentElement;
    if (!layer || !host) return { missing: true, lang: prefs.lang || null, plat: prefs.plat || null };
    const hostRect = host.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const scroll = layer.querySelector('[data-hscroll="y"], [data-prefix="scroll"]');
    const close = layer.querySelector('[data-btn-name="关闭按钮"], [data-name="img/关闭按钮"], [data-name="img/按钮"]');
    const scrollbarHidden = !scroll || getComputedStyle(scroll).scrollbarWidth === 'none';
    const pose = {
      missing: false,
      lang: prefs.lang || null,
      plat: prefs.plat || null,
      go: opener.getAttribute('data-go'),
      hostW: hostRect.width,
      hostH: hostRect.height,
      hostLeft: hostRect.left,
      hostTop: hostRect.top,
      modalW: layerRect.width,
      modalH: layerRect.height,
      modalLeft: layerRect.left,
      modalTop: layerRect.top,
      hasClose: !!close,
      hasNamedScroll: !!scroll,
      scrollbarHidden,
    };
    if (close) close.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    pose.closedAfterClose = !layer.isConnected || layer.hidden || layer.getAttribute('data-modal-open') !== 'true';
    return pose;
  });
  const mobileVerdict = mobile.missing
    ? { ok: false, measured: false, skipped: false, problems: ['mobile-modal-missing'] }
    : { ...mobileModalSheetVerdict(mobile), measured: true, skipped: false };
  if (mobile.lang && mobile.lang !== 'zh-CN') {
    mobileVerdict.ok = false;
    mobileVerdict.problems = [...(mobileVerdict.problems || []), `mobile-modal-lang:${mobile.lang}`];
  }
  const mobileClose = mobile.missing
    ? { ok: false, measured: false, skipped: false, problems: ['mobile-modal-missing'] }
    : {
      ok: mobileVerdict.problems.filter((item) => /close|scrollbar/.test(item)).length === 0,
      measured: true,
      skipped: false,
      problems: mobileVerdict.problems.filter((item) => /close|scrollbar/.test(item)),
    };
  if (!mobileClose.ok) mobileVerdict.ok = false;
  mobileVerdict.close = mobileClose;
  mobileVerdict.lang = mobile.lang || null;
  mobileVerdict.go = mobile.go || null;
  if (!mobileVerdict.ok) problems.push(`mobile-modal: ${(mobileVerdict.problems || ['mobile-modal-missing']).join(',')}`);
  if (!mobileClose.ok) problems.push(`mobile-close: ${mobileClose.problems.join(',')}`);

  await page.evaluate(() => window.__qa.setPref('lang', 'zh-CN'));
  await waitMs(page, 200);
  const pcCatalog = await (async () => {
    await page.setViewportSize({ width: Math.max(width, 1280), height: 1080 });
    await page.goto(`${base}/index.html?interaction=1#g=PC&d=3&w=${width}&h=1080&state=entry&plat=desktop&lang=zh-CN`, {
      waitUntil: 'load',
      timeout: 120000,
    });
    await waitQa(page);
    await page.evaluate(() => {
      try { window.__qa.setPref('plat', 'desktop'); } catch {}
      window.__qa.setPref('lang', 'zh-CN');
    });
    await waitMs(page, 200);
    return measureVisibleOpenerCatalog(page, { plat: 'pc' });
  })();
  if (!pcCatalog.ok) problems.push(`pc-catalog: ${(pcCatalog.problems || []).join(',')}`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/index.html?interaction=1#g=Mobile&d=0&w=390&h=844&state=entry&plat=phone&lang=zh-CN`, {
    waitUntil: 'load',
    timeout: 120000,
  });
  await waitQa(page);
  await page.evaluate(() => {
    try { window.__qa.setPref('plat', 'phone'); } catch {}
    window.__qa.setPref('lang', 'zh-CN');
  });
  await waitMs(page, 200);
  const mobileCatalog = await measureVisibleOpenerCatalog(page, { plat: 'mobile' });
  if (!mobileCatalog.ok) problems.push(`mobile-catalog: ${(mobileCatalog.problems || []).join(',')}`);

  return {
    ok: problems.length === 0,
    languages,
    stalePrefs,
    modal: modalVerdict,
    mobile: mobileVerdict,
    pcCatalog,
    mobileCatalog,
    problems,
  };
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
  let payloadPixel = { ok: false, languages: [], stalePrefs: { ok: false }, modal: { ok: false }, problems: ['pixel-not-measured'] };
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
    const pixel = await measureInteractionPixels(page, { base, width: 1920 });
    payloadPixel = pixel;
    for (const problem of pixel.problems || []) problems.push(problem);
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
    pixel: payloadPixel,
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
