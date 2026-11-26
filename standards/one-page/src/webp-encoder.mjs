import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StoppedError } from './stopped.mjs';

const helper = fileURLToPath(new URL('./c-assets-image.py', import.meta.url));

export function inspectImage(mode, source, { target, forceLossless = false, python = 'python3' } = {}) {
  const args = mode === 'svg' ? [source] : [source, target, String(forceLossless)];
  const result = spawnSync(python, ['-B', helper, mode, ...args], { encoding: 'utf8', timeout: 120_000 });
  if (result.error?.code === 'ENOENT' || result.status === 3) {
    throw new StoppedError('encoder-unavailable', 'C1 需要现有 Python 3 和支持 WebP 的 Pillow，未发布素材包。');
  }
  if (result.status === 2 && mode === 'svg') return null;
  if (result.status !== 0) throw new StoppedError('image-invalid', '素材格式、像素保真或编码校验失败。');
  return JSON.parse(result.stdout);
}
