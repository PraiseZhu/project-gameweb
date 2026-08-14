// Reusable component-motion contracts for Figma-to-Web verification.
// Figma provides the static end state. Browser/official-site evidence may
// refine behavior; missing evidence stays configurable/unverified.

export const MOTION_CONTRACT_SCHEMA = 'figma-motion-contract/v1';
export const MOTION_PATTERNS = Object.freeze([
  'hero-kv-reveal',
  'activity-calendar-reveal',
  'heading-content-card-reveal',
  'character-switch-transition',
  'tabs-card-state-change',
  'scroll-progress-trigger',
  'navigation-footer-entry',
]);

/* Carousel interaction is a reusable motion contract, not a page-specific
   component implementation. Main Skill supplies the page/slot graph; Motion
   owns the gesture threshold and settle timeline once that graph is proven. */
export const MOTION_INTERACTION_PATTERNS = Object.freeze([
  'carousel-snap-transition',
  'horizontal-drag-scroll',
]);

export const MOTION_CAROUSEL_SCHEMA = 'figma-motion-carousel/v1';

/* Official-site observations are normalized into generic primitives. These
   names are intentionally free of hashed classes, page IDs, and selectors. */
export const MOTION_PRIMITIVES = Object.freeze([
  'blur-scale-in',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'fade-in-from-left',
  'clip-circle',
  'clip-center',
  'arrow-loop-y',
  'arrow-loop-x',
  'mouse-parallax-x',
]);

/* 官方动效默认模板:来自真实产品线官网实测基线(私有证据,2026-08-06 观察记录,
   不入发布面)。**公开包不绑定任何站点**:site 留空,适配器必须由使用方显式提供
   site 才构建 —— 这是冻结的内部 fallback,不是对某个具体站点的通用声明。 */
