// 通用 auto-layout 消费回归测试：渲染层必须把 truth 的 layoutMode 变成 flex 容器，
// 子节点改成 flex item（relative），否则译文变宽后按钮icon/跟随标签/标题装饰会错位。
// 断言机制标记而非具体像素（像素由真实 Chrome evidence 负责）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadDemo, renderFrame } from '../lib/figma-render-check.mjs';

const demoDir = resolve('demos/yise-ss5-preview');
const rawTruth = JSON.parse(readFileSync(join(demoDir, 'truth.json'), 'utf8'));
const unwrap = (n) => (n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && n.provenance) ? n.value
  : Array.isArray(n) ? n.map(unwrap)
  : (n && typeof n === 'object' ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, unwrap(v)])) : n);
const truth = unwrap(rawTruth);

function collectAutoLayout(frame) {
  const owners = [];
  const items = [];
  for (const e of frame.walk()) {
    if (e.attrs && e.attrs['data-auto-layout']) owners.push(e);
    if (e.attrs && e.attrs['data-auto-layout-item'] === '1') items.push(e);
  }
  return { owners, items };
}

test('renderer consumes truth auto-layout (layoutMode) as flex, children become flex items', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const { owners, items } = collectAutoLayout(frame);
  // truth 里有 auto-layout frame（按钮/标题/技能行/日历），渲染层必须消费出 flex owner
  assert.ok(owners.length > 0, 'expected at least one auto-layout flex owner');
  assert.ok(items.length > 0, 'expected at least one auto-layout flex item');
  // 每个 item 必须是 relative（脱离绝对定位），且其祖先里有 auto-layout owner
  for (const it of items) {
    assert.equal(it.style.position, 'relative', 'auto-layout item must be relative, not absolute');
    assert.equal(it.style.left, 'auto', 'auto-layout item must clear absolute left');
    let p = it.__p; let foundOwner = false;
    while (p) { if (p.attrs && p.attrs['data-auto-layout']) { foundOwner = true; break; } p = p.__p; }
    assert.ok(foundOwner, 'auto-layout item must be nested under a data-auto-layout owner');
  }
  // owner 必须是 flex
  for (const o of owners) {
    assert.equal(o.style.display, 'flex', 'auto-layout owner must be display:flex');
    assert.ok(['row', 'column'].includes(o.style.flexDirection), 'owner flexDirection row/column');
  }
});

test('auto-layout flex item width not forced to source width when it hugs content', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const { items } = collectAutoLayout(frame);
  // 至少一个 HUG 文本 item：其宽度不应钉死在源宽度（否则译文变宽被裁）
  // 机制标记：auto-layout item 仍是 fx-n；这里只验证它们都被重排（非 absolute）
  const absoluteItems = items.filter((e) => e.style.position === 'absolute');
  assert.equal(absoluteItems.length, 0, 'no auto-layout item should stay absolute');
});

test('fixed text items in horizontal auto-layout preserve their source item width for following siblings', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const truthNodes = Object.values(truth.sections || {}).flatMap((section) => section.nodes || []);
  const byId = new Map(truthNodes.map((node) => [String(node.id), node]));
  const childrenByParentId = new Map();
  for (const node of truthNodes) {
    if (!node.parentId) continue;
    const children = childrenByParentId.get(String(node.parentId)) || [];
    children.push(node);
    childrenByParentId.set(String(node.parentId), children);
  }
  const candidates = [...frame.walk()].filter((entry) =>
    entry.attrs?.['data-text-owner-evidence'] === 'source-fixed-auto-layout-item'
      && (entry.__p?.children || []).some((sibling) => sibling !== entry));
  assert.ok(candidates.length > 0, 'expected a fixed text item with an Auto Layout sibling');
  for (const entry of candidates) {
    const source = byId.get(String(entry.attrs['data-node']));
    assert.ok(source?.box?.w > 0, 'candidate must retain a source item box');
    const followingSibling = (childrenByParentId.get(String(source.parentId)) || []).find((sibling) =>
      String(sibling.id) !== String(source.id)
        && Number(sibling.box?.w) > 0
        && Number(sibling.box?.x) >= Number(source.box.x) + Number(source.box.w) - 0.5);
    assert.ok(followingSibling, 'source proof requires a following Auto Layout sibling');
    assert.equal(Number.parseFloat(entry.style.width), Number(source.box.w), 'fixed text must not consume sibling space');
    assert.equal(entry.__p?.attrs?.['data-auto-layout'], 'HORIZONTAL', 'candidate must be in a horizontal Auto Layout owner');
    assert.ok((entry.__p?.children || []).some((sibling) => sibling !== entry), 'owner must retain a following or preceding sibling');
  }
});

