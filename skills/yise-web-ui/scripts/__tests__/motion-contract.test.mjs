import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveMotionRoles, deriveSectionMotionRole } from '../lib/motion-role.mjs';
import {
  MOTION_PATTERNS,
  MOTION_PRIMITIVES,
  OFFICIAL_MOTION_TEMPLATE,
  buildOfficialMotionAdapter,
  mouseParallaxState,
  buildMotionContract,
  buildRevealPlan,
  buildStateTransition,
  buildCarouselContract,
  carouselIndex,
  carouselGesture,
  carouselSettlePlan,
  validateCarouselContract,
  scrollProgressState,
  validateMotionContract,
} from '../lib/motion-contract.mjs';
import { buildMotionEvidence } from '../lib/translation/evidence-schema.mjs';

const render = readFileSync(new URL('../../templates/figma-render.js', import.meta.url), 'utf8');

test('all reusable component motion patterns are schema-valid without page IDs', () => {
  assert.deepEqual(MOTION_PATTERNS, [
    'hero-kv-reveal',
    'activity-calendar-reveal',
    'heading-content-card-reveal',
    'character-switch-transition',
    'tabs-card-state-change',
    'scroll-progress-trigger',
    'navigation-footer-entry',
  ]);
  for (const pattern of MOTION_PATTERNS) {
    const contract = buildMotionContract({ pattern, targetKey: 'synthetic-target', figmaEndState: { box: { width: 100, height: 40 } } });
    assert.equal(validateMotionContract(contract).ok, true);
    assert.equal(contract.behavior.status, 'unverified');
  }
});

test('官网 adapter 只输出语义角色和通用 primitive，不泄漏 hashed selector/node id', () => {
  assert.ok(MOTION_PRIMITIVES.includes('blur-scale-in'));
  assert.ok(MOTION_PRIMITIVES.includes('fade-in-from-left'));
  /* 公开包不绑定任何站点:模板 site 留空,适配器必须由使用方显式提供 site。 */
  assert.equal(OFFICIAL_MOTION_TEMPLATE.site, '');
  assert.equal(buildOfficialMotionAdapter({ evidence: [{ source: 'official-browser' }] }), null, '未显式声明站点不许隐式构建适配器');
  const adapter = buildOfficialMotionAdapter({
    site: 'example.official.example',
    sourceUrl: 'https://example.official.example/',
    evidence: [{ viewport: { width: 1440, height: 900 }, source: 'official-browser' }],
  });
  assert.equal(adapter.status, 'observed');
  assert.equal(adapter.site, 'example.official.example');
  assert.equal(adapter.template.roles.kvTitle.entries[0].primitive, 'blur-scale-in');
  assert.equal(adapter.template.roles.kvTitle.entries[0].durationMs, 800);
  assert.equal(adapter.template.roles.kvPrimaryAction.entries[0].primitive, 'slide-up');
  assert.equal(adapter.template.roles.activityCalendar.trigger, 'intersection');
  assert.equal(adapter.template.roles.scrollIndicator.entries[0].primitive, 'arrow-loop-y');
  assert.equal(adapter.template.mouseParallax.minViewportWidth, 751);
  /* 模板自身绑定站点时,站点不符不建适配器(防把 A 站观察套到 B 站)。 */
  assert.equal(
    buildOfficialMotionAdapter({ site: 'other.example', template: Object.freeze({ site: 'bound.example' }) }),
    null,
  );
  const serialized = JSON.stringify(adapter);
  assert.doesNotMatch(serialized, /i_[a-z0-9]{6,}/);
  assert.doesNotMatch(serialized, /\b(?:1|12):\d+\b/);
});

