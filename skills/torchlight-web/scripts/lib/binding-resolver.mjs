import { isPlainObject } from './fs-utils.mjs';
import { normalizeHash, truthAt } from './schema.mjs';

const SHA256_RE = /^[0-9a-f]{64}$/i;

function requireSha256(value, label) {
  const normalized = normalizeHash(value);
  if (!SHA256_RE.test(normalized)) {
    throw new Error(`${label} must be a sha256 hex string`);
  }
  return normalized.toLowerCase();
}

export function resolveAssetShaTruth(truth, path) {
  const raw = truthAt(truth, path);
  if (raw === undefined) {
    throw new Error(`asset-sha truth path missing: ${path}`);
  }
  if (typeof raw === 'string') {
    return requireSha256(raw, `asset-sha truth ${path}`);
  }
  if (isPlainObject(raw)) {
    if (Object.hasOwn(raw, 'sha256')) {
      return requireSha256(raw.sha256, `asset-sha truth ${path}.sha256`);
    }
    if (Object.hasOwn(raw, 'hash')) {
      return requireSha256(raw.hash, `asset-sha truth ${path}.hash`);
    }
  }
  throw new Error(`asset-sha truth ${path} must be a sha256 string or manifest record with own sha256/hash`);
}

// Gate D length bindings compare design/CSS px as authored by default. Only
// explicit scaled:true opts into multiplying by the current renderer scale.
export function designPxScaleFactor({ scaled = false, scale = 1 } = {}) {
  if (!scaled) return 1;
  const n = Number(scale);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`scaled design-px requires finite positive __qa.scale(): ${scale}`);
  }
  return n;
}

export function expectedDesignPx(cssPx, { scaled = false, scale = 1 } = {}) {
  const n = Number(cssPx);
  if (!Number.isFinite(n)) throw new Error(`design-px must be finite: ${cssPx}`);
  return n * designPxScaleFactor({ scaled, scale });
}
