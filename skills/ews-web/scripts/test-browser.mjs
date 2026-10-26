#!/usr/bin/env node
/**
 * Real CLI → HTTP → Chromium checks. Reuses an already-installed playwright-core
 * via explicit candidate paths. Does not import other Skills from runtime code.
 * Missing driver: exit 2. Failed assertions: exit 1.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runEwsWeb } from './ews-web.mjs';
import {
  defaultConfig, defaultDesignations, makeLark, writeAssets, writeReadyPack,
} from './__tests__/helpers/ready-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(HERE, '..');

function playwrightCandidates() {
  return [
    process.env.EWS_PLAYWRIGHT_CORE,
    resolve(SKILL_ROOT, '../yise-web-ui/node_modules/playwright-core'),
    resolve(SKILL_ROOT, '../torchlight-web/node_modules/playwright-core'),
    resolve(SKILL_ROOT, '../../../../skills/yise-web-ui/node_modules/playwright-core'),
    resolve(SKILL_ROOT, '../../../../skills/torchlight-web/node_modules/playwright-core'),
  ].filter(Boolean);
}

function loadPlaywright() {
  for (const dir of playwrightCandidates()) {
    const pkg = join(dir, 'package.json');
    if (!existsSync(pkg)) continue;
    try {
      const require = createRequire(pkg);
      return { chromium: require(dir).chromium, dir };
    } catch {
      try {
        const require = createRequire(pkg);
        return { chromium: require('playwright-core').chromium, dir };
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

function chromePath(chromium) {
  if (process.env.EWS_CHROME && existsSync(process.env.EWS_CHROME)) return process.env.EWS_CHROME;
  try {
    const exe = chromium.executablePath();
    if (exe && existsSync(exe)) return exe;
  } catch {
    /* fall through */
  }
  return undefined;
}

