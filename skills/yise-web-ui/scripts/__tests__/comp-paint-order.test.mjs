import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEMO = join(ROOT, 'demos', 'yise-ss5-preview');
const unwrap = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && v.provenance ? v.value : v;

test('pagePaintOrder 与 Figma 页面框直接 children 顺序一致', () => {
  const spec = JSON.parse(readFileSync(join(DEMO, 'spec.json'), 'utf8'));
  const fixture = JSON.parse(readFileSync(join(DEMO, 'fixtures', spec.figma.snapshotFile), 'utf8'));
  const truth = JSON.parse(readFileSync(join(DEMO, 'truth.json'), 'utf8'));
  const root = fixture.nodes[spec.figma.frames.pc.id].document;
  const expected = root.children.map((n) => n.id);
  const actual = (truth.pagePaintOrder || []).map((e) => unwrap(e.id));
  assert.deepEqual(actual, expected, '不得按背景/内容分类重排页面 root sibling');

  const content = root.children.find((n) => n.id === spec.figma.sectionsParent.node);
  const expectedSections = content.children.map((n) => n.id);
  const contentPaint = (truth.pagePaintOrder || []).find((e) => unwrap(e.id) === content.id);
  assert.deepEqual((contentPaint?.sectionIds || []).map(unwrap), expectedSections,
    '页面模块内 sec/* 顺序必须来自 Figma children');
});

test('真实 demo smoke 断言 DOM paint root 顺序与节点完整性', () => {
  const result = spawnSync(process.execPath, [join(DEMO, '_render-smoke.mjs')], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /OK page paint order/);
  assert.match(result.stdout, /smoke passed/);
});
