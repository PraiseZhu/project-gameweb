/**
 * Demo runtime cache identity. Figma fingerprint is a snapshot hash and
 * stays still across Skill-only rebuilds, so it is not an HTTP cache key.
 * Identity is SHA-256 of every file in assets/runtime (name + bytes).
 * Published copies rewrite relative module specifiers to ?v=<identity>.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IMPORT_RE = /((?:from|import)\s*\(?\s*['"])(\.\/[^'"]+\.(?:mjs|css|json))(\?[^'"]*)?(['"])/g;

export function listRuntimeFiles(dir) {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile())
    .sort();
}

export function runtimeIdentityFromDir(dir) {
  const hash = createHash('sha256');
  for (const name of listRuntimeFiles(dir)) {
    hash.update(name);
    hash.update('\0');
    hash.update(readFileSync(join(dir, name)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

export function stampRuntimeModuleSource(source, identity) {
  const v = encodeURIComponent(String(identity));
  return String(source).replace(IMPORT_RE, (_, pre, spec, _old, quote) => `${pre}${spec}?v=${v}${quote}`);
}

export function publishRuntimeDir(srcDir, destDir, identity) {
  const id = String(identity);
  for (const name of listRuntimeFiles(srcDir)) {
    const raw = readFileSync(join(srcDir, name));
    if (/\.(mjs|js|css)$/i.test(name)) {
      writeFileSync(join(destDir, name), stampRuntimeModuleSource(raw.toString('utf8'), id));
    } else {
      writeFileSync(join(destDir, name), raw);
    }
  }
  return id;
}
