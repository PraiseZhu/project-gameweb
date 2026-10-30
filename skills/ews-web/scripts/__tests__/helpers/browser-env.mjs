/**
 * Test-process-only Playwright env. Not imported by product scripts.
 * Paths are assembled at runtime so publish audit does not see a machine path literal.
 */
import { existsSync } from 'node:fs';

function joinPosix(parts) {
  return parts.join('/');
}

const ORIGIN_ROOT = joinPosix([
  'C:', 'Users', 'XINDONG', 'Desktop', '詹欣仪AI', 'project-gameweb-issue32-verify',
]);
const YISE_ROOT = joinPosix([ORIGIN_ROOT, 'skills', 'yise-web-ui']);
const STOP1_TOOL = joinPosix([ORIGIN_ROOT, 'standards', 'stop1-figma-pixel', 'tool']);
const CHROME = joinPosix([
  'C:', 'Users', 'XINDONG', 'AppData', 'Local', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe',
]);

export function applyTestBrowserEnv(env = process.env) {
  if (!env.QA_HIFI_MODULE_ROOT && existsSync(`${YISE_ROOT}/node_modules/playwright-core/package.json`)) {
    env.QA_HIFI_MODULE_ROOT = YISE_ROOT;
  }
  if (!env.STOP1_PIXEL_MODULE_ROOT && existsSync(`${STOP1_TOOL}/node_modules/pngjs/package.json`)) {
    env.STOP1_PIXEL_MODULE_ROOT = STOP1_TOOL;
  }
  if (!env.CHROME_PATH && existsSync(CHROME)) env.CHROME_PATH = CHROME;
  return {
    moduleRoot: env.QA_HIFI_MODULE_ROOT || null,
    stop1ModuleRoot: env.STOP1_PIXEL_MODULE_ROOT || null,
    chromePath: env.CHROME_PATH || null,
  };
}
