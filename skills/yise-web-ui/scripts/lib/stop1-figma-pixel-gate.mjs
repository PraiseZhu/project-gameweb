/**
 * Stop-1 Figma pixel gate: per-section screenshot of the existing demo
 * versus a Figma page-frame export cropped by consume.sections[].pageBox.
 * Fail-closed. Empty baselines are red, never skip. Does not call pixel-compare.mjs.
 *
 * Callers: figma-html-from-handoff attachStop1FigmaPixelGate; stop1-figma-pixel-probe.mjs.
 * Schema: stop1-figma-pixel-gate/v1.
 * User: 「把像素比对接到停1，给我看之前就跑」
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { compareImages, loadPngApi, readPng, writePng } from './png-compare.mjs';

export const STOP1_PIXEL_SCHEMA = 'stop1-figma-pixel-gate/v1';
export const STOP1_PIXEL_DIR = 'artifacts/stop1-pixel';
export const DEFAULT_STOP1_PIXEL_THRESHOLD = 0.005;
export const PIXEL_YIQ_THRESHOLD = 0.1;
export const DEFAULT_STOP1_PIXEL_SCALE = 0.5;
export const FIGMA_AREA_LIMIT_PX = 32_000_000;

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function geom(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w ?? box.width);
  const h = Number(box.h ?? box.height);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

export function safeSecId(secId) {
  return String(secId || 'unknown').replace(/[/:]/g, '-');
}

export function artifactRel(platform, secId, kind) {
  return `${STOP1_PIXEL_DIR}/${platform}.${safeSecId(secId)}.${kind}.png`;
}

export function loadHandoffConsume(handoffDir) {
  const file = join(handoffDir, 'manifest.json');
  if (!existsSync(file)) throw new Error(`handoff manifest missing: ${file}`);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const consume = manifest?.consume || manifest;
  if (!consume || typeof consume !== 'object') throw new Error('handoff consume missing');
  return { manifest, consume, fileKey: manifest?.fileKey || consume?.fileKey || null };
}

export function platformsOfConsume(consume) {
  const ends = asArray(consume?.ends).filter((end) => end === 'pc' || end === 'mobile');
  if (ends.length) return ends;
  const keys = ['pc', 'mobile'].filter((key) => consume?.[key]);
  return keys.length ? keys : ['pc'];
}

export function sectionsOfConsume(consume, platform) {
  const end = consume?.[platform] || {};
  const sections = asArray(end.sections).filter((entry) => entry && entry.id);
  if (!sections.length) {
    throw new Error(`${platform}: handoff consume has no sections`);
  }
  return sections.map((entry) => ({
    id: String(entry.id),
    pageBox: geom(entry.pageBox || entry.box),
  }));
}

export function pageBoxOfConsume(consume, platform) {
  const end = consume?.[platform] || {};
  const box = geom(end.page?.pageBox || end.page?.box);
  if (!box || !(box.w > 0) || !(box.h > 0)) {
    throw new Error(`${platform}: consume page.pageBox missing`);
  }
  return { ...box, id: String(end.page?.id || end.requestedNodeId || '') };
}

export function pickExportScale(pageBox) {
  const box = geom(pageBox);
  if (!box) throw new Error('pageBox missing for scale');
  const area = box.w * box.h;
  if (!(area > 0)) throw new Error('pageBox area invalid');
  /* Never 2×. Real pages (3840×6429) empirically flatten at 1× even when the
     advertised area cap is not hit; stop-1 uses 0.5 for those frames. */
  const halfArea = area * DEFAULT_STOP1_PIXEL_SCALE * DEFAULT_STOP1_PIXEL_SCALE;
  if (area <= FIGMA_AREA_LIMIT_PX / 4) return 1;
  if (halfArea <= FIGMA_AREA_LIMIT_PX) return DEFAULT_STOP1_PIXEL_SCALE;
  const scale = Math.sqrt(FIGMA_AREA_LIMIT_PX / area) * 0.99;
  if (!(scale > 0)) throw new Error('cannot pick export scale under Figma area cap');
  return scale;
}

