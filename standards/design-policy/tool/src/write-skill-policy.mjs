#!/usr/bin/env node
/**
 * Generate a frozen ESM snapshot of DESIGN.md YAML inside a skill package.
 * Skills import that snapshot, not this parser, so demo lib-sync stays closed.
 */

import { writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { parseDesignPolicyFile } from './parse-design-policy.mjs';

export function renderSkillPolicyModule(policy) {
  const json = JSON.stringify(policy, null, 2);
  return `// Generated from DESIGN.md YAML. Do not edit by hand.
// Regenerate: node standards/design-policy/tool/src/write-skill-policy.mjs <DESIGN.md> <out.mjs>
export const DESIGN_POLICY = Object.freeze(${json});
`;
}

export function writeSkillPolicyModule(designPath, outPath, { repoRoot = process.cwd() } = {}) {
  const policy = parseDesignPolicyFile(designPath);
  const absDesign = resolve(designPath);
  const absRoot = resolve(repoRoot);
  const rel = relative(absRoot, absDesign).split(sep).join('/');
  if (!rel || rel.startsWith('..') || /^[A-Za-z]:/.test(rel) || rel.startsWith('/')) {
    throw new Error(`DESIGN.md path must stay inside the repo: ${absDesign}`);
  }
  const portable = { ...policy, path: rel };
  const absOut = resolve(outPath);
  writeFileSync(absOut, renderSkillPolicyModule(portable));
  return absOut;
}

function isCli() {
  const self = process.argv[1] ? resolve(process.argv[1]) : '';
  return self.endsWith('write-skill-policy.mjs');
}

if (isCli()) {
  const design = process.argv[2];
  const out = process.argv[3];
  if (!design || !out) {
    process.stderr.write('usage: node src/write-skill-policy.mjs <DESIGN.md> <out.mjs>\n');
    process.exit(2);
  }
  try {
    const abs = writeSkillPolicyModule(design, out);
    process.stdout.write(`${abs}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}
