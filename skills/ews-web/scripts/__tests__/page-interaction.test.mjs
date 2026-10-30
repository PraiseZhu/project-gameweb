import test from 'node:test';
import assert from 'node:assert/strict';
import { isPageInteractionEnabled, pageInteractionMode } from '../../assets/runtime/page-interaction.mjs';
import { isProductView } from '../../assets/runtime/qa-toolbar.mjs';

test('interaction opt-in is independent of product chrome; missing flag is inert', () => {
  assert.equal(isPageInteractionEnabled(''), false);
  assert.equal(isPageInteractionEnabled('?product=1'), false);
  assert.equal(isPageInteractionEnabled('product=1'), false);
  assert.equal(pageInteractionMode('?product=1'), 'inert');
  assert.equal(isPageInteractionEnabled('?interaction=1'), true);
  assert.equal(isPageInteractionEnabled('?product=1&interaction=1'), true);
  assert.equal(isPageInteractionEnabled('interaction=true'), true);
  assert.equal(isPageInteractionEnabled('interaction=yes'), true);
  assert.equal(isPageInteractionEnabled('interaction=0'), false);
  assert.equal(pageInteractionMode('?product=1&interaction=1'), 'live');
  assert.equal(isProductView('?product=1&interaction=1'), true);
  assert.equal(isProductView('?interaction=1'), false);
});
