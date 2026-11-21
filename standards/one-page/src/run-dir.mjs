import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson } from './canonical.mjs';

export function formatRunDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function runDirName({ date, fileKey, nodeId }) {
  const key8 = String(fileKey).slice(0, 8);
  const node = String(nodeId).replace(/:/g, '-');
  return `${date}-${key8}-${node}`;
}

export function resolveRunDir(runRoot, identity) {
  const dir = join(runRoot, 'runs', runDirName(identity));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function nextStageRound(dir, stage) {
  const prefix = `stage-${stage}-`;
  const names = readdirSync(dir);
  return names.filter((name) => name.startsWith(prefix) && name.endsWith('.json')).length + 1;
}

export function writeJsonFile(filePath, value) {
  writeFileSync(filePath, `${canonicalJson(value)}\n`, 'utf8');
}
