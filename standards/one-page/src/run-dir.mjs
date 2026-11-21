import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { canonicalJson } from './canonical.mjs';
import { StoppedError } from './stopped.mjs';

export function formatRunDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function runDirName({ date, fileKey, nodeId, suffix }) {
  const key8 = String(fileKey).slice(0, 8);
  const node = String(nodeId).replace(/:/g, '-');
  return `${date}-${key8}-${node}-${suffix}`;
}

function defaultSuffix() {
  return randomBytes(4).toString('hex');
}

export function allocRunDir(runRoot, { date, fileKey, nodeId, suffix, makeSuffix } = {}) {
  const runsRoot = resolve(runRoot, 'runs');
  mkdirSync(runsRoot, { recursive: true });
  for (let i = 0; i < 8; i += 1) {
    const id = suffix ?? (makeSuffix ? makeSuffix() : defaultSuffix());
    const name = runDirName({ date, fileKey, nodeId, suffix: id });
    const dir = join(runsRoot, name);
    if (existsSync(dir)) {
      if (suffix) {
        throw new StoppedError('exists', '运行目录已存在。请重新跑第一步拿到新目录。');
      }
      continue;
    }
    mkdirSync(dir);
    return { dir, runId: name };
  }
  throw new StoppedError('exists', '无法分配唯一运行目录，请重试。');
}

export function resolveExistingRunDir(runRoot, { runDir, runId } = {}) {
  const hasDir = runDir != null && String(runDir) !== '' && runDir !== true;
  const hasId = runId != null && String(runId) !== '' && runId !== true;
  if (!hasDir && !hasId) {
    throw new StoppedError(
      'need-run-dir',
      '写记录必须带 --run-dir（第一步返回的目录）或 --run-id。未写入范围记录。',
    );
  }
  const runsRoot = resolve(runRoot, 'runs');
  const dir = hasDir ? resolve(String(runDir)) : join(runsRoot, String(runId));
  const prefix = `${runsRoot}${sep}`;
  if (dir !== runsRoot && !dir.startsWith(prefix)) {
    throw new StoppedError('need-run-dir', '运行目录必须在仓库 runs/ 下。');
  }
  if (!existsSync(dir)) {
    throw new StoppedError('need-run-dir', '运行目录不存在。请使用第一步返回的 --run-dir。');
  }
  return { dir, runId: basename(dir) };
}

export function nextStageRound(dir, stage) {
  const prefix = `stage-${stage}-`;
  const names = readdirSync(dir);
  return names.filter((name) => name.startsWith(prefix) && name.endsWith('.json')).length + 1;
}

export function nextScopeSerial(dir) {
  let max = 0;
  for (const name of readdirSync(dir)) {
    const match = /^scope\.v(\d+)\.json$/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function listScopePaths(dir) {
  return readdirSync(dir)
    .filter((name) => /^scope\.v\d+\.json$/.test(name))
    .map((name) => join(dir, name));
}

export function findScopeByVersion(dir, scopeVersion) {
  for (const filePath of listScopePaths(dir)) {
    try {
      const record = JSON.parse(readFileSync(filePath, 'utf8'));
      if (record.scopeVersion === scopeVersion) return filePath;
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

export function writeJsonFile(filePath, value) {
  if (existsSync(filePath)) {
    throw new StoppedError('exists', '记录文件已存在，未覆盖。');
  }
  writeFileSync(filePath, `${canonicalJson(value)}\n`, { encoding: 'utf8', flag: 'wx' });
}
