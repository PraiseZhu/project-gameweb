/**
 * Test-process-only Playwright env. Not imported by product scripts.
 * Resolves playwright-core from env and in-repo relative candidates (same shape as test-browser.mjs).
 * Missing module or Chromium → tests call browserTestOptions() and SKIP with a reason.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function playwrightCoreCandidates(skillRoot = SKILL_ROOT, env = process.env) {
  if (env.EWS_PLAYWRIGHT_CORE) return [env.EWS_PLAYWRIGHT_CORE];
  return [
    env.QA_HIFI_MODULE_ROOT && join(env.QA_HIFI_MODULE_ROOT, 'node_modules/playwright-core'),
    env.PLAYWRIGHT_MODULE_ROOT && join(env.PLAYWRIGHT_MODULE_ROOT, 'node_modules/playwright-core'),
    resolve(skillRoot, '../yise-web-ui/node_modules/playwright-core'),
    resolve(skillRoot, '../torchlight-web/node_modules/playwright-core'),
    resolve(skillRoot, '../../../../skills/yise-web-ui/node_modules/playwright-core'),
    resolve(skillRoot, '../../../../skills/torchlight-web/node_modules/playwright-core'),
  ].filter(Boolean);
}

export function findPlaywrightCore(skillRoot = SKILL_ROOT, env = process.env) {
  for (const dir of playwrightCoreCandidates(skillRoot, env)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
  }
  return null;
}

export function applyTestBrowserEnv(env = process.env, skillRoot = SKILL_ROOT) {
  const core = findPlaywrightCore(skillRoot, env);
  if (core && !env.QA_HIFI_MODULE_ROOT) {
    env.QA_HIFI_MODULE_ROOT = resolve(core, '../..');
  }
  const stop1Tool = resolve(skillRoot, '../../standards/stop1-figma-pixel/tool');
  if (!env.STOP1_PIXEL_MODULE_ROOT && existsSync(join(stop1Tool, 'node_modules/pngjs/package.json'))) {
    env.STOP1_PIXEL_MODULE_ROOT = stop1Tool;
  }
  if (!env.CHROME_PATH && core) {
    try {
      const require = createRequire(join(core, 'package.json'));
      const pw = require(core);
      const exe = pw.chromium?.executablePath?.();
      if (exe && existsSync(exe)) env.CHROME_PATH = exe;
    } catch {
      /* leave CHROME_PATH unset; launchChromium still tries platform candidates */
    }
  }
  return {
    moduleRoot: env.QA_HIFI_MODULE_ROOT || null,
    stop1ModuleRoot: env.STOP1_PIXEL_MODULE_ROOT || null,
    chromePath: env.CHROME_PATH || null,
    playwrightCore: core,
  };
}

const NO_MODULE = 'playwright/playwright-core is not installed; browser checks skip until the module and a launchable Chromium/Chrome are present';
const NO_EXE = 'playwright/playwright-core is installed but no Chromium/Chrome is launchable; browser checks skip until npx playwright install chromium or CHROME_PATH is set';

const probeCache = new Map();

export function probePlaywrightCapability(skillRoot = SKILL_ROOT, env = process.env) {
  const key = [
    skillRoot,
    env.EWS_PLAYWRIGHT_CORE || '',
    env.QA_HIFI_MODULE_ROOT || '',
    env.PLAYWRIGHT_MODULE_ROOT || '',
    env.CHROME_PATH || '',
  ].join('\0');
  if (probeCache.has(key)) return probeCache.get(key);
  const core = findPlaywrightCore(skillRoot, env);
  if (!core) {
    const miss = { available: false, reason: NO_MODULE };
    probeCache.set(key, miss);
    return miss;
  }
  try {
    const require = createRequire(join(core, 'package.json'));
    const pw = require(core);
    const chromium = pw.chromium;
    const fromEnv = env.CHROME_PATH && existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
    let exe = fromEnv;
    if (!exe) {
      try {
        const bundled = chromium?.executablePath?.();
        if (bundled && existsSync(bundled)) exe = bundled;
      } catch {
        /* bundled browser missing */
      }
    }
    if (!exe) {
      const miss = { available: false, reason: NO_EXE, core };
      probeCache.set(key, miss);
      return miss;
    }
    const hit = { available: true, core, executablePath: exe };
    probeCache.set(key, hit);
    return hit;
  } catch {
    const miss = { available: false, reason: NO_MODULE };
    probeCache.set(key, miss);
    return miss;
  }
}

/** Spread into node:test options. Missing Chromium → `{ skip: reason }`; present → `{}`. */
export function browserTestOptions(extra = {}) {
  const probe = probePlaywrightCapability();
  if (probe.available) return extra;
  return { ...extra, skip: probe.reason };
}
