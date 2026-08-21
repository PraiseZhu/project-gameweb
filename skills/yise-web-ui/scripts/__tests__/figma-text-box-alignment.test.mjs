import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDemo, renderFrame } from '../lib/figma-render-check.mjs';

const demoDir = 'docs/design-previews/ss6-0820';

function sourceTruth(text) {
  const owner = {
    id: 'owner',
    type: 'FRAME',
    name: 'button',
    box: { x: 0, y: 0, w: 504, h: 268 },
    clipsContent: true,
  };
  return {
    owner,
    truth: {
      sections: {
        synthetic: {
          meta: { x: 0, y: 0, width: 504, height: 268 },
          nodes: [owner, text],
        },
      },
    },
  };
}

function renderSynthetic(text) {
  const demo = loadDemo(demoDir);
  const { owner, truth } = sourceTruth(text);
  const frame = renderFrame(demo, truth, truth, { plat: 'pc' }, 'zh-CN', 504);
  return {
    owner,
    element: [...frame.walk()].find((entry) => entry.attrs?.['data-node'] === text.id),
  };
}

test('source-fixed centered text preserves its leaf width and direct-owner center', () => {
  const centered = {
    id: 'centered',
    type: 'TEXT',
    name: 'label',
    parentId: 'owner',
    box: { x: 150.3333282470703, y: 98, w: 203.33334350585938, h: 52.8 },
    constraints: { horizontal: 'CENTER', vertical: 'CENTER' },
    layout: { constraints: { horizontal: 'CENTER', vertical: 'CENTER' } },
    text: {
      characters: 'generic label',
      fontFamily: 'Alimama ShuHeiTi',
      fontWeight: 700,
      fontSize: 40,
      lineHeight: 56,
      align: 'CENTER',
      vAlign: 'TOP',
    },
  };
  const { owner, element } = renderSynthetic(centered);
  assert.ok(element, 'synthetic centered text must render');
  assert.equal(Number.parseFloat(element.style.width), centered.box.w, 'centered fixed text keeps its source leaf width');
  assert.equal(element.attrs?.['data-text-owner-evidence'], 'source-fixed-centered-text-box');
  assert.equal(element.attrs?.['data-text-source-centered-box'], 'true');
  const ownerCenter = owner.box.x + owner.box.w / 2;
  const textCenter = Number.parseFloat(element.style.left) + Number.parseFloat(element.style.width) / 2;
  assert.ok(Math.abs(textCenter - ownerCenter) <= 0.001, 'rendered source leaf center matches its owner center');
  assert.equal(element.style.transform, 'translateY(8px)', 'horizontal policy must not change existing source-metric vertical compensation');
});

test('non-centered text retains the existing owner-right width policy', () => {
  const leftAligned = {
    id: 'left-aligned',
    type: 'TEXT',
    name: 'label',
    parentId: 'owner',
    box: { x: 150, y: 98, w: 203, h: 52.8 },
    constraints: { horizontal: 'LEFT', vertical: 'CENTER' },
    layout: { constraints: { horizontal: 'LEFT', vertical: 'CENTER' } },
    text: {
      characters: 'generic label',
      fontFamily: 'Alimama ShuHeiTi',
      fontWeight: 700,
      fontSize: 40,
      lineHeight: 56,
      align: 'LEFT',
      vAlign: 'TOP',
    },
  };
  const { owner, element } = renderSynthetic(leftAligned);
  assert.ok(element, 'synthetic left-aligned text must render');
  assert.equal(Number.parseFloat(element.style.width), owner.box.w - leftAligned.box.x, 'left-aligned text retains its owner-right bound');
  assert.notEqual(element.attrs?.['data-text-owner-evidence'], 'source-fixed-centered-text-box');
  assert.equal(element.attrs?.['data-text-source-centered-box'], undefined);
});
