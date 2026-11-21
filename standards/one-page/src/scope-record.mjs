import { sha256Hex } from './canonical.mjs';

export function scopeContent({
  link,
  fileKey,
  nodeId,
  fileVersion,
  languages,
  baseLanguage,
  platform,
}) {
  return {
    link,
    fileKey,
    nodeId,
    fileVersion,
    languages,
    baseLanguage,
    platform,
  };
}

export function computeScopeVersion(fields) {
  return sha256Hex(scopeContent(fields));
}

export function computeRecordDigest(record) {
  if (!record || typeof record !== 'object') return '';
  const { recordDigest, ...rest } = record;
  return sha256Hex(rest);
}

export function buildScopeRecord(fields, { confirmQuote, confirmSource, confirmedAt }) {
  const content = scopeContent(fields);
  const record = {
    ...content,
    scopeVersion: sha256Hex(content),
    confirmedAt,
    confirmQuote,
    confirmSource,
  };
  return { ...record, recordDigest: sha256Hex(record) };
}

export function verifyScopeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { ok: false, reason: '范围记录不是对象' };
  }
  const expected = computeScopeVersion(record);
  if (record.scopeVersion !== expected) {
    return { ok: false, reason: '范围记录已被改动，版本号对不上' };
  }
  const digest = computeRecordDigest(record);
  if (record.recordDigest !== digest) {
    return { ok: false, reason: '范围记录确认信息已被改动' };
  }
  return { ok: true, version: expected, digest };
}
