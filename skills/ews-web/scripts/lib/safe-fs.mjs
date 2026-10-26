/**
 * Path containment for EWS writes. Rejects traversal, drives, separators in
 * file tokens, and symlink escape. Used by CLI and asset validation.
 */
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function contained(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function sanitizeRel(rel) {
  const raw = String(rel ?? '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw) || raw.includes('\0')) {
    return { ok: false, problem: `非法相对路径：${rel}` };
  }
  const parts = raw.split('/').filter((part) => part && part !== '.');
  if (!parts.length) return { ok: false, problem: `空相对路径：${rel}` };
  if (parts.some((part) => part === '..' || /[:*?"<>|\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(part))) {
    return { ok: false, problem: `路径穿越或非法文件名：${rel}` };
  }
  return { ok: true, rel: parts.join('/') };
}

export function sanitizeFileToken(key, label = 'name') {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(String(key || '')) || /[. ]$/.test(String(key)) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(String(key))) {
    return { ok: false, problem: `${label} 非法：${key}` };
  }
  return { ok: true, rel: String(key) };
}

export function resolveInside(root, relOrAbs) {
  const rootAbs = resolve(root);
  if (relOrAbs == null || relOrAbs === '') return { ok: false, problem: '空路径' };
  const raw = String(relOrAbs);
  if (raw.includes('\0')) return { ok: false, problem: '路径含 NUL' };
  if (isAbsolute(raw) || /^[A-Za-z]:/.test(raw.replace(/\\/g, '/'))) {
    const abs = resolve(raw);
    if (!contained(rootAbs, abs)) return { ok: false, problem: `绝对路径越出根：${raw}` };
    return finalizeInside(rootAbs, abs);
  }
  const safe = sanitizeRel(raw);
  if (!safe.ok) return safe;
  return finalizeInside(rootAbs, resolve(rootAbs, safe.rel));
}

function finalizeInside(rootAbs, abs) {
  if (!contained(rootAbs, abs)) return { ok: false, problem: `路径越出根：${abs}` };
  try {
    const rootReal = physicalPath(rootAbs);
    const real = physicalPath(abs);
    if (!contained(rootReal, real)) return { ok: false, problem: '真实路径越出根目录' };
  } catch {
    return { ok: false, problem: `无法解析路径：${abs}` };
  }
  return { ok: true, abs };
}

export function physicalPath(target) {
  let probe = resolve(target);
  while (!existsSync(probe)) {
    try {
      if (lstatSync(probe).isSymbolicLink()) throw new Error('悬空符号链接');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(probe);
    if (parent === probe) throw new Error('无法解析路径');
    probe = parent;
  }
  return resolve(realpathSync(probe), relative(probe, resolve(target)));
}