export function cropRectForSection(pageBox, sectionBox, scale) {
  const page = geom(pageBox);
  const section = geom(sectionBox);
  if (!page) throw new Error('frame pageBox missing');
  if (!section) throw new Error('section pageBox missing');
  const s = Number(scale);
  if (!(s > 0)) throw new Error(`invalid scale ${scale}`);
  const x = (section.x - page.x) * s;
  const y = (section.y - page.y) * s;
  const w = section.w * s;
  const h = section.h * s;
  if (Math.abs(x - Math.round(x)) > 1e-6 || Math.abs(y - Math.round(y)) > 1e-6) {
    throw new Error(`crop origin not integer (x=${x}, y=${y}) at scale=${s}`);
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function cropPng(PNG, png, crop) {
  const { x, y, w, h } = crop;
  if (x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > png.width || y + h > png.height) {
    throw new Error(`crop [${x},${y} ${w}×${h}] outside export ${png.width}×${png.height}`);
  }
  const out = new PNG({ width: w, height: h });
  for (let row = 0; row < h; row += 1) {
    const srcStart = ((y + row) * png.width + x) * 4;
    png.data.copy(out.data, row * w * 4, srcStart, srcStart + w * 4);
  }
  return out;
}

export function scalePng(PNG, png, width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!(w > 0) || !(h > 0)) throw new Error(`invalid scale target ${width}×${height}`);
  if (png.width === w && png.height === h) return png;
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y += 1) {
    const srcY = Math.min(png.height - 1, Math.floor((y * png.height) / h));
    for (let x = 0; x < w; x += 1) {
      const srcX = Math.min(png.width - 1, Math.floor((x * png.width) / w));
      const si = (srcY * png.width + srcX) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = png.data[si];
      out.data[di + 1] = png.data[si + 1];
      out.data[di + 2] = png.data[si + 2];
      out.data[di + 3] = png.data[si + 3];
    }
  }
  return out;
}

export function assertExportNotFlattened({ png, frameBox, scale }) {
  const box = geom(frameBox);
  if (!box) throw new Error('frame pageBox missing for flatten check');
  const expW = Math.round(box.w * scale);
  const expH = Math.round(box.h * scale);
  if (Math.abs(png.width - expW) > 1 || Math.abs(png.height - expH) > 1) {
    throw new Error(
      `export ${png.width}×${png.height} ≠ expected ${expW}×${expH} (frame ${box.w}×${box.h} × scale ${scale}) — flattened Figma export refused`,
    );
  }
}

function rawOf(PNG, value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value.data && Number.isFinite(value.width)) return PNG.sync.write(value);
  return Buffer.from(value);
}

export async function compareSectionPngs({
  PNG,
  pixelmatch,
  odiff,
  baselineRaw,
  actualRaw,
  threshold = DEFAULT_STOP1_PIXEL_THRESHOLD,
  demoDir,
  platform,
  secId,
}) {
  const problems = [];
  const artifacts = {};
  const outRoot = demoDir || '';
  const writeArtifact = (kind, buf) => {
    if (!outRoot || !buf) return;
    const rel = artifactRel(platform, secId, kind);
    mkdirSync(join(outRoot, STOP1_PIXEL_DIR), { recursive: true });
    writeFileSync(join(outRoot, rel), buf);
    artifacts[kind] = rel;
  };

  if (!baselineRaw || !actualRaw) {
    if (baselineRaw) writeArtifact('baseline', rawOf(PNG, baselineRaw));
    if (actualRaw) writeArtifact('demo', rawOf(PNG, actualRaw));
    return {
      ok: false,
      status: 'MISSING',
      problems: [`${platform} ${secId}: missing baseline or demo PNG`],
      artifacts,
    };
  }

  const baselineBuf = rawOf(PNG, baselineRaw);
  const actualBuf = rawOf(PNG, actualRaw);
  const baseline = readPng(PNG, baselineBuf);
  const actual = readPng(PNG, actualBuf);
  writeArtifact('baseline', baselineBuf);
  writeArtifact('demo', actualBuf);

  if (baseline.width !== actual.width || baseline.height !== actual.height) {
    return {
      ok: false,
      status: 'ERROR',
      problems: [`${platform} ${secId}: size mismatch ${baseline.width}x${baseline.height} vs ${actual.width}x${actual.height}`],
      artifacts,
    };
  }

  const compared = await compareImages({
    PNG,
    pixelmatch,
    odiff,
    baseline,
    actual,
    baselineRaw: baselineBuf,
    actualRaw: actualBuf,
    cssSize: { width: baseline.width, height: baseline.height },
    threshold: PIXEL_YIQ_THRESHOLD,
    masks: [],
  });
  if (compared.status !== 'OK') {
    return {
      ok: false,
      status: 'ERROR',
      problems: [`${platform} ${secId}: ${compared.detail || 'compare failed'}`],
      artifacts,
    };
  }
  const diffRatio = compared.total ? compared.bad / compared.total : 1;
  const ok = diffRatio <= threshold;
  writePng(PNG, join(outRoot, artifactRel(platform, secId, 'diff')), compared.diff);
  artifacts.diff = artifactRel(platform, secId, 'diff');
  if (!ok) {
    problems.push(
      `${platform} ${secId}: diffRatio ${(diffRatio * 100).toFixed(2)}% > ${(threshold * 100).toFixed(2)}% (${artifacts.diff})`,
    );
  }
  return {
    ok,
    status: ok ? 'PASS' : 'FAIL',
    diffRatio,
    threshold,
    bad: compared.bad,
    total: compared.total,
    problems,
    artifacts,
  };
}

