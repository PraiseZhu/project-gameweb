import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_PUBLIC_SKIP_LIMIT,
  MISSING_PLAYWRIGHT_SKIP_ALLOWANCE,
  publicSkipPolicy,
  SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE,
  UNBUNDLED_FONTS_SKIP_ALLOWANCE,
  WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE,
} from '../lib/runtime-capabilities.mjs';

test('公开自测 skip 策略: Linux/CI 不因 symlink 权限放宽基准', () => {
  for (const symlinkAvailable of [true, false]) {
    assert.deepEqual(publicSkipPolicy({ platform: 'linux', symlinkAvailable, bundledFonts: true }), {
      base: BASE_PUBLIC_SKIP_LIMIT,
      allowances: [],
      limit: BASE_PUBLIC_SKIP_LIMIT,
    });
  }
});

test('公开自测 skip 策略: 只按平台与真实 symlink 能力增加 allowance', () => {
  const windowsWithSymlink = publicSkipPolicy({ platform: 'win32', symlinkAvailable: true, bundledFonts: true });
  assert.equal(windowsWithSymlink.limit, BASE_PUBLIC_SKIP_LIMIT + WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE);
  assert.deepEqual(windowsWithSymlink.allowances, [{ label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE }]);

  const restrictedWindows = publicSkipPolicy({ platform: 'win32', symlinkAvailable: false, bundledFonts: true });
  assert.equal(restrictedWindows.limit, BASE_PUBLIC_SKIP_LIMIT + WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE + SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE);
  assert.deepEqual(restrictedWindows.allowances, [
    { label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE },
    { label: '无法创建 symlink 的 r9 PoC', count: SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE },
  ]);

});

test('公开自测 skip 策略: 调用方必须明确传入 symlink 能力', () => {
  assert.throws(() => publicSkipPolicy({ platform: 'linux' }), /symlinkAvailable/);
});

test('公开自测 skip 策略: 公开包不含 fonts/ 时额外放行 3 条 bundled-only 测试', () => {
  const unbundled = publicSkipPolicy({ platform: 'linux', symlinkAvailable: true, bundledFonts: false });
  assert.equal(unbundled.limit, BASE_PUBLIC_SKIP_LIMIT + UNBUNDLED_FONTS_SKIP_ALLOWANCE);
  assert.deepEqual(unbundled.allowances, [{ label: '公开包不含 fonts/ 二进制', count: UNBUNDLED_FONTS_SKIP_ALLOWANCE }]);
});

test('公开自测 skip 策略: 无 Playwright 时额外放行 3 条 preview-first 浏览器测', () => {
  const missing = publicSkipPolicy({ platform: 'linux', symlinkAvailable: true, bundledFonts: true, playwrightAvailable: false });
  assert.equal(missing.limit, BASE_PUBLIC_SKIP_LIMIT + MISSING_PLAYWRIGHT_SKIP_ALLOWANCE);
  assert.deepEqual(missing.allowances, [{ label: '公开包不含 Playwright，preview-first 浏览器测 skip', count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }]);
  const present = publicSkipPolicy({ platform: 'linux', symlinkAvailable: true, bundledFonts: true, playwrightAvailable: true });
  assert.equal(present.limit, BASE_PUBLIC_SKIP_LIMIT);
});
