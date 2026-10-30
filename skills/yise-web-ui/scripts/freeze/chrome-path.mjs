import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function resolveChromePath(explicit = '') {
  const wanted = String(explicit || '').trim();
  if (wanted) {
    if (existsSync(wanted)) return wanted;
    throw new Error('chrome-not-found:' + wanted);
  }
  const env = process.env;
  const programFiles = env.ProgramFiles || env.PROGRAMFILES || '';
  const programFilesX86 = env['ProgramFiles(x86)'] || env['PROGRAMFILES(X86)'] || '';
  const localAppData = env.LOCALAPPDATA || '';
  const candidates = [
    programFiles && join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    programFilesX86 && join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData && join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter(Boolean);
  return candidates.find((file) => existsSync(file)) || '';
}
