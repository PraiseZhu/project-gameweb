import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignPolicyFile, parseDesignPolicyMarkdown } from '../src/parse-design-policy.mjs';
import { writeSkillPolicyModule } from '../src/write-skill-policy.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

function yiseYaml(extra = '') {
  return `---
schema: gameweb-design-policy/v1
designWidths:
  mobile: 750
  pad: 3840
  pc: 3840
officialRootFontVw: 10
heroViewportFillVh: 100
composition:
  - key: mobile
    min: 0
    max: 750
  - key: tablet
    min: 751
    max: 1023
  - key: desktop
    min: 1024
    max: null
qaBuckets:
  - key: mobile
    min: 0
    max: 750
  - key: tablet
    min: 751
    max: 1023
  - key: desktop
    min: 1024
    max: null
inventPadTree: false
padUsesPcTree: true
localeFontScale:
  body:
    zh-CN: 1
    en: 0.8
    ja: 0.8
    ko: 0.8
    zh-TW: 1
  card-title:
    zh-CN: 1
    en: 1
    ja: 0.833
    ko: 1
    zh-TW: 0.833
  heading:
    zh-CN: 1
    en: 1
    ja: 1
    ko: 1
    zh-TW: 1
tierRules:
  bodyMaxWeightExclusive: 600
  cardTitleMinSourcePxExclusive: 40
shrinkSteps:
  - 100
  - 92
  - 85
  - 78
  - 75
shrinkFloorPercent: 75
hugNoShrink: true
openFlowNoShrink: true
${extra}---

# body
`;
}

function torchYaml() {
  return yiseYaml()
    .replace('padUsesPcTree: true', 'padUsesPcTree: false')
    .replace(/composition:\n(?:  - key: .+\n    min: .+\n    max: .+\n)+/, `composition:
  - key: mobile
    min: 0
    max: 1126
  - key: desktop
    min: 1127
    max: null
`);
}

function throws(fn, re) {
  assert.throws(fn, (err) => {
    assert.match(String(err.message), re);
    return true;
  });
}

test('parses yise DESIGN.md YAML', () => {
  const policy = parseDesignPolicyFile(join(REPO, 'skills/yise-web-ui/DESIGN.md'));
  assert.equal(policy.schema, 'gameweb-design-policy/v1');
  assert.equal(policy.designWidths.mobile, 750);
  assert.equal(policy.designWidths.pc, 3840);
  assert.equal(policy.officialRootFontVw, 10);
  assert.equal(policy.heroViewportFillVh, 100);
  assert.equal(policy.composition[0].max, 750);
  assert.equal(policy.composition[1].min, 751);
  assert.equal(policy.composition[2].min, 1024);
  assert.equal(policy.padUsesPcTree, true);
  assert.deepEqual([...policy.shrinkSteps], [100, 92, 85, 78, 75]);
  assert.equal(policy.shrinkFloorPercent, 75);
  assert.equal(policy.hugNoShrink, true);
  assert.equal(policy.openFlowNoShrink, true);
  assert.equal(policy.localeFontScale.body.en, 0.8);
  assert.equal(policy.localeFontScale['card-title'].ja, 0.833);
});

test('parses torchlight DESIGN.md YAML with composition != qaBuckets', () => {
  const policy = parseDesignPolicyFile(join(REPO, 'skills/torchlight-web/DESIGN.md'));
  assert.equal(policy.composition[0].max, 1126);
  assert.equal(policy.composition[1].min, 1127);
  assert.equal(policy.inventPadTree, false);
  assert.equal(policy.qaBuckets[0].max, 750);
  assert.equal(policy.qaBuckets[2].min, 1024);
  assert.notDeepEqual(policy.composition, policy.qaBuckets);
  assert.equal(policy.shrinkMode, 'integer-px');
  assert.deepEqual([...policy.shrinkSteps], [1]);
  assert.equal(policy.shrinkFloorPercent, 1);
  assert.equal(policy.modalViewportFill, 'cover');
  assert.equal(policy.modalScrimOpacity, 0.8);
  assert.equal(policy.modalLockPageScroll, true);
});

