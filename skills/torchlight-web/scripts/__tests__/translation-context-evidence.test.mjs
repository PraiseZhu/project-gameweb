import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTypographyEvidence } from '../lib/translation/evidence-schema.mjs';
import { findTextTruth } from '../lib/figma-typography-browser-check.mjs';

const leaf = (value, locator) => ({ value, provenance: {
  source: 'fixture://synthetic-page', locator, hash: 'synthetic-hash',
} });

test('truth text evidence preserves owner ancestry and provenance through flattened nodes', () => {
  const truth = {
    nodes: [{
      id: leaf('root', '/nodes/0/id'),
      type: leaf('FRAME', '/nodes/0/type'),
      name: leaf('page', '/nodes/0/name'),
      ancestorNames: [leaf('canvas', '/nodes/0/ancestorNames/0')],
      ancestorTypes: [leaf('CANVAS', '/nodes/0/ancestorTypes/0')],
      id2: leaf('text', '/nodes/0/id2'),
      parentId: leaf('nav-owner', '/nodes/0/parentId'),
    }, {
      id: leaf('text-1', '/nodes/1/id'),
      type: leaf('TEXT', '/nodes/1/type'),
      name: leaf('xx', '/nodes/1/name'),
      parentId: leaf('nav-owner', '/nodes/1/parentId'),
      ancestorNames: [
        leaf('page', '/nodes/1/ancestorNames/0'),
        leaf('fixed-nav', '/nodes/1/ancestorNames/1'),
        leaf('活动日历', '/nodes/1/ancestorNames/2'),
      ],
      ancestorTypes: [
        leaf('FRAME', '/nodes/1/ancestorTypes/0'),
        leaf('FRAME', '/nodes/1/ancestorTypes/1'),
      ],
      text: {
        characters: leaf('活动', '/nodes/1/text/characters'),
        fontSize: leaf(20, '/nodes/1/text/fontSize'),
      },
    }],
  };
  const source = findTextTruth(truth).get('text-1');
  assert.deepEqual(source.ancestorNames, ['page', 'fixed-nav', '活动日历']);
  assert.deepEqual(source.ancestorTypes, ['FRAME', 'FRAME']);
  assert.equal(source.provenance.locator, '/nodes/1/text/characters');

  const evidence = buildTypographyEvidence({
    nodeId: source.id,
    name: source.name,
    truth: source,
    language: 'zh-CN',
    browser: { rect: { x: 0, y: 0, width: 100, height: 24 }, range: { x: 0, y: 0, width: 36, height: 24 } },
  });
  assert.deepEqual(evidence.source.ancestorNames, source.ancestorNames);
  assert.equal(evidence.source.provenance.locator, '/nodes/1/text/characters');
});

test('renderer exposes context attributes without page-specific selectors', () => {
  const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');
  assert.match(renderer, /data-text-role/);
  assert.match(renderer, /data-text-context-key/);
  assert.match(renderer, /data-text-ancestor-names/);
  const contextHelper = renderer.slice(renderer.indexOf('const textContext'), renderer.indexOf('const paint'));
  assert.doesNotMatch(contextHelper, /\d+:\d+|yise|etheria/i);
});
