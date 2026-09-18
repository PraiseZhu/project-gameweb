import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const renderer = readFileSync(fileURLToPath(new URL('../../templates/figma-render.js', import.meta.url)), 'utf8');

test('product and QA renderer installs content protection independently of interaction opt-in', () => {
  assert.match(renderer, /data-content-protection/);
  assert.match(renderer, /user-select:none!important/);
  assert.match(renderer, /-webkit-user-drag:none!important/);
  assert.match(renderer, /img,svg,video,canvas/);
  assert.ok(renderer.includes("setAttribute('draggable', 'false')"));
  assert.match(renderer, /MutationObserver/);
  assert.doesNotMatch(renderer, /__CONTENT_PROTECTION_TEST__|__contentProtectionCleanup/);
  assert.match(renderer, /data-content-protection-editable/);
  assert.doesNotMatch(renderer, /__contentProtectionCleanup = \(\) =>/);
  for (const event of ['selectstart', 'copy', 'cut', 'dragstart', 'contextmenu']) {
    assert.ok(renderer.includes("addEventListener('" + event + "'"), 'missing ' + event + ' guard');
  }
  const protection = renderer.indexOf('installContentProtection');
  const interaction = renderer.indexOf('installButtonPressFeel');
  assert.ok(protection >= 0 && interaction >= 0 && protection < interaction, 'protection must not depend on interaction opt-in');
});
