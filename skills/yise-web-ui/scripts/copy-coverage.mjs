#!/usr/bin/env node
// copy-coverage.mjs — 本地化/同字段多场景覆盖门。
// 用法：node scripts/copy-coverage.mjs --demo demos/<name> [--json]

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { assessCopyCoverage, collectFigmaTexts } from './lib/figma-copy-coverage.mjs';

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--demo') args.demo = process.argv[++i];
  else if (key === '--json') args.json = true;
  else fail(`未知参数：${key}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const readJson = (path, label) => {
  if (!existsSync(path)) fail(`缺 ${label}：${path}`);
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { fail(`${label} 不是合法 JSON：${error.message}`); }
};
const spec = readJson(join(demoDir, 'spec.json'), 'spec.json');
const snapshotFile = spec?.figma?.snapshotFile || 'figma-page.json';
const figmaSnapshot = readJson(join(demoDir, 'fixtures', snapshotFile), `Figma fixture ${snapshotFile}`);
const truth = readJson(join(demoDir, 'truth.json'), 'truth.json');
const report = readJson(join(demoDir, 'extract-report.json'), 'extract-report.json');
const larkFile = spec?.copy?.snapshotFile || 'lark-copy.json';
const larkPath = join(demoDir, 'fixtures', larkFile);
const larkSnapshot = existsSync(larkPath) ? readJson(larkPath, `copy fixture ${larkFile}`) : null;

const result = assessCopyCoverage({
  sourceTexts: collectFigmaTexts(figmaSnapshot), truth, report, larkSnapshot,
});
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`copy coverage：${result.status}；Figma TEXT ${result.sourceTextCount}，绑定 ${result.boundCount ?? 0}，unread ${result.unreadCount ?? 0}，contextual ${result.contextualCount ?? 0}`);
  if (result.note) console.log(`⚠️ ${result.note}`);
  for (const item of result.errors || []) console.log(`❌ ${item.kind}：${item.why}`);
  for (const item of result.warnings || []) console.log(`⚠️ ${item.kind}：${item.why}`);
}
process.exit(result.ok ? 0 : 1);
