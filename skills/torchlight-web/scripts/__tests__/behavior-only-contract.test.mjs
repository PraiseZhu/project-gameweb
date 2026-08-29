import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BEHAVIOR_ONLY_SCHEMA,
  behaviorPayloadViolations,
  assertBehaviorOnlyPayload,
  behaviorOnlyHandoff,
} from '../lib/behavior-only-contract.mjs';

test('semantic interaction handoff is accepted', () => {
  const result = assertBehaviorOnlyPayload({
    controlKey: 'homepage.mobile.menu-toggle',
    currentState: 'homepage/mobile/default',
    targetState: 'homepage/mobile/menu-open',
    staticAcceptanceId: 'accepted-menu-r1',
    staticTruthRef: 'opaque://static/menu-open',
    permittedOutcome: { hidden: true, aria: true },
  }, { module: 'Interaction' });
  assert.equal(result.schema, BEHAVIOR_ONLY_SCHEMA);
  assert.equal(result.ok, true);
  assert.deepEqual(result.violations, []);
});

test('interaction rejects static geometry and material fields', () => {
  const result = assertBehaviorOnlyPayload({
    controlKey: 'homepage.mobile.menu-toggle',
    targetState: 'homepage/mobile/menu-open',
    box: { x: 10, y: 20, width: 300, height: 400 },
    assetKey: 'ss5/menu.png',
  }, { module: 'Interaction' });
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((item) => item.path === 'box'));
  assert.ok(result.violations.some((item) => item.path === 'assetKey'));
});

test('Resize may carry viewport facts but not nested layout payloads', () => {
  const accepted = assertBehaviorOnlyPayload({
    viewport: { width: 1097, height: 2160 },
    composition: 'pc',
    currentState: 'homepage/mobile/default',
  }, { module: 'Resize' });
  assert.equal(accepted.ok, true);

  const rejected = behaviorPayloadViolations({
    viewport: { width: 1097, height: 2160, box: { x: 0, y: 0 } },
  }, { allowViewport: true });
  assert.ok(rejected.some((item) => item.path === 'viewport.box'));
});

test('handoff exposes only semantic refs and permitted browser state', () => {
  const handoff = behaviorOnlyHandoff({
    module: 'Interaction',
    controlKey: 'homepage.mobile.menu-toggle',
    currentState: 'homepage/mobile/default',
    targetState: 'homepage/mobile/menu-open',
    staticAcceptanceId: 'accepted-menu-r1',
    staticTruthRef: 'opaque://menu-open',
    activeTarget: 'homepage/mobile/menu-open',
  });
  assert.equal(handoff.schema, BEHAVIOR_ONLY_SCHEMA);
  assert.equal(handoff.staticTruthRef, 'opaque://menu-open');
  assert.equal('box' in handoff, false);
  assert.equal('nodeId' in handoff, false);
});

test('handoff throws when a forbidden static field is passed', () => {
  assert.throws(() => behaviorOnlyHandoff({
    module: 'Interaction',
    targetState: 'homepage/mobile/menu-open',
    activeTarget: { nodeId: 'season-specific-node' },
  }), /forbidden static fields/);
});
