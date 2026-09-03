import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderPrGateSummary, main, redact } from './pr-gate-summary.mjs';

const SCRIPT = fileURLToPath(new URL('./pr-gate-summary.mjs', import.meta.url));
const HEALTH = fileURLToPath(new URL('./nightly-health.mjs', import.meta.url));

const DIE_EXCLUDE = '夜间健康检查失败 2 项:\n- skills/yise-web-ui: test-public --list 排除项不合法 # exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page\n- skills/yise-web-ui: test-public --list 排除项不合法 # exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page';
const DIE_ROOT = '进仓内容无法夜间检查:\n- 仓库根有 package.json，必须放进 skills/<name>/ 或 standards/<name>/';
const DIE_FAKE_TEST = '夜间健康检查失败 1 项:\n- skills/demo: 进仓必须有可核验的 npm test，echo/true/exit 0/伪造摘要不算';
const DIE_MISSING_LIST = '夜间健康检查失败 1 项:\n- skills/omit: test-public --list 漏了包内公开测试: test/bad.test.mjs';
const DIE_NPM_CI = '夜间健康检查失败 1 项:\n- skills/yise-web-ui npm ci: 退出码 1';
const DIE_TAP = '夜间健康检查失败 1 项:\n- skills/yise-web-ui: TAP 失败 3 / 退出码 1';
const DIE_UNKNOWN = '夜间健康检查失败 1 项:\n- standards/figma-naming/tool npm run fonts:check: 退出码 1';
const SECRET_LOG = '夜间健康检查失败 1 项:\n- token=example-secret-value-not-a-key leaked from /Users/someone/secret.env';
const REAL_HEALTH_LOG = [
  '将检查 2 个包:',
  '- [skill] skills/yise-web-ui  →  缺可核验的 npm test + release:audit',
  '- [standard] standards/figma-naming/tool  →  npm test + file proof + release:audit',
  '进仓内容无法夜间检查:',
  '- skills/yise-web-ui: test-public --list 排除项不合法 # exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page',
  '夜间健康检查失败 2 项:',
  '- skills/yise-web-ui: test-public --list 排除项不合法 # exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page',
  '- skills/yise-web-ui: test-public --list 排除项不合法 # exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page',
].join('\n');
const YAML = fileURLToPath(new URL('../workflows/pr-gate.yml', import.meta.url));

test('health source still contains the mapped die() substrings', () => {
  const src = readFileSync(HEALTH, 'utf8');
  assert.match(src, /排除项不合法/);
  assert.match(src, /仓库根有/);
  assert.match(src, /进仓必须有可核验的 npm test/);
  assert.match(src, /漏了包内公开测试/);
  assert.match(src, /npm ci/);
});

