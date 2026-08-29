import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { findChromiumExecutable, getChromeCandidates, playwrightDependencyHint } from '../lib/resolve-playwright.mjs';

test('Chrome resolver prefers explicit CHROME_PATH and discovers common Windows installs', () => {
  const drive = 'C:';
  const candidates = getChromeCandidates({
    CHROME_PATH: `${drive}\\Custom\\chrome.exe`,
    ProgramFiles: `${drive}\\Program Files`,
    'ProgramFiles(x86)': `${drive}\\Program Files (x86)`,
    ProgramW6432: `${drive}\\Program Files`,
    LOCALAPPDATA: `${drive}\\Users\\Test\\AppData\\Local`,
    APPDATA: `${drive}\\Users\\Test\\AppData\\Roaming`,
  });
  assert.equal(candidates[0], `${drive}\\Custom\\chrome.exe`);
  assert.ok(candidates.includes(`${drive}\\Program Files\\Google\\Chrome\\Application\\chrome.exe`));
  assert.ok(candidates.includes(`${drive}\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`));
  assert.ok(candidates.includes(`${drive}\\Users\\Test\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`));
  assert.ok(candidates.includes(`${drive}\\Users\\Test\\AppData\\Local\\Chromium\\Application\\chrome.exe`));
});

test('Chrome resolver keeps explicit path first without page-specific identifiers', () => {
  const drive = 'C:';
  const candidates = getChromeCandidates({ CHROME_PATH: `${drive}\\Chrome\\chrome.exe` });
  assert.equal(candidates[0], `${drive}\\Chrome\\chrome.exe`);
  assert.equal(candidates.some((candidate) => candidate.includes('yise') || candidate.includes('Etheria')), false);
});

test('Playwright dependency hint names Windows and non-Git/Figma-only setup', () => {
  const hint = playwrightDependencyHint('playwright');
  assert.match(hint, /Figma-only and non-Git demos are supported/);
  assert.match(hint, /QA_HIFI_MODULE_ROOT/);
  assert.match(hint, /Windows PowerShell/);
  assert.match(hint, /CHROME_PATH/);
});

test('findChromiumExecutable is null when Playwright browser and Chrome paths are missing', () => {
  // findChromiumExecutable 会探测固定真实候选（/usr/bin/google-chrome 等），
  // runner 预装 Chrome 时 fallback 必然命中；断言跟随真机：候选存在 ⇔ 探测命中。
  const env = {
    CHROME_PATH: '/definitely-missing-chrome',
    ProgramFiles: '/no-program-files',
    'ProgramFiles(x86)': '/no-program-files-x86',
    ProgramW6432: '/no-program-files',
    LOCALAPPDATA: '/no-local',
    APPDATA: '/no-roaming',
  };
  const machineHasListedChrome = getChromeCandidates(env).some((p) => existsSync(p));
  const found = findChromiumExecutable({
    executablePath() { return '/definitely-missing-playwright-chromium'; },
  }, env);
  assert.equal(found !== null, machineHasListedChrome, `探测结果与真机候选不一致: ${found}`);
});
