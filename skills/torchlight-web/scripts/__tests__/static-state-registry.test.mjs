import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATIC_STATE_REGISTRY_SCHEMA,
  validateAcceptedStaticStateRegistry,
  acceptedStaticStateOptions,
  acceptedStaticStateKey,
  requireAcceptedDefaultState,
} from '../lib/static-state-registry.mjs';

const valid = [
  { stateKey: 'homepage/mobile/default', page: 'homepage', platform: 'mobile', state: 'default', staticAcceptanceId: 'r1-default', staticTruthRef: 'opaque://default', accepted: true },
  { stateKey: 'homepage/mobile/menu-open', page: 'homepage', platform: 'mobile', state: 'menu-open', staticAcceptanceId: 'r1-menu', staticTruthRef: 'opaque://menu', accepted: true },
];

test('accepted static registry exposes only opaque semantic references', () => {
  const result = validateAcceptedStaticStateRegistry(valid);
  assert.equal(result.schema, STATIC_STATE_REGISTRY_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.states.get('homepage/mobile/menu-open').staticTruthRef, 'opaque://menu');
  assert.equal('box' in result.states.get('homepage/mobile/menu-open'), false);
});

test('registry rejects material fields and malformed state keys', () => {
  const result = validateAcceptedStaticStateRegistry([
    { ...valid[0], box: { x: 0, y: 0, width: 100, height: 100 } },
    { ...valid[1], stateKey: 'wrong-key' },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => /static material/.test(item.reason)));
  assert.ok(result.problems.some((item) => /does not match/.test(item.reason)));
});

test('registry rejects duplicate and unaccepted entries', () => {
  const result = validateAcceptedStaticStateRegistry([
    ...valid,
    { ...valid[1], staticAcceptanceId: 'r2-menu' },
    { ...valid[0], stateKey: 'homepage/mobile/language-open', state: 'language-open', accepted: false },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => /duplicate/.test(item.reason)));
  assert.ok(result.problems.some((item) => /accepted:true/.test(item.reason)));
});

test('options and default checks remain references-only', () => {
  const options = acceptedStaticStateOptions(valid);
  assert.equal(options.ok, true);
  assert.equal(options.acceptedStaticStates.length, 2);
  assert.equal(acceptedStaticStateKey({ page: 'homepage', platform: 'mobile', state: 'default' }), 'homepage/mobile/default');
  assert.equal(requireAcceptedDefaultState(valid, { page: 'homepage', platform: 'mobile' }).ok, true);
  assert.equal(requireAcceptedDefaultState(valid, { page: 'homepage', platform: 'pc' }).ok, false);
});

test('registry does not accept source-node or asset fields even when opaque refs are valid', () => {
  const result = validateAcceptedStaticStateRegistry([{
    ...valid[0],
    sourceFrameId: 'figma-frame',
    assetKey: 'season-specific.png',
  }]);
  assert.equal(result.ok, false);
  assert.ok(result.problems[0].violations.some((item) => item.key === 'sourceFrameId'));
  assert.ok(result.problems[0].violations.some((item) => item.key === 'assetKey'));
});

test('registry rejects material nested inside arrays, not only top-level objects', () => {
  const result = validateAcceptedStaticStateRegistry([{
    ...valid[0],
    meta: [{ style: { color: 'red' } }],
  }]);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((item) => /static material/.test(item.reason)));
  assert.ok(result.problems.some((item) => (item.violations || []).some((v) => v.key === 'style')));
});
