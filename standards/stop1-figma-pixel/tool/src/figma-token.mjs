/**
 * Read a Figma REST token for slice export / fetch.
 * Callers: stop1-figma-pixel-probe.mjs.
 * Schema: none.
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const FIGMA_TOKEN_KEYS = Object.freeze(['FIGMA_TOKEN', 'FIGMA_ACCESS_TOKEN']);

function unquote(value) {
  const text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1).trim();
  }
  return text;
}

function tokenFromEnv(env = process.env) {
  for (const key of FIGMA_TOKEN_KEYS) {
    const value = unquote(env[key]);
    if (value) return value;
  }
  return null;
}

function tokenFromDotenv(text) {
  const found = Object.create(null);
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    found[match[1]] = unquote(match[2]);
  }
  for (const key of FIGMA_TOKEN_KEYS) {
    if (found[key]) return found[key];
  }
  return null;
}

function tokenFromFile(file) {
  if (!existsSync(file)) return null;
  return tokenFromDotenv(readFileSync(file, 'utf8'));
}

export function readFigmaToken(startDir, env = process.env) {
  const fromEnv = tokenFromEnv(env);
  if (fromEnv) return fromEnv;
  let dir = resolve(startDir || process.cwd());
  for (let i = 0; i < 12; i += 1) {
    const token = tokenFromFile(join(dir, '.env'))
      || tokenFromFile(join(dir, 'standards/figma-naming/tool/.env'));
    if (token) return token;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function requireFigmaToken(startDir, env = process.env) {
  const token = readFigmaToken(startDir, env);
  if (token) return token;
  throw new Error('找不到 FIGMA_TOKEN / FIGMA_ACCESS_TOKEN（环境变量或祖先目录 .env）');
}
