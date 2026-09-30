import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium } from "../lib/resolve-playwright.mjs";
import { playwrightBrowserSkipMessage, probePlaywrightCapability } from "../lib/runtime-capabilities.mjs";
import { DESIGN_POLICY } from "../lib/design-policy.generated.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = probePlaywrightCapability(root);
const rendererPath = resolve(root, "templates/figma-render.js");
const words = "WORD WORD WORD WORD WORD WORD";

function browserTest(name, fn) {
  test(name, async (t) => {
    if (!probe.available) {
      t.skip(playwrightBrowserSkipMessage(probe));
      return;
    }
    try {
      await fn();
    } catch (err) {
      const message = String(err && err.message || err);
      if (/browserType.launch|Executable doesn't exist|Failed to launch|npx playwright install/i.test(message)) {
        t.skip(playwrightBrowserSkipMessage(probe));
        return;
      }
      throw err;
    }
  });
}

async function fit(page, { hidden, whiteSpace, maxWidth, maxHeight, fontSize }) {
  return page.evaluate(({ words, hidden, whiteSpace, maxWidth, maxHeight, fontSize }) => {
    const host = document.createElement("div");
    host.hidden = hidden;
    host.style.width = maxWidth + "px";
    document.body.appendChild(host);
    const el = document.createElement("div");
    el.textContent = words;
    el.style.whiteSpace = whiteSpace;
    el.style.width = maxWidth + "px";
    el.style.fontSize = fontSize + "px";
    el.style.lineHeight = fontSize + "px";
    el.style.fontFamily = "sans-serif";
    host.appendChild(el);
    window.__figmaRender._fitText(el, { fontSize, lineHeight: fontSize }, { w: maxWidth, h: maxHeight }, {
      maxWidth,
      maxHeight,
    });
    const size = Number.parseFloat(el.style.fontSize);
    host.remove();
    return { size, stillHidden: host.hidden };
  }, { words, hidden, whiteSpace, maxWidth, maxHeight, fontSize });
}

browserTest("hidden wrapping copy keeps its size when the wrapped block fits", async () => {
  const { browser } = await launchChromium(root, { headless: true });
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><body></body>");
    await page.evaluate((policy) => { window.__designPolicy = policy; }, DESIGN_POLICY);
    await page.addScriptTag({ path: rendererPath });
    const hiddenFit = await fit(page, { hidden: true, whiteSpace: "pre-wrap", maxWidth: 160, maxHeight: 200, fontSize: 32 });
    assert.equal(hiddenFit.size, 32);
    const hiddenTight = await fit(page, { hidden: true, whiteSpace: "pre-wrap", maxWidth: 120, maxHeight: 70, fontSize: 32 });
    assert.ok(hiddenTight.size < 32, "wrapped overflow still shrinks, got " + hiddenTight.size);
    assert.ok(hiddenTight.size > 16, "does not collapse to a single-line width, got " + hiddenTight.size);
    const visibleLine = await fit(page, { hidden: false, whiteSpace: "pre", maxWidth: 80, maxHeight: 40, fontSize: 28 });
    assert.ok(visibleLine.size < 28);
  } finally {
    await browser.close();
  }
});
