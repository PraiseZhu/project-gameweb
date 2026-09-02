/**
 * PNG → WebP via local Python/Pillow. Zero npm native deps.
 * Missing encoder is not fatal: callers keep the PNG and report it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'encode-webp.py');
const PYTHON_CANDIDATES = ['python', 'python3', 'py'];

export const WEBP_QUALITY = 90;

/** Dedup identical PNG sha before encoding. No pngjs. */
export function planWebpDelivery(manifest, { assetsDir, demoDir }) {
  const seen = new Map();
  const jobs = [];
  const aliases = [];
  for (const [id, rec] of Object.entries(manifest || {})) {
    if (!rec?.file) continue;
    const sha = rec.pngSha256 || rec.sha256;
    if (!sha) continue;
    if (seen.has(sha)) {
      aliases.push({ nodeId: id, duplicateOf: seen.get(sha) });
      continue;
    }
    seen.set(sha, id);
    const pngName = rec.pngFile || rec.file;
    const webpRel = String(pngName).replace(/\.png$/i, '.webp');
    jobs.push({
      nodeId: id,
      src: join(assetsDir || join(demoDir, 'assets'), String(pngName).replace(/^assets\//, '')),
      dest: join(demoDir, webpRel),
      webpRel,
    });
  }
  return { jobs, aliases };
}

function pythonCmd() {
  for (const bin of PYTHON_CANDIDATES) {
    const r = spawnSync(bin, ['-c', 'from PIL import Image'], {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    });
    if (r.status === 0) return bin;
  }
  return null;
}

export function detectWebpEncoder() {
  if (!existsSync(SCRIPT)) return { ok: false, why: `缺 ${SCRIPT}` };
  const bin = pythonCmd();
  if (!bin) return { ok: false, why: '本机没有 Python Pillow（python/python3/py + PIL）' };
  return { ok: true, bin, script: SCRIPT };
}

/**
 * @param {Array<{ src: string, dest: string, lossless?: boolean }>} jobs
 *   Omit lossless for slice-time default (alpha lossless, opaque lossy).
 *   Pass lossless:false to keep Pack lossy, including alpha sources.
 * @param {{ quality?: number }} [opts]
 */
const ENCODE_BATCH = 80;

function runEncodeJobs(encoder, jobs, quality) {
  const dir = mkdtempSync(join(tmpdir(), 'yise-webp-'));
  const jobsPath = join(dir, 'jobs.json');
  writeFileSync(jobsPath, JSON.stringify({ quality, jobs }, null, 0));
  const r = spawnSync(encoder.bin, [encoder.script, jobsPath], {
    encoding: 'utf8',
    timeout: 600000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (r.error) {
    return { ok: false, skipped: false, why: r.error.message, results: [], errors: jobs.map((j) => ({ src: j.src, dest: j.dest, error: r.error.message })) };
  }
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || '{}'); } catch {
    return { ok: false, skipped: false, why: `encode-webp.py 输出不是 JSON：${(r.stdout || r.stderr || '').slice(0, 200)}`, results: [], errors: [] };
  }
  return {
    ok: parsed.ok === true && r.status === 0,
    skipped: false,
    why: parsed.ok ? null : (parsed.errors?.[0]?.error || `exit ${r.status}`),
    results: parsed.results || [],
    errors: parsed.errors || [],
  };
}

export function encodeWebpBatch(jobs, { quality = WEBP_QUALITY } = {}) {
  const encoder = detectWebpEncoder();
  if (!encoder.ok) {
    return { ok: false, skipped: true, why: encoder.why, results: [], errors: jobs.map((j) => ({ src: j.src, dest: j.dest, error: encoder.why })) };
  }
  if (!jobs.length) return { ok: true, skipped: false, results: [], errors: [] };
  const results = [];
  const errors = [];
  for (let i = 0; i < jobs.length; i += ENCODE_BATCH) {
    const chunk = jobs.slice(i, i + ENCODE_BATCH);
    const encoded = runEncodeJobs(encoder, chunk, quality);
    results.push(...encoded.results);
    errors.push(...encoded.errors);
    if (!encoded.ok) {
      return { ok: false, skipped: false, why: encoded.why, results, errors };
    }
  }
  return { ok: true, skipped: false, why: null, results, errors };
}
