#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skills = ['yise-web-ui', 'torchlight-web'];

export function buildSuites(value = 'chromium') {
  const engines = value.split(',');
  if (!engines.length || new Set(engines).size !== engines.length
    || engines.some(engine => !['chromium', 'firefox', 'webkit'].includes(engine))) {
    throw new Error('CONTENT_PROTECTION_ENGINES 必须是 chromium/firefox/webkit 的无重复逗号列表');
  }
  return skills.flatMap(skill => [
    { file: 'skills/' + skill + '/scripts/__tests__/content-protection-contract.test.mjs', minimum: 1 },
    { file: 'skills/' + skill + '/scripts/__tests__/content-protection-browser.test.mjs', minimum: 9 },
    ...engines.map(engine => ({ file: 'skills/' + skill + '/scripts/__tests__/content-protection-boundaries.test.mjs', minimum: 12, engine })),
  ]);
}

export function assessResult(result, minimum) {
  if (result.error || result.signal || result.status !== 0) return '测试进程失败、超时或被中断';
  const output = result.stdout || '';
  const counts = {};
  for (const name of ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo']) {
    const matches = [...output.matchAll(new RegExp('^# ' + name + ' ([0-9]+)$', 'gm'))];
    if (matches.length !== 1) return 'TAP 摘要缺失或重复：' + name;
    counts[name] = Number(matches[0][1]);
  }
  if (counts.tests < minimum || counts.pass !== counts.tests) return '测试数量不足或有未通过用例';
  if (['fail', 'skipped', 'cancelled', 'todo'].some(name => counts[name] !== 0)) return '存在失败、跳过、取消或待办用例';
  if (/^\s*not ok /m.test(output)) return '报告包含失败用例';
  return null;
}

export function main() {
  let failed = false;
  const suites = buildSuites(process.env.CONTENT_PROTECTION_ENGINES ?? 'chromium');
  const evidenceRoot = resolve(root, '_tmp/content-protection');
  // Chromium's Linux SingletonSocket is limited to 108 bytes. Keep CI's
  // temporary root configurable so a deep GitHub workspace path cannot make
  // the browser abort before any test starts. Local runs retain the evidence
  // directory default; CI sets a short workspace-local path.
  const tempRoot = resolve(process.env.CONTENT_PROTECTION_TMPDIR || resolve(evidenceRoot, 'tmp'));
  mkdirSync(tempRoot, { recursive: true });
  const generated = mkdtempSync(resolve(evidenceRoot, 'generated-'));
  const env = { ...process.env, CONTENT_PROTECTION_REQUIRED: '1',
    CONTENT_PROTECTION_GENERATED_DIR: generated, TMPDIR: tempRoot };
  console.log('evidence_generated_at=' + new Date().toISOString());
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  console.log('base_commit=' + (head.stdout || '').trim());
  for (const file of new Set(['.github/scripts/content-protection-gate.mjs', '.github/scripts/content-protection-artifact-gate.mjs',
    '.github/workflows/content-protection.yml', ...suites.map(s => s.file),
    ...skills.flatMap(skill => [
      'figma-render.js', 'figma-chrome.js', 'qa-chrome.js', 'qa-component-adapter.js',
      'demo-shell.html', 'component-shell.html',
    ].map(name => 'skills/' + skill + '/templates/' + name))])) {
    console.log('source_sha256=' + createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex') + ' ' + file);
  }
  for (const skill of skills) {
    const result = spawnSync(process.execPath, ['skills/' + skill + '/scripts/init.mjs', '--dir', resolve(generated, skill), '--name', 'protection-ci', '--mode', 'classic'], { cwd: root, encoding: 'utf8', timeout: 30000, env });
    if (result.status !== 0 || result.error || result.signal) {
      console.error('生成 HTML 失败：' + skill + '\n' + result.stderr);
      return 1;
    }
  }
  const artifact = spawnSync(process.execPath, ['.github/scripts/content-protection-artifact-gate.mjs', generated], { cwd: root, encoding: 'utf8', timeout: 30000, env });
  process.stdout.write(artifact.stdout || '');
  process.stderr.write(artifact.stderr || '');
  if (artifact.status !== 0 || artifact.error || artifact.signal) return 1;
  for (const suite of suites) {
    console.log('检查 ' + suite.file + (suite.engine ? ' engine=' + suite.engine : ''));
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', suite.file], {
      cwd: root, encoding: 'utf8', timeout: 150000, maxBuffer: 8 * 1024 * 1024,
      env: { ...env, CONTENT_PROTECTION_ENGINE: suite.engine || 'chromium' },
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    const problem = assessResult(result, suite.minimum);
    if (problem) {
      failed = true;
      console.error(suite.file + ': ' + problem + (result.error ? ': ' + result.error.message : ''));
    }
  }
  if (failed) {
    console.error('内容保护闸门未通过。浏览器缺失或用例未完整执行不能算通过。');
    return 1;
  }
  console.log('gate_exit_code=0');
  console.log('内容保护闸门通过：双项目 × 产品/QA × 390/1440 × 静态/交互，边界引擎=' + (process.env.CONTENT_PROTECTION_ENGINES ?? 'chromium') + '；零跳过。');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
