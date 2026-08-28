import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compileInteractionProfiles,
  resolveAcceptedMutualExclusionGroups,
} from '../lib/interaction-profile-contract.mjs';

const states = [
  { stateKey: 'homepage/mobile/default', page: 'homepage', platform: 'mobile', state: 'default' },
  { stateKey: 'homepage/mobile/menu-open', page: 'homepage', platform: 'mobile', state: 'menu-open' },
  { stateKey: 'homepage/mobile/language-open', page: 'homepage', platform: 'mobile', state: 'language-open' },
];

const accepted = states.map((state) => ({
  ...state,
  staticAcceptanceId: `accepted-${state.state}`,
  staticTruthRef: `static://${state.state}`,
  accepted: true,
}));

function profile(overrides = {}) {
  return {
    profileKey: 'homepage-mobile-overlays',
    page: 'homepage',
    platform: 'mobile',
    stateKeys: states.map((state) => state.stateKey),
    transitions: [
      { status: 'determined', from: { controlKey: 'homepage.mobile.navigation-toggle' }, to: { stateKey: 'homepage/mobile/menu-open' }, evidence: { kind: 'template-prototype' } },
      { status: 'determined', from: { controlKey: 'homepage.mobile.language-toggle' }, to: { stateKey: 'homepage/mobile/language-open' }, evidence: { kind: 'template-prototype' } },
      { status: 'determined', from: { controlKey: 'homepage.mobile.close-menu' }, to: { stateKey: 'homepage/mobile/default' }, evidence: { kind: 'template-prototype' } },
    ],
    mutualExclusion: [
      { status: 'determined', stateKeys: ['homepage/mobile/menu-open', 'homepage/mobile/language-open'], evidence: { kind: 'template-prototype' } },
    ],
    ...overrides,
  };
}

test('semantic profile compiles navigation, language, close transitions and mutual exclusion', () => {
  const result = compileInteractionProfiles({ profiles: [profile()], pageStates: states });
  assert.equal(result.unresolved.length, 0);
  assert.deepEqual(result.transitions.map((transition) => [transition.from.controlKey, transition.to.stateKey]), [
    ['homepage.mobile.navigation-toggle', 'homepage/mobile/menu-open'],
    ['homepage.mobile.language-toggle', 'homepage/mobile/language-open'],
    ['homepage.mobile.close-menu', 'homepage/mobile/default'],
  ]);
  assert.deepEqual(result.mutualExclusionGroups[0].stateKeys, ['homepage/mobile/menu-open', 'homepage/mobile/language-open']);

  const acceptedGroups = resolveAcceptedMutualExclusionGroups({ groups: result.mutualExclusionGroups, acceptedStaticStates: accepted });
  assert.equal(acceptedGroups.unresolved.length, 0);
  assert.deepEqual(acceptedGroups.groups[0].permittedOutcome, { hidden: true, aria: true });
});

test('unknown or evidence-free profile statements fail closed', () => {
  const candidate = profile({
    transitions: [
      { status: 'unknown', from: { controlKey: 'homepage.mobile.navigation-toggle' }, to: { stateKey: 'homepage/mobile/menu-open' }, evidence: { kind: 'candidate-only' } },
      { status: 'determined', from: { controlKey: 'homepage.mobile.language-toggle' }, to: { stateKey: 'homepage/mobile/language-open' } },
    ],
    mutualExclusion: [
      { status: 'unknown', stateKeys: ['homepage/mobile/menu-open', 'homepage/mobile/language-open'], evidence: { kind: 'candidate-only' } },
    ],
  });
  const result = compileInteractionProfiles({ profiles: [candidate], pageStates: states });
  assert.equal(result.transitions.length, 0);
  assert.equal(result.mutualExclusionGroups.length, 0);
  assert.ok(result.unresolved.some((entry) => entry.reason === 'interaction-profile-transition requires human confirmation'));
  assert.ok(result.unresolved.some((entry) => entry.reason === 'interaction-profile-transition requires evidence'));
  assert.ok(result.unresolved.some((entry) => entry.reason === 'interaction-profile-mutual-exclusion requires human confirmation'));
});

test('profile material, undeclared states, and unaccepted groups remain inert', () => {
  const material = compileInteractionProfiles({
    profiles: [profile({ box: { x: 1, y: 2 } })],
    pageStates: states,
  });
  assert.equal(material.transitions.length, 0);
  assert.ok(material.unresolved.some((entry) => entry.reason === 'interaction-profile-carries-static-material'));

  const undeclared = compileInteractionProfiles({
    profiles: [profile({ stateKeys: [...states.map((state) => state.stateKey), 'homepage/mobile/not-static'] })],
    pageStates: states,
  });
  assert.equal(undeclared.transitions.length, 0);
  assert.ok(undeclared.unresolved.some((entry) => entry.reason === 'interaction-profile-state-not-declared-in-same-page-platform'));

  const compiled = compileInteractionProfiles({ profiles: [profile()], pageStates: states });
  const unaccepted = resolveAcceptedMutualExclusionGroups({
    groups: compiled.mutualExclusionGroups,
    acceptedStaticStates: accepted.filter((entry) => entry.state !== 'language-open'),
  });
  assert.equal(unaccepted.groups.length, 0);
  assert.ok(unaccepted.unresolved.some((entry) => entry.reason === 'mutual-exclusion-static-state-not-accepted'));
});
