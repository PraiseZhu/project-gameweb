#!/usr/bin/env node
/**
 * Live-copy gate: TEXT color/wrap/size/characters plus product chrome,
 * dropmenu default off, overflow, textCase, and 4xx. Pixel masks cannot hide these.
 * Does not rebuild the page.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditDropmenuHtml,
  auditLiveCopyModel,
  auditModalTriggerHtml,
  auditProductChromeHtml,
  liveTextNodesOf,
} from './lib/live-copy.mjs';
import { designedLineCount, expectedNowrap, expectedTextTransform } from '../assets/runtime/text-style.mjs';
import { renderPageHtml } from '../assets/runtime/render.mjs';
import { isDeclaredPageResource } from './lib/demo-refs.mjs';
import { presenceVisibleIds } from './lib/presence.mjs';
import { openBrowserSession, waitEwsBoot } from './lib/browser-session.mjs';

const SKILL_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function arg(argv, name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !String(argv[i + 1]).startsWith('--') ? argv[i + 1] : null;
}

export async function runLiveCopy(argv = process.argv.slice(2), { cwd = process.cwd(), skillRoot = SKILL_ROOT } = {}) {
  const demoArg = arg(argv, '--demo');
  const artifactsArg = arg(argv, '--artifacts');
  if (!demoArg) return { ok: false, gate: 'live-copy', problems: ['缺少 --demo'] };
  const demoDir = isAbsolute(demoArg) ? demoArg : resolve(cwd, demoArg);
  const artifactsDir = artifactsArg
    ? (isAbsolute(artifactsArg) ? artifactsArg : resolve(cwd, artifactsArg))
    : join(demoDir, 'artifacts', 'stop1');
  const indexPath = join(demoDir, 'index.html');
  const modelPath = join(demoDir, 'model.json');
  const problems = [];
  if (!existsSync(indexPath)) problems.push('demo 缺少 index.html');
  if (!existsSync(modelPath)) problems.push('demo 缺少 model.json');
  if (problems.length) return { ok: false, gate: 'live-copy', problems };

  const html = readFileSync(indexPath, 'utf8');
  const model = JSON.parse(readFileSync(modelPath, 'utf8'));
  const htmlByEnd = {};
  for (const end of Object.keys(model.platforms || {})) {
    htmlByEnd[end] = renderPageHtml(model, { locale: model.defaultLocale, device: end });
  }
  const staticAudit = auditLiveCopyModel(model, html, { htmlByEnd });
  problems.push(...staticAudit.problems);
  for (const end of Object.keys(model.platforms || {})) {
    const endHtml = renderPageHtml(model, { locale: model.defaultLocale, device: end, product: true });
    problems.push(...auditProductChromeHtml(endHtml).problems.map((item) => `${end} ${item}`));
    problems.push(...auditDropmenuHtml(endHtml).problems.map((item) => `${end} ${item}`));
    const triggers = Object.entries(model.platforms?.[end]?.modalTriggers || {}).map(([from, to]) => ({ from, to }));
    problems.push(...auditModalTriggerHtml(endHtml, triggers).problems.map((item) => `${end} ${item}`));
  }

  const session = await openBrowserSession({ skillRoot, demoDir });
  if (!session.ok) {
    problems.push(...(session.problems || ['无法启动浏览器做 live-copy']));
  } else {
    try {
      const viewports = [
        { name: 'pc-1440', width: 1440, height: 810, full: true },
        { name: 'mobile-390', width: 390, height: 844, full: true },
        { name: 'pc-1920', width: 1920, height: 1080, lines: true },
        { name: 'pc-1440-lines', width: 1440, height: 900, lines: true },
        { name: 'pc-998', width: 998, height: 1080, lines: true },
        { name: 'mobile-375', width: 375, height: 844, lines: true },
        { name: 'mobile-750', width: 750, height: 844, lines: true },
      ];
      for (const vp of viewports) {
        const failed = [];
        const page = await session.browser.newPage({ viewport: { width: vp.width, height: vp.height } });
        const pageUrl = `${session.base}/index.html?product=1`;
        page.on('response', (res) => {
          if (res.status() >= 400) failed.push({ status: res.status(), url: res.url() });
        });
        await page.goto(pageUrl, { waitUntil: 'load', timeout: 120000 });
        await waitEwsBoot(page);
        await page.evaluate(() => (document.fonts?.ready || Promise.resolve()).catch(() => {}));
        for (const item of failed) {
          if (!isDeclaredPageResource(item.url, { html, pageUrl })) continue;
          problems.push(`${vp.name} ${item.status} ${item.url}`);
        }
        const chrome = await page.evaluate(() => {
          const out = [];
          const lang = document.querySelector('.ews-lang-switch');
          if (lang) {
            const cs = getComputedStyle(lang);
            const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && lang.getClientRects().length > 0;
            if (visible) out.push('product 模式仍显示 QA 语言条');
          }
          const qa = document.querySelector('#ews-qa-host');
          if (qa && !qa.hidden && qa.getAttribute('data-ews-qa') !== 'hidden-product') {
            const cs = getComputedStyle(qa);
            if (cs.display !== 'none') out.push('product 模式仍显示 QA 工具栏');
          }
          const bar = document.querySelector('.bar');
          if (bar) {
            const cs = getComputedStyle(bar);
            if (cs.display !== 'none' && cs.visibility !== 'hidden' && bar.getClientRects().length > 0) {
              out.push('product 模式仍显示 QA 壳');
            }
          }
          if (document.querySelector('.qc-root, .qc-toolbar')) out.push('product 模式仍显示评论壳');
          if (typeof window.__qa?.current === 'function') out.push('product 模式暴露了 QA __qa.current');
          for (const menu of document.querySelectorAll('[data-dropmenu="true"]')) {
            if (menu.getAttribute('data-dropmenu-state') !== 'off') {
              out.push(`${menu.getAttribute('data-node-id')}: dropmenu 初始不是 off`);
            }
            const onLayer = menu.querySelector(':scope > [data-dropmenu-layer="on"]');
            if (onLayer && !onLayer.hidden) out.push(`${menu.getAttribute('data-node-id')}: on 层未藏`);
          }
          return out;
        });
        if (vp.full) problems.push(...chrome.map((item) => `${vp.name} ${item}`));
        const end = await page.evaluate(() => document.querySelector('.ews-root')?.getAttribute('data-device') || 'pc');
        const platform = model.platforms?.[end] || model.platforms?.pc;
        const byId = new Map((platform?.nodes || []).filter((node) => node?.id).map((node) => [String(node.id), node]));
        const live = liveTextNodesOf(platform).map((node) => ({
          id: node.id,
          nowrap: expectedNowrap(node, byId, { locale: model.defaultLocale, sourceLocale: model.defaultLocale }),
          designedLines: designedLineCount(node),
          sourceLocale: true,
          textTransform: expectedTextTransform(node.text?.textCase),
          dropmenuLayer: node.dropmenuLayer || null,
        }));
        const browserProblems = await page.evaluate((items) => {
          const out = [];
          const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(["\\])/g, '\\$1'));
          for (const item of items) {
            const el = document.querySelector(`[data-node-id="${cssEscape(item.id)}"]`);
            if (!el) {
              if (item.dropmenuLayer !== 'on') out.push(`${item.id}: product 页缺 live TEXT`);
              continue;
            }
            const cs = getComputedStyle(el);
            const hidden = cs.visibility === 'hidden' || cs.display === 'none' || el.hidden;
            if (item.dropmenuLayer === 'on') continue;
            if (hidden) {
              out.push(`${item.id}: product 页 live TEXT 被藏`);
              continue;
            }
            if (item.nowrap && cs.whiteSpace !== 'nowrap') {
              out.push(`${item.id}: computed white-space=${cs.whiteSpace} 应为 nowrap`);
            }
            if (!item.nowrap && cs.whiteSpace === 'nowrap') {
              out.push(`${item.id}: 长段落 computed nowrap`);
            }
            if (item.textTransform !== 'none' && cs.textTransform !== item.textTransform) {
              out.push(`${item.id}: text-transform=${cs.textTransform} 应为 ${item.textTransform}`);
            }
            const lines = (() => {
              const tops = [];
              let rects = [];
              try {
                const range = document.createRange();
                range.selectNodeContents(el);
                rects = [...range.getClientRects()];
              } catch {
                rects = [...el.getClientRects()];
              }
              if (!rects.length) rects = [...el.getClientRects()];
              for (const r of rects) {
                if (!(r.width > 0.5) || !(r.height > 0.5)) continue;
                if (!tops.some((top) => Math.abs(top - r.top) < 1)) tops.push(r.top);
              }
              return tops.length;
            })();
            if (item.sourceLocale && Number.isFinite(Number(item.designedLines)) && lines > 0 && lines !== Number(item.designedLines)) {
              out.push(`${item.id}: 源语言行数 ${lines} ≠ 稿上 ${item.designedLines}`);
            }
            let clip = el.parentElement;
            while (clip) {
              const overflow = getComputedStyle(clip);
              if (overflow.overflowX === 'hidden' || overflow.overflowX === 'clip' || overflow.overflowX === 'scroll' || overflow.overflowX === 'auto'
                || overflow.overflowY === 'hidden' || overflow.overflowY === 'clip' || overflow.overflowY === 'scroll' || overflow.overflowY === 'auto') break;
              clip = clip.parentElement;
            }
            if (clip) {
              const cr = clip.getBoundingClientRect();
              for (const r of el.getClientRects()) {
                if (!(r.width > 0.5) || !(r.height > 0.5)) continue;
                if (r.right > cr.right + 1.5 || r.left < cr.left - 1.5 || r.bottom > cr.bottom + 1.5 || r.top < cr.top - 1.5) {
                  out.push(`${item.id}: 文本被祖先 overflow 裁掉`);
                  break;
                }
              }
            }
          }
          return out;
        }, live);
        if (vp.full) problems.push(...browserProblems.map((item) => `${vp.name} ${item}`));
        const visibleIds = presenceVisibleIds(platform);
        const presenceProblems = await page.evaluate((ids) => {
          const out = [];
          const cssEscape = (value) => (globalThis.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/(['"\\])/g, '\\$1'));
          for (const id of ids) {
            const el = document.querySelector(`[data-node-id="${cssEscape(id)}"]`);
            if (!el) {
              out.push(`${id}: 缺 DOM`);
              continue;
            }
            const cs = getComputedStyle(el);
            if (el.hidden || cs.display === 'none' || cs.visibility === 'hidden') {
              out.push(`${id}: computed 不可见`);
              continue;
            }
            const box = el.getBoundingClientRect();
            if (!(box.width > 0) || !(box.height > 0)) out.push(`${id}: rect 为零`);
          }
          return out;
        }, visibleIds);
        if (vp.full) problems.push(...presenceProblems.map((item) => `${vp.name} ${item}`));
        if (vp.full || vp.lines) {
          const screens = model.screens || [];
          for (const key of screens) {
            await page.evaluate((next) => window.__ewsStop1.goTo(next, { animate: false }), key);
            const lineProblems = await page.evaluate(() => {
              const out = [];
              const els = [...document.querySelectorAll('.ews-screen.is-current [data-figma-type="TEXT"]')];
              for (const el of els) {
                if (el.closest('[hidden]') || el.hidden) continue;
                const designed = Number(el.getAttribute('data-designed-lines'));
                if (!Number.isFinite(designed) || designed <= 0) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                const tops = [];
                let rects = [];
                try {
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  rects = [...range.getClientRects()];
                } catch {
                  rects = [...el.getClientRects()];
                }
                for (const r of rects) {
                  if (!(r.width > 0.5) || !(r.height > 0.5)) continue;
                  if (!tops.some((top) => Math.abs(top - r.top) < 1)) tops.push(r.top);
                }
                if (tops.length > 0 && tops.length !== designed) {
                  out.push(`${el.getAttribute('data-node-id')}: 源语言行数 ${tops.length} ≠ 稿上 ${designed}`);
                }
              }
              return out;
            });
            problems.push(...lineProblems.map((item) => `${vp.name} ${key} ${item}`));
          }
        }
        await page.close();
      }
    } catch (err) {
      problems.push(err.message);
    } finally {
      await session.close();
    }
  }

  const payload = {
    ok: problems.length === 0,
    gate: 'live-copy',
    problems,
  };
  mkdirSync(artifactsDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'live-copy.json'), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const result = await runLiveCopy();
  if (!result.ok) {
    console.error((result.problems || []).join('\n'));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, gate: result.gate }, null, 2)}\n`);
}
