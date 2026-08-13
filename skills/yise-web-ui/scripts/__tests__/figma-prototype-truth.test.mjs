import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPrototypeTruthGate,
  extractPrototypeLeaves,
  inspectPrototypeSnapshot,
  inspectPrototypeTruth,
} from '../lib/figma-prototype-truth.mjs';
import { extractGeometry } from '../lib/figma-geo.mjs';

test('explicit interaction with transition is observed motion truth', () => {
  const record = inspectPrototypeTruth({
    id: 'synthetic-node', type: 'FRAME',
    interactions: [{ trigger: { type: 'ON_CLICK' }, actions: [{ type: 'NODE', destinationId: 'target' }] }],
    transition: { type: 'SMART_ANIMATE', duration: 300, easing: 'EASE_IN_OUT' },
  });
  assert.equal(record.status, 'observed');
  assert.deepEqual(record.fields.prototypeNonEmpty, ['interactions', 'transition']);
});

test('empty interactions are explicit-empty, not proof that the design has no motion', () => {
  const record = inspectPrototypeTruth({ id: 'synthetic-node', type: 'FRAME', interactions: [] });
  assert.equal(record.status, 'explicit-empty');
  const gate = buildPrototypeTruthGate({ nodes: { synthetic: { document: { id: 'synthetic-node', type: 'FRAME', interactions: [] } } } }, { requireObserved: true });
  assert.equal(gate.ok, false);
  assert.equal(gate.status, 'unverified');
});

test('component and variant metadata cannot be promoted to motion', () => {
  const record = inspectPrototypeTruth({
    id: 'synthetic-component', type: 'COMPONENT_SET',
    componentProperties: { State: { type: 'VARIANT', value: 'Default' } },
    variantProperties: { State: 'Default' },
  });
  assert.equal(record.status, 'static-component-metadata');
  assert.equal(buildPrototypeTruthGate({ id: 'synthetic-component', type: 'COMPONENT_SET', componentProperties: { State: {} } }, { requireObserved: true }).ok, false);
});

test('missing prototype fields remain field-absent', () => {
  assert.equal(inspectPrototypeTruth({ id: 'synthetic-text', type: 'TEXT' }).status, 'field-absent');
  assert.equal(inspectPrototypeTruth(null).status, 'unavailable');
});

test('truth extraction retains only source fields and wraps them through fig()', () => {
  const calls = [];
  const out = extractPrototypeLeaves({
    id: 'synthetic', type: 'FRAME', interactions: [],
    componentProperties: { State: { type: 'VARIANT', value: 'Default' } },
  }, '/nodes/synthetic', (ptr) => { calls.push(ptr); return { value: ptr, provenance: { source: 'fixtures/x.json', locator: ptr, hash: 'hash' } }; });
  assert.deepEqual(Object.keys(out), ['interactions', 'componentProperties']);
  assert.deepEqual(calls, ['/nodes/synthetic/interactions', '/nodes/synthetic/componentProperties']);
});

test('figma-geo emits prototype fields exactly once when fixture exposes them', () => {
  const snapshot = { nodes: {
    root: { document: {
      id: 'root', type: 'FRAME', name: 'root',
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
      children: [{
        id: 'child', type: 'INSTANCE', name: 'component',
        absoluteBoundingBox: { x: 0, y: 0, width: 40, height: 20 },
        interactions: [],
        componentProperties: { State: { type: 'VARIANT', value: 'Default' } },
        children: [],
      }],
    } },
  } };
  const at = (pointer) => pointer.split('/').slice(1).reduce((value, key) => value[key], snapshot);
  const fig = (pointer) => ({ value: at(pointer), provenance: { source: 'fixtures/synthetic.json', locator: pointer, hash: 'hash' } });
  const result = extractGeometry({ snap: snapshot, at, fig, sectionId: 'root', emitStructural: true, preserveOwnerRootIds: ['child'] });
  assert.equal(result.nodes.length, 1);
  assert.deepEqual(Object.keys(result.nodes[0].prototype), ['interactions', 'componentProperties']);
  assert.deepEqual(result.nodes[0].prototype.interactions.value, []);
});

const ETHERIA_FIXTURE = fileURLToPath(new URL('../../demos/yise-ss5-preview/fixtures/figma-page.json', import.meta.url));
const HAS_ETHERIA = existsSync(ETHERIA_FIXTURE);
if (!HAS_ETHERIA) console.log('[skip] figma-prototype-truth: 缺私有 Etheria fixture figma-page.json（source-only 发布不含）；合成用例仍覆盖契约，fail-closed 跳过');
test('current Etheria fixtures expose empty interactions and component metadata only', { skip: !HAS_ETHERIA }, () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../demos/yise-ss5-preview/fixtures/figma-page.json', import.meta.url), 'utf8'));
  const evidence = inspectPrototypeSnapshot(snapshot, { source: 'figma-page.json' });
  assert.ok(evidence.totalNodes > 0);
  assert.equal(evidence.counts.observed, 0);
  assert.ok(evidence.counts['explicit-empty'] > 0);
  assert.ok(evidence.records.some((record) => record.fields.staticNonEmpty.length > 0));
  assert.equal(evidence.motionClaim, 'unverified');
});