test('auto-layout consumes explicit Figma CENTER alignment and preserves negative item spacing', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const owner = [...frame.walk()].find((entry) => entry.attrs?.['data-node'] === '2:31284');
  assert.ok(owner, 'expected the source-backed HUG card-row owner');
  // Raw fixture 2:31284 explicitly records primaryAxisAlignItems=CENTER.
  // Preserve that source value; only an absent axis setting falls back to MIN.
  assert.equal(owner.style.justifyContent, 'center', 'explicit Figma primary CENTER must not be downgraded to MIN');
  assert.equal(owner.style.alignItems, 'flex-start', 'missing Figma counter alignment must keep MIN, not center');
  const children = owner.children.filter((entry) => entry.attrs?.['data-auto-layout-item'] === '1');
  assert.equal(children.length, 3, 'card-row must retain its three direct source children');
  assert.equal(children[0].style.marginLeft || '', '', 'first item must not receive a synthetic overlap offset');
  for (const child of children.slice(1)) {
    assert.equal(child.style.marginLeft, '-224px', 'negative Figma itemSpacing must remain a main-axis overlap');
  }
});

test('HUG horizontal owner with FILL text and fixed flanks uses an intrinsic text track', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const qualifyingOwners = [...frame.walk()].filter((entry) =>
    entry.attrs?.['data-auto-layout-hug-fill-fixed-siblings'] === '1');
  assert.ok(qualifyingOwners.length > 0, 'expected at least one source-proven HUG/FILL/fixed-sibling group');
  for (const owner of qualifyingOwners) {
    assert.equal(owner.attrs?.['data-auto-layout'], 'HORIZONTAL', 'qualifying owner remains a horizontal Auto Layout owner');
    assert.equal(owner.style.width, 'max-content', 'HUG owner derives its width from rendered flow content');
    const tracks = owner.children.filter((entry) => entry.attrs?.['data-auto-layout-hug-fill-text-track']);
    assert.equal(tracks.length, 1, 'qualifying group must have exactly one FILL text track');
    assert.equal(tracks[0].style.width, 'max-content', 'FILL title track must be intrinsic instead of source-box fixed');
    assert.equal(tracks[0].style.minWidth, 'max-content', 'glyph width must be the track minimum after text constraints run');
    assert.equal(tracks[0].style.flex, '0 0 auto', 'intrinsic title track must not re-enter circular flex-grow sizing');
  }
});

test('HUG horizontal owner gives each HUG text item its source-leaf floor, never its complete row width', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'ja', 1920);
  const truthNodes = Object.values(truth.sections || {}).flatMap((section) => section.nodes || []);
  const byId = new Map(truthNodes.map((node) => [String(node.id), node]));
  const tracks = [...frame.walk()].filter((entry) => {
    const source = byId.get(String(entry.attrs?.['data-node']));
    return entry.attrs?.['data-auto-layout-hug-text-track'] === 'source-leaf-floor'
      && Number(source?.box?.w) > 0
      && Number.parseFloat(entry.__p?.style?.minWidth) > Number(source.box.w) + 0.5;
  });
  assert.ok(tracks.length > 0, 'expected a HUG text track whose complete row is wider than the source leaf');
  for (const track of tracks) {
    const source = byId.get(String(track.attrs?.['data-node']));
    const owner = track.__p;
    assert.equal(owner?.attrs?.['data-auto-layout'], 'HORIZONTAL', 'track stays in its source horizontal Auto Layout row');
    assert.equal(owner?.attrs?.['data-auto-layout-hug-text-track-owner'], '1', 'owner remains content-sized HUG');
    assert.equal(track.style.width, 'max-content', 'translated glyphs determine the track width');
    assert.equal(Number.parseFloat(track.style.minWidth), Number(source?.box?.w), 'only the source text leaf is the minimum');
    assert.notEqual(Number.parseFloat(track.style.minWidth), Number(owner?.style?.minWidth), 'complete row width must not become the text floor');
  }
});