function serve(dir) {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname.slice(1) || 'index.html';
    const file = resolve(root, path);
    if (!file.startsWith(root)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    try {
      const type = path.endsWith('.mjs') ? 'text/javascript'
        : path.endsWith('.css') ? 'text/css'
          : path.endsWith('.json') ? 'application/json'
            : path.endsWith('.png') ? 'image/png'
              : path.endsWith('.webm') ? 'video/webm'
              : path.endsWith('.woff2') ? 'font/woff2'
              : path.endsWith('.bin') ? 'application/octet-stream'
                : 'text/html';
      res.setHeader('Content-Type', type);
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function main() {
  const pw = loadPlaywright();
  if (!pw) {
    console.error('EWS test:browser: 解析不到已安装的 playwright-core。候选路径均不存在。退出码 2');
    process.exit(2);
  }
  const executablePath = chromePath(pw.chromium);
  if (!executablePath && !process.env.EWS_ALLOW_DEFAULT_BROWSER) {
    console.error(`EWS test:browser: 已找到驱动 ${pw.dir}，但未找到 Chromium 可执行文件。设置 EWS_CHROME 后重试。退出码 2`);
    process.exit(2);
  }

  const root = mkdtempSync(join(tmpdir(), 'ews-browser-'));
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  writeFileSync(join(root, 'config.json'), `${JSON.stringify(defaultConfig(), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', join(root, 'config.json'),
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  if (!built.ok) {
    console.error(built.problems);
    process.exit(1);
  }

  const server = await serve(out);
  const browser = await pw.chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const failures = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const url = `http://127.0.0.1:${server.address().port}/index.html`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(400);
    const pc = await page.evaluate(() => ({
      device: document.querySelector('.ews-root')?.dataset.device,
      images: [...document.images].map((img) => ({ src: img.getAttribute('src'), w: img.naturalWidth })),
      title: document.querySelector('[data-node-id="100:5"]')?.textContent,
      footer: document.querySelector('.ews-footer')?.getAttribute('data-node-id'),
      nav: document.querySelectorAll('[data-nav-screen]').length,
      slides: document.querySelectorAll('.ews-carousel-slide').length,
      video: document.querySelectorAll('video').length,
      modalOpen: document.querySelectorAll('[data-modal-open]').length,
    }));
    if (pc.device !== 'pc') failures.push(`pc device=${pc.device}`);
    if (!pc.images.length || pc.images.some((img) => img.w === 0 || !img.src?.startsWith('./assets/'))) {
      failures.push(`pc images ${JSON.stringify(pc.images)}`);
    }
    if (pc.footer !== '100:12') failures.push(`footer=${pc.footer}`);
    if (!pc.nav || !pc.slides || !pc.video || !pc.modalOpen) failures.push(`wiring ${JSON.stringify(pc)}`);
    await page.evaluate(() => document.fonts.ready);
    const resources = await page.evaluate(async () => {
      await document.fonts.load('400 16px "Source Han Sans"');
      await document.fonts.load('500 16px "Source Han Sans"');
      return {
        fonts: [...document.fonts].map((font) => ({ weight: font.weight, status: font.status })),
        video: [...document.querySelectorAll('video')].map((video) => ({ ready: video.readyState, error: video.error?.code || 0 })),
        background: Boolean(document.querySelector('[data-node-id="100:3"]')),
        galleryTop: document.querySelector('[data-screen="gallery"]').getBoundingClientRect().top,
        footerTop: document.querySelector('.ews-footer').getBoundingClientRect().top,
        carousel: [...document.querySelectorAll('.ews-carousel')].map((element) => ({ width: element.clientWidth, scroll: element.scrollWidth })),
      };
    });
    if (resources.fonts.length !== 2 || resources.fonts.some((font) => font.status !== 'loaded')) failures.push('fonts not loaded: ' + JSON.stringify(resources));
    if (resources.video.some((video) => video.error || video.ready < 3)) failures.push('video not playable: ' + JSON.stringify(resources));
    if (!resources.background || Math.abs(resources.galleryTop - 900) > 1 || Math.abs(resources.footerTop - 1800) > 1) failures.push('screen/background layout: ' + JSON.stringify(resources));
    if (resources.carousel.some((carousel) => carousel.scroll !== 2 * carousel.width)) failures.push('carousel double offset: ' + JSON.stringify(resources));

    await page.click('[data-locale="en"]');
    await page.waitForTimeout(200);
    const en = await page.evaluate(() => document.querySelector('[data-node-id="100:5"]')?.textContent);
    if (en !== 'Title A') failures.push(`en title=${en}`);
    await page.click('[data-locale="zh-CN"]');
    await page.waitForTimeout(200);
    const cn = await page.evaluate(() => document.querySelector('[data-node-id="100:5"]')?.textContent);
    if (cn !== '标题甲') failures.push(`cn title=${cn}`);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);
    const mobile = await page.evaluate(() => ({
      device: document.querySelector('.ews-root')?.dataset.device,
      node: document.querySelector('[data-node-id="200:5"]')?.textContent,
      img: [...document.images].map((img) => img.getAttribute('src')),
    }));
    if (mobile.device !== 'mobile' || !mobile.node) failures.push(`mobile ${JSON.stringify(mobile)}`);

    await page.setViewportSize({ width: 1440, height: 500 });
    await page.waitForTimeout(300);
    const shortScreen = await page.evaluate(() => {
      const scroller = document.querySelector('.ews-screen-scroll');
      const last = Math.max(0, ...[...document.querySelectorAll('.ews-screen-world .ews-node')].map((n) => n.getBoundingClientRect().bottom));
      return {
        device: document.querySelector('.ews-root')?.dataset.device,
        scrollHeight: scroller?.scrollHeight,
        clientHeight: scroller?.clientHeight,
        last,
      };
    });
    if (!(shortScreen.scrollHeight > shortScreen.clientHeight + 8)) {
      failures.push(`short screen not scrollable ${JSON.stringify(shortScreen)}`);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);
    await page.click('[data-nav-screen="gallery"]');
    await page.waitForTimeout(200);
    const gallery = await page.evaluate(() => document.querySelector('[data-screen="gallery"]')?.getBoundingClientRect().top);
    if (Math.abs(gallery) > 40) failures.push(`nav gallery top=${gallery}`);
    await page.click('[data-modal-open]');
    await page.waitForTimeout(100);
    const locked = await page.evaluate(() => !document.querySelector('.ews-modal[hidden]'));
    if (!locked) failures.push('modal did not open');
    const modal = await page.evaluate(() => ({
      text: document.querySelector('.ews-modal:not([hidden]) [data-node-id="100:25"]')?.textContent,
      close: Boolean(document.querySelector('.ews-modal:not([hidden]) [data-modal-close]')),
    }));
    if (modal.text !== '弹窗文案' || !modal.close) failures.push('modal body/close: ' + JSON.stringify(modal));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.ews-root')?.dataset.device === 'mobile');
    if (!(await page.locator('.ews-modal:not([hidden])').count())) failures.push('resize lost modal');
    const lockedTop = await page.locator('[data-screen="gallery"]').evaluate((element) => element.getBoundingClientRect().top);
    await page.mouse.wheel(0, 300);
    const afterLockedWheel = await page.locator('[data-screen="gallery"]').evaluate((element) => element.getBoundingClientRect().top);
    if (Math.abs(afterLockedWheel - lockedTop) > 1) failures.push('resize lost modal wheel lock');
    await page.click('[data-modal-close]');
    if (await page.locator('.ews-modal:not([hidden])').count()) failures.push('modal close failed');
    await page.evaluate(() => document.querySelector('[data-nav-screen="gallery"]').click());
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const carouselBox = await page.locator('.ews-carousel').boundingBox();
    const swipe = async (start, finish) => {
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
      for (let step = 1; step <= 5; step += 1) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (finish.x - start.x) * step / 5, y: start.y + (finish.y - start.y) * step / 5, id: 1 }] });
      }
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe({ x: carouselBox.x + carouselBox.width - 30, y: carouselBox.y + 70 }, { x: carouselBox.x + 30, y: carouselBox.y + 70 });
    await page.waitForFunction(() => document.querySelector('.ews-carousel').scrollLeft > 0);
    const horizontal = await page.locator('.ews-carousel').evaluate((element) => ({ left: element.scrollLeft, width: element.clientWidth }));
    if (Math.abs(horizontal.left - horizontal.width) > 1) failures.push('horizontal touch did not reach next slide: ' + JSON.stringify(horizontal));
    await page.waitForTimeout(450);
    await swipe({ x: 360, y: 700 }, { x: 360, y: 400 });
    await page.waitForTimeout(150);
    const footerTop = await page.locator('.ews-footer').evaluate((element) => element.getBoundingClientRect().top);
    if (Math.abs(footerTop) > 1) failures.push('CDP upward touch did not advance to footer: ' + footerTop);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, driver: pw.dir, executablePath: executablePath || 'default' }, null, 2));
}

void pathToFileURL;
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
