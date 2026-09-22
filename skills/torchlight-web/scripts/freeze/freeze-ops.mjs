import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignPolicyFile } from '../../../../standards/design-policy/tool/src/parse-design-policy.mjs';
import { languageMatrixOptions } from '../lib/translation/locale-policy.mjs';
import { safeJsonForScript } from '../lib/fs-utils.mjs';
import { LOCALE_PAGES } from './static-locale.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = path.resolve(HERE, '../..');
const QA_SHELL = path.join(HERE, 'qa-shell.html');
const CHROME_TPL = path.join(SKILL_ROOT, 'templates/figma-chrome.js');
const DEVICES_TPL = path.join(SKILL_ROOT, 'templates/default-devices.json');
const DESIGN_MD = path.join(SKILL_ROOT, 'DESIGN.md');

function inlineSafe(code) {
  return String(code).replaceAll('</script', '<\\/script');
}

function frozenPagesMap() {
  return Object.fromEntries(
    LOCALE_PAGES.map((page) => [page.lang, { src: `./${page.out}`, region: page.region, locale: page.locale }]),
  );
}

function frozenQaDemoScript() {
  const langs = LOCALE_PAGES.map((page) => page.lang);
  const data = {
    name: 'torchlight-frozen',
    title: '火炬之光：无限',
    pr: null,
    summary: {
      what: 'Freeze the Main-green product frame into static HTML, then present it in the same QA harness.',
      how: 'CN/Global plus Language pick cn/tw/en/ko.static.html. Platform and size resize the iframe so the frozen runtime picks PC or mobile.',
      accept: 'Stop 1 is the QA shell with frozen canvas clicks off and wheel scroll on. Stop 2 keeps the same shell and turns frozen clicks on.',
    },
    matrix: {
      plat: { label: '平台', options: [{ v: 'desktop', label: 'Desktop' }, { v: 'mobile', label: 'Mobile' }] },
      region: { label: '区域', options: [{ v: 'cn', label: 'CN' }, { v: 'global', label: 'Global' }] },
      os: { label: '系统', options: [{ v: 'any', label: 'Any' }] },
      mode: { label: '主题', options: [{ v: 'default', label: 'Default' }] },
      lang: { label: '语言', options: languageMatrixOptions(langs) },
    },
    defaultPrefs: { plat: 'desktop', region: 'cn', os: 'any', mode: 'default', lang: 'zh-CN' },
    initialState: 'entry',
    states: { entry: {} },
    tabStates: [],
    adaptive: null,
    frozenPages: frozenPagesMap(),
  };
  return `{
  name: ${safeJsonForScript(data.name)},
  title: ${safeJsonForScript(data.title)},
  pr: null,
  summary: ${safeJsonForScript(data.summary)},
  matrix: ${safeJsonForScript(data.matrix)},
  defaultPrefs: ${safeJsonForScript(data.defaultPrefs)},
  get compositionBreakpoints() {
    var policy = window.__designPolicy;
    if (policy && Array.isArray(policy.composition) && policy.composition.length) return policy.composition;
    throw new Error('frozen QA shell: composition missing from DESIGN.md YAML');
  },
  initialState: ${safeJsonForScript(data.initialState)},
  states: ${safeJsonForScript(data.states)},
  tabStates: ${safeJsonForScript(data.tabStates)},
  adaptive: null,
  frozenPages: ${safeJsonForScript(data.frozenPages)},
  scale: function () { return 1; },
  get supports() { return {}; },
  renderApp: function (ctx) {
    var frame = ctx.frame;
    if (!frame) return;
    var pages = (window.__qaDemo && window.__qaDemo.frozenPages) || {};
    var lang = ctx.prefs && ctx.prefs.lang;
    var region = ctx.prefs && ctx.prefs.region;
    var page = pages[lang];
    if (region === 'cn') page = pages['zh-CN'] || page;
    else if (region === 'global' && (!page || page.region === 'cn')) page = pages['zh-TW'] || pages.en || pages.ko || page;
    if (!page) page = pages['zh-CN'];
    if (!page) throw new Error('frozen QA shell: missing locale page for ' + lang);
    var iframe = frame.querySelector('iframe.qa-frozen-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.className = 'qa-frozen-frame';
      iframe.title = 'frozen page';
      iframe.setAttribute('data-qa-frozen-frame', '1');
      frame.replaceChildren(iframe);
    }
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';
    iframe.style.pointerEvents = 'auto';
    frame.style.overflow = 'hidden';
    frame.style.overflowY = 'hidden';
    frame.style.overflowX = 'clip';
    function armFrozenDoc(doc) {
      if (!doc || doc.documentElement.getAttribute('data-qa-frozen-armed') === '1') return;
      doc.documentElement.setAttribute('data-qa-frozen-armed', '1');
      var style = doc.createElement('style');
      style.setAttribute('data-qa-frozen-chrome', '1');
      style.textContent = '.frame,.stage{scrollbar-width:none;-ms-overflow-style:none}.frame::-webkit-scrollbar,.stage::-webkit-scrollbar{display:none;width:0;height:0}';
      (doc.head || doc.documentElement).appendChild(style);
      var block = function (ev) {
        if (document.documentElement.getAttribute('data-ops-interaction') !== '0') return;
        ev.preventDefault();
        ev.stopPropagation();
      };
      doc.addEventListener('click', block, true);
      doc.addEventListener('pointerdown', block, true);
      doc.addEventListener('pointerup', block, true);
      doc.addEventListener('auxclick', block, true);
      doc.addEventListener('contextmenu', block, true);
      doc.addEventListener('keydown', function (ev) {
        if (document.documentElement.getAttribute('data-ops-interaction') !== '0') return;
        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
          ev.preventDefault();
          ev.stopPropagation();
        }
      }, true);
    }
    iframe.onload = function () {
      try { armFrozenDoc(iframe.contentDocument); } catch (err) { /* same-origin freeze pages only */ }
    };
    try { armFrozenDoc(iframe.contentDocument); } catch (err) { /* load handler arms after navigation */ }
    if (iframe.getAttribute('src') !== page.src) iframe.setAttribute('src', page.src);
  }
}`;
}

