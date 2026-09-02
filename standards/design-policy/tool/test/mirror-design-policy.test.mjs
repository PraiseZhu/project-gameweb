import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDesignPolicyMarkdown, parseDesignPolicyFile } from '../src/parse-design-policy.mjs';
import {
  implementationFromPolicy,
  mirrorDesignPolicy,
  mirrorDesignPolicyFile,
} from '../src/mirror-design-policy.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../../../..');
const PARSE = join(HERE, '../src/parse-design-policy.mjs');
const MIRROR = join(HERE, '../src/mirror-design-policy.mjs');

function sampleMarkdown() {
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
---

# body
`;
}

test('matching implementation is green', () => {
  const policy = parseDesignPolicyMarkdown(sampleMarkdown());
  const impl = implementationFromPolicy(policy);
  impl.chromeOfficialRootFontVw = policy.officialRootFontVw;
  const result = mirrorDesignPolicy({ policy, implementation: impl });
  assert.equal(result.ok, true);
});

test('floor 75 vs steps containing 70 is red for library and CLI', () => {
  const policy = parseDesignPolicyMarkdown(sampleMarkdown());
  const impl = implementationFromPolicy(policy);
  impl.shrinkSteps = [100, 92, 85, 78, 75, 70, 65];
  assert.throws(() => mirrorDesignPolicy({ policy, implementation: impl }), /shrinkSteps/);

  const dir = mkdtempSync(join(tmpdir(), 'design-policy-mirror-'));
  const designPath = join(dir, 'DESIGN.md');
  const implPath = join(dir, 'impl.json');
  writeFileSync(designPath, sampleMarkdown());
  writeFileSync(implPath, JSON.stringify(impl));
  const cli = spawnSync(process.execPath, [MIRROR, '--design', designPath, '--impl', implPath], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /shrinkSteps/);
});

test('CLI and library fail the same missing-key YAML', () => {
  const bad = sampleMarkdown().replace('hugNoShrink: true\n', '');
  assert.throws(() => parseDesignPolicyMarkdown(bad), /missing required key/);
  const dir = mkdtempSync(join(tmpdir(), 'design-policy-cli-'));
  const path = join(dir, 'DESIGN.md');
  writeFileSync(path, bad);
  const cli = spawnSync(process.execPath, [PARSE, path], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /missing required key/);
});

test('real skill DESIGN.md mirrors against loaded modules and chrome source', async () => {
  const { implementationSnapshotFromModules } = await import('../src/implementation-snapshot.mjs');
  const packs = [
    ['skills/yise-web-ui', await import(join(REPO, 'skills/yise-web-ui/scripts/lib/resize/index.mjs')), await import(join(REPO, 'skills/yise-web-ui/scripts/lib/translation/typography-policy.mjs'))],
    ['skills/torchlight-web', await import(join(REPO, 'skills/torchlight-web/scripts/lib/resize/index.mjs')), await import(join(REPO, 'skills/torchlight-web/scripts/lib/translation/typography-policy.mjs'))],
  ];
  for (const [rel, resize, typography] of packs) {
    const abs = join(REPO, rel, 'DESIGN.md');
    const chromeSource = readFileSync(join(REPO, rel, 'templates/figma-chrome.js'), 'utf8');
    const renderSource = readFileSync(join(REPO, rel, 'templates/figma-render.js'), 'utf8');
    const shellSource = readFileSync(join(REPO, rel, 'templates/demo-shell.html'), 'utf8');
    const implementation = implementationSnapshotFromModules({ resize, typography, chromeSource, renderSource, shellSource });
    const result = mirrorDesignPolicyFile(abs, implementation);
    assert.equal(result.ok, true, rel);
    assert.equal(implementation.chromeOfficialRootFontVw, parseDesignPolicyFile(abs).officialRootFontVw, rel);
  }
});

test('sourceTitleInlineSafe 70/65 width-fit cannot mirror green', async () => {
  const { implementationSnapshotFromModules } = await import('../src/implementation-snapshot.mjs');
  const yiseResize = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/resize/index.mjs'));
  const yiseType = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/translation/typography-policy.mjs'));
  const chromeSource = readFileSync(join(REPO, 'skills/yise-web-ui/templates/figma-chrome.js'), 'utf8');
  const live = readFileSync(join(REPO, 'skills/yise-web-ui/templates/figma-render.js'), 'utf8');
  const drifted = live.replace(
    /const FLOORW = Number\(designPolicy\(\)\.shrinkFloorPercent\);[\s\S]*?for \(const s of stepsW\) \{/,
    'const FLOORW = opts.sourceTitleInlineSafe ? 65 : 75;\n      const stepsW = opts.sourceTitleInlineSafe ? [92, 85, 78, 75, 70, FLOORW] : [92, 85, 78, FLOORW];\n      for (const s of stepsW) {',
  );
  assert.match(drifted, /sourceTitleInlineSafe \? 65 : 75/);
  assert.throws(() => implementationSnapshotFromModules({
    resize: yiseResize,
    typography: yiseType,
    chromeSource,
    renderSource: drifted,
    shellSource: readFileSync(join(REPO, 'skills/yise-web-ui/templates/demo-shell.html'), 'utf8'),
  }), /live render shrinkSteps/);
});

test('hardcoded render DW / FLOOR cannot mirror green', async () => {
  const { implementationSnapshotFromModules } = await import('../src/implementation-snapshot.mjs');
  const yiseResize = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/resize/index.mjs'));
  const yiseType = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/translation/typography-policy.mjs'));
  const chromeSource = readFileSync(join(REPO, 'skills/yise-web-ui/templates/figma-chrome.js'), 'utf8');
  const driftedRender = `const DW = { pc: 3840, pad: 3840, mobile: 750 };\nconst FLOOR = 75;\nfor (const s of [92, 85, 78, FLOOR]) {}\nconst slotScale = Math.max(k, viewportH / firstHeight);`;
  assert.throws(() => implementationSnapshotFromModules({
    resize: yiseResize,
    typography: yiseType,
    chromeSource,
    renderSource: driftedRender,
    shellSource: '<script></script>',
  }), /live render/);
});

test('chrome silent || 10 is not a live implementation number', async () => {
  const { chromeOfficialRootFontVwFromSource, implementationSnapshotFromModules } = await import('../src/implementation-snapshot.mjs');
  assert.equal(chromeOfficialRootFontVwFromSource("html{--fx-official-root:calc((window.__designPolicy && window.__designPolicy.officialRootFontVw) || 10)vw}"), null);
  const yiseResize = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/resize/index.mjs'));
  const yiseType = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/translation/typography-policy.mjs'));
  const abs = join(REPO, 'skills/yise-web-ui/DESIGN.md');
  const drifted = implementationSnapshotFromModules({
    resize: yiseResize,
    typography: yiseType,
    chromeOfficialRootFontVw: 9,
  });
  assert.throws(() => mirrorDesignPolicyFile(abs, drifted), /chromeOfficialRootFontVw/);
});

test('generated skill snapshots match live DESIGN.md YAML', async () => {
  const { DESIGN_POLICY: yise } = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/design-policy.generated.mjs'));
  const { DESIGN_POLICY: torch } = await import(join(REPO, 'skills/torchlight-web/scripts/lib/design-policy.generated.mjs'));
  assert.deepEqual(yise.shrinkSteps, parseDesignPolicyFile(join(REPO, 'skills/yise-web-ui/DESIGN.md')).shrinkSteps);
  assert.deepEqual(torch.composition, parseDesignPolicyFile(join(REPO, 'skills/torchlight-web/DESIGN.md')).composition);
  assert.equal(yise.officialRootFontVw, 10);
  assert.equal(torch.composition[0].max, 1126);
});

function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkFiles(abs, acc);
    else acc.push(abs);
  }
  return acc;
}

test('runtime override below YAML floor is not a production default', () => {
  const policy = parseDesignPolicyMarkdown(sampleMarkdown());
  assert.equal(Math.min(...policy.shrinkSteps), 75);
  assert.equal(policy.shrinkSteps.includes(70), false);
});

test('generated snapshot drift against YAML is red', async () => {
  const yisePath = join(REPO, 'skills/yise-web-ui/DESIGN.md');
  const { DESIGN_POLICY: generated } = await import(join(REPO, 'skills/yise-web-ui/scripts/lib/design-policy.generated.mjs'));
  const drifted = { ...generated, shrinkSteps: [100, 92, 85, 78, 75, 70, 65] };
  assert.throws(
    () => mirrorDesignPolicyFile(yisePath, implementationFromPolicy(drifted)),
    /shrinkSteps/,
  );
});

test('skills do not copy parse/mirror source', () => {
  for (const skill of ['skills/yise-web-ui/scripts', 'skills/torchlight-web/scripts']) {
    for (const file of walkFiles(join(REPO, skill))) {
      if (!file.endsWith('.mjs') && !file.endsWith('.js')) continue;
      const text = readFileSync(file, 'utf8');
      assert.equal(text.includes('function parseYamlMapping'), false, relative(REPO, file));
      assert.equal(text.includes("err.code = 'DESIGN_POLICY_PARSE'"), false, relative(REPO, file));
    }
  }
});
