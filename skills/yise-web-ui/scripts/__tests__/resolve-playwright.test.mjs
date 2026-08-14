import test from 'node:test';
import assert from 'node:assert/strict';
import { getChromeCandidates } from '../lib/resolve-playwright.mjs';

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
