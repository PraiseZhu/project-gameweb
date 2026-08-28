export const COMPONENT_PREFLIGHT_SCHEMA = 'component-preflight/v1';
export const COMPONENT_PREFLIGHT_FAMILY = 'source-width-hug-owner-text-growth-crop-consumption';

const DEFAULT_TOLERANCE = 2;

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function lower(value) {
  return String(value ?? '').toLowerCase();
}

function rectOf(value = {}) {
  return {
    x: num(value.x, 0),
    y: num(value.y, 0),
    w: num(value.w ?? value.width, 0),
    h: num(value.h ?? value.height, 0),
  };
}

function axisSize(rect, axis) {
  return axis === 'horizontal' ? rect.w : rect.h;
}

function axisName(axis) {
  return axis === 'horizontal' ? 'width' : 'height';
}

function platformEntries(input) {
  if (Array.isArray(input?.platforms)) return input.platforms;
  return [{ label: input?.platform || input?.platformLabel || 'default', components: arr(input?.components) }];
}

function componentTolerance(component) {
  return num(component?.tolerancePx ?? component?.expect?.tolerancePx ?? component?.source?.tolerancePx, DEFAULT_TOLERANCE);
}

function componentKey(platform, component) {
  return `${platform}:${component.id ?? component.key ?? component.name ?? 'unknown-component'}`;
}

function makeFailure({ code, platform, component, message, evidence, severity = 'blocking' }) {
  const key = componentKey(platform, component);
  return {
    code,
    severity,
    stage: 'renderer',
    rootCauseFamily: COMPONENT_PREFLIGHT_FAMILY,
    source: 'component-preflight',
    platform,
    componentId: String(component.id ?? component.key ?? ''),
    componentName: component.name ?? null,
    key,
    message,
    evidence,
    ledger: {
      source: 'component-preflight',
      key,
      message,
      stage: 'renderer',
      rootCauseFamily: COMPONENT_PREFLIGHT_FAMILY,
      severity,
      evidence,
    },
  };
}

function styleContainsMaxContent(style = {}) {
  return ['width', 'minWidth', 'maxWidth', 'flexBasis'].some((prop) => lower(style[prop]).includes('max-content'));
}

function stepFitScale(component) {
  const fit = component?.chrome?.fit || component?.chrome?.text?.fit || {};
  const direct = num(component?.chrome?.fitScale, null);
  if (direct != null) return direct;
  return num(fit.scale ?? fit.scalePercent ?? fit.percent, null);
}

function isStepFitAuthorized(component) {
  return component?.expect?.allowStepFit === true
    || component?.source?.fitAuthorized === true
    || component?.source?.truncation === true
    || lower(component?.source?.textAutoResize).includes('truncate')
    || lower(component?.source?.textTruncation).includes('ending')
    || component?.source?.clipsContent === true;
}

function clipAncestors(component) {
  const explicit = arr(component?.chrome?.clipAncestors);
  if (explicit.length) return explicit;
  return arr(component?.chrome?.ancestors).filter((ancestor) => {
    const overflow = `${ancestor?.overflow ?? ancestor?.style?.overflow ?? ''} ${ancestor?.style?.overflowX ?? ''} ${ancestor?.style?.overflowY ?? ''}`;
    return /hidden|clip|scroll|auto/.test(lower(overflow)) || ancestor?.clipsContent === true;
  });
}

function requiredTextHidden(component, tolerance) {
  const text = component?.chrome?.text || {};
  if (!(component?.expect?.requiredText === true || text.required === true || component?.source?.requiredText === true)) return null;
  const visibleRatio = num(text.visibleRatio ?? text.visibleTextRatio, null);
  if (text.visible === false || visibleRatio === 0) return { reason: 'text-not-visible', visibleRatio };
  const scrollW = num(text.scrollW ?? text.scrollWidth, null);
  const clientW = num(text.clientW ?? text.clientWidth, null);
  const scrollH = num(text.scrollH ?? text.scrollHeight, null);
  const clientH = num(text.clientH ?? text.clientHeight, null);
  const clippedX = scrollW != null && clientW != null && scrollW > clientW + tolerance;
  const clippedY = scrollH != null && clientH != null && scrollH > clientH + tolerance;
  if ((clippedX || clippedY) && clipAncestors(component).length) {
    return { reason: 'required-text-clipped-by-ancestor', clippedX, clippedY, scrollW, clientW, scrollH, clientH };
  }
  return null;
}

