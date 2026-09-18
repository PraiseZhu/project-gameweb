import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assessResult, buildSuites } from './content-protection-gate.mjs';

const report = (extra = {}) => ({ status: 0, stdout: Object.entries({ tests: 9, pass: 9, fail: 0, skipped: 0, cancelled: 0, todo: 0, ...extra }).map(([key, value]) => '# ' + key + ' ' + value).join('\n') });
test('accepts a complete zero-skip browser run', () => assert.equal(assessResult(report(), 9), null));
test('rejects missing, truncated, duplicate and undersized reports', () => {
  for (const result of [{ status: 0, stdout: '' }, { status: 0, stdout: '# tests 9' }, { status: 0, stdout: report().stdout + '\n# tests 9' }, report({ tests: 0, pass: 0 }), report({ tests: 8, pass: 8 })]) assert.ok(assessResult(result, 9));
});
test('rejects failures, skips, cancellations, todos and lying summaries', () => {
  for (const key of ['fail', 'skipped', 'cancelled', 'todo']) assert.ok(assessResult(report({ [key]: 1 }), 9));
  assert.ok(assessResult(report({ pass: 8 }), 9));
  assert.ok(assessResult({ status: 0, stdout: 'not ok 1 - broken\n' + report().stdout }, 9));
});
test('rejects process failures even with a passing summary', () => {
  for (const extra of [{ status: 1 }, { status: null }, { signal: 'SIGTERM' }, { error: new Error('timeout') }]) assert.ok(assessResult({ ...report(), ...extra }, 9));
});
test('cloud requires all three boundary engines and refuses invalid selection', () => {
  const workflow = readFileSync(new URL('../workflows/content-protection.yml', import.meta.url), 'utf8');
  assert.match(workflow, /CONTENT_PROTECTION_ENGINES: chromium,firefox,webkit/);
  assert.match(workflow, /install --with-deps chromium firefox webkit/);
  const suites = buildSuites('chromium,firefox,webkit');
  assert.equal(suites.length, 10);
  for (const engine of ['chromium', 'firefox', 'webkit']) {
    assert.equal(suites.filter(suite => suite.engine === engine && suite.minimum === 12).length, 2);
  }
  for (const value of ['', 'chromium,', 'chromium,chromium', 'unknown']) assert.throws(() => buildSuites(value));
});
test('both cloud entrypoints call the browser workflow without making it optional', () => {
  for (const file of ['pr-gate.yml', 'nightly-health.yml']) assert.ok(readFileSync(new URL('../workflows/' + file, import.meta.url), 'utf8').includes('content-protection:\n    uses: ./.github/workflows/content-protection.yml'));
  const workflow = readFileSync(new URL('../workflows/content-protection.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('playwright-core/cli.js install --with-deps chromium'));
  assert.ok(workflow.includes('node .github/scripts/content-protection-gate.mjs'));
  const gate = readFileSync(new URL('./content-protection-gate.mjs', import.meta.url), 'utf8');
  assert.ok(gate.includes('content-protection-artifact-gate.mjs'));
  assert.ok(gate.includes('/scripts/init.mjs'));
  assert.ok(gate.includes('CONTENT_PROTECTION_GENERATED_DIR: generated'));
  assert.ok(gate.includes('CONTENT_PROTECTION_TMPDIR'));
  assert.ok(workflow.includes('CONTENT_PROTECTION_TMPDIR: ${{ github.workspace }}/t'));
  assert.ok(workflow.includes('_tmp/content-protection/failures/'));
  assert.match(workflow, /set -o pipefail/);
  assert.ok(workflow.includes('content-protection-pass.log'));
  assert.ok(!workflow.includes('continue-on-error'));
  const pr = readFileSync(new URL('../workflows/pr-gate.yml', import.meta.url), 'utf8');
  assert.ok(pr.includes('needs: [content-protection]'));
  assert.ok(pr.includes("needs.content-protection.result == 'success' && steps.health.outputs.exit_code"));
  assert.ok(pr.includes('if [ "$protection" != "success" ]; then'));
});

test('actual caller final step rejects failed, skipped, cancelled and missing protection results', () => {
  const source = readFileSync(new URL('../workflows/pr-gate.yml', import.meta.url), 'utf8');
  const finalStep = source.split('      - name: Fail job when health or summary failed')[1];
  assert.ok(finalStep, 'caller final gate must exist');
  const shell = finalStep.split('        run: |\n')[1];
  assert.ok(shell, 'caller final gate must run a shell command');
  const expression = name => '$' + '{{ ' + name + ' }}';
  const run = (protection, health = '0', summary = 'success') => {
    const script = shell
      .replaceAll(expression('needs.content-protection.result'), protection)
      .replaceAll(expression('steps.health.outputs.exit_code'), health)
      .replaceAll(expression('steps.summary.outcome'), summary);
    assert.ok(!script.includes('$' + '{{'), 'all expressions must be resolved');
    return spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', timeout: 5000 });
  };
  assert.equal(run('success').status, 0);
  for (const state of ['failure', 'skipped', 'cancelled', '']) {
    const result = run(state);
    assert.equal(result.status, 1, state + ': ' + result.stderr);
    assert.ok(result.stdout.includes('页面内容保护未通过'));
  }
  for (const health of ['1', '2', '']) assert.equal(run('success', health).status, 1);
  for (const summary of ['failure', 'skipped', 'cancelled', '']) assert.equal(run('success', '0', summary).status, 1);
});

test('nightly caller has an explicit fail-closed result aggregator', () => {
  const source = readFileSync(new URL('../workflows/nightly-health.yml', import.meta.url), 'utf8');
  assert.match(source, /health:\n\s+name: health\n\s+needs: \[content-protection\]\n\s+if: \$\{\{ always\(\) \}\}/);
  const gate = source.split('  nightly-gate:\n')[1];
  assert.ok(gate, 'nightly-gate must exist');
  assert.match(gate, /needs: \[content-protection, health\]/);
  assert.match(gate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(gate, /if \[ \"\$protection\" != \"success\" \]; then/);
  assert.match(gate, /if \[ \"\$health\" != \"success\" \]; then/);
});

test('merge queue is covered and nightly shell rejects every non-success dependency', () => {
  const pr = readFileSync(new URL('../workflows/pr-gate.yml', import.meta.url), 'utf8');
  assert.match(pr, /\n  merge_group:/);
  const nightly = readFileSync(new URL('../workflows/nightly-health.yml', import.meta.url), 'utf8');
  const shell = nightly.split('  nightly-gate:\n')[1].split('        run: |\n')[1];
  const expression = name => '$' + '{{ ' + name + ' }}';
  for (const protection of ['success', 'failure', 'skipped', 'cancelled', '']) {
    for (const health of ['success', 'failure', 'skipped', 'cancelled', '']) {
      const script = shell.replaceAll(expression('needs.content-protection.result'), protection)
        .replaceAll(expression('needs.health.result'), health);
      const result = spawnSync('bash', ['-e', '-c', script], { encoding: 'utf8', timeout: 5000 });
      assert.equal(result.status, protection === 'success' && health === 'success' ? 0 : 1);
    }
  }
});
