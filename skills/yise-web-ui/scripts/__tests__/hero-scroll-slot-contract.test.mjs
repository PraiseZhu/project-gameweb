import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildHeroScrollSlot, assertHeroScrollSlotState } from '../lib/hero-scroll-slot.mjs';

test('generic hero scroll-slot state machine locks, exits progressively, then releases', () => {
  const slot = buildHeroScrollSlot({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'synthetic-hero', y: 0, height: 2200 },
    followingSections: [{ id: 'synthetic-next', y: 2200 }],
    contentRootId: 'synthetic-root',
  });
  assert.equal(slot.extra, 1400);
  assert.equal(slot.layoutOffsetDesign, 1400);
  assert.equal(slot.releaseDistance, 350);
  assert.equal(slot.revealSectionId, null);
  assert.equal(slot.revealDistance, 0);
  assert.deepEqual(slot.stateAt(0), { state: 'HERO_LOCKED', progress: 0, scrollTop: 0 });
  assert.equal(slot.stateAt(175).state, 'HERO_EXITING');
  assert.equal(slot.stateAt(350).state, 'CONTENT_RELEASED');
  assert.equal(slot.stateAt(99999).progress, 1);
  assert.ok(assertHeroScrollSlotState(slot.stateAt(0)));
});

test('insufficient page structure does not guess a hero', () => {
  assert.equal(buildHeroScrollSlot({
    viewportHeight: 900,
    scale: 0.25,
    pageOriginY: 0,
    firstSection: { id: 'synthetic-hero', y: 10, height: 2200 },
    contentRootId: 'synthetic-root',
}), null);
});

test('renderer exposes the generic state contract and does not use a visual cover', () => {
  const render = readFileSync(resolve('templates/figma-render.js'), 'utf8');
  assert.match(render, /_buildHeroScrollSlot/);
  assert.match(render, /_installHeroScrollSlot/);
  assert.match(render, /data-hero-scroll-state/);
  assert.match(render, /HERO_LOCKED/);
  assert.match(render, /HERO_EXITING/);
  assert.match(render, /CONTENT_RELEASED/);
  assert.match(render, /data-hero-slot-role=\"hero\"/);
  assert.match(render, /data-hero-slot-reveal/);
  assert.match(render, /revealDistance/);
  assert.doesNotMatch(render, /slotOffset/);
  assert.match(render, /data-hero-visual-motion/);
  assert.doesNotMatch(render, /display\s*:\s*none[^\n]*hero/i);
});