export const OFFICIAL_MOTION_TEMPLATE = Object.freeze({
  schema: 'official-motion-template/v1',
  site: '',
  roles: Object.freeze({
    kvBrand: Object.freeze({
      trigger: 'mount',
      entries: Object.freeze([
        Object.freeze({ primitive: 'slide-down', durationMs: 400, delayMs: 200, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    kvTitle: Object.freeze({
      trigger: 'mount',
      entries: Object.freeze([
        Object.freeze({ primitive: 'blur-scale-in', durationMs: 800, delayMs: 300, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    kvPrimaryAction: Object.freeze({
      trigger: 'mount',
      entries: Object.freeze([
        Object.freeze({ primitive: 'slide-up', durationMs: 400, delayMs: 800, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    activityCalendar: Object.freeze({
      trigger: 'intersection',
      entries: Object.freeze([
        Object.freeze({ primitive: 'slide-down', durationMs: 400, delayMs: 0, easing: 'ease-out', source: 'official-observed' }),
        Object.freeze({ primitive: 'slide-up', durationMs: 400, delayMs: 200, easing: 'ease-out', source: 'official-observed' }),
        Object.freeze({ primitive: 'slide-up', durationMs: 400, delayMs: 400, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    headingContentCard: Object.freeze({
      trigger: 'intersection',
      entries: Object.freeze([
        Object.freeze({ primitive: 'slide-down', durationMs: 400, delayMs: 0, easing: 'ease-out', source: 'official-observed' }),
        Object.freeze({ primitive: 'slide-up', durationMs: 400, delayMs: 200, easing: 'ease-out', source: 'official-observed' }),
        Object.freeze({ primitive: 'slide-left', durationMs: 400, delayMs: 500, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    characterSkill: Object.freeze({
      trigger: 'intersection-or-slide-active',
      entries: Object.freeze([
        Object.freeze({ primitive: 'clip-circle', durationMs: 500, delayMs: 0, easing: 'ease-out', source: 'official-observed' }),
        Object.freeze({ primitive: 'slide-left', durationMs: 400, delayMs: 100, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    navigationFooter: Object.freeze({
      trigger: 'mount-or-intersection',
      entries: Object.freeze([
        Object.freeze({ primitive: 'slide-right', durationMs: 400, delayMs: 400, easing: 'ease-out', source: 'official-observed' }),
      ]),
    }),
    scrollIndicator: Object.freeze({
      trigger: 'mount',
      entries: Object.freeze([
        Object.freeze({ primitive: 'arrow-loop-y', durationMs: 2000, delayMs: 0, easing: 'ease-in-out', iteration: 'infinite', source: 'official-observed' }),
      ]),
    }),
  }),
  mouseParallax: Object.freeze({
    trigger: 'mousemove',
    minViewportWidth: 751,
    transitionMs: 200,
    easing: 'ease-out',
    backgroundRangePercent: 0.75,
    foregroundRangePercent: 0.25,
    resetAtCenter: true,
    navigationStopsPropagation: true,
    source: 'official-observed',
  }),
  interaction: Object.freeze({
    componentVariantTransition: Object.freeze({
      schema: 'figma-motion-component-variant/v1',
      pattern: 'fade-replace',
      roles: Object.freeze(['sourceDevice']),
      durationMs: 300,
      easing: 'ease',
      behaviorEvidence: Object.freeze({
        status: 'observed',
        source: 'official-browser',
        note: '官网源器组件使用 loop=true、effect=fade、speed=300；只用于 truth-backed sourceDevice 的完整 alternate component trees；其他变体无精确官网时间线时保持立即替换。',
      }),
    }),
  }),
});

export function mouseParallaxState({ clientX = 0, viewportWidth = 0, backgroundRangePercent = 0.75, foregroundRangePercent = 0.25 } = {}) {
  const width = Number(viewportWidth);
  const x = width > 0 ? Math.min(1, Math.max(0, Number(clientX) / width)) : 0.5;
  const bg = Number(backgroundRangePercent) || 0;
  const fg = Number(foregroundRangePercent) || 0;
  return {
    progress: x,
    backgroundPercent: bg * (1 - 2 * x),
    foregroundPercent: fg * (2 * x - 1),
  };
}

export function buildOfficialMotionAdapter({ site = '', sourceUrl = '', evidence = null, template = OFFICIAL_MOTION_TEMPLATE } = {}) {
  const normalizedSite = String(site || '').trim().toLowerCase();
  /* fail-closed:使用方必须显式声明站点;站点未声明的调用不再隐式绑定任何站。 */
  if (!normalizedSite) return null;
  /* 模板自身绑定了站点时,站点不符不建适配器(防把 A 站观察的模板套到 B 站);
     默认模板 site 为空 = 中性基线,任何显式站点都可构建,站点由使用方署名。 */
  const templateSite = String(template?.site || '').trim().toLowerCase();
  if (templateSite && templateSite !== normalizedSite) return null;
  const observations = Array.isArray(evidence) ? evidence : [];
  return {
    schema: 'official-motion-adapter/v1',
    site: normalizedSite,
    sourceUrl: String(sourceUrl),
    status: observations.length ? 'observed' : 'unverified',
    template,
    evidenceCount: observations.length,
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeTrigger(trigger = {}) {
  const start = finiteOrNull(trigger.start) ?? 0;
  const end = finiteOrNull(trigger.end) ?? 1;
  return {
    type: trigger.type || 'scroll-progress',
    start,
    end: Math.max(start, end),
    once: trigger.once === true,
  };
}

export function buildMotionContract({
  pattern,
  targetKey = null,
  trigger = {},
  duration = null,
  easing = null,
  stagger = null,
  figmaEndState = {},
  behaviorEvidence = null,
  configurable = true,
} = {}) {
  if (!MOTION_PATTERNS.includes(pattern)) return null;
  const durationMs = finiteOrNull(duration);
  const staggerMs = finiteOrNull(stagger);
  const evidenceStatus = behaviorEvidence?.status || 'unverified';
  return {
    schema: MOTION_CONTRACT_SCHEMA,
    pattern,
    targetKey: targetKey == null ? null : String(targetKey),
    trigger: normalizeTrigger(trigger),
    behavior: {
      durationMs,
      easing: easing || null,
      staggerMs,
      status: evidenceStatus,
      configurable: configurable !== false,
    },
    figmaEndState: figmaEndState || {},
    behaviorEvidence: behaviorEvidence ? {
      status: evidenceStatus,
      source: behaviorEvidence.source || null,
      note: behaviorEvidence.note || null,
    } : null,
  };
}

export function scrollProgressState(contract, progress = 0) {
  const trigger = contract?.trigger || normalizeTrigger();
  const value = clamp(Number(progress) || 0, 0, 1);
  const range = Math.max(0.000001, trigger.end - trigger.start);
  const normalized = clamp((value - trigger.start) / range, 0, 1);
  const phase = value < trigger.start ? 'before' : value >= trigger.end ? 'after' : 'active';
  return { progress: value, normalized, phase, once: trigger.once };
}

export function buildRevealPlan({ pattern, itemKeys = [], progress = 0, stagger = 0, duration = 1 } = {}) {
  const allowed = ['activity-calendar-reveal', 'heading-content-card-reveal'];
  if (!allowed.includes(pattern)) return null;
  const keys = itemKeys.map((key) => String(key));
  const step = Math.max(0, Number(stagger) || 0);
  const span = Math.max(0.000001, Number(duration) || 1);
  const items = keys.map((key, index) => {
    const local = clamp(((Number(progress) || 0) - index * step) / span, 0, 1);
    return { key, index, progress: local, phase: local <= 0 ? 'before' : local >= 1 ? 'visible' : 'entering' };
  });
  return { pattern, progress: clamp(Number(progress) || 0, 0, 1), items };
}

export function buildStateTransition({ pattern, from, to, progress = 0, behaviorEvidence = null } = {}) {
  const allowed = ['character-switch-transition', 'tabs-card-state-change'];
  if (!allowed.includes(pattern) || from == null || to == null) return null;
  const value = clamp(Number(progress) || 0, 0, 1);
  return {
    pattern,
    from: String(from),
    to: String(to),
    progress: value,
    phase: value <= 0 ? 'from' : value >= 1 ? 'to' : 'transitioning',
    behaviorStatus: behaviorEvidence?.status || 'unverified',
  };
}

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function buildCarouselContract({
  axis = 'x',
  durationMs = 300,
  easing = 'ease-out',
  thresholdRatio = 0.5,
  thresholdPx = 24,
  flickMs = 300,
  loop = false,
  interruptible = true,
  behaviorEvidence = null,
} = {}) {
  const evidenceStatus = behaviorEvidence?.status || 'unverified';
  return {
    schema: MOTION_CAROUSEL_SCHEMA,
    pattern: 'carousel-snap-transition',
    axis: axis === 'y' ? 'y' : 'x',
    settle: {
      durationMs: Math.max(0, finite(durationMs, 300)),
      easing: String(easing || 'ease-out'),
      interruptible: interruptible !== false,
    },
    gesture: {
      thresholdRatio: Math.min(1, Math.max(0, finite(thresholdRatio, 0.5))),
      thresholdPx: Math.max(0, finite(thresholdPx, 24)),
      flickMs: Math.max(0, finite(flickMs, 300)),
    },
    loop: loop === true,
    behaviorEvidence: {
      status: evidenceStatus,
      source: behaviorEvidence?.source || null,
      note: behaviorEvidence?.note || null,
    },
  };
}

export function carouselIndex({ current = 0, delta = 0, pageCount = 0, loop = false } = {}) {
  const count = Math.max(0, Math.floor(finite(pageCount, 0)));
  if (!count) return null;
  const base = Math.min(count - 1, Math.max(0, Math.floor(finite(current, 0))));
  const step = Math.trunc(finite(delta, 0));
  if (!step) return base;
  const next = base + step;
  if (loop) return ((next % count) + count) % count;
  return Math.min(count - 1, Math.max(0, next));
}

export function carouselGesture({
  startX = 0,
  startY = 0,
  currentX = 0,
  currentY = 0,
  elapsedMs = 0,
  viewportSize = 0,
  thresholdRatio = 0.5,
  thresholdPx = 24,
  flickMs = 300,
  axis = 'x',
} = {}) {
  const dx = finite(currentX, 0) - finite(startX, 0);
  const dy = finite(currentY, 0) - finite(startY, 0);
  const main = axis === 'y' ? dy : dx;
  const cross = axis === 'y' ? dx : dy;
  const size = Math.max(1, Math.abs(finite(viewportSize, 0)));
  const ratio = Math.min(1, Math.max(0, finite(thresholdRatio, 0.5)));
  const distance = Math.abs(main);
  const direction = main === 0 ? 0 : main < 0 ? 1 : -1;
  const axisIntent = distance >= Math.abs(cross);
  const commit = axisIntent && (distance >= Math.max(Math.abs(finite(thresholdPx, 24)), size * ratio)
    || (distance > 0 && Math.max(0, finite(elapsedMs, 0)) <= Math.max(0, finite(flickMs, 300))));
  return {
    axis: axis === 'y' ? 'y' : 'x',
    dx,
    dy,
    distance,
    progress: Math.min(1, distance / size),
    direction: commit ? direction : 0,
    axisIntent,
    commit,
  };
}

export function carouselSettlePlan({ from = 0, to = 0, progress = 0, durationMs = 300, easing = 'ease-out' } = {}) {
  const p = Math.min(1, Math.max(0, finite(progress, 0)));
  return {
    from: Math.trunc(finite(from, 0)),
    to: Math.trunc(finite(to, 0)),
    progress: p,
    phase: p <= 0 ? 'from' : p >= 1 ? 'to' : 'settling',
    durationMs: Math.max(0, finite(durationMs, 300)),
    easing: String(easing || 'ease-out'),
  };
}

export function validateCarouselContract(contract) {
  const errors = [];
  if (!contract || contract.schema !== MOTION_CAROUSEL_SCHEMA) errors.push('schema');
  if (contract?.pattern !== 'carousel-snap-transition') errors.push('pattern');
  if (!['x', 'y'].includes(contract?.axis)) errors.push('axis');
  if (!contract?.settle || !Number.isFinite(contract.settle.durationMs)) errors.push('settle');
  if (!contract?.gesture || !Number.isFinite(contract.gesture.thresholdRatio)) errors.push('gesture');
  return { ok: errors.length === 0, errors };
}

export function validateMotionContract(contract) {
  const errors = [];
  if (!contract || contract.schema !== MOTION_CONTRACT_SCHEMA) errors.push('schema');
  if (!MOTION_PATTERNS.includes(contract?.pattern)) errors.push('pattern');
  if (!contract?.trigger || !Number.isFinite(contract.trigger.start) || !Number.isFinite(contract.trigger.end)) errors.push('trigger');
  if (!contract?.figmaEndState || typeof contract.figmaEndState !== 'object') errors.push('figmaEndState');
  return { ok: errors.length === 0, errors };
}
