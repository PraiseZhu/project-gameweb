import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_PUBLIC_SKIP_LIMIT,
  publicSkipPolicy,
  SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE,
  WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE,
} from '../lib/runtime-capabilities.mjs';

test('公开自测 skip 策略: Linux/CI 不因 symlink 权限放宽基准', () => {
  for (const symlinkAvailable of [true, false]) {
    assert.deepEqual(publicSkipPolicy({ platform: 'linux', symlinkAvailable }), {
      base: BASE_PUBLIC_SKIP_LIMIT,
      allowances: [],
      limit: BASE_PUBLIC_SKIP_LIMIT,
    });
  }
});

test('公开自测 skip 策略: 只按平台与真实 symlink 能力增加 allowance', () => {
  const windowsWithSymlink = publicSkipPolicy({ platform: 'win32', symlinkAvailable: true });
  assert.equal(windowsWithSymlink.limit, BASE_PUBLIC_SKIP_LIMIT + WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE);
  assert.deepEqual(windowsWithSymlink.allowances, [{ label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE }]);

  const restrictedWindows = publicSkipPolicy({ platform: 'win32', symlinkAvailable: false });
  assert.equal(restrictedWindows.limit, BASE_PUBLIC_SKIP_LIMIT + WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE + SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE);
  assert.deepEqual(restrictedWindows.allowances, [
    { label: 'Windows 只读 rename 语义', count: WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE },
    { label: '无法创建 symlink 的 r9 PoC', count: SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE },
  ]);

});

test('公开自测 skip 策略: 调用方必须明确传入 symlink 能力', () => {
  assert.throws(() => publicSkipPolicy({ platform: 'linux' }), /symlinkAvailable/);
});
