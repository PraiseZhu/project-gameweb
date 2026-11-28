import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let interpreter;

// Resolve the executable itself (including py -3), so production's existing
// python option and fixture commands use the same verified Pillow installation.
export function pillowPython() {
  if (interpreter) return interpreter;
  const candidates = [];
  if (process.env.PYTHON) candidates.push([process.env.PYTHON, []]);
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const root = join(process.env.LOCALAPPDATA, 'Programs', 'Python');
    if (existsSync(root)) {
      for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => b.name.localeCompare(a.name))) {
        if (entry.isDirectory()) candidates.push([join(root, entry.name, 'python.exe'), []]);
      }
    }
  }
  candidates.push(['python3', []], ['py', ['-3']]);
  const failures = [];
  for (const [command, prefix] of candidates) {
    const result = spawnSync(command, [...prefix, '-B', '-c', 'from PIL import Image; import sys; print(sys.executable)'],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true });
    if (!result.error && result.status === 0 && result.stdout.trim()) {
      interpreter = result.stdout.trim();
      return interpreter;
    }
    failures.push(`${command}: ${result.error?.code ?? result.status}`);
  }
  throw new Error('No Python interpreter can import Pillow: ' + failures.join(', '));
}
