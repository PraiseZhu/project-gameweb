import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASE_PUBLIC_SKIP_LIMIT = 184;
export const SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE = 10;
export const WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE = 1;
export const UNBUNDLED_FONTS_SKIP_ALLOWANCE = 3;
export const MISSING_PLAYWRIGHT_SKIP_ALLOWANCE = 24;

const SKILL_ROOT = fileURLToPath(new URL('../..', import.meta.url));

export function probeSymlinkCapability() {
  const dir = mkdtempSync(join(tmpdir(), 'qa-hifi-symlink-capability-'));
  try {
    const target = join(dir, 'target.js');
    const link = join(dir, 'link.js');
    writeFileSync(target, 'ok\n');
    symlinkSync(target, link);
    return { available: true, code: null };
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP'].includes(error?.code)) {
      return { available: false, code: error.code };
    }
    throw error;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function interpretPlaywrightProbeStatus(status) {
  if (status === 0) return { available: true };
  return {
    available: false,
    reason: status === 1 ? 'no-executable' : 'unresolved',
  };
}

const PROBE_SCRIPT = [
  "import { loadPlaywrightApi, findChromiumExecutable } from './scripts/lib/resolve-playwright.mjs';",
  'try {',
  '  const { api } = await loadPlaywrightApi(process.cwd());',
  '  const executablePath = findChromiumExecutable(api.chromium);',
  '  if (!executablePath) process.exit(1);',
  "  const ciArgs = (process.env.CI || process.env.GITHUB_ACTIONS) ? ['--no-sandbox', '--disable-dev-shm-usage'] : [];",
  '  try {',
  '    const browser = await api.chromium.launch({ executablePath, headless: true, args: ciArgs });',
  '    await browser.close();',
  '    process.exit(0);',
  '  } catch { process.exit(1); }',
  '} catch { process.exit(2); }',
].join(' ');

const probeCache = new Map();

export function probePlaywrightCapability(cwd = SKILL_ROOT, env = process.env) {
  const key = [
    cwd,
    env.CHROME_PATH || '',
    env.QA_HIFI_MODULE_ROOT || '',
    env.PLAYWRIGHT_MODULE_ROOT || '',
    env.CI || '',
    env.GITHUB_ACTIONS || '',
  ].join('\0');
  if (probeCache.has(key)) return probeCache.get(key);
  /* File existence is not enough: ubuntu-latest ships Google Chrome, but
     playwright-core cannot launch a newer system Chrome. Only a real launch
     counts as available; otherwise public tests must skip. */
  const res = spawnSync(process.execPath, ['-e', PROBE_SCRIPT], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 30000,
  });
  const probe = interpretPlaywrightProbeStatus(res.status);
  probeCache.set(key, probe);
  return probe;
}

export function playwrightBrowserSkipMessage(probe) {
  if (probe?.reason === 'no-executable') {
    return 'playwright/playwright-core is installed but no Chromium/Chrome is launchable; browser checks skip until npx playwright install chromium or CHROME_PATH is set';
  }
  return 'playwright/playwright-core is not installed; browser checks skip until the module and a launchable Chromium/Chrome are present';
}

export function publicSkipPolicy({ platform = process.platform, symlinkAvailable, bundledFonts, playwrightAvailable = true } = {}) {
  if (typeof symlinkAvailable !== 'boolean') throw new TypeError('symlinkAvailable 必须显式传入 boolean');
  const fontsBundled = bundledFonts !== false;
  const allowances = [
    ...(platform === 'win32' ? [{ label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE }] : []),
    ...(platform === 'win32' && !symlinkAvailable ? [{ label: '无法创建 symlink 的 r9 PoC', count: SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE }] : []),
    ...(!fontsBundled ? [{ label: '公开包不含 fonts/ 二进制', count: UNBUNDLED_FONTS_SKIP_ALLOWANCE }] : []),
    ...(!playwrightAvailable ? [{ label: '公开包不含可启动 Chrome，preview-first / verify 浏览器测 skip', count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }] : []),
  ];
  return {
    base: BASE_PUBLIC_SKIP_LIMIT,
    allowances,
    limit: BASE_PUBLIC_SKIP_LIMIT + allowances.reduce((sum, allowance) => sum + allowance.count, 0),
  };
}
