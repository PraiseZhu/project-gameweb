#!/usr/bin/env node
import { existsSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const args = process.argv.slice(2);
function argOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}
function has(flag) { return args.includes(flag); }
function finish(ok, payload, code = ok ? 0 : 2) {
  const out = { ok, ...payload };
  const text = JSON.stringify(out, null, 2);
  (ok ? console.log : console.error)(text);
  process.exit(code);
}

function normalizeFigmaUrl(input) {
  if (!input) return { ok: false, error: 'missing-figma-url' };
  let url;
  try { url = new URL(input); } catch {
    return { ok: false, error: 'invalid-url' };
  }
  if (!/figma\.com$/i.test(url.hostname) && !/\.figma\.com$/i.test(url.hostname)) {
    return { ok: false, error: 'not-figma-url', host: url.hostname };
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const fileKind = parts[0] || null;
  const fileKey = parts[1] || null;
  const nodeId = url.searchParams.get('node-id') || url.searchParams.get('node_id') || null;
  if (!['design', 'file'].includes(fileKind) || !fileKey) return { ok: false, error: 'missing-file-key' };
  if (!nodeId) return { ok: false, error: 'missing-node-id' };
  return {
    ok: true,
    fileKind,
    fileKey,
    nodeId,
    normalizedUrl: 'https://www.figma.com/' + fileKind + '/' + fileKey + '?node-id=' + encodeURIComponent(nodeId),
  };
}

const figmaUrl = argOf('--url') || argOf('--figma-url');
const tokenEnv = argOf('--token-env') || 'FIGMA_TOKEN';
const translation = argOf('--translation');
const multiLocale = has('--multi-locale') || has('--require-translation');
const normalized = normalizeFigmaUrl(figmaUrl);
const errors = [];
const warnings = [];
if (!normalized.ok) errors.push({ code: normalized.error, detail: normalized });

const tokenPresent = !!String(process.env[tokenEnv] || '').trim();
if (!tokenPresent) errors.push({ code: 'missing-token-env', env: tokenEnv });

let translationStatus = { status: 'not-supplied' };
if (translation) {
  const abs = resolve(translation);
  const ext = extname(abs).toLowerCase();
  if (!existsSync(abs)) {
    errors.push({ code: 'translation-not-found', path: translation });
    translationStatus = { status: 'missing', path: translation };
  } else if (!['.xlsx', '.csv', '.json'].includes(ext)) {
    errors.push({ code: 'translation-unsupported-format', path: translation, supported: ['.xlsx', '.csv', '.json'] });
    translationStatus = { status: 'unsupported', path: translation, ext };
  } else if (!statSync(abs).isFile()) {
    errors.push({ code: 'translation-not-file', path: translation });
    translationStatus = { status: 'not-file', path: translation };
  } else {
    translationStatus = { status: 'supplied', path: abs, format: ext.slice(1) };
  }
} else if (multiLocale) {
  errors.push({ code: 'translation-required-for-multi-locale' });
} else {
  warnings.push({ code: 'translation-missing-single-language-preview', message: 'Translation input is optional for a single-language first visible page preview.' });
}

warnings.push({
  code: 'figma-naming-v2.8-compatibility',
  standard: 'standards/figma-naming v2.8 / A-v1.6',
  compatibilityUntil: '2026-11-12',
  severity: 'warning',
  message: [
    'Current Skill may still encounter legacy txt/swpage names; treat them as compatibility warnings, not blockers.',
    'Do not implement naming behavior from this warning yet.',
    'Upstream policy: unprefixed TEXT is editable copy; TEXT named img/bg/kv is a visual asset/slice; txt is not a standard prefix; swpage is not required; switch direct children are future candidate pages under source-backed constraints; IMG/Sec/img-with-spaces are equivalent to canonical lowercase no-space forms; full-width slash/backslash are separator errors; unlabelled nodes must not be inferred as img/switch.',
    'Source owner tree and geometry remain authoritative for layout-plane claims.'
  ].join(' ')
});

finish(errors.length === 0, {
  command: 'figma:onboard',
  check: has('--check'),
  figma: normalized.ok ? normalized : null,
  token: { env: tokenEnv, present: tokenPresent, value: tokenPresent ? '<redacted>' : null },
  translation: translationStatus,
  warnings,
  errors,
}, errors.length === 0 ? 0 : 2);
