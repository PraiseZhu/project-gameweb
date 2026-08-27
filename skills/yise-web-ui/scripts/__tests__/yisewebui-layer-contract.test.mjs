import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = join(ROOT, '../..');
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

function readClaude() {
  return readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
}

test('sc-61-recall: CLAUDE.md trigger table loads yise-web-ui SKILL.md', () => {
  const claude = readClaude();
  const skill = read('SKILL.md');
  const readme = read('README.md');
  assert.match(claude, /yisewebui \/ 伊瑟网页还原/);
  assert.match(claude, /立即执行 `skills\/yise-web-ui\/SKILL.md`/);
  assert.match(skill, /<command-name>yisewebui<\/command-name>/);
  assert.match(readme, /仓根 `CLAUDE\.md` 触发表/);
  assert.doesNotMatch(readme, /别人装好后直接打 `\/yisewebui`/);
});

test('sc-61-completion-standard: SKILL / README / CLAUDE.md share one sentence', () => {
  const sentence = /吃 ready 包 → 写出 demo\/`index\.html` → `preview:first` 必须绿 → 才给人 `\?product=1`/;
  const skill = read('SKILL.md');
  const readme = read('README.md');
  const claude = readClaude();
  const entry = read('docs/page-making-inventory-entry.md');
  assert.match(skill, sentence);
  assert.match(readme, sentence);
  assert.match(claude, sentence);
  assert.match(entry, /eat ready pack → write demo\/`index\.html` → `preview:first` must be green → then show `\?product=1`/);
  assert.match(skill, /figma:html-from-handoff/);
  assert.match(readme, /figma:html-from-handoff/);
  assert.match(skill, /停下来要包/);
  assert.match(readme, /停下来要包/);
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
  assert.match(encoder, /alpha →\s*lossless WebP/);
  assert.match(encoder, /opaque → lossy quality/);
  assert.match(encoder, /Pack passes lossless=false/);
  assert.match(skill, /10MB/);
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
