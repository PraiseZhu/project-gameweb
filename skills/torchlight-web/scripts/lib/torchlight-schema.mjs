/**
 * Torchlight artifact schema names.
 * New writes use torchlight-* /v1. Readers still accept the copied yise-* names
 * from older local artifacts. This module is torchlight-only; do not copy it
 * into yise-web-ui.
 */
export function torchlightSchema(name) {
  const value = String(name || '');
  if (!value.startsWith('torchlight-') || !value.endsWith('/v1')) {
    throw new Error(`torchlight schema 必须是 torchlight-*/v1，收到: ${name}`);
  }
  return value;
}

export function legacyYiseSchema(current) {
  const value = torchlightSchema(current);
  return `yise-${value.slice('torchlight-'.length)}`;
}

export function matchesSchema(actual, current) {
  return actual === current || actual === legacyYiseSchema(current);
}
