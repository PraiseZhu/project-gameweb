import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { launchChromium } from "../lib/resolve-playwright.mjs";
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from "../lib/runtime-capabilities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const demo = resolve(root, "../../_tmp/demo-392-18375/index.html");
const probe = probePlaywrightCapability(root);
const skip = !probe.available || !existsSync(demo);

async function measure(page) {
  return page.evaluate(() => {
    const title = [...document.querySelectorAll("img")].find((img) => (img.currentSrc || img.src || "").includes("392-24235"));
    const box = title ? title.getBoundingClientRect() : null;
    const button = document.querySelector('[data-node-name="btn/下载按钮"], [data-btn-name="下载按钮"]');
    const buttonBox = button ? button.getBoundingClientRect() : null;
    const arrow = document.querySelector('[data-node-name="img/下滑箭头"]');
    const arrowBox = arrow ? arrow.getBoundingClientRect() : null;
    return {
      h: innerHeight,
      title: box ? { y: box.y, bottom: box.bottom, h: box.height } : null,
      button: buttonBox ? { y: buttonBox.y, bottom: buttonBox.bottom, h: buttonBox.height } : null,
      arrow: arrowBox ? { bottom: arrowBox.bottom } : null,
      lowest: Math.max(0, ...[...document.querySelectorAll('[data-hero-ui-anchor]')].map((el) => el.getBoundingClientRect().bottom)),
    };
  });
}

test("short wide PC windows keep the hero title and download inside the bottom edge", async (t) => {
  if (skip) {
    t.skip(probe.available ? "demo-392-18375 missing" : playwrightBrowserSkipMessage(probe));
    return;
  }
  const { browser } = await launchChromium(root, { headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 800 } });
    const url = pathToFileURL(demo).href + "?product=1";
    for (const [w, h] of [[1920, 800], [1440, 600]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(1500);
      const info = await measure(page);
      assert.ok(info.title, "title image missing at " + w + "x" + h);
      assert.ok(info.title.bottom <= h + 2, "title bottom " + info.title.bottom + " leaves " + h);
      assert.ok(info.title.bottom >= h - 80, "title bottom " + info.title.bottom + " is not pinned near " + h);
      assert.ok(info.lowest <= h + 2 && info.lowest >= h - 2, "lowest hero control bottom " + info.lowest + " is not flush with " + h);
      assert.ok(info.title.y >= 0, "title top left the window");
      assert.ok(info.button, "download button owner missing at " + w + "x" + h);
      assert.ok(info.button.h > 20, "download button owner has no box");
      assert.ok(info.button.bottom <= h + 2, "download bottom " + info.button.bottom + " leaves " + h);
      assert.ok(info.button.bottom > info.title.y, "download button is above the title");
      assert.ok(info.arrow, "bottom arrow missing at " + w + "x" + h);
      assert.ok(info.arrow.bottom <= h + 2 && info.arrow.bottom >= h - 2, "arrow bottom " + info.arrow.bottom + " is not flush with " + h);
    }
  } finally {
    await browser.close();
  }
});