test('real health.log progress lines are not treated as failures', () => {
  const md = renderPrGateSummary({ logText: REAL_HEALTH_LOG, exitCode: 2 });
  assert.match(md, /排除名单不合法|排除项不合法/);
  assert.match(md, /comp-paint-order/);
  assert.match(md, /夜间检查会继续红|公开套件和磁盘对不上/);
  assert.doesNotMatch(md, /\[skill\]/);
  assert.doesNotMatch(md, /脚本是 echo/);
  assert.doesNotMatch(md, /尚未写成固定人话/);
  assert.doesNotMatch(md, /## PR 审核通过/);
});

test('workflow job stays red when the summary step fails', () => {
  const yml = readFileSync(YAML, 'utf8');
  assert.match(yml, /id: summary/);
  assert.match(yml, /steps\.summary\.outcome/);
  assert.match(yml, /闸不能假绿/);
  assert.match(yml, /continue-on-error: true/);
});

test('failed health.log is uploaded and summarized, not only redirected', () => {
  const yml = readFileSync(YAML, 'utf8');
  assert.match(yml, /node \.github\/scripts\/nightly-health\.mjs > health\.log 2>&1/);
  assert.match(yml, /Keep health\.log visible on failure/);
  assert.match(yml, /Upload health\.log/);
  assert.match(yml, /name: pr-gate-health-log/);
  assert.match(yml, /path: health\.log/);
});

test('#49 exclude-illegal golden uses real die() wrapper and three fields', () => {
  const md = renderPrGateSummary({ logText: DIE_EXCLUDE, exitCode: 2 });
  assert.match(md, /## PR 审核未通过/);
  assert.match(md, /\*\*错误：\*\*/);
  assert.match(md, /\*\*问题：\*\*/);
  assert.match(md, /\*\*导致：\*\*/);
  assert.match(md, /排除名单不合法|排除项不合法/);
  assert.match(md, /comp-paint-order/);
  assert.match(md, /夜间检查会继续红|公开套件和磁盘对不上/);
  assert.doesNotMatch(md, /## PR 审核通过/);
});

test('root package.json placement maps to not-in-inventory consequence', () => {
  const md = renderPrGateSummary({ logText: DIE_ROOT, exitCode: 2 });
  assert.match(md, /仓库根有 package\.json/);
  assert.match(md, /夜间扫不到这个包/);
});

test('fake npm test maps to unverifiable tests', () => {
  const md = renderPrGateSummary({ logText: DIE_FAKE_TEST, exitCode: 2 });
  assert.match(md, /进仓必须有可核验的 npm test/);
  assert.match(md, /实际什么都没验/);
});

test('missing listed tests maps to hidden failures', () => {
  const md = renderPrGateSummary({ logText: DIE_MISSING_LIST, exitCode: 2 });
  assert.match(md, /漏了包内公开测试/);
  assert.match(md, /藏起来不跑/);
});

test('npm ci failure has dedicated copy', () => {
  const md = renderPrGateSummary({ logText: DIE_NPM_CI, exitCode: 1 });
  assert.match(md, /npm ci: 退出码/);
  assert.match(md, /装不上依赖/);
  assert.match(md, /夜间检查也会红/);
});

test('TAP failure maps to bringing red tests onto main', () => {
  const md = renderPrGateSummary({ logText: DIE_TAP, exitCode: 2 });
  assert.match(md, /TAP 失败/);
  assert.match(md, /红测试带上主干/);
});

test('unknown failure still has three fields and does not claim pass', () => {
  const md = renderPrGateSummary({ logText: DIE_UNKNOWN, exitCode: 2 });
  assert.match(md, /\*\*错误：\*\*/);
  assert.match(md, /尚未写成固定人话/);
  assert.match(md, /主干健不健康说不清/);
  assert.doesNotMatch(md, /## PR 审核通过/);
});

test('exit 0 writes pass title only', () => {
  const md = renderPrGateSummary({ logText: DIE_EXCLUDE, exitCode: 0 });
  assert.match(md, /## PR 审核通过/);
  assert.match(md, /本单通过|可以合进/);
  assert.doesNotMatch(md, /未通过/);
});

test('missing log + non-zero cannot write pass', () => {
  const md = renderPrGateSummary({ exitCode: 2, logMissing: true });
  assert.match(md, /读不到失败原文/);
  assert.doesNotMatch(md, /## PR 审核通过/);
});

test('empty log + non-zero cannot write pass', () => {
  const md = renderPrGateSummary({ logText: '   \n', exitCode: 2 });
  assert.match(md, /读不到失败原文/);
  assert.doesNotMatch(md, /## PR 审核通过/);
});

test('secret-looking lines are redacted and not dumped whole TAP-style', () => {
  const md = renderPrGateSummary({ logText: SECRET_LOG, exitCode: 2 });
  assert.doesNotMatch(md, /example-secret-value-not-a-key/);
  assert.doesNotMatch(md, /\/Users\/someone/);
  assert.match(md, /\[redacted\]|\[path\]/);
  assert.match(md, /\*\*错误：\*\*/);
});

test('redact helper strips token assignment', () => {
  assert.equal(redact('token=example-secret-value-not-a-key'), '[redacted]');
});

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'pr-gate-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('CLI and exported renderer refuse pass when log file is missing', () => {
  withTempDir((dir) => {
    const summary = join(dir, 'summary.md');
    const md = main(['--log', join(dir, 'no-such.log'), '--exit-code', '2', '--summary', summary]);
    assert.match(md, /读不到失败原文/);
    assert.doesNotMatch(md, /## PR 审核通过/);
    assert.match(readFileSync(summary, 'utf8'), /读不到失败原文/);
  });
});

test('CLI missing --log is fail-closed for non-zero exit', () => {
  withTempDir((dir) => {
    const summary = join(dir, 'summary.md');
    const md = main(['--exit-code', '2', '--summary', summary]);
    assert.match(md, /读不到失败原文/);
    assert.doesNotMatch(md, /## PR 审核通过/);
  });
});

test('CLI missing summary path throws instead of writing pass', () => {
  withTempDir((dir) => {
    const previous = process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_STEP_SUMMARY;
    try {
      assert.throws(() => main(['--exit-code', '2']), /缺 summary 路径/);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous;
    }
    assert.equal(existsSync(join(dir, 'summary.md')), false);
  });
});

test('CLI without --summary writes to GITHUB_STEP_SUMMARY', () => {
  withTempDir((dir) => {
    const summary = join(dir, 'from-env.md');
    const previous = process.env.GITHUB_STEP_SUMMARY;
    process.env.GITHUB_STEP_SUMMARY = summary;
    try {
      const md = main(['--exit-code', '2']);
      assert.match(md, /读不到失败原文/);
      assert.match(readFileSync(summary, 'utf8'), /读不到失败原文/);
      assert.doesNotMatch(md, /## PR 审核通过/);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = previous;
    }
  });
});

test('spawned CLI writes summary from a real die()-shaped log file', () => {
  withTempDir((dir) => {
    const log = join(dir, 'health.log');
    const summary = join(dir, 'summary.md');
    writeFileSync(log, DIE_EXCLUDE);
    const res = spawnSync(process.execPath, [SCRIPT, '--log', log, '--exit-code', '2', '--summary', summary], {
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, res.stderr);
    const md = readFileSync(summary, 'utf8');
    assert.match(md, /排除名单不合法|排除项不合法/);
    assert.match(md, /夜间检查会继续红|公开套件和磁盘对不上/);
  });
});