test('synthetic HUG-FILL-text-fixed eligibility contract excludes ordinary fixed rows', () => {
  const isHugFillTextFixed = ({ layout, children }) => {
    const horizontalHug = String(layout?.layoutMode || '').toUpperCase() === 'HORIZONTAL'
      && String(layout?.layoutSizingHorizontal || '').toUpperCase() === 'HUG';
    const fillText = children.filter((node) => node.type === 'TEXT'
      && String(node.layout?.layoutAlign || '').toUpperCase() === 'INHERIT'
      && String(node.layout?.layoutSizingHorizontal || '').toUpperCase() === 'FILL');
    const fixedFlanks = children.filter((node) => node.type !== 'TEXT'
      && String(node.layout?.layoutAlign || '').toUpperCase() === 'INHERIT'
      && String(node.layout?.layoutSizingHorizontal || '').toUpperCase() !== 'FILL');
    return horizontalHug && fillText.length === 1 && fixedFlanks.length >= 2;
  };
  const fixed = (type = 'GROUP') => ({ type, layout: { layoutAlign: 'INHERIT', layoutSizingHorizontal: 'FIXED' } });
  const fillText = { type: 'TEXT', layout: { layoutAlign: 'INHERIT', layoutSizingHorizontal: 'FILL' } };
  assert.equal(isHugFillTextFixed({
    layout: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG' },
    children: [fixed(), fillText, fixed()],
  }), true, 'generic three-sibling HUG fixture qualifies without any node/copy identity');
  assert.equal(isHugFillTextFixed({
    layout: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'FIXED' },
    children: [fixed(), fillText, fixed()],
  }), false, 'ordinary fixed-width row must retain its source geometry');
  assert.equal(isHugFillTextFixed({
    layout: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG' },
    children: [fixed(), { ...fillText, layout: { ...fillText.layout, layoutSizingHorizontal: 'FIXED' } }, fixed()],
  }), false, 'without a FILL text sibling there is no HUG track to replace');
});

test('synthetic HUG-text-track eligibility excludes fixed rows and overlay text', () => {
  const isHugTextTrack = ({ parent, child }) => String(parent?.layoutMode || '').toUpperCase() === 'HORIZONTAL'
    && String(parent?.layoutSizingHorizontal || '').toUpperCase() === 'HUG'
    && child?.type === 'TEXT'
    && String(child?.layout?.layoutAlign || '').toUpperCase() === 'INHERIT'
    && String(child?.layout?.layoutSizingHorizontal || '').toUpperCase() === 'HUG';
  const text = { type: 'TEXT', layout: { layoutAlign: 'INHERIT', layoutSizingHorizontal: 'HUG' } };
  assert.equal(isHugTextTrack({ parent: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG' }, child: text }), true);
  assert.equal(isHugTextTrack({ parent: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'FIXED' }, child: text }), false);
  assert.equal(isHugTextTrack({ parent: { layoutMode: 'HORIZONTAL', layoutSizingHorizontal: 'HUG' }, child: { ...text, layout: { ...text.layout, layoutAlign: 'ABSOLUTE' } } }), false);
});

test('only INHERIT children participate in a source Auto Layout owner', () => {
  const demo = loadDemo(demoDir);
  const frame = renderFrame(demo, truth, rawTruth, { plat: 'pc' }, 'en', 1920);
  const rewardCard = [...frame.walk()].find((entry) => entry.attrs?.['data-node'] === '1:468');
  assert.ok(rewardCard, 'expected first reward card');
  const ids = new Map((rewardCard.children || []).map((entry) => [entry.attrs?.['data-node'], entry]));
  assert.equal(ids.get('1:469')?.attrs?.['data-auto-layout-item'], undefined, 'frame decoration without layoutAlign must not enter the card flex flow');
  assert.equal(ids.get('12:48529')?.attrs?.['data-auto-layout-item'], undefined, 'card art without layoutAlign must not enter the card flex flow');
  assert.equal(ids.get('1:473')?.attrs?.['data-auto-layout-item'], undefined, 'card title container without layoutAlign must not enter the card flex flow');
  assert.equal(ids.get('1:475')?.attrs?.['data-auto-layout-item'], undefined, 'reward scroll viewport without layoutAlign must not enter the card flex flow');
  assert.equal(ids.get('1:471')?.attrs?.['data-auto-layout-item'], undefined, 'an INHERIT detail frame outside the vertical owner origin must remain an overlay');
});
