import test from 'node:test';
import assert from 'node:assert/strict';
import { extractGeometry, extractPageScope } from '../lib/figma-geo.mjs';
import { buildComponentVariantIndex } from '../lib/figma-component-variant-graph.mjs';

function fixture(root) {
  const snap = { nodes: { root: { document: root } } };
  const at = (pointer) => pointer.slice(1).split('/').reduce((v, k) => v[k], snap);
  const fig = (pointer) => ({ value: at(pointer), provenance: { source: 'fixture', locator: pointer } });
  return { snap, at, fig };
}

const box = (x = 0, y = 0) => ({ x, y, width: 100, height: 100 });
const empty = (id, name, type = 'FRAME', children = []) => ({ id, name, type, absoluteBoundingBox: box(), fills: [], strokes: [], effects: [], children });

test('keeps empty structural owners while passing generic containers through', () => {
  const root = empty('root', 'sec/test', 'FRAME', [
    empty('switch', 'switch/role', 'INSTANCE', [empty('leaf', 'txt/value', 'TEXT')]),
    empty('plain', 'layout', 'FRAME', [empty('plain-leaf', 'txt/plain', 'TEXT')]),
  ]);
  const f = fixture(root);
  const out = extractGeometry({ ...f, sectionId: 'root', emitStructural: true, emitOwnerPath: true });
  assert.deepEqual(out.nodes.map((n) => n.name.value), ['switch/role', 'txt/value', 'txt/plain']);
  assert.equal(out.nodes[0].parentId.value, 'root');
  assert.deepEqual(out.nodes[1].ownerPath.map((x) => x.value), ['root', 'switch', 'leaf']);
  assert.ok(out.skipped.some((x) => x.nodeId === 'plain' && /纯容器/.test(x.why)));
});

test('section meta preserves the Figma root clipsContent leaf for stage mapping', () => {
  const root = { ...empty('root', 'sec/test'), clipsContent: false };
  const f = fixture(root);
  const out = extractGeometry({ ...f, sectionId: 'root' });
  assert.equal(out.meta.clipsContent.value, false);
  assert.equal(out.meta.clipsContent.provenance.locator, '/nodes/root/document/clipsContent');
});

test('keeps a visual composite group as the owner of its image and copy', () => {
  const image = {
    ...empty('frame', 'img/card-frame', 'RECTANGLE'),
    fills: [{ type: 'IMAGE', visible: true, imageRef: 'asset-card-frame' }],
  };
  const root = empty('root', 'sec/test', 'FRAME', [
    empty('card', '内容', 'GROUP', [image, empty('title', 'txt/title', 'TEXT')]),
  ]);
  const f = fixture(root);
  const out = extractGeometry({ ...f, sectionId: 'root', emitStructural: true, emitOwnerPath: true });
  const card = out.nodes.find((node) => node.id.value === 'card');
  assert.ok(card, 'image-plus-copy group must remain an auditable composite owner');
  assert.equal(out.nodes.find((node) => node.id.value === 'frame').parentId.value, 'card');
  assert.equal(out.nodes.find((node) => node.id.value === 'title').parentId.value, 'card');
});

test('root sibling filter remains fail-closed and reports excluded subtree', () => {
  const root = empty('root', 'page', 'FRAME', [
    empty('allowed', 'fix/nav', 'FRAME', [empty('allowed-child', 'txt/nav', 'TEXT')]),
    empty('excluded', 'content', 'FRAME', [empty('nested-switch', 'switch/role', 'INSTANCE', [empty('nested-leaf', 'txt/value', 'TEXT')])]),
  ]);
  const f = fixture(root);
  const out = extractGeometry({ ...f, sectionId: 'root', emitStructural: true, emitOwnerPath: true,
    includeRootChild: (child) => child.id === 'allowed', preserveOwnerRootIds: ['allowed'] });
  assert.ok(out.nodes.some((n) => n.id.value === 'allowed'));
  assert.ok(out.skipped.filter((x) => x.why === 'page-scope root sibling filter').some((x) => x.nodeId === 'excluded'));
  assert.ok(out.skipped.some((x) => x.nodeId === 'nested-switch'));
});

