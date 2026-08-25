import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveInteractionModel } from '../lib/figma-interaction-contract.mjs';
import { buildRendererInteractionPayload } from '../lib/figma-render-interaction-adapter.mjs';
import {
  BUTTON_PRESS_SELECTOR,
  BUTTON_PRESS_TOKENS,
  attachButtonPressAttrs,
  buttonPressCss,
} from '../lib/figma-button-press-contract.mjs';
import { readFileSync } from 'node:fs';

const renderer = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

test('draw-only btn gets feel without inventing a link or highlight variant', () => {
  const model = deriveInteractionModel([
    { id: 'chrome', type: 'FRAME', name: 'fix/nav' },
    { id: 'download', type: 'FRAME', name: 'btn/下载按钮', parentId: 'chrome' },
  ]);
  const download = model.attributes.find((entry) => entry.id === 'download')?.attrs;
  assert.equal(download.role, 'button');
  assert.equal(download.tabindex, '0');
  assert.equal(download['data-btn-press'], 'true');
  assert.equal(download['data-btn-action'], 'unresolved');
  assert.equal(download['data-link'], undefined);
  assert.equal(download['data-btn-variant'], undefined);
});

test('named @link action is pressable and not unresolved', () => {
  const model = deriveInteractionModel([
    { id: 'official', type: 'FRAME', name: 'btn/官网按钮@link=official' },
  ]);
  const attrs = model.attributes.find((entry) => entry.id === 'official')?.attrs;
  assert.equal(attrs['data-link'], 'official');
  assert.equal(attrs['data-sec-target'], undefined);
  assert.equal(attrs['data-btn-press'], 'true');
  assert.equal(attrs['data-btn-action'], undefined);
});

test('disabled independent avatar is inert and does not get hover feel', () => {
  const graph = {
    componentSetId: 'avatar-set',
    variants: [
      { componentId: 'a-normal', name: 'Property 1=normal', interactions: [] },
      { componentId: 'a-highlight', name: 'Property 1=highlight', interactions: [] },
      { componentId: 'a-disable', name: 'Property 1=disable', interactions: [] },
    ],
  };
  const model = deriveInteractionModel([
    { id: 'avatar', type: 'INSTANCE', name: 'btn/角色头像', componentProperties: { 'Property 1': { value: 'disable', type: 'VARIANT' } }, componentVariantGraph: graph },
  ]);
  const attrs = model.attributes.find((entry) => entry.id === 'avatar')?.attrs;
  assert.equal(attrs['data-btn-press'], 'inert');
  assert.equal(attrs['aria-disabled'], 'true');
  assert.equal(attrs['data-btn-variant'], undefined);
});

test('source-backed highlight variant stays distinct from CSS press', () => {
  const graph = {
    componentSetId: 'lang-set',
    variants: [
      { componentId: 'lang-normal', name: 'Property 1=normal', interactions: [] },
      { componentId: 'lang-highlight', name: 'Property 1=highlight', interactions: [] },
    ],
  };
  const model = deriveInteractionModel([
    { id: 'lang', type: 'INSTANCE', name: 'btn/多语言切换按钮', componentProperties: { 'Property 1': { value: 'normal', type: 'VARIANT' } }, componentVariantGraph: graph },
  ]);
  const attrs = model.attributes.find((entry) => entry.id === 'lang')?.attrs;
  assert.equal(attrs['data-btn-variant'], 'true');
  assert.equal(attrs['data-btn-press'], 'true');
  assert.equal(attrs['data-btn-action'], undefined);
});

test('prev/next and tabs inherit press feel without becoming pages', () => {
  const model = deriveInteractionModel([
    { id: 'switch', type: 'INSTANCE', name: 'switch/role', parentId: 'section' },
    { id: 'tab', type: 'FRAME', name: 'tab/role', parentId: 'section' },
    { id: 'prev', type: 'BOOLEAN_OPERATION', name: 'btn/prev', parentId: 'section' },
    { id: 'section', type: 'FRAME', name: 'sec/one' },
  ]);
  const byId = new Map(model.attributes.map((x) => [x.id, x.attrs]));
  assert.equal(byId.get('prev')['data-switch-action'], 'prev');
  assert.equal(byId.get('prev')['data-btn-press'], 'true');
  assert.equal(byId.get('prev')['data-swpage'], undefined);
  assert.equal(byId.get('tab')['data-btn-press'], 'true');
});

test('global CSS is brightness, hover-gated, and has no transition', () => {
  const css = buttonPressCss();
  assert.match(css, /--fx-hover-brightness:1\.12/);
  assert.match(css, /--fx-press-brightness:0\.88/);
  assert.match(css, /@media \(hover: hover\)/);
  assert.match(css, /filter:brightness\(var\(--fx-hover-brightness\)\)/);
  assert.match(css, /filter:brightness\(var\(--fx-press-brightness\)\)/);
  assert.equal(BUTTON_PRESS_TOKENS.transition, 'none');
  assert.ok(!/transition:\s*[^n]/.test(css));
  assert.match(BUTTON_PRESS_SELECTOR, /\[data-btn-press="true"\]/);
});

test('renderer payload carries the press stylesheet for offline demos', () => {
  const payload = buildRendererInteractionPayload(deriveInteractionModel([
    { id: 'download', type: 'FRAME', name: 'btn/下载按钮' },
  ]));
  assert.equal(payload.buttonPress.schema, 'figma-button-press-contract/v1');
  assert.match(payload.buttonPress.css, /brightness/);
  assert.match(payload.buttonPress.keyboard, /el\.click\(\)/);
});

test('renderer injects the press stylesheet and does not treat brightness as highlight', () => {
  assert.match(renderer, /data-fx-button-press/);
  assert.match(renderer, /--fx-hover-brightness:1\.12/);
  assert.match(renderer, /data-btn-press/);
  assert.match(renderer, /data-btn-action/);
  assert.doesNotMatch(renderer, /filter:brightness\(1\.1[25]\).*highlight/);
});

test('attachButtonPressAttrs does not mark unnamed frames as buttons', () => {
  const next = attachButtonPressAttrs({ 'data-node': 'title' }, { role: null });
  assert.equal(next.role, undefined);
  assert.equal(next['data-btn-press'], undefined);
});
