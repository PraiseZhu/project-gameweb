import test from 'node:test';
import assert from 'node:assert/strict';
import { semanticBreakFor, validateSemanticLayout } from '../lib/translation/semantic-layout.mjs';

const bindings = { 'card-A': { translations: { ja: { value: '前半後半' }, en: { value: 'Whole title' } } } };

test('semantic layout validates explicit content lines against the adopted translation and keeps provenance', () => {
  const layout = validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '後半'], provenance: { kind: 'user-provided-official-visual-reference' } } } } }, copyByNode: bindings });
  assert.deepEqual(semanticBreakFor({ semanticLayout: layout, nodeId: 'card-A', language: 'ja' }).lines, ['前半', '後半']);
  assert.equal(semanticBreakFor({ semanticLayout: layout, nodeId: 'card-A', language: 'en' }), null, 'other locales are not fabricated');
});

test('semantic layout rejects a break that changes translated copy or lacks provenance', () => {
  assert.throws(() => validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '別文'], provenance: { kind: 'visual' } } } } }, copyByNode: bindings }), /concatenate/);
  assert.throws(() => validateSemanticLayout({ layout: { byNode: { 'card-A': { ja: { lines: ['前半', '後半'] } } } }, copyByNode: bindings }), /provenance/);
});
