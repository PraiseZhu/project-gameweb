import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { applyTestBrowserEnv } from './helpers/browser-env.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';
import { runStop1, writeReportHtml } from '../stop1.mjs';
import { runStop1Pixel } from '../stop1-pixel.mjs';

applyTestBrowserEnv();

test('stop1 missing args is blocked, not awaiting-user-review', async () => {
  const result = await runStop1([]);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.schema, 'ews-stop1/v1');
});

test('stop1-pixel without Figma token fail-closed', { timeout: 120000 }, async () => {
  const { out, handoff } = buildSyntheticDemo('ews-stop1-pixel-');
  const envToken = process.env.FIGMA_TOKEN;
  const envAccess = process.env.FIGMA_ACCESS_TOKEN;
  delete process.env.FIGMA_TOKEN;
  delete process.env.FIGMA_ACCESS_TOKEN;
  try {
    const result = await runStop1Pixel([
      '--demo', out,
      '--handoff', handoff,
      '--artifacts', `${out}/artifacts/stop1`,
    ], { cwd: out });
    assert.equal(result.ok, false);
    assert.equal(result.skipped, false);
    assert.ok((result.problems || []).length > 0);
  } finally {
    if (envToken) process.env.FIGMA_TOKEN = envToken;
    if (envAccess) process.env.FIGMA_ACCESS_TOKEN = envAccess;
  }
});

test('synthetic stop1 stays blocked and never awaiting-user-review', { timeout: 180000 }, async () => {
  const { out, handoff, assetsPath, configPath } = buildSyntheticDemo('ews-stop1-all-');
  const result = await runStop1([
    '--demo', out,
    '--handoff', handoff,
    '--assets', assetsPath,
    '--config', configPath,
    '--artifacts', `${out}/artifacts/stop1`,
  ], { cwd: out });
  assert.equal(result.status, 'blocked');
  assert.notEqual(result.status, 'awaiting-user-review');
  assert.ok(result.gates.some((row) => row.gate === 'stop1-pixel' && row.ok === false));
  assert.equal(result.schema, 'ews-stop1/v1');
});


test('stop1 report escapes dynamic gate text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ews-stop1-html-'));
  writeReportHtml(dir, {
    status: '<ready>',
    fingerprint: "fp&'",
    gates: [{ gate: '<img>', ok: false, problems: ["<script>alert(1)</script>"] }],
  });
  const html = readFileSync(join(dir, 'report.html'), 'utf8');
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /status: &lt;ready&gt;/);
  assert.match(html, /fingerprint: fp&amp;&#39;/);
});