test('KV mouse parallax keeps background and foreground at opposing semantic depths', () => {
  const left = mouseParallaxState({ clientX: 0, viewportWidth: 1440 });
  const center = mouseParallaxState({ clientX: 720, viewportWidth: 1440 });
  const right = mouseParallaxState({ clientX: 1440, viewportWidth: 1440 });
  assert.equal(left.backgroundPercent, 0.75);
  assert.equal(left.foregroundPercent, -0.25);
  assert.equal(center.backgroundPercent, 0);
  assert.equal(center.foregroundPercent, 0);
  assert.equal(right.backgroundPercent, -0.75);
  assert.equal(right.foregroundPercent, 0.25);
});

test('calendar and heading-card reveals support progress and stagger without display-state assumptions', () => {
  const calendar = buildRevealPlan({ pattern: 'activity-calendar-reveal', itemKeys: ['day-a', 'day-b', 'day-c'], progress: 0.8, stagger: 0.2, duration: 0.6 });
  assert.equal(calendar.items[0].phase, 'visible');
  assert.equal(calendar.items[1].phase, 'visible');
  assert.equal(calendar.items[2].phase, 'entering');
  const cards = buildRevealPlan({ pattern: 'heading-content-card-reveal', itemKeys: ['heading', 'card'], progress: 1, stagger: 0.1 });
  assert.equal(cards.items[0].phase, 'visible');
  assert.equal(cards.items[1].phase, 'entering');
});

test('character switch and tabs/card state changes preserve explicit from/to state', () => {
  assert.deepEqual(buildStateTransition({ pattern: 'character-switch-transition', from: 'a', to: 'b', progress: 0.5 }), {
    pattern: 'character-switch-transition', from: 'a', to: 'b', progress: 0.5, phase: 'transitioning', behaviorStatus: 'unverified',
  });
  assert.equal(buildStateTransition({ pattern: 'tabs-card-state-change', from: 'tab-a', to: 'tab-b', progress: 1 }).phase, 'to');
});

test('carousel contract keeps interaction mechanics generic and truth-gated', () => {
  const contract = buildCarouselContract({
    durationMs: 300,
    thresholdRatio: 0.5,
    thresholdPx: 24,
    flickMs: 300,
    loop: true,
    behaviorEvidence: { status: 'observed', source: 'official-browser' },
  });
  assert.equal(validateCarouselContract(contract).ok, true);
  assert.equal(contract.settle.durationMs, 300);
  assert.equal(contract.gesture.thresholdRatio, 0.5);
  assert.equal(contract.behaviorEvidence.status, 'observed');
  assert.equal(carouselIndex({ current: 0, delta: -1, pageCount: 3, loop: true }), 2);
  assert.equal(carouselIndex({ current: 2, delta: 1, pageCount: 3, loop: false }), 2);
  const swipe = carouselGesture({ startX: 0, currentX: -180, startY: 0, currentY: 12, viewportSize: 300, elapsedMs: 400 });
  assert.equal(swipe.axisIntent, true);
  assert.equal(swipe.commit, true);
  assert.equal(swipe.direction, 1);
  assert.deepEqual(carouselSettlePlan({ from: 0, to: 1, progress: 0.5, durationMs: 300 }), {
    from: 0,
    to: 1,
    progress: 0.5,
    phase: 'settling',
    durationMs: 300,
    easing: 'ease-out',
  });
});

test('scroll-progress trigger has before/active/after phases and keeps unknown behavior configurable', () => {
  const contract = buildMotionContract({
    pattern: 'scroll-progress-trigger',
    trigger: { start: 0.2, end: 0.8, once: true },
    figmaEndState: { opacity: 1 },
  });
  assert.equal(scrollProgressState(contract, 0.1).phase, 'before');
  assert.ok(Math.abs(scrollProgressState(contract, 0.5).normalized - 0.5) < 1e-9);
  assert.equal(scrollProgressState(contract, 0.9).phase, 'after');
  assert.equal(contract.behavior.configurable, true);
  assert.equal(contract.behavior.durationMs, null);
  assert.equal(contract.behavior.easing, null);
  const evidence = buildMotionEvidence({ contract, viewport: { width: 390, height: 844 }, progress: 0.5 });
  assert.equal(evidence.schema, 'figma-motion-evidence/v1');
  assert.equal(evidence.status, 'unverified');
});

