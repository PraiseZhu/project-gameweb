/**
 * Semantic interaction-profile contract.
 *
 * A profile carries only reusable behavioral vocabulary: semantic control keys,
 * state keys, relations, mutual-exclusion groups, and evidence.  Static gate
 * remains the sole owner of Figma trees, geometry, assets, text, and baselines.
 */
import { assertBehaviorOnlyPayload } from './behavior-only-contract.mjs';

const asArray = (value) => Array.isArray(value) ? value : [];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const stateScope = (stateKey) => {
  const parts = String(stateKey || '').split('/');
  return parts.length === 3 ? { page: parts[0], platform: parts[1], state: parts[2] } : null;
};

function unresolvedEntry(reason, profile, detail = {}) {
  return { reason, profileKey: String(profile?.profileKey || ''), ...detail };
}

/**
 * Read semantic profile input against declared inventory page states. This does
 * not make a profile executable: static acceptance is resolved separately.
 */
export function compileInteractionProfiles({ profiles = [], pageStates = [] } = {}) {
  const declaredByKey = new Map(asArray(pageStates).map((state) => [state?.stateKey, state]));
  const transitions = [];
  const mutualExclusionGroups = [];
  const unresolved = [];
  const seenProfiles = new Set();

  for (const profile of asArray(profiles)) {
    const behavior = assertBehaviorOnlyPayload(profile, { module: 'Interaction' });
    const profileKey = typeof profile?.profileKey === 'string' ? profile.profileKey : '';
    const page = typeof profile?.page === 'string' ? profile.page : '';
    const platform = typeof profile?.platform === 'string' ? profile.platform : '';
    const stateKeys = asArray(profile?.stateKeys).filter((key) => typeof key === 'string' && key);
    if (!isObject(profile) || !profileKey || !page || !platform || !stateKeys.length) {
      unresolved.push(unresolvedEntry('interaction-profile requires profileKey, page, platform, and stateKeys', profile));
      continue;
    }
    if (seenProfiles.has(profileKey)) {
      unresolved.push(unresolvedEntry('duplicate-interaction-profile', profile));
      continue;
    }
    seenProfiles.add(profileKey);
    if (!behavior.ok) {
      unresolved.push(unresolvedEntry('interaction-profile-carries-static-material', profile, { violations: behavior.violations }));
      continue;
    }
    const invalidStateKey = stateKeys.find((key) => {
      const scope = stateScope(key);
      return !scope || scope.page !== page || scope.platform !== platform || !declaredByKey.has(key);
    });
    if (invalidStateKey) {
      unresolved.push(unresolvedEntry('interaction-profile-state-not-declared-in-same-page-platform', profile, { stateKey: invalidStateKey }));
      continue;
    }

    for (const relation of asArray(profile.transitions)) {
      const controlKey = typeof relation?.from?.controlKey === 'string' ? relation.from.controlKey : '';
      const targetStateKey = typeof relation?.to?.stateKey === 'string' ? relation.to.stateKey : '';
      if (!controlKey || !targetStateKey || !stateKeys.includes(targetStateKey)) {
        unresolved.push(unresolvedEntry('interaction-profile-transition requires controlKey and profile stateKey target', profile, { relation }));
        continue;
      }
      if (relation.status !== 'determined') {
        unresolved.push(unresolvedEntry('interaction-profile-transition requires human confirmation', profile, { relation }));
        continue;
      }
      if (relation.evidence == null) {
        unresolved.push(unresolvedEntry('interaction-profile-transition requires evidence', profile, { relation }));
        continue;
      }
      transitions.push({
        kind: 'state-transition',
        status: 'determined',
        from: { controlKey },
        to: { stateKey: targetStateKey },
        evidence: relation.evidence,
        profileKey,
      });
    }

    for (const group of asArray(profile.mutualExclusion)) {
      const groupStateKeys = asArray(group?.stateKeys).filter((key) => typeof key === 'string' && key);
      if (group.status !== 'determined') {
        unresolved.push(unresolvedEntry('interaction-profile-mutual-exclusion requires human confirmation', profile, { group }));
        continue;
      }
      if (group.evidence == null) {
        unresolved.push(unresolvedEntry('interaction-profile-mutual-exclusion requires evidence', profile, { group }));
        continue;
      }
      if (groupStateKeys.length < 2 || new Set(groupStateKeys).size !== groupStateKeys.length
        || groupStateKeys.some((key) => !stateKeys.includes(key))) {
        unresolved.push(unresolvedEntry('interaction-profile-mutual-exclusion requires two or more distinct profile stateKeys', profile, { group }));
        continue;
      }
      mutualExclusionGroups.push({ profileKey, page, platform, stateKeys: groupStateKeys, evidence: group.evidence });
    }
  }
  return { transitions, mutualExclusionGroups, unresolved };
}

/**
 * Require every mutually-exclusive semantic state to have a matching accepted
 * static entry before exposing the group to Interaction.  This output carries
 * references only; no material is read or copied.
 */
export function resolveAcceptedMutualExclusionGroups({ groups = [], acceptedStaticStates = [] } = {}) {
  const accepted = new Map(asArray(acceptedStaticStates)
    .filter((entry) => entry?.accepted === true && typeof entry?.stateKey === 'string')
    .map((entry) => [entry.stateKey, entry]));
  const resolved = [];
  const unresolved = [];
  for (const group of asArray(groups)) {
    const missing = asArray(group?.stateKeys).find((key) => !accepted.has(key));
    if (missing) {
      unresolved.push({ reason: 'mutual-exclusion-static-state-not-accepted', profileKey: group?.profileKey || '', stateKey: missing });
      continue;
    }
    const states = group.stateKeys.map((key) => accepted.get(key));
    if (states.some((state) => state.page !== group.page || state.platform !== group.platform)) {
      unresolved.push({ reason: 'mutual-exclusion-cross-page-or-platform', profileKey: group?.profileKey || '' });
      continue;
    }
    const defaultKey = `${group.page}/${group.platform}/default`;
    if (!accepted.has(defaultKey)) {
      unresolved.push({ reason: 'mutual-exclusion-missing-accepted-default-state', profileKey: group?.profileKey || '' });
      continue;
    }
    resolved.push({
      profileKey: group.profileKey,
      page: group.page,
      platform: group.platform,
      stateKeys: [...group.stateKeys],
      evidence: group.evidence,
      permittedOutcome: { hidden: true, aria: true },
    });
  }
  return { groups: resolved, unresolved };
}
