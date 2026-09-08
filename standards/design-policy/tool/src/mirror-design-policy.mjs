#!/usr/bin/env node
/**
 * Mirror DESIGN.md YAML numbers against a page-making implementation snapshot.
 * Library and CLI share this function: both fail closed on missing YAML or drift.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseDesignPolicyFile, parseDesignPolicyMarkdown } from './parse-design-policy.mjs';

function fail(message, extra = {}) {
  const err = new Error(message);
  err.code = 'DESIGN_POLICY_MIRROR';
  err.problems = extra.problems || [message];
  throw err;
}

function sameNumber(a, b) {
  return Number(a) === Number(b);
}

function pushIfDrift(problems, label, actual, expected) {
  if (actual !== expected) problems.push(`${label} ${actual} != ${expected}`);
}

function pushIfNumberDrift(problems, label, actual, expected) {
  if (!sameNumber(actual, expected)) problems.push(`${label} ${actual} != ${expected}`);
}

function sameBreakpoints(expected, actual, label, problems) {
  if (!Array.isArray(actual)) {
    problems.push(`${label} missing`);
    return;
  }
  if (expected.length !== actual.length) {
    problems.push(`${label} length ${actual.length} != YAML ${expected.length}`);
    return;
  }
  expected.forEach((bp, index) => {
    const got = actual[index] || {};
    if (got.key !== bp.key) problems.push(`${label}[${index}].key ${got.key} != ${bp.key}`);
    if (!sameNumber(got.min, bp.min)) problems.push(`${label}[${index}].min ${got.min} != ${bp.min}`);
    if ((got.max == null ? null : got.max) !== (bp.max == null ? null : bp.max)) {
      problems.push(`${label}[${index}].max ${got.max} != ${bp.max}`);
    }
  });
}

function sameLocale(expected, actual, problems) {
  if (!actual || typeof actual !== 'object') {
    problems.push('localeFontScale missing');
    return;
  }
  for (const tier of Object.keys(expected)) {
    const row = actual[tier];
    if (!row) {
      problems.push(`localeFontScale.${tier} missing`);
      continue;
    }
    for (const lang of Object.keys(expected[tier])) {
      if (!sameNumber(row[lang], expected[tier][lang])) {
        problems.push(`localeFontScale.${tier}.${lang} ${row[lang]} != ${expected[tier][lang]}`);
      }
    }
  }
}

export function implementationFromPolicy(policy) {
  return {
    designWidths: { ...policy.designWidths },
    officialRootFontVw: policy.officialRootFontVw,
    heroViewportFillVh: policy.heroViewportFillVh,
    composition: policy.composition.map((bp) => ({ ...bp })),
    qaBuckets: policy.qaBuckets.map((bp) => ({ ...bp })),
    inventPadTree: policy.inventPadTree,
    padUsesPcTree: policy.padUsesPcTree,
    localeFontScale: JSON.parse(JSON.stringify(policy.localeFontScale)),
    tierRules: { ...policy.tierRules },
    shrinkSteps: [...policy.shrinkSteps],
    shrinkFloorPercent: policy.shrinkFloorPercent,
    hugNoShrink: policy.hugNoShrink,
    openFlowNoShrink: policy.openFlowNoShrink,
    shrinkMode: policy.shrinkMode,
    modalViewportFill: policy.modalViewportFill,
    modalScrimOpacity: policy.modalScrimOpacity,
    modalLockPageScroll: policy.modalLockPageScroll,
    letterSpacingPolicy: policy.letterSpacingPolicy
      ? {
          keepSourceLangs: [...policy.letterSpacingPolicy.keepSourceLangs],
          zeroLangs: [...policy.letterSpacingPolicy.zeroLangs],
        }
      : undefined,
    localeFontFamily: policy.localeFontFamily
      ? JSON.parse(JSON.stringify(policy.localeFontFamily))
      : undefined,
    localeInvariantFamilies: Array.isArray(policy.localeInvariantFamilies)
      ? [...policy.localeInvariantFamilies]
      : undefined,
    chromeOfficialRootFontVw: policy.officialRootFontVw,
  };
}

export function mirrorDesignPolicy({ policy, implementation, path = 'DESIGN.md' } = {}) {
  if (!policy) fail(`missing policy for ${path}`);
  if (!implementation || typeof implementation !== 'object') {
    fail(`missing implementation snapshot for ${path}`);
  }
  const problems = [];
  const widths = implementation.designWidths || {};
  for (const key of ['mobile', 'pad', 'pc']) {
    pushIfNumberDrift(problems, `designWidths.${key}`, widths[key], policy.designWidths[key]);
  }
  pushIfNumberDrift(problems, 'officialRootFontVw', implementation.officialRootFontVw, policy.officialRootFontVw);
  pushIfNumberDrift(problems, 'heroViewportFillVh', implementation.heroViewportFillVh, policy.heroViewportFillVh);
  sameBreakpoints(policy.composition, implementation.composition, 'composition', problems);
  sameBreakpoints(policy.qaBuckets, implementation.qaBuckets, 'qaBuckets', problems);
  pushIfDrift(problems, 'inventPadTree', implementation.inventPadTree, policy.inventPadTree);
  pushIfDrift(problems, 'padUsesPcTree', implementation.padUsesPcTree, policy.padUsesPcTree);
  sameLocale(policy.localeFontScale, implementation.localeFontScale, problems);
  const tier = implementation.tierRules || {};
  pushIfNumberDrift(problems, 'tierRules.bodyMaxWeightExclusive', tier.bodyMaxWeightExclusive, policy.tierRules.bodyMaxWeightExclusive);
  pushIfNumberDrift(problems, 'tierRules.cardTitleMinSourcePxExclusive', tier.cardTitleMinSourcePxExclusive, policy.tierRules.cardTitleMinSourcePxExclusive);
  const steps = Array.isArray(implementation.shrinkSteps) ? implementation.shrinkSteps : [];
  if (steps.join(',') !== policy.shrinkSteps.join(',')) {
    problems.push(`shrinkSteps [${steps.join(',')}] != YAML [${policy.shrinkSteps.join(',')}]`);
  }
  if (policy.shrinkMode === 'percent-ladder' && steps.some((step) => Number(step) < Number(policy.shrinkFloorPercent))) {
    problems.push(`shrinkSteps contain values below floor ${policy.shrinkFloorPercent}`);
  }
  pushIfNumberDrift(problems, 'shrinkFloorPercent', implementation.shrinkFloorPercent, policy.shrinkFloorPercent);
  pushIfDrift(problems, 'hugNoShrink', implementation.hugNoShrink, policy.hugNoShrink);
  pushIfDrift(problems, 'shrinkMode', implementation.shrinkMode || 'percent-ladder', policy.shrinkMode);
  pushIfDrift(problems, 'openFlowNoShrink', implementation.openFlowNoShrink, policy.openFlowNoShrink);
  if (policy.modalViewportFill != null) {
    pushIfDrift(problems, 'modalViewportFill', implementation.modalViewportFill, policy.modalViewportFill);
    pushIfNumberDrift(problems, 'modalScrimOpacity', implementation.modalScrimOpacity, policy.modalScrimOpacity);
    pushIfDrift(problems, 'modalLockPageScroll', implementation.modalLockPageScroll, policy.modalLockPageScroll);
  }
  if (policy.letterSpacingPolicy) {
    const got = implementation.letterSpacingPolicy || {};
    const keep = Array.isArray(got.keepSourceLangs) ? got.keepSourceLangs.join(',') : '';
    const zero = Array.isArray(got.zeroLangs) ? got.zeroLangs.join(',') : '';
    const expKeep = policy.letterSpacingPolicy.keepSourceLangs.join(',');
    const expZero = policy.letterSpacingPolicy.zeroLangs.join(',');
    if (keep !== expKeep) problems.push(`letterSpacingPolicy.keepSourceLangs [${keep}] != YAML [${expKeep}]`);
    if (zero !== expZero) problems.push(`letterSpacingPolicy.zeroLangs [${zero}] != YAML [${expZero}]`);
  }
  if (policy.localeFontFamily) {
    const got = implementation.localeFontFamily;
    if (!got || typeof got !== 'object') {
      problems.push('localeFontFamily missing');
    } else {
      for (const lang of Object.keys(policy.localeFontFamily)) {
        const expectedRow = policy.localeFontFamily[lang];
        const actualRow = got[lang];
        if (!actualRow) {
          problems.push(`localeFontFamily.${lang} missing`);
          continue;
        }
        for (const role of Object.keys(expectedRow)) {
          if (actualRow[role] !== expectedRow[role]) {
            problems.push(`localeFontFamily.${lang}.${role} ${actualRow[role]} != YAML ${expectedRow[role]}`);
          }
        }
      }
    }
    const expectedInv = Array.isArray(policy.localeInvariantFamilies) ? policy.localeInvariantFamilies.join(',') : '';
    const actualInv = Array.isArray(implementation.localeInvariantFamilies) ? implementation.localeInvariantFamilies.join(',') : '';
    if (actualInv !== expectedInv) {
      problems.push(`localeInvariantFamilies [${actualInv}] != YAML [${expectedInv}]`);
    }
  }
  if (implementation.chromeOfficialRootFontVw == null) {
    problems.push('chromeOfficialRootFontVw missing');
  } else {
    pushIfNumberDrift(problems, 'chromeOfficialRootFontVw', implementation.chromeOfficialRootFontVw, policy.officialRootFontVw);
  }
  if (problems.length) {
    fail(`design-policy mirror red for ${path}: ${problems.join('; ')}`, { problems });
  }
  return { ok: true, path, schema: policy.schema };
}

export function mirrorDesignPolicyFile(designPath, implementation) {
  const policy = parseDesignPolicyFile(designPath);
  return mirrorDesignPolicy({ policy, implementation, path: designPath });
}

export function mirrorDesignPolicyMarkdown(markdown, implementation, path = 'DESIGN.md') {
  const policy = parseDesignPolicyMarkdown(markdown, { path });
  return mirrorDesignPolicy({ policy, implementation, path });
}

function argOf(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : null;
}

function isCli() {
  const self = process.argv[1] ? resolve(process.argv[1]) : '';
  return self.endsWith('mirror-design-policy.mjs');
}

if (isCli()) {
  const argv = process.argv.slice(2);
  const design = argOf(argv, '--design') || argv.find((arg) => !arg.startsWith('--'));
  const implPath = argOf(argv, '--impl');
  if (!design || !implPath) {
    process.stderr.write('usage: node src/mirror-design-policy.mjs --design <DESIGN.md> --impl <implementation.json>\n');
    process.exit(2);
  }
  try {
    const implementation = JSON.parse(readFileSync(resolve(implPath), 'utf8'));
    const result = mirrorDesignPolicyFile(design, implementation);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
