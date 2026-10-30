/**
 * EWS consume-only gate. Reuses loadReadyPack + consumeReadyPack.
 * Does not write HTML or assets.
 */
import { resolve } from 'node:path';
import { loadReadyPack } from './handoff-contract.mjs';
import { consumeReadyPack } from './ready-consumer.mjs';

const ENDS = ['pc', 'mobile'];

export function unknownEvidence(consumed, end) {
  if (!consumed?.ends?.includes(end)) return null;
  const tree = consumed.pageTree?.[end] || [];
  const unknownNodes = tree.filter((node) => node.status === 'unknown');
  const listed = (consumed.unknown || []).filter((node) => node.platform === end);
  const wiredFromTree = unknownNodes
    .filter((node) => node.interaction !== 'draw-only')
    .map((node) => node.id);
  const wiredFromList = listed
    .filter((node) => node.wired === true || node.interaction === 'eligible')
    .map((node) => node.id);
  const wiredUnknownIds = [...new Set([...wiredFromTree, ...wiredFromList])];
  return {
    unknownNotWired: wiredUnknownIds.length === 0,
    unknownCount: unknownNodes.length,
    wiredUnknownIds,
  };
}

export function runFromHandoff(dir, { cwd = process.cwd() } = {}) {
  const emptyConsume = { pc: null, mobile: null };
  if (!dir) {
    return {
      ok: false,
      kind: null,
      ready: false,
      fingerprint: null,
      ends: [],
      consume: emptyConsume,
      problems: ['缺少交接包目录'],
    };
  }
  const pack = loadReadyPack(resolve(cwd, dir));
  if (!pack.ok) {
    return {
      ok: false,
      kind: null,
      ready: false,
      fingerprint: pack.fingerprint ?? null,
      ends: pack.ends ?? [],
      consume: emptyConsume,
      problems: pack.problems ?? ['ready pack is not ok'],
    };
  }
  const consumed = consumeReadyPack(pack);
  const consume = {
    pc: unknownEvidence(consumed, 'pc'),
    mobile: unknownEvidence(consumed, 'mobile'),
  };
  const problems = [...(consumed.problems || [])];
  for (const end of ENDS) {
    const row = consume[end];
    if (row && row.unknownNotWired !== true) {
      problems.push(`${end} unknown 被接线：${row.wiredUnknownIds.join(', ') || '(无 id)'}`);
    }
  }
  const packedOk = pack.ends.every((end) => consume[end]?.unknownNotWired === true);
  const ok = consumed.ok === true && problems.length === 0 && packedOk;
  return {
    ok,
    kind: ok ? 'ready' : null,
    ready: ok,
    fingerprint: pack.fingerprint,
    ends: pack.ends,
    consume,
    problems,
  };
}
