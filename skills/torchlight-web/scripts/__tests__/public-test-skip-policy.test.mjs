import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_PUBLIC_SKIP_LIMIT,
  interpretPlaywrightProbeStatus,
  MISSING_PLAYWRIGHT_SKIP_ALLOWANCE,
  playwrightBrowserSkipMessage,
  probePlaywrightCapability,
  publicSkipPolicy,
  SYMLINK_UNAVAILABLE_SKIP_ALLOWANCE,
  UNBUNDLED_FONTS_SKIP_ALLOWANCE,
  WINDOWS_READONLY_RENAME_SKIP_ALLOWANCE,
} from '../lib/runtime-capabilities.mjs';
import { findChromiumExecutable, getChromeCandidates } from '../lib/resolve-playwright.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SKILL_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PLAYWRIGHT_SKIP_LABEL = '公开包不含可启动 Chrome，preview-first / verify 浏览器测 skip';

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

test('公开自测 skip 策略: 无 Playwright 时额外放行 22 条浏览器测', () => {
  const missing = publicSkipPolicy({ platform: 'linux', symlinkAvailable: true, bundledFonts: true, playwrightAvailable: false });
  assert.equal(missing.limit, BASE_PUBLIC_SKIP_LIMIT + MISSING_PLAYWRIGHT_SKIP_ALLOWANCE);
  assert.equal(MISSING_PLAYWRIGHT_SKIP_ALLOWANCE, 22);
  assert.deepEqual(missing.allowances, [{ label: PLAYWRIGHT_SKIP_LABEL, count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }]);
  const present = publicSkipPolicy({ platform: 'linux', symlinkAvailable: true, bundledFonts: true, playwrightAvailable: true });
  assert.equal(present.limit, BASE_PUBLIC_SKIP_LIMIT);
});

test('公开自测 skip 策略: 探测失败码 1 视为不能启动，而不是模块缺失', () => {
  assert.deepEqual(interpretPlaywrightProbeStatus(1), { available: false, reason: 'no-executable' });
  assert.match(playwrightBrowserSkipMessage(interpretPlaywrightProbeStatus(1)), /is installed but no Chromium\/Chrome is launchable/);
});

test('公开自测 skip 策略: 模块在但没有可启动 Chrome 时探测为 false 并走 Playwright skip allowance', () => {
  const missingPath = {
    CHROME_PATH: '/definitely-missing-chrome',
    ProgramFiles: '/no-program-files',
    'ProgramFiles(x86)': '/no-program-files-x86',
    ProgramW6432: '/no-program-files',
    LOCALAPPDATA: '/no-local',
    APPDATA: '/no-roaming',
  };
  // 候选顺序契约：CHROME_PATH 永远排第一（纯函数，不碰文件系统）。
  const candidates = getChromeCandidates(missingPath);
  assert.equal(candidates[0], '/definitely-missing-chrome');
  // findChromiumExecutable 会探测真实文件系统（/usr/bin/google-chrome 等固定候选，
  // runner 预装 Chrome 时必然命中），所以断言跟随真机：有候选存在就必须找得到，
  // 找不到就必须返回 null——两种机器都自洽。
  const machineHasListedChrome = candidates.some((p) => existsSync(p));
  const executable = findChromiumExecutable({
    executablePath() { return '/definitely-missing-playwright-chromium'; },
  }, missingPath);
  assert.equal(executable !== null, machineHasListedChrome, `探测结果与真机候选不一致: ${executable}`);
  const probe = interpretPlaywrightProbeStatus(executable ? 0 : 1);
  assert.equal(probe.available, machineHasListedChrome);
  assert.deepEqual(interpretPlaywrightProbeStatus(0), { available: true });
  assert.deepEqual(interpretPlaywrightProbeStatus(2), { available: false, reason: 'unresolved' });
  assert.match(playwrightBrowserSkipMessage({ available: false, reason: 'no-executable' }), /is installed but no Chromium\/Chrome is launchable/);
  assert.match(playwrightBrowserSkipMessage(interpretPlaywrightProbeStatus(2)), /is not installed/);
  const live = probePlaywrightCapability(SKILL_ROOT);
  assert.equal(typeof live.available, 'boolean');
  if (live.available) assert.equal(live.reason, undefined);
  else assert.ok(live.reason === 'no-executable' || live.reason === 'unresolved');
  // 策略纯函数直接喂「无 Chrome」假输入，与真机探测解耦（runner 预装 Chrome 时
  // probe.available 为 true，喂进策略会走基准口径，不能拿来断言 allowance）。
  const skip = publicSkipPolicy({
    platform: 'linux',
    symlinkAvailable: true,
    bundledFonts: true,
    playwrightAvailable: false,
  });
  assert.equal(skip.limit, BASE_PUBLIC_SKIP_LIMIT + MISSING_PLAYWRIGHT_SKIP_ALLOWANCE);
  assert.deepEqual(skip.allowances, [{ label: PLAYWRIGHT_SKIP_LABEL, count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }]);
  void probe;
  // live 探测跟随真实机器：有 Chrome 的 runner 上 available=true，上限回基准；
  // 无 Chrome 的 runner 上走 allowance。只断言两种口径都自洽，不写死方向。
  const liveSkip = publicSkipPolicy({
    platform: 'linux',
    symlinkAvailable: true,
    bundledFonts: true,
    playwrightAvailable: live.available,
  });
  assert.equal(liveSkip.limit, BASE_PUBLIC_SKIP_LIMIT + (live.available ? 0 : MISSING_PLAYWRIGHT_SKIP_ALLOWANCE));
  assert.deepEqual(
    liveSkip.allowances,
    live.available ? [] : [{ label: PLAYWRIGHT_SKIP_LABEL, count: MISSING_PLAYWRIGHT_SKIP_ALLOWANCE }],
  );
});
