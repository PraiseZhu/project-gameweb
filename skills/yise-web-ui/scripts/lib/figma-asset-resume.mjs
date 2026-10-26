/**
 * Resume a sliced asset only when the cached bytes still belong to this
 * source. Same node id is not enough: a later ready pack reuses that id.
 * Missing version, PNG sha, or export geometry fails closed (re-export).
 */
function finiteBox(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w);
  const h = Number(box.h);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

function sameBox(left, right) {
  const a = finiteBox(left);
  const b = finiteBox(right);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return ['x', 'y', 'w', 'h'].every((key) => Math.abs(a[key] - b[key]) <= 1e-6);
}

function sameScale(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9;
}

export function decideAssetResume({
  designVersion,
  previousVersion,
  record,
  pngSha256,
  webpSha256,
  geometry,
} = {}) {
  const reasons = [];
  if (designVersion == null || String(designVersion) === '') reasons.push('missing-design-version');
  if (previousVersion == null || String(previousVersion) === '' || String(previousVersion) !== String(designVersion)) {
    reasons.push('design-version-mismatch');
  }
  if (!record || typeof record !== 'object') reasons.push('missing-manifest-record');
  if (!pngSha256) reasons.push('missing-png-bytes');
  if (record && typeof record === 'object') {
    if (!record.pngSha256 || record.pngSha256 !== pngSha256) reasons.push('png-sha-mismatch');
    if (!geometry || record.designSize !== geometry.designSize) reasons.push('design-size-mismatch');
    if (!geometry || !sameScale(record.exportScale, geometry.exportScale)) reasons.push('export-scale-mismatch');
    if (!geometry || String(record.exportBounds || '') !== String(geometry.exportBounds || '')) reasons.push('export-bounds-mismatch');
    if (!geometry || !sameBox(record.exportBox, geometry.exportBox)) reasons.push('export-box-mismatch');
    if (!geometry || record.pixelSize !== geometry.pixelSize) reasons.push('pixel-size-mismatch');
  }
  const resumePng = reasons.length === 0;
  const resumeWebp = resumePng
    && !!record.webpFile
    && !!record.sha256
    && !!webpSha256
    && record.sha256 === webpSha256;
  return { resumePng, resumeWebp, reasons };
}


export function partialOnlyRefusal({ designVersion, previousVersion, hasManifest } = {}) {
  if (!hasManifest) return null;
  const currentMissing = designVersion == null || String(designVersion) === "";
  const previousMissing = previousVersion == null || String(previousVersion) === "";
  if (currentMissing || previousMissing) {
    return "--only refused: designVersion is missing; run a full export without --only";
  }
  if (String(previousVersion) !== String(designVersion)) {
    return "--only refused: designVersion changed; run a full export without --only";
  }
  return null;
}
