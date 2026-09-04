#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertStopAccepted,
  canStartLaterAxis,
  packAllowedAfterSecondStop,
  presentStop,
  readHumanReview,
} from './lib/human-review.mjs';

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function fail(error, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ok: false, error, ...extra }, null, 2)}\n`);
  process.exit(2);
}

function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const demo = argOf(argv, '--demo');
  if (!demo) fail('usage: node scripts/human-review.mjs <present|assert|status|can-start|pack-allowed> --demo <dir> [--stop <id>] [--preview-ok]');
  const demoDir = resolve(demo);
  const stop = argOf(argv, '--stop');
  const previewOk = argv.includes('--preview-ok');

  let result;
  try {
    if (cmd === 'present') fail('human-review present is locked; run npm run torchlightweb -- --handoff <dir> --demo <dir>');
    else if (cmd === 'accept') fail('human-review accept is locked; run npm run torchlightweb -- accept --demo <dir>');
    else if (cmd === 'assert') result = assertStopAccepted(demoDir, stop);
    else if (cmd === 'status') result = { ok: true, ...readHumanReview(demoDir) };
    else if (cmd === 'can-start') result = canStartLaterAxis(demoDir);
    else if (cmd === 'pack-allowed') result = packAllowedAfterSecondStop(demoDir);
    else fail(`unknown command: ${cmd}`);
  } catch (error) {
    fail(error && error.message ? error.message : String(error));
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result.ok ? 0 : 2);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isCli) main();
