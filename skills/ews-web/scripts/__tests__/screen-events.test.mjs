import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenController } from '../../assets/runtime/ews-screen-runtime.mjs';

function setup() {
  const listeners = new Map();
  const windowRef = {
    innerWidth: 390, innerHeight: 844,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
  };
  return { listeners, controller: createScreenController({ screens: ['a', 'b'], footer: true, windowRef }) };
}

test('standard TouchEvent upward swipe advances and destroy removes every listener', () => {
  const { listeners, controller } = setup();
  listeners.get('touchstart')({ touches: [{ clientX: 100, clientY: 500 }], target: {} });
  listeners.get('touchend')({ changedTouches: [{ clientX: 100, clientY: 100 }], target: {} });
  assert.equal(controller.getState().screen, 'b');
  controller.destroy();
  assert.equal(listeners.size, 0);
});

test('horizontal carousel touch changes slide without flipping screen; lock stops it', () => {
  const { listeners, controller } = setup();
  const carousel = { scrollLeft: 0, clientWidth: 700, scrollWidth: 1400 };
  const target = { closest(selector) { return selector === '.ews-carousel' ? carousel : null; } };
  const swipe = () => {
    listeners.get('touchstart')({ touches: [{ clientX: 300, clientY: 100 }], target });
    listeners.get('touchend')({ changedTouches: [{ clientX: 80, clientY: 110 }], target });
  };
  controller.setLocked(true);
  swipe();
  assert.equal(carousel.scrollLeft, 0);
  controller.setLocked(false);
  swipe();
  assert.equal(carousel.scrollLeft, 700);
  assert.equal(controller.getState().screen, 'a');
  controller.destroy();
});
