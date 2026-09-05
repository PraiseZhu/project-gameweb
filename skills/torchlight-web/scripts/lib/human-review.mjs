import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HUMAN_REVIEW_STOPS } from './workflows.mjs';
import { inspectPackPath, packRoot } from './pack-demo.mjs';

export const HUMAN_REVIEW_SCHEMA = 'yise-human-review/v1';
export const HUMAN_REVIEW_FILE = 'human-review.json';

const STOP_IDS = HUMAN_REVIEW_STOPS.map((stop) => stop.id);

function emptyStop() {
  return { presented: false, previewOk: false, accepted: false, acceptedAt: null };
}

function emptyRecord() {
  return {
    schema: HUMAN_REVIEW_SCHEMA,
    stops: Object.fromEntries(STOP_IDS.map((id) => [id, emptyStop()])),
  };
}

export function humanReviewPath(demoDir) {
  return join(packRoot(demoDir), HUMAN_REVIEW_FILE);
}

function inspectHumanReviewFile(demoDir) {
  return inspectPackPath(packRoot(demoDir), humanReviewPath(demoDir));
}

export function readHumanReview(demoDir) {
  const inspected = inspectHumanReviewFile(demoDir);
  const file = inspected.path || humanReviewPath(demoDir);
  if (!inspected.ok) {
    return { ...emptyRecord(), missing: true, file, inspectError: inspected.error };
  }
  try {
    const parsed = JSON.parse(readFileSync(inspected.path, 'utf8'));
    const record = emptyRecord();
    if (parsed && typeof parsed === 'object') {
      for (const id of STOP_IDS) {
        const stop = parsed.stops?.[id] || {};
        record.stops[id] = {
          presented: stop.presented === true,
          previewOk: stop.previewOk === true,
          accepted: stop.accepted === true,
          acceptedAt: typeof stop.acceptedAt === 'string' ? stop.acceptedAt : null,
        };
      }
    }
    return { ...record, missing: false, file };
  } catch {
    return { ...emptyRecord(), missing: true, invalid: true, file };
  }
}

function writeHumanReview(demoDir, record) {
  const inspected = inspectHumanReviewFile(demoDir);
  const file = humanReviewPath(demoDir);
  if (inspected.ok === false && inspected.error && !/missing path/.test(inspected.error)) {
    throw new Error(inspected.error);
  }
  mkdirSync(dirname(file), { recursive: true });
  const payload = {
    schema: HUMAN_REVIEW_SCHEMA,
    stops: record.stops,
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  const written = inspectHumanReviewFile(demoDir);
  if (!written.ok) throw new Error(written.error || 'human-review.json is not a regular file inside the demo');
  return written.path;
}

export function presentStop(demoDir, id, { previewOk = false } = {}) {
  if (!STOP_IDS.includes(id)) return { ok: false, reason: `unknown-stop:${id}` };
  if (id === 'static-and-translation' && previewOk !== true) {
    return { ok: false, reason: 'preview:first-red', presentPage: false };
  }
  const record = readHumanReview(demoDir);
  if (id === 'static-and-translation') {
    /* Re-presenting stop 1 after a Main rebuild clears later-stop signatures. */
    record.stops['interaction-and-resize'] = emptyStop();
  }
  if (id === 'interaction-and-resize' && record.stops['static-and-translation'].accepted !== true) {
    return { ok: false, reason: 'first-stop-not-accepted', presentPage: false };
  }
  record.stops[id] = {
    ...record.stops[id],
    presented: true,
    previewOk: previewOk === true,
    accepted: false,
    acceptedAt: null,
  };
  try {
    const file = writeHumanReview(demoDir, record);
    const stop = HUMAN_REVIEW_STOPS.find((item) => item.id === id);
    return { ok: true, id, file, prompt: stop?.prompt, presentPage: true, record };
  } catch (error) {
    return { ok: false, reason: 'unsafe-human-review-file', error: error.message, presentPage: false };
  }
}

export function acceptStop(demoDir, id) {
  if (!STOP_IDS.includes(id)) return { ok: false, reason: `unknown-stop:${id}` };
  const record = readHumanReview(demoDir);
  const stop = record.stops[id];
  if (stop.presented !== true) return { ok: false, reason: 'stop-not-presented' };
  if (id === 'static-and-translation' && stop.previewOk !== true) {
    return { ok: false, reason: 'preview:first-red' };
  }
  if (id === 'interaction-and-resize' && record.stops['static-and-translation'].accepted !== true) {
    return { ok: false, reason: 'first-stop-not-accepted' };
  }
  record.stops[id] = {
    ...stop,
    accepted: true,
    acceptedAt: new Date().toISOString(),
  };
  try {
    const file = writeHumanReview(demoDir, record);
    return { ok: true, id, file, record };
  } catch (error) {
    return { ok: false, reason: 'unsafe-human-review-file', error: error.message };
  }
}

export function assertStopAccepted(demoDir, id) {
  if (!STOP_IDS.includes(id)) return { ok: false, reason: `unknown-stop:${id}` };
  const record = readHumanReview(demoDir);
  if (record.stops[id].accepted === true) return { ok: true, id, record };
  return { ok: false, reason: `${id}-not-accepted`, record };
}

export function canStartLaterAxis(demoDir) {
  const result = assertStopAccepted(demoDir, 'static-and-translation');
  if (result.ok) return { ok: true, next: 'Interaction / Resize' };
  return {
    ok: false,
    reason: 'first-stop-not-accepted',
    nextHumanStep: '静态（有翻译表才带翻译）还没人点头。不许开 Interaction / Resize。',
  };
}

export function packAllowedAfterSecondStop(demoDir) {
  const result = assertStopAccepted(demoDir, 'interaction-and-resize');
  if (result.ok) return { ok: true };
  return {
    ok: false,
    reason: 'second-stop-not-accepted',
    error: 'second human review stop not accepted; do not Pack',
  };
}
