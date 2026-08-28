import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('sc-probe-ss5-identity: 4201 is SS5 1:180 / 20:2205 local extract, not SS6', () => {
  const skill = read('SKILL.md');
  const readme = read('README.md');
  assert.match(readme, /1:180/);
  assert.match(readme, /20:2205/);
  assert.match(readme, /4201/);
  assert.match(readme, /latest-Figma local extract baseline/);
  assert.match(readme, /not an inventory\/handoff baseline/);
  assert.match(skill, /yisewebui/);
});

test('sc-label-direct-figma: live extract is not inventory/handoff', () => {
  const entry = read('docs/page-making-inventory-entry.md');
  assert.match(entry, /latest-Figma local extract\s+baseline/);
  assert.match(entry, /never `latest inventory\/handoff baseline`/);
  assert.match(entry, /figma:from-handoff|inventory\/v2/);
  assert.match(entry, /Issue #38/);
  assert.match(entry, /inert/);
});

test('sc-open-not-done: opening the page is still a candidate', () => {
  const skill = read('SKILL.md');
  const readme = read('README.md');
  assert.match(skill, /A page that opens is not a finished Skill run/);
  assert.match(readme, /A page that opens is still a candidate/);
  assert.match(readme, /not-claimed|extraction recognition only/);
});

test('sc-yisewebui-layer-stop: static then Translation then Interaction then Resize', () => {
  const skill = read('SKILL.md');
  const arch = read('docs/skill-architecture.md');
  assert.match(skill, /Main\s+static → Translation → Interaction → Resize/);
  assert.match(arch, /stop-layer workflow/);
  assert.match(arch, /Do not invent a fourth Skill|Do not split the directory into a fourth Skill/);
  assert.match(skill, /Do not open the next axis until\n?the previous one is accepted/s);
});

test('sc-html-10mb-webp: HTML volume is 10MB on index.html, assets folder is free', () => {
  const skill = read('SKILL.md');
  const volume = read('scripts/lib/html-volume.mjs');
  const encoder = read('scripts/lib/encode-webp.py');
  assert.match(volume, /DEFAULT_MAX_HTML_BYTES = 10 \* 1024 \* 1024/);
  assert.match(volume, /index.html itself, not the assets folder/);
  assert.match(encoder, /Alpha images use lossless WebP/);
  assert.match(encoder, /lossy quality 90/);
  assert.match(skill, /10MB/);
});

test('sc-resize-official-contract: Resize owns 10vw / 100vh / overflow-x, not poster CSS', () => {
  const resize = read('docs/resize-skill.md');
  const lib = read('scripts/lib/resize/index.mjs');
  const render = read('templates/figma-render.js');
  const chrome = read('templates/figma-chrome.js');
  assert.match(resize, /k = viewportW \/ designWidth/);
  assert.match(resize, /10vw/);
  assert.match(resize, /100vh/);
  assert.match(lib, /OFFICIAL_ROOT_FONT_VW = 10/);
  assert.match(lib, /pageOverflowPolicy/);
  assert.match(render, /pagePaintOrder.length === 1/);
  assert.match(render, /data-hero-crop-window/);
  assert.match(render, /heroVisualPlane/);
  assert.match(render, /pageScope \? 1 : k/);
  assert.match(render, /data-hero-ui-y-ratio/);
  assert.match(render, /data-node-name/);
  assert.match(chrome, /data-hero-source-height/);
  assert.match(chrome, /data-node-name/);
  assert.doesNotMatch(chrome, /data-prefix'\) === 'img'\|\|/);
  assert.doesNotMatch(chrome, /sourceBoxWidth = parseFloat\(root\.style\.width\) \|\| 601/);
  assert.match(chrome, /source-y-scale/);
  assert.doesNotMatch(chrome, /I52:3263;17:53006/);
  assert.match(chrome, /PRODUCT_VIEW \? 'hidden' : 'auto'/);
  assert.match(chrome, /10vw \* var\(--fx-root-scale, 1\)/);
  assert.match(chrome, /html\[data-product-view="1"\]\{font-size:16px\}/);
  assert.match(chrome, /BEZEL = PRODUCT_VIEW \? 0 : 22/);
  assert.match(chrome, /fit: !PRODUCT_VIEW/);
  assert.doesNotMatch(chrome, /poster\.xdcdn/);
});

test('sc-pack-after-resize: Pack is delivery after Resize, not a fourth Skill', () => {
  const skill = read('SKILL.md');
  const arch = read('docs/skill-architecture.md');
  const pack = read('docs/pack-skill.md');
  const lib = read('scripts/lib/pack-demo.mjs');
  assert.match(skill, /Main\s+static → Translation → Interaction → Resize/);
  assert.match(skill, /After Resize is accepted, run the Pack delivery/);
  assert.match(skill, /Pack is not a restore axis/);
  assert.match(arch, /Pack delivery/);
  assert.match(arch, /not a restore axis/);
  assert.match(pack, /not a fourth restore axis/);
  assert.match(pack, /after Resize is accepted/);
  assert.match(lib, /DEFAULT_PACK_BUDGET_BYTES = 15 \* 1024 \* 1024/);
  assert.match(lib, /figma-indicator/);
});

test('sc-prior-test-gaps: unknown stays inert; #38 is record-only', () => {
  const entry = read('docs/page-making-inventory-entry.md');
  assert.match(entry, /Keep unresolved switch\/page relations\ninert/);
  assert.match(entry, /Issue #38: record\/analyse\nonly/);
  assert.match(entry, /do not change shaoshenze upstream completeness/);
});