function collectReplaceableIndex(html, locale) {
  const assets = {};
  const tagRe = /<(?:img|source|video|div|span)\b[^>]*\sdata-asset(?:-key)?="([^"]+)"[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(html))) {
    const markup = match[0];
    const key = match[1];
    const platform = (markup.match(/\sdata-asset-platform="([^"]+)"/i) || [])[1] || 'pc';
    const lang = (markup.match(/\sdata-asset-lang="([^"]+)"/i) || [])[1] || locale;
    const src = (markup.match(/\ssrc="([^"]+)"/i) || markup.match(/\sdata-asset-src="([^"]+)"/i) || [])[1] || null;
    if (!assets[key]) assets[key] = { replaceable: true, files: {} };
    if (!assets[key].files[platform]) assets[key].files[platform] = {};
    assets[key].files[platform][lang] = { src, locale };
  }
  return assets;
}

export function writeOpsShell(frozenDir, { interaction = false } = {}) {
  if (!existsSync(frozenDir)) mkdirSync(frozenDir, { recursive: true });
  const policy = parseDesignPolicyFile(DESIGN_MD);
  const devices = JSON.parse(readFileSync(DEVICES_TPL, 'utf8'));
  const chrome = inlineSafe(readFileSync(CHROME_TPL, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'));
  let html = readFileSync(QA_SHELL, 'utf8').replace(/\r\n/g, '\n');
  html = html.replace(
    /data-ops-interaction="[01]"/,
    `data-ops-interaction="${interaction ? '1' : '0'}"`,
  );
  html = html
    .replace('{{QA_TRUTH}}', safeJsonForScript({
      design: { fileVersion: 'torchlight-frozen' },
      platforms: { pc: true, mobile: true },
    }))
    .replace('{{QA_DEVICES}}', safeJsonForScript(devices))
    .replace('{{QA_DESIGN_POLICY}}', safeJsonForScript(policy))
    .replace('{{QA_DEMO}}', frozenQaDemoScript())
    .replace('{{FIGMA_CHROME}}', chrome);
  const dest = path.join(frozenDir, 'index.html');
  writeFileSync(dest, html);
  return dest;
}

export function writeReplaceableIndex(frozenDir) {
  const byLocale = {};
  const merged = {};
  for (const page of LOCALE_PAGES) {
    const file = path.join(frozenDir, page.out);
    if (!existsSync(file)) continue;
    const html = readFileSync(file, 'utf8');
    const assets = collectReplaceableIndex(html, page.lang);
    byLocale[page.locale] = { lang: page.lang, region: page.region, assets };
    for (const [key, entry] of Object.entries(assets)) {
      if (!merged[key]) merged[key] = { replaceable: true, files: {} };
      for (const [platform, langs] of Object.entries(entry.files || {})) {
        if (!merged[key].files[platform]) merged[key].files[platform] = {};
        Object.assign(merged[key].files[platform], langs);
      }
    }
  }
  const payload = {
    schemaVersion: 1,
    source: 'torchlight-freeze',
    locales: byLocale,
    assets: merged,
  };
  const dest = path.join(frozenDir, 'replaceable-index.json');
  writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`);
  return { dest, count: Object.keys(merged).length, payload };
}

export function frozenOpsIndex(demoDir) {
  return path.join(demoDir, 'frozen', 'index.html');
}