test('fixture markdown parses the same shape', () => {
  const yise = parseDesignPolicyMarkdown(yiseYaml());
  assert.equal(yise.composition[1].key, 'tablet');
  const torch = parseDesignPolicyMarkdown(torchYaml());
  assert.equal(torch.composition[0].max, 1126);
});

test('missing required key is red', () => {
  throws(() => parseDesignPolicyMarkdown(yiseYaml().replace('hugNoShrink: true\n', '')), /missing required key: hugNoShrink/);
});

test('duplicate keys are red', () => {
  throws(() => parseDesignPolicyMarkdown(yiseYaml().replace('hugNoShrink: true\n', 'hugNoShrink: true\nhugNoShrink: false\n')), /duplicate key: hugNoShrink/);
});

test('unregistered extraBreakpoint is red', () => {
  throws(() => parseDesignPolicyMarkdown(yiseYaml('extraBreakpoint: 999\n')), /unregistered key: extraBreakpoint/);
});

test('yise DESIGN.md may omit named-modal YAML', () => {
  const policy = parseDesignPolicyFile(join(REPO, 'skills/yise-web-ui/DESIGN.md'));
  assert.equal(policy.modalViewportFill, undefined);
  assert.equal(policy.modalScrimOpacity, undefined);
  assert.equal(policy.modalLockPageScroll, undefined);
});

test('named-modal YAML keys must be declared together', () => {
  throws(
    () => parseDesignPolicyMarkdown(yiseYaml('modalViewportFill: cover\n')),
    /must be declared together/,
  );
});

test('named-modal YAML fill must be cover or contain', () => {
  throws(
    () => parseDesignPolicyMarkdown(yiseYaml('modalViewportFill: stretch\nmodalScrimOpacity: 0.8\nmodalLockPageScroll: true\n')),
    /modalViewportFill must be cover or contain/,
  );
});


test('writeSkillPolicyModule stores a repo-relative DESIGN.md path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-policy-write-'));
  const out = join(dir, 'design-policy.generated.mjs');
  writeSkillPolicyModule(
    join(REPO, 'skills/torchlight-web/DESIGN.md'),
    out,
    { repoRoot: REPO },
  );
  const generated = readFileSync(out, 'utf8');
  assert.match(generated, /"path": "skills\/torchlight-web\/DESIGN.md"/);
  assert.doesNotMatch(generated, /C:\\\\Users/);
  assert.doesNotMatch(generated, /"path": "\/Users/);
});

test('writeSkillPolicyModule rejects DESIGN.md outside the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-policy-outside-'));
  const outside = join(dir, 'DESIGN.md');
  const out = join(dir, 'design-policy.generated.mjs');
  writeFileSync(outside, readFileSync(join(REPO, 'skills/torchlight-web/DESIGN.md')));
  assert.throws(
    () => writeSkillPolicyModule(outside, out, { repoRoot: REPO }),
    /DESIGN.md path must stay inside the repo/,
  );
});


test('bare hash comments on a value line are red', () => {
  throws(() => parseDesignPolicyMarkdown(yiseYaml().replace('officialRootFontVw: 10', 'officialRootFontVw: 10 # vw')), /bare #/);
});

test('tab indent is red', () => {
  throws(() => parseDesignPolicyMarkdown(yiseYaml().replace('  mobile: 750', '\tmobile: 750')), /Tab/);
});

test('missing file is red', () => {
  const dir = mkdtempSync(join(tmpdir(), 'design-policy-missing-'));
  throws(() => parseDesignPolicyFile(join(dir, 'DESIGN.md')), /cannot read DESIGN.md/);
});

test('__proto__ mapping cannot satisfy required keys', () => {
  const src = yiseYaml();
  const rest = src.slice(4);
  const end = rest.indexOf('\n---');
  const body = rest.slice(0, end);
  const nested = body.split('\n').filter(Boolean).map((line) => `  ${line}`).join('\n');
  throws(() => parseDesignPolicyMarkdown(`---\n__proto__:\n${nested}\n---\n`), /forbidden key: __proto__/);
});
