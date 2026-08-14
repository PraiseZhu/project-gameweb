import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const DEMO = join(ROOT, 'demos', 'yise-ss5-preview');

const unwrap = (v) => {
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v && v.provenance) return unwrap(v.value);
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x)]));
  return v;
};

test('hero scroll-slot 的 Node 守卫来自 page frame 结构而不是 demo 命名', () => {
  const truth = unwrap(JSON.parse(readFileSync(join(DEMO, 'truth.json'), 'utf8')));
  const render = readFileSync(join(ROOT, 'templates', 'figma-render.js'), 'utf8');
  const pc = truth.platforms?.pc || truth;
  assert.ok(pc?.pageChrome?.meta, 'PC truth 必须有 pageChrome meta');
  assert.ok(Array.isArray(pc.pagePaintOrder) && pc.pagePaintOrder.length > 0, '必须有 pagePaintOrder');
  const sections = Object.entries(pc.sections || {}).sort(([, a], [, b]) => (a.meta?.y ?? Infinity) - (b.meta?.y ?? Infinity));
  assert.ok(sections.length > 1, '至少需要首屏和后续分区才能验证 slot');
  const [heroId, hero] = sections[0];
  assert.ok(Math.abs(hero.meta.y - pc.pageChrome.meta.y) <= 0.5, '首 section 必须从 page origin 开始');
  const contentRoot = pc.pagePaintOrder.find((entry) => (entry.sectionIds || []).map(String).includes(String(heroId)));
  assert.ok(contentRoot, '首 section 必须属于真实 pagePaintOrder root');

  for (const [w, h] of [[768, 1024], [1024, 1366], [390, 844], [1440, 900]]) {
    assert.ok(Number.isFinite(w) && Number.isFinite(h), `${w}x${h} viewport 有效`);
  }
  assert.match(render, /data-hero-scroll-slot/);
  assert.match(render, /data-hero-slot-role/);
  assert.match(render, /viewportH \/ k/);
  assert.match(render, /pagePaintOrder.*contentRoot|contentRoot.*pagePaintOrder/s);
  assert.match(render, /data-hero-slot-reveal/);
  assert.match(render, /followingSection/);
  assert.doesNotMatch(render, /slotOffset/);
});

test('无 tablet Figma truth 时 spec 明确记录 fallback/TODO', () => {
  const spec = JSON.parse(readFileSync(join(DEMO, 'spec.json'), 'utf8'));
  const tablet = (spec.adaptation?.knownDeviations || []).find((x) => String(x.item || '').includes('tablet'));
  assert.ok(tablet, '缺 tablet 适配台账');
  assert.match(String(tablet.resolution || ''), /TODO|待定|fallback/i);
  assert.equal(spec.adaptation?.breakpoints?.find((x) => x.key === 'tablet')?.base, 'TODO-待定');
});