test('switch direct container children keep their structural owner path', () => {
  /* Generic structural rule: direct switch descendants must survive extraction
     even when visually empty. They retain per-child ownership for later audit,
     but are NOT carousel pages unless the source explicitly labels them
     swpage; a static component snapshot must never be split or hidden. */
  const root = empty('root', 'sec/x', 'FRAME', [
    empty('sw', 'switch/thing', 'INSTANCE', [
      empty('page0', 'Frame 1', 'FRAME', [empty('leaf0', 'txt/a', 'TEXT')]),
      empty('page1', '内容', 'GROUP', [empty('leaf1', 'txt/b', 'TEXT')]),
      { id: 'page2', name: 'img/pic', type: 'INSTANCE', absoluteBoundingBox: box(), fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }], strokes: [], effects: [], children: [] },
    ]),
  ]);
  const f = fixture(root);
  const out = extractGeometry({ ...f, sectionId: 'root', emitStructural: true, emitOwnerPath: true });
  const ids = out.nodes.map((n) => n.id.value);
  /* page0/page1 are pure containers but remain inspectable, parent = sw. */
  for (const pid of ['page0', 'page1', 'page2']) {
    const node = out.nodes.find((n) => n.id.value === pid);
    assert.ok(node, 'switch descendant ' + pid + ' must be a truth node');
    assert.equal(node.parentId.value, 'sw', 'switch descendant ' + pid + ' parent must be the switch owner');
  }
  /* their leaves still walk in original order under the kept page owner. */
  const leaf1 = out.nodes.find((n) => n.id.value === 'leaf1');
  assert.equal(leaf1.parentId.value, 'page1');
  assert.deepEqual(leaf1.ownerPath.map((x) => x.value), ['root', 'sw', 'page1', 'leaf1']);
  /* a nested pure container NOT directly under a switch still passes through. */
  assert.ok(!ids.includes('root'));
});

test('preserves same-snapshot component-set variant options, order, default and provenance', () => {
  const root = empty('root', 'sec/x', 'FRAME', [
    { ...empty('instance', 'switch/example', 'INSTANCE'), componentId: 'variant-a', componentProperties: { State: { type: 'VARIANT', value: 'A' } } },
  ]);
  const f = fixture(root);
  f.snap.nodes.set = { document: {
    id: 'set', type: 'COMPONENT_SET', name: 'switch/example', absoluteBoundingBox: box(),
    componentPropertyDefinitions: { State: { type: 'VARIANT', defaultValue: 'A', variantOptions: ['A', 'B'] } },
    children: [
      { ...empty('variant-a', 'State=A', 'COMPONENT'), interactions: [] },
      { ...empty('variant-b', 'State=B', 'COMPONENT'), interactions: [] },
    ],
  } };
  const index = buildComponentVariantIndex(f.snap);
  const out = extractGeometry({ ...f, sectionId: 'root', emitStructural: true, emitOwnerPath: true, componentVariantIndex: index });
  const node = out.nodes.find((entry) => entry.id.value === 'instance');
  assert.equal(node.componentId.value, 'variant-a');
  assert.equal(node.componentProperties.value.State.value, 'A');
  assert.equal(node.componentVariantGraph.componentSetId.value, 'set');
  assert.deepEqual(node.componentVariantGraph.propertyDefinitions.State.variantOptions.value, ['A', 'B']);
  assert.deepEqual(node.componentVariantGraph.variants.map((variant) => variant.componentId.value), ['variant-a', 'variant-b']);
  assert.equal(node.componentVariantGraph.variants[1].name.provenance.locator, '/nodes/set/document/children/1/name');
});

test('extracts a complete alternate component tree only from its same-snapshot pointer', () => {
  const root = empty('root', 'sec/x', 'FRAME');
  const f = fixture(root);
  f.snap.nodes.set = { document: {
    id: 'set', type: 'COMPONENT_SET', name: 'switch/example', absoluteBoundingBox: box(), children: [
      empty('variant-a', 'State=A', 'COMPONENT', [
        empty('visual', 'mix/card', 'FRAME', [empty('label', 'txt/name', 'TEXT')]),
      ]),
    ],
  } };
  const out = extractGeometry({
    ...f, sectionId: 'variant-a', rootPointer: '/nodes/set/document/children/0',
    includeRoot: true, includeRootChildren: true, emitStructural: true, emitOwnerPath: true,
  });
  assert.deepEqual(out.nodes.map((node) => node.id.value), ['variant-a', 'visual', 'label']);
  assert.equal(out.nodes[1].parentId.value, 'variant-a');
  assert.deepEqual(out.nodes[2].ownerPath.map((x) => x.value), ['variant-a', 'visual', 'label']);
});