export function analyzeComponent(platform, component) {
  const failures = [];
  const tolerance = componentTolerance(component);
  const source = rectOf(component?.source?.box || component?.source);
  const chrome = rectOf(component?.chrome?.rect || component?.chrome);

  if ((component?.expect?.preserveSourceWidth ?? component?.source?.preserveWidth ?? true) && source.w > 0 && chrome.w > 0) {
    const loss = source.w - chrome.w;
    if (loss > tolerance) {
      failures.push(makeFailure({
        code: 'source-width-loss',
        platform,
        component,
        message: `source width lost: Chrome rect width ${chrome.w} is ${loss.toFixed(2)}px narrower than source owner width ${source.w}`,
        evidence: { sourceBox: source, chromeRect: chrome, delta: { w: chrome.w - source.w }, tolerancePx: tolerance },
      }));
    }
  }

  const style = component?.chrome?.style || {};
  if (styleContainsMaxContent(style) && component?.expect?.allowMaxContent !== true && component?.source?.allowMaxContent !== true) {
    failures.push(makeFailure({
      code: 'unauthorized-max-content',
      platform,
      component,
      message: 'unauthorized max-content sizing: Chrome style uses max-content without source authorization',
      evidence: { style, allowedBy: 'expect.allowMaxContent or source.allowMaxContent' },
    }));
  }

  const scale = stepFitScale(component);
  if (scale != null && scale < 100 - 0.01 && !isStepFitAuthorized(component)) {
    failures.push(makeFailure({
      code: 'unauthorized-step-fit',
      platform,
      component,
      message: `unauthorized step-fit: Chrome fit scale ${scale}% without fixed/truncation/clip authorization`,
      evidence: { fitScale: scale, source: component?.source, allowedBy: 'explicit truncation/clipsContent/expect.allowStepFit' },
    }));
  }

  const hug = component?.source?.hug || component?.expect?.hug || null;
  if (hug) {
    const axis = hug.axis === 'horizontal' ? 'horizontal' : 'vertical';
    const minGrowth = num(hug.minGrowthPx ?? component?.expect?.minHugGrowthPx, 0);
    const sourceSize = num(hug.sourceSize, axisSize(source, axis));
    const minExpected = sourceSize + minGrowth;
    const actualSize = axisSize(chrome, axis);
    if (minGrowth > 0 && actualSize + tolerance < minExpected) {
      failures.push(makeFailure({
        code: 'insufficient-hug-growth',
        platform,
        component,
        message: `insufficient HUG growth: Chrome ${axisName(axis)} ${actualSize} < expected ${minExpected} from source ${sourceSize} + growth ${minGrowth}`,
        evidence: { axis, sourceSize, minGrowthPx: minGrowth, expectedMinSize: minExpected, actualSize, tolerancePx: tolerance, sourceBox: source, chromeRect: chrome },
      }));
    }
  }

  const hidden = requiredTextHidden(component, tolerance);
  if (hidden) {
    failures.push(makeFailure({
      code: 'hidden-required-text-due-to-clip-ancestor',
      platform,
      component,
      message: `hidden required text due to clip ancestor: ${hidden.reason}`,
      evidence: { ...hidden, clipAncestors: clipAncestors(component), text: component?.chrome?.text || {}, source: component?.source || {} },
    }));
  }

  return failures;
}

export function runComponentPreflight(input = {}) {
  const platforms = platformEntries(input);
  const failures = [];
  const platformReports = platforms.map((platformEntry) => {
    const label = String(platformEntry.label ?? platformEntry.platform ?? 'default');
    const components = arr(platformEntry.components);
    const componentReports = components.map((component) => {
      const componentFailures = analyzeComponent(label, component);
      failures.push(...componentFailures);
      return {
        id: component.id ?? component.key ?? null,
        name: component.name ?? null,
        ok: componentFailures.length === 0,
        failures: componentFailures,
      };
    });
    return { label, componentCount: components.length, ok: componentReports.every((entry) => entry.ok), components: componentReports };
  });
  return {
    ok: failures.length === 0,
    schema: COMPONENT_PREFLIGHT_SCHEMA,
    summary: {
      platforms: platformReports.length,
      components: platformReports.reduce((sum, platform) => sum + platform.componentCount, 0),
      failures: failures.length,
      byCode: failures.reduce((acc, failure) => {
        acc[failure.code] = (acc[failure.code] || 0) + 1;
        return acc;
      }, {}),
    },
    platforms: platformReports,
    failures,
  };
}
