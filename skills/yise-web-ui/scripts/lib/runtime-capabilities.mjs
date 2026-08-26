import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const BASE_PUBLIC_SKIP_LIMIT = 159;
export const SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE = 10;
export const WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE = 1;
export const UNBUNDLED_FONTS_SKIP_ALLOWANCE = 3;
export const MISSING_PLAYWRIGHT_SKIP_ALLOWANCE = 3;

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

export function probePlaywrightCapability(cwd = SKILL_ROOT) {
  const res = spawnSync(process.execPath, ['-e', "import('./scripts/lib/resolve-playwright.mjs').then(m=>m.resolveModule('playwright', process.cwd())).catch(()=>import('./scripts/lib/resolve-playwright.mjs').then(m=>m.resolveModule('playwright-core', process.cwd()))).then(()=>process.exit(0),()=>process.exit(1))"], {
    cwd,
    encoding: 'utf8',
    env: process.env,
    timeout: 30000,
  });
  return { available: res.status === 0 };
}

export function publicSkipPolicy({ platform = process.platform, symlinkAvailable, bundledFonts, playwrightAvailable = true } = {}) {
  if (typeof symlinkAvailable !== 'boolean') throw new TypeError('symlinkAvailable 必须显式传入 boolean');
  const fontsBundled = bundledFonts !== false;
  const allowances = [
    ...(platform === 'win32' ? [{ label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE }] : []),
    ...(platform === 'win32' && !symlinkAvailable ? [{ label: '无法创建 symlink 的 r9 PoC', count: SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE }] : []),
    ...(!fontsBundled ? [{ label: '公开包不含 fonts/ 二进制', count: UNBUNDLED_FONTS_SKIP_ALLOWANCE }] : []),
    ...(!playwrightAvailable ? [{ label: '公开包不含 Playwright，preview-first 浏览器测 skip', count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }] : []),
  ];
  return {
    base: BASE_PUBLIC_SKIP_LIMIT,
    allowances,
    limit: BASE_PUBLIC_SKIP_LIMIT + allowances.reduce((sum, allowance) => sum + allowance.count, 0),
  };
}
