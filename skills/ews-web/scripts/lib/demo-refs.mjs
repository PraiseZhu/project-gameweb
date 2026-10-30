/**
 * Relative files referenced by a built demo. Missing files are a gate red.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function collectRelativeRefs(text, { kind = 'html' } = {}) {
  const out = new Set();
  const src = String(text || '');
  if (kind === 'js') {
    for (const match of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) out.add(match[1]);
  } else {
    for (const match of src.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) out.add(match[1]);
    for (const match of src.matchAll(/url\((['"]?)([^'")]+)\1\)/g)) out.add(match[2]);
    if (kind === 'html') {
      for (const match of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) out.add(match[1]);
    }
  }
  return [...out].filter((url) => url && !/^(?:https?:|data:|javascript:|mailto:|#)/i.test(url) && !url.includes('${'));
}

function resolveRef(fromFile, url) {
  const clean = String(url).split('?')[0].split('#')[0];
  if (!clean) return null;
  return resolve(dirname(fromFile), clean);
}

export function declaredPageUrls(html, pageUrl) {
  const urls = new Set();
  const add = (ref) => {
    if (!ref || /^(?:data:|javascript:|mailto:|#)/i.test(ref)) return;
    try {
      urls.add(new URL(ref, pageUrl).href);
    } catch {
      /* ignore */
    }
  };
  for (const ref of collectRelativeRefs(html, { kind: 'html' })) add(ref);
  for (const match of String(html || '').matchAll(/["'](\.\/(?:assets|fonts|media|runtime)\/[^"']+)["']/g)) add(match[1]);
  for (const match of String(html || '').matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) add(match[1]);
  return urls;
}

export function isDeclaredPageResource(requestUrl, { html, pageUrl } = {}) {
  if (!requestUrl || !pageUrl) return false;
  let req;
  try {
    req = new URL(requestUrl, pageUrl);
  } catch {
    return false;
  }
  const declared = declaredPageUrls(html, pageUrl);
  if (declared.has(req.href)) return true;
  for (const href of declared) {
    try {
      if (new URL(href).pathname === req.pathname) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

export function auditDemoRefs(demoDir, { extraFiles = [] } = {}) {
  const problems = [];
  const seen = new Set();
  const queue = [join(demoDir, 'index.html'), ...extraFiles.map((file) => (file.startsWith(demoDir) ? file : join(demoDir, file)))];
  while (queue.length) {
    const abs = queue.pop();
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      problems.push(`缺资源 ${abs}`);
      continue;
    }
    if (!/\.(html|css|mjs|js)$/i.test(abs)) continue;
    const text = readFileSync(abs, 'utf8');
    const kind = /\.(mjs|js)$/i.test(abs) ? 'js' : (/\.css$/i.test(abs) ? 'css' : 'html');
    for (const url of collectRelativeRefs(text, { kind })) {
      const target = resolveRef(abs, url);
      if (!target) continue;
      if (!existsSync(target) || !statSync(target).isFile()) {
        problems.push(`缺资源 ${url}`);
        continue;
      }
      if (/\.(html|css|mjs|js)$/i.test(target)) queue.push(target);
    }
  }
  return { ok: problems.length === 0, problems };
}
