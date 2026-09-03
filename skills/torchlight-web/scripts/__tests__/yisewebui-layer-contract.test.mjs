import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = join(ROOT, '../..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

test('sc-probe-torch-identity: Torch 2:1987 local extract is not inventory/handoff', () => {
  const skill = read('SKILL.md');
  const readme = read('README.md');
  assert.match(readme, /2:1987/);
  assert.match(readme, /196:9509/);
  assert.match(readme, /272:21937/);
  assert.match(readme, /latest-Figma local extract baseline/);
  assert.match(readme, /not an inventory\/handoff baseline/);
  assert.match(skill, /torchlightweb/);
});

function readClaude() {
  return readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
}

test('sc-61-recall: CLAUDE.md trigger table loads torchlight-web SKILL.md', () => {
  const claude = readClaude();
  const skill = read('SKILL.md');
  const readme = read('README.md');
  assert.match(claude, /torchlightweb \/ 火炬网页还原/);
  assert.match(claude, /立即执行 `skills\/torchlight-web\/SKILL.md`/);
  assert.match(skill, /<command-name>torchlightweb<\/command-name>/);
  assert.match(readme, /仓根 `CLAUDE\.md` 触发表/);
  assert.doesNotMatch(readme, /别人装好后直接打 `\/torchlightweb`/);
});

test('sc-61-completion-standard: SKILL / README / CLAUDE.md share one sentence', () => {
  const sentence = /吃 ready 包 → 写出 demo\/`index\.html` → `preview:first` 必须绿 → 清单对账必须绿(?:（整框 `img\/` `bg\/` `kv` \/ 无名 `kv` 的 PNG 非空且宽高等于 `pageBox`）)?\s*→ 政策镜像必须绿 → 才给人 `\?product=1`/;
  const skill = read('SKILL.md');
  const readme = read('README.md');
  const claude = readClaude();
  const entry = read('docs/page-making-inventory-entry.md');
  assert.match(skill, sentence);
  assert.match(readme, sentence);
  assert.match(claude, sentence);
  assert.match(skill, /政策镜像必须绿/);
  assert.match(readme, /政策镜像必须绿/);
  assert.doesNotMatch(skill, /DOM 已验 10vw|整份 DESIGN\.md 已上屏/);
  assert.doesNotMatch(readme, /DOM 已验 10vw|整份 DESIGN\.md 已上屏/);
  assert.match(entry, /eat ready pack → write demo\/`index\.html` → `preview:first` must be green → inventory static gate must be green → policy mirror must be green → then show `\?product=1`/);
  assert.match(skill, /figma:html-from-handoff/);
  assert.match(readme, /figma:html-from-handoff/);
  assert.match(skill, /停下来要包/);
  assert.match(readme, /停下来要包/);
  assert.match(skill, /inventory-static-gate-probe\.mjs/);
  assert.match(readme, /inventory-static-gate-probe\.mjs/);
  assert.match(skill, /inventory-static-gate=1/);
  assert.match(readme, /inventory-static-gate=1/);
  assert.match(skill, /product=1` 滚动后/);
  assert.match(readme, /product=1` 滚动后/);
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

test('sc-yisewebui-layer-stop: two human review stops, Translation not-claimed without a table', () => {
  const skill = read('SKILL.md');
  const arch = read('docs/skill-architecture.md');
  const readme = read('README.md');
  assert.match(skill, /Main static → Translation/);
  assert.match(skill, /humans see \*\*two\*\* review stops/);
  assert.match(skill, /zh-CN\s+font load\s+is not a translation pass/s);
  assert.match(skill, /Do not open or present the page while `preview:first` is red/);
  assert.match(skill, /humanStopPreviewAllowed/);
  assert.match(skill, /productView\.command/);
  assert.match(skill, /human-review\.json/);
  assert.match(skill, /recall-torchlightweb/);
  const finalGate = read('docs/final-preview-gate.md');
  assert.match(finalGate, /humanStopPreviewAllowed/);
  assert.match(finalGate, /human review stop may open/);
  assert.match(finalGate, /productView\.command/);
  assert.match(arch, /stop-layer workflow/);
  assert.match(arch, /two review stops/);
  assert.match(arch, /zh-CN font\s+load is not a translation pass/s);
  assert.match(readme, /two human review stops/);
  assert.match(readme, /zh-CN font load is not a translation pass/);
  assert.match(arch, /Do not invent a fourth Skill|Do not split the directory into a fourth Skill/);
  assert.match(arch, /human-review\.json/);
  assert.match(readme, /human-review\.mjs/);
  assert.match(readme, /recall-torchlightweb/);
});

test('sc-html-10mb-webp: HTML volume is 10MB on index.html, assets folder is free', () => {
  const skill = read('SKILL.md');
  const volume = read('scripts/lib/html-volume.mjs');
  const encoder = read('scripts/lib/encode-webp.py');
  assert.match(volume, /DEFAULT_MAX_HTML_BYTES = 10 \* 1024 \* 1024/);
  assert.match(volume, /index.html itself, not the assets folder/);
  assert.match(encoder, /alpha →\s*lossless WebP/);
  assert.match(encoder, /opaque → lossy quality/);
  assert.match(encoder, /Pack passes lossless=false/);
  assert.match(skill, /10MB/);
});

test('sc-resize-official-contract: Resize owns 10vw / 100vh / overflow-x, not poster CSS', () => {
  const resize = read('docs/resize-skill.md');
  const lib = read('scripts/lib/resize/index.mjs');
  const render = read('templates/figma-render.js');
  const chrome = read('templates/figma-chrome.js');
  assert.match(resize, /10vw/);
  assert.match(resize, /100vh/);
  assert.match(resize, /1127–1920/);
  assert.match(lib, /OFFICIAL_ROOT_FONT_VW = DESIGN_POLICY\.officialRootFontVw/);
  assert.match(lib, /PC_COLUMN_FREEZE_MAX = 1920/);
  assert.doesNotMatch(lib, /continuous width scale k = viewportW \/ designWidth/);
  assert.match(lib, /pageOverflowPolicy/);
  assert.doesNotMatch(render, /const DW = \{ pc: 3840, pad: 3840, mobile: 750 \}/);
  assert.doesNotMatch(render, /const FLOOR = 75/);
  assert.doesNotMatch(render, /\[92, 85, 78, FLOOR\]/);
  assert.match(render, /pagePaintOrder.length === 1/);
  assert.match(render, /data-hero-crop-window/);
  assert.match(render, /heroVisualPlane/);
  assert.match(render, /pageScope \? 1 : k/);
  assert.match(render, /data-hero-ui-y-ratio/);
  assert.match(render, /data-name/);
  assert.match(chrome, /data-hero-source-height/);
  assert.match(chrome, /data-name/);
  assert.doesNotMatch(chrome, /data-prefix'\) === 'img'\|\|/);
  assert.doesNotMatch(chrome, /sourceBoxWidth = parseFloat\(root\.style\.width\) \|\| 601/);
  assert.match(chrome, /source-y-scale/);
  assert.doesNotMatch(chrome, /I52:3263;17:53006/);
  assert.match(chrome, /PRODUCT_VIEW \? 'hidden' : 'auto'/);
  assert.match(chrome, /function officialRootFontVw\(\)/);
  assert.match(chrome, /designPolicy\(\)\.officialRootFontVw/);
  assert.doesNotMatch(chrome, /officialRootFontVw\) \|\| 10/);
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
  assert.match(skill, /Main static → Translation/);
  assert.match(skill, /After the second\n?human stop is accepted, run the Pack delivery/s);
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
