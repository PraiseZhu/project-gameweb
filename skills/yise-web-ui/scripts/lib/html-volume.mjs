/**
 * HTML volume gate: index.html itself, not the assets folder.
 * Figma pages blow past 10MB when truth.json is inlined into #qa-truth.
 * Over the limit, rewrite the block to a same-directory pointer.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFAULT_MAX_HTML_BYTES = 10 * 1024 * 1024;
export const QA_TRUTH_RE = /<script([^>]*id=["']qa-truth["'][^>]*)>([\s\S]*?)<\/script>/i;

export function htmlBytesOf(indexPath) {
  if (!existsSync(indexPath)) return 0;
  return readFileSync(indexPath).length;
}

export function qaTruthOpeningAttrs(attrText) {
  const attrs = String(attrText || '');
  const cleaned = attrs
    .replace(/\sdata-src=(["']).*?\1/i, '')
    .replace(/\sdata-html-volume=["'][^"']*["']/i, '');
  return cleaned.trim();
}

/**
 * If index.html exceeds the HTML budget, empty #qa-truth and point it at truth.json.
 * Truth file on disk is the source of truth; this only changes how the page loads it.
 */
export function externalizeQaTruthIfOverLimit(demoDir, {
  limitBytes = DEFAULT_MAX_HTML_BYTES,
  truthFile = 'truth.json',
} = {}) {
  const indexPath = join(demoDir, indexName(demoDir));
  if (!existsSync(indexPath)) {
    return { ok: false, action: 'missing-index', bytes: 0, limitBytes };
  }
  const html = readFileSync(indexPath, 'utf8');
  const bytes = Buffer.byteLength(html);
  const m = html.match(QA_TRUTH_RE);
  if (!m) {
    return { ok: bytes <= limitBytes, action: 'no-qa-truth', bytes, limitBytes };
  }
  if (bytes <= limitBytes) {
    return { ok: true, action: 'inline', bytes, limitBytes };
  }
  const opening = qaTruthOpeningAttrs(m[1]);
  const block = `<script ${opening} data-src="${truthFile}" data-html-volume="external"></script>`;
  const next = html.replace(QA_TRUTH_RE, block);
  writeFileSync(indexPath, next);
  return {
    ok: Buffer.byteLength(next) <= limitBytes,
    action: 'externalized',
    bytesBefore: bytes,
    bytes: Buffer.byteLength(next),
    limitBytes,
    src: truthFile,
  };
}

function indexName() {
  return 'index.html';
}
