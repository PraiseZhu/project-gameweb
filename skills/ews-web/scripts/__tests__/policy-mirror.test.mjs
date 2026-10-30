import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ewsImplementationFromRuntime, resolveDesignPolicyTools } from '../lib/policy-implementation.mjs';
import { runPolicyMirror } from '../policy-mirror.mjs';

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('live runtime snapshot mirrors DESIGN.md six fields', async () => {
  const result = await runPolicyMirror({ skillRoot: SKILL_ROOT });
  assert.equal(result.ok, true, (result.problems || []).join('\n'));
  assert.equal(result.schema, 'ews-design-policy/v1');
  assert.equal(result.values.mobileMaxWidth, 750);
  assert.equal(result.values.rootFontVw, 10);
  assert.equal(result.values.wideAspectMin, 1.92);
  assert.equal(result.values.wideRootFontVh, 19.2);
  assert.equal(result.values.screenHeight, 'innerHeight');
});

test('CLI policy-mirror exits 0 on current runtime', () => {
  const cli = spawnSync(process.execPath, ['scripts/policy-mirror.mjs'], {
    cwd: SKILL_ROOT,
    encoding: 'utf8',
  });
  assert.equal(cli.status, 0, cli.stderr);
  const body = JSON.parse(cli.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.values.mobileMaxWidth, 750);
});

test('hardcoded 750 runtime source is red', () => {
  const generated = {
    schema: 'ews-design-policy/v1',
    mobileMaxWidth: 750,
    rootFontVw: 10,
    wideAspectMin: 1.92,
    wideRootFontVh: 19.2,
    screenHeight: 'innerHeight',
  };
  const live = ewsImplementationFromRuntime({
    runtime: {
      MOBILE_MAX_WIDTH: 750,
      ROOT_FONT_VW: 10,
      WIDE_ASPECT: 1.92,
      WIDE_ROOT_FONT_VH: 19.2,
      SCREEN_HEIGHT: 'innerHeight',
    },
    runtimeSource: 'export const MOBILE_MAX_WIDTH = 750;\ninnerHeight',
    generated,
  });
  assert.equal(live.ok, false);
  assert.ok(live.problems.some((item) => /硬编码 MOBILE_MAX_WIDTH/.test(item)));
});

test('runtime 749 vs YAML is red when mirrored', async () => {
  const parse = await import(pathToFileURL(join(SKILL_ROOT, '../../standards/design-policy/tool/src/parse-design-policy.mjs')).href);
  const mirror = await import(pathToFileURL(join(SKILL_ROOT, '../../standards/design-policy/tool/src/mirror-design-policy.mjs')).href);
  const policy = parse.parseDesignPolicyFile(join(SKILL_ROOT, 'DESIGN.md'));
  const live = ewsImplementationFromRuntime({
    runtime: {
      MOBILE_MAX_WIDTH: 749,
      ROOT_FONT_VW: 10,
      WIDE_ASPECT: 1.92,
      WIDE_ROOT_FONT_VH: 19.2,
      SCREEN_HEIGHT: 'innerHeight',
    },
    runtimeSource: `import { DESIGN_POLICY } from ${JSON.stringify('./design-policy.generated.mjs')};\nexport const MOBILE_MAX_WIDTH = DESIGN_POLICY.mobileMaxWidth;\nexport function canvasScale() {}\nexport function designRootFontPx() {}\nexport function bleedObjectPosition() {}\ninnerHeight`,
    generated: {
      schema: 'ews-design-policy/v1',
      mobileMaxWidth: 750,
      rootFontVw: 10,
      wideAspectMin: 1.92,
      wideRootFontVh: 19.2,
      screenHeight: 'innerHeight',
    },
  });
  assert.equal(live.ok, true, (live.problems || []).join('\n'));
  assert.throws(() => mirror.mirrorDesignPolicy({ policy, implementation: live.snapshot }), /mobileMaxWidth 749 != 750/);
});

test('missing shared design-policy tools fail closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-no-policy-tools-'));
  writeFileSync(join(dir, 'empty.txt'), 'x');
  const tools = resolveDesignPolicyTools(dir);
  assert.equal(tools.ok, false);
  assert.ok(tools.problems.some((item) => /缺失不得 skip/.test(item)));
});