test('renderer motion bridge is optional and semantic-role based', () => {
  assert.match(render, /_installMotionAdapter/);
  assert.match(render, /data-motion-role/);
  assert.match(render, /sourceDevice/);
  assert.match(render, /figma-motion-blur-scale-in/);
  assert.match(render, /figma-motion-fade-in-from-left/);
  assert.match(render, /figma-motion-clip-center/);
  assert.match(render, /ctx\.motionAdapter \|\| ctx\.motion/);
  assert.match(render, /data-motion-role="kv-background"/);
  assert.match(render, /data-motion-role="kv-foreground"/);
  assert.match(render, /data-motion-parallax-x/);
  assert.match(render, /scrollIndicator/);
  assert.match(render, /root: frame/);
  assert.match(render, /prefers-reduced-motion: reduce/);
  assert.match(render, /_installCarouselMotion/);
  assert.match(render, /data-motion-carousel-page/);
  assert.match(render, /data-motion-carousel-tab/);
  assert.match(render, /data-motion-carousel-indicator/);
  assert.match(render, /thresholdRatio/);
  assert.match(render, /data-motion-carousel-prev/);
  assert.match(render, /data-motion-carousel-next/);
  assert.match(render, /componentVariantTransition/);
  assert.match(render, /fade-replace/);
  assert.match(render, /data-motion-variant-duration/);
  assert.match(render, /prefersReducedMotion\(\)/);
  assert.match(render, /@keyframes figma-motion-slide-up\{from\{opacity:0;translate:/);
  assert.doesNotMatch(render, /@keyframes figma-motion-slide-up\{from\{opacity:0;transform:/);
  assert.match(render, /heroStage\.style\.translate/);
  assert.doesNotMatch(render, /data-motion-role="(?:1|12):\d+"/);
});

test('renderer materializes complete component-set variants as immediate replacement, not a carousel claim', () => {
  assert.match(render, /componentVariantGraph/);
  assert.match(render, /data-switch-page-source.*component-set-variant/);
  assert.match(render, /data-switch-transition.*immediate/);
  assert.match(render, /data-switch-variant-layer/);
  assert.match(render, /data-switch-variant-base/);
  assert.match(render, /suppressInteractions: true/);
  assert.match(render, /layer\.hidden = true/);
});

test('component-set variant mount keeps canvas roots out of the instance content layer', () => {
  /* The COMPONENT root is source geometry for a component-set canvas.  The
     rendered page already has the INSTANCE root, so adding both creates a
     second coordinate system and can duplicate/offset alternate content. */
  assert.match(render, /skipNodeIds/);
  assert.match(render, /roots\.length !== 1/);
  assert.match(render, /blocked-invalid-owner-local-root/);
  assert.match(render, /data-switch-variant-root-origin/);
  assert.match(render, /data-switch-variant-content/);
  assert.match(render, /owner-local-mutually-exclusive/);
  assert.match(render, /skipNodeIds: new Set\(\[String\(__u\(root\.id\)\)\]\)/);
  /* A fade may animate the incoming layer, but never leaves two full variant
     trees visible together. */
  assert.match(render, /previous\.hidden = true/);
  assert.doesNotMatch(render, /previous\.hidden = false/);
});

test('official adapter keeps component-variant fade evidence separate from fabricated carousel tracks', () => {
  const adapter = buildOfficialMotionAdapter({ site: 'example.official.example', evidence: [{ source: 'official-browser' }] });
  const variant = adapter.template.interaction.componentVariantTransition;
  assert.equal(variant.schema, 'figma-motion-component-variant/v1');
  assert.equal(variant.pattern, 'fade-replace');
  assert.deepEqual(variant.roles, ['sourceDevice']);
  assert.equal(variant.durationMs, 300);
  assert.equal(variant.behaviorEvidence.status, 'observed');
  assert.match(variant.behaviorEvidence.note, /完整 alternate component trees/);
});

test('truth semantic motion roles avoid section titles, ordinals, and node IDs', () => {
  const truth = {
    sections: {
      later: { meta: { y: 200 }, nodes: [{ id: 'later-title', name: '标题', type: 'FRAME' }] },
      first: {
        meta: { y: 0 },
        nodes: [
          { id: 'bg', name: 'kv/背景', type: 'RECTANGLE' },
          { id: 'fg', name: 'kv/中景', type: 'RECTANGLE' },
          { id: 'brand', name: 'img/logo', type: 'FRAME' },
          { id: 'title-logo', name: 'img/title-logo', type: 'FRAME' },
          { id: 'download-fill', name: 'img/button-background', type: 'RECTANGLE', ownerPath: ['hero', 'download', 'download-fill'], ancestorNames: ['sec/hero', 'btn/download'] },
          { id: 'download-label-host', name: 'Frame', type: 'FRAME', ownerPath: ['hero', 'download', 'download-label-host'], ancestorNames: ['sec/hero', 'btn/download'] },
          { id: 'download-label', name: 'download', type: 'TEXT', ownerPath: ['hero', 'download', 'download-label-host', 'download-label'], ancestorNames: ['sec/hero', 'btn/download', 'Frame'] },
          { id: 'calendar', name: 'mix/calendar', type: 'FRAME' },
          { id: 'source', name: 'switch/source', type: 'INSTANCE' },
          { id: 'character', name: 'switch/角色', type: 'INSTANCE' },
          { id: 'skill', name: '技能1', type: 'FRAME' },
          { id: 'card', name: '内容框', type: 'FRAME' },
        ],
      },
    },
    pageChrome: { nodes: [{ id: 'bg', name: 'kv/背景', type: 'RECTANGLE' }, { id: 'fg', name: 'kv/中景', type: 'RECTANGLE' }] },
    fixedOverlays: { nodes: [{ id: 'nav', name: 'fix/左侧导航', type: 'INSTANCE' }] },
  };
  const roles = deriveMotionRoles(truth);
  assert.equal(roles.get('bg').role, 'kv-background');
  assert.equal(roles.get('fg').role, 'kv-foreground');
  assert.equal(roles.get('brand').role, 'kvBrand');
  assert.equal(roles.get('title-logo').role, 'kvTitle');
  assert.equal(roles.get('download-fill').role, 'kvPrimaryAction');
  assert.equal(roles.get('download-label-host').role, 'kvPrimaryAction');
  assert.equal(roles.has('download-label'), false);
  assert.equal(roles.get('calendar').role, 'activityCalendar');
  assert.equal(roles.get('source').role, 'sourceDevice');
  assert.equal(roles.get('character').role, 'characterSkill');
  assert.equal(roles.get('skill').step, 1);
  assert.equal(roles.get('card').role, 'headingContentCard');
  assert.equal(roles.get('nav').role, 'navigationFooter');
  assert.equal(roles.get('nav').navigation, true);
  const indicator = deriveMotionRoles({ pageChrome: { nodes: [{ id: 'arrow', name: 'img/下滑箭头', type: 'BOOLEAN_OPERATION' }] } }).get('arrow');
  assert.equal(indicator.role, 'scrollIndicator');
  assert.equal(deriveSectionMotionRole({ sectionIndex: 0, section: truth.sections.first }).role, 'kv');
  assert.equal(deriveSectionMotionRole({ sectionIndex: 1, section: truth.sections.later }), null);
  assert.doesNotMatch(readFileSync(new URL('../lib/motion-role.mjs', import.meta.url), 'utf8'), /sec\/\d|(?:1|12):\d+/);
});