export function failClosedSkipPreviewProbe() {
  return () => {
    throw new Error('stop1-figma-pixel-gate required; refusing to mark green from skipPreview / JSON-only truth');
  };
}

function parseProbeJson(text) {
  const raw = String(text || '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function defaultLiveProbe(demoDir, handoffDir) {
  return () => {
    const probe = join(SKILL_ROOT, 'scripts/lib/stop1-figma-pixel-probe.mjs');
    if (!existsSync(probe)) {
      throw new Error('stop1-figma-pixel-probe.mjs missing; cannot mark green without Figma pixel probe');
    }
    if (!existsSync(join(demoDir, 'index.html'))) {
      throw new Error('demo index.html missing; cannot screenshot existing page');
    }
    const res = spawnSync(process.execPath, [probe, '--demo', demoDir, '--handoff', handoffDir], {
      cwd: SKILL_ROOT,
      encoding: 'utf8',
      env: process.env,
      timeout: 900000,
    });
    const parsed = parseProbeJson(res.stdout);
    if (!parsed) {
      const output = `${res.stdout || ''}\n${res.stderr || ''}`.trim();
      throw new Error(output || `stop1-figma-pixel-probe failed (${res.status})`);
    }
    if (res.status !== 0 && parsed.ok === true) {
      parsed.ok = false;
      parsed.problems = [...asArray(parsed.problems), `probe exit ${res.status}`];
    }
    return parsed;
  };
}

function pixelGatePayload({ ok, threshold, problems, platforms, artifactsDir }) {
  return {
    schema: STOP1_PIXEL_SCHEMA,
    ok,
    skipped: false,
    threshold,
    problems,
    platforms,
    artifactsDir,
  };
}

export function runStop1FigmaPixelGate({
  handoffDir,
  demoDir,
  skipPreview = false,
  pixelGateProbe = null,
} = {}) {
  const artifactsDir = join(demoDir || '', STOP1_PIXEL_DIR);
  const probe = pixelGateProbe || (skipPreview
    ? failClosedSkipPreviewProbe()
    : defaultLiveProbe(demoDir, handoffDir));
  try {
    const result = probe();
    if (result && typeof result.then === 'function') {
      throw new Error('stop1-figma-pixel-gate probe must be synchronous');
    }
    const ok = result?.ok === true;
    return pixelGatePayload({
      ok,
      threshold: result?.threshold ?? DEFAULT_STOP1_PIXEL_THRESHOLD,
      problems: ok
        ? []
        : (asArray(result?.problems).length ? asArray(result.problems) : ['stop1-figma-pixel-gate red']),
      platforms: result?.platforms || null,
      artifactsDir: result?.artifactsDir || artifactsDir,
    });
  } catch (err) {
    return pixelGatePayload({
      ok: false,
      threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
      problems: [`stop1-figma-pixel-gate failed: ${err && err.message ? err.message : String(err)}`],
      platforms: null,
      artifactsDir,
    });
  }
}

export { loadPngApi, readPng, writePng };
