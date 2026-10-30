import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenController } from '../../assets/runtime/ews-screen-runtime.mjs';

function setup(options = {}) {
  const listeners = new Map();
  const windowRef = {
    innerWidth: 390, innerHeight: 844,
    addEventListener(name, handler) { listeners.set(name, handler); },
    removeEventListener(name, handler) { if (listeners.get(name) === handler) listeners.delete(name); },
  };
  return { listeners, controller: createScreenController({ screens: ['a', 'b'], footer: true, windowRef, ...options }) };
}

test('whole-page mode advances on a small wheel input even over overflowing content', () => {
  const { listeners, controller } = setup();
  const scroller = { scrollTop: 0, scrollHeight: 3000, clientHeight: 844 };
  let prevented = false;
  listeners.get('wheel')({ deltaY: 1, target: { closest: s => s === '.ews-screen-scroll' ? scroller : null }, preventDefault() { prevented = true; } });
  assert.equal(controller.getState().screen, 'b');
  assert.equal(scroller.scrollTop, 0); assert.equal(prevented, true);
  controller.destroy();
});

test('second vertical swipe during 300ms animation lock does not skip a screen', () => {
  const { listeners, controller } = setup();
  const swipeUp = () => {
    listeners.get('touchstart')({ touches: [{ clientX: 100, clientY: 500 }], target: {} });
    listeners.get('touchend')({ changedTouches: [{ clientX: 100, clientY: 100 }], target: {} });
  };
  swipeUp();
  assert.equal(controller.getState().screen, 'b');
  swipeUp();
  assert.equal(controller.getState().screen, 'b');
  assert.equal(controller.getState().transitioning, true);
  controller.destroy();
});

test('standard TouchEvent upward swipe advances and destroy removes every listener', () => {
  const { listeners, controller } = setup();
  listeners.get('touchstart')({ touches: [{ clientX: 100, clientY: 500 }], target: {} });
  listeners.get('touchend')({ changedTouches: [{ clientX: 100, clientY: 100 }], target: {} });
  assert.equal(controller.getState().screen, 'b');
  controller.destroy();
  assert.equal(listeners.size, 0);
});

test('inert horizontal paged-viewport touch does not change cards or screen', () => {
  const { listeners, controller } = setup();
  const viewport = { scrollLeft: 0, clientWidth: 800, scrollWidth: 1600 };
  const target = { closest(selector) { return selector.includes('.ews-paged-viewport') ? viewport : null; } };
  listeners.get('touchstart')({ touches: [{ clientX: 400, clientY: 120 }], target });
  listeners.get('touchend')({ changedTouches: [{ clientX: 80, clientY: 130 }], target });
  assert.equal(viewport.scrollLeft, 0);
  assert.equal(controller.getState().screen, 'a');
  controller.destroy();
});

test('live horizontal paged-viewport touch leaves paging to the paged runtime and does not flip screen', () => {
  const { listeners, controller } = setup({ enablePageInteraction: true });
  const viewport = { scrollLeft: 0, clientWidth: 800, scrollWidth: 1600, classList: { contains: (c) => c === 'ews-paged-viewport' } };
  const target = { closest(selector) { return selector.includes('.ews-paged-viewport') ? viewport : null; } };
  listeners.get('touchstart')({ touches: [{ clientX: 400, clientY: 120 }], target });
  listeners.get('touchend')({ changedTouches: [{ clientX: 80, clientY: 130 }], target });
  assert.equal(viewport.scrollLeft, 0);
  assert.equal(controller.getState().screen, 'a');
  controller.destroy();
});

test('horizontal carousel touch changes slide without flipping screen; lock stops it', () => {
  const { listeners, controller } = setup({ enablePageInteraction: true });
  const carousel = { scrollLeft: 0, clientWidth: 700, scrollWidth: 1400 };
  const target = { closest(selector) { return String(selector).includes('.ews-carousel') ? carousel : null; } };
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
