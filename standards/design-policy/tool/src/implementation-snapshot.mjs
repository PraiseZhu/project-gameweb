/**
 * Build the implementation snapshot that mirror-design-policy compares to YAML.
 * Skills import this; they must not copy parse/mirror source.
 *
 * Live page numbers must come from chrome / render / shell source, never from YAML.
 */

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseNumericAssign(source, name) {
  const match = new RegExp(`(?:const|var|let)\\s+${name}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)`).exec(source);
  return match ? finiteNumber(match[1]) : null;
}

function parseNumberList(source, pattern) {
  const match = pattern.exec(source);
  if (!match) return null;
  const nums = match[1].split(',').map((part) => finiteNumber(part.replace(/FLOOR|floorPercent|shrinkFloorPercent/g, '').trim())).filter((n) => n != null);
  return nums.length ? nums : null;
}

function parseBreakpoints(source, name) {
  const start = source.search(new RegExp(`${name}\\s*=\\s*\\[`));
  if (start < 0) return null;
  const from = source.indexOf('[', start);
  let depth = 0;
  let end = -1;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1;
    if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const body = source.slice(from, end + 1);
  const items = [];
  const re = /\{\s*key:\s*'([^']+)'\s*,\s*min:\s*(-?\d+(?:\.\d+)?)\s*,\s*max:\s*(null|-?\d+(?:\.\d+)?)\s*\}/g;
  let match;
  while ((match = re.exec(body))) {
    items.push({
      key: match[1],
      min: Number(match[2]),
      max: match[3] === 'null' ? null : Number(match[3]),
    });
  }
  return items.length ? items : null;
}

export function chromeOfficialRootFontVwFromSource(source, { expectedVw = null } = {}) {
  const text = String(source ?? '');
  if (/officialRootFontVw\s*\|\|\s*\d/.test(text) || /__designPolicy\.officialRootFontVw\)\s*\|\|/.test(text)) {
    return null;
  }
  const helper = /function officialRootFontVw\(\)[\s\S]{0,500}designPolicy\(\)\.officialRootFontVw/.test(text)
    && /--fx-official-root:calc\(' \+ officialRootFontVw\(\) \+ 'vw/.test(text);
  if (helper) {
    const expected = Number(expectedVw);
    return Number.isFinite(expected) ? expected : null;
  }
  const literal = /--fx-official-root:calc\((\d+(?:\.\d+)?)vw/.exec(text);
  if (!literal) return null;
  const value = Number(literal[1]);
  return Number.isFinite(value) ? value : null;
}

export function renderDesignWidthsFromSource(source) {
  const text = String(source ?? '');
  if (/const DW = \{ pc: 3840, pad: 3840, mobile: 750 \}/.test(text)
    || /DW\[__base\] \?\? DW\[__plat\] \?\? 3840/.test(text)
    || /DW\[__base\] \|\| 3840/.test(text)) {
    return null;
  }
  if (/designPolicy\(\)\.designWidths/.test(text) || /window\.__designPolicy\.designWidths/.test(text)) {
    return { fromPolicy: true };
  }
  return null;
}

export function renderShrinkFromSource(source) {
  const text = String(source ?? '');
  if (/const FLOOR = 75/.test(text)
    || /for \(const s of \[92, 85, 78, FLOOR\]\)/.test(text)
    || /\[92, 85, 78, 75, 70, FLOORW\]/.test(text)
    || /sourceTitleInlineSafe \? 65 : 75/.test(text)
    || /sourceTitleInlineSafe \? \[92, 85, 78, 75, 70/.test(text)
    || /, 70, FLOORW/.test(text)
    || /, 65\]/.test(text) && /stepsW/.test(text)) {
    return null;
  }
  if (/shrinkFloorPercent/.test(text) && /shrinkSteps/.test(text)
    && /for \(const s of shrinkSteps\)/.test(text)
    && /const FLOORW = Number\(designPolicy\(\)\.shrinkFloorPercent\)/.test(text)
    && /const stepsW = Array\.isArray\(designPolicy\(\)\.shrinkSteps\)/.test(text)
    && /for \(const s of stepsW\)/.test(text)) {
    return { fromPolicy: true };
  }
  const floor = parseNumericAssign(text, 'FLOOR');
  const steps = parseNumberList(text, /for \(const s of \[([^\]]+)\]\)/);
  if (floor == null || !steps) return null;
  return { floor, steps: steps.includes(100) ? steps : [100, ...steps] };
}

export function renderHeroFillVhFromSource(source) {
  const text = String(source ?? '');
  if (/slotScale = Math\.max\(k, viewportH \/ firstHeight\)/.test(text)
    || /slotScale = Math\.max\(k, viewportH \/ Number\(first\.height\)\)/.test(text)) {
    return null;
  }
  if (/heroViewportFillVh/.test(text) && /slotH = viewportH \* \(fillVh \/ 100\)/.test(text)) {
    return { fromPolicy: true };
  }
  const literal = /slotH = viewportH \* \((\d+(?:\.\d+)?) \/ 100\)/.exec(text);
  return literal ? finiteNumber(literal[1]) : null;
}

export function shellCompositionFromSource(source) {
  const text = String(source ?? '');
  if (/compositionBreakpoints:\s*\[\s*\{ key: 'mobile', min: 0, max: 1126 \}/.test(text)) {
    return null;
  }
  if (/get compositionBreakpoints\(\)/.test(text) && /policy\.composition/.test(text)) {
    return { fromPolicy: true };
  }
  if (!/compositionBreakpoints/.test(text)) return [];
  const renamed = text.replace(/compositionBreakpoints:\s*\[/, 'compositionBreakpoints = [');
  return parseBreakpoints(renamed, 'compositionBreakpoints') || [];
}

export function chromeCompositionFromSource(source) {
  const text = String(source ?? '');
  if (/var TORCHLIGHT_COMPOSITION_BREAKPOINTS = \[\s*\{ key: 'mobile', min: 0, max: 1126 \}/.test(text)
    || /max-width: 1126/.test(text) && /TORCHLIGHT_COMPOSITION_BREAKPOINTS/.test(text)) {
    return null;
  }
  if (/designPolicy\(\)\.composition/.test(text) && !/max: 1126/.test(text)) {
    return { fromPolicy: true };
  }
  return parseBreakpoints(text, 'TORCHLIGHT_COMPOSITION_BREAKPOINTS')
    || parseBreakpoints(text, 'COMPOSITION_BREAKPOINTS');
}

function sameBreakpoints(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  if (actual.length !== expected.length) return false;
  return actual.every((bp, i) => bp.key === expected[i].key && Number(bp.min) === Number(expected[i].min) && (bp.max == null ? expected[i].max == null : Number(bp.max) === Number(expected[i].max)));
}

export function implementationSnapshotFromModules({
  resize,
  typography,
  chromeOfficialRootFontVw = null,
  chromeSource = null,
  renderSource = null,
  shellSource = null,
} = {}) {
  if (!resize) throw new Error('implementation snapshot missing resize module');
  if (!typography) throw new Error('implementation snapshot missing typography module');
  const policy = typography.DESIGN_POLICY || resize.DESIGN_POLICY;
  if (!policy) throw new Error('implementation snapshot missing DESIGN_POLICY');
  const steps = typography.DESIGN_POLICY?.shrinkSteps;
  if (!Array.isArray(steps) || !steps.length) throw new Error('implementation snapshot missing shrinkSteps');
  if (typeof resize.PAD_USES_PC_TREE !== 'boolean') {
    throw new Error('implementation snapshot missing PAD_USES_PC_TREE');
  }
  if (typeof resize.INVENT_PAD_TREE !== 'boolean') {
    throw new Error('implementation snapshot missing INVENT_PAD_TREE');
  }
  const chromeVw = chromeSource != null
    ? chromeOfficialRootFontVwFromSource(chromeSource, { expectedVw: resize.OFFICIAL_ROOT_FONT_VW })
    : chromeOfficialRootFontVw;
  if (chromeSource != null && chromeVw == null) {
    throw new Error('implementation snapshot missing chromeOfficialRootFontVw in chrome source');
  }
  if (renderSource != null) {
    const widths = renderDesignWidthsFromSource(renderSource);
    if (!widths || widths.fromPolicy !== true) {
      throw new Error('implementation snapshot missing live render designWidths');
    }
    const shrink = renderShrinkFromSource(renderSource);
    if (!shrink) throw new Error('implementation snapshot missing live render shrinkSteps');
    if (shrink.fromPolicy !== true) {
      if (shrink.steps.join(',') !== steps.join(',')) {
        throw new Error(`implementation snapshot render shrinkSteps [${shrink.steps.join(',')}] != YAML [${steps.join(',')}]`);
      }
      if (Number(shrink.floor) !== Number(policy.shrinkFloorPercent)) {
        throw new Error(`implementation snapshot render FLOOR ${shrink.floor} != YAML ${policy.shrinkFloorPercent}`);
      }
    }
    const hero = renderHeroFillVhFromSource(renderSource);
    if (!hero || hero.fromPolicy !== true) {
      throw new Error('implementation snapshot missing live render heroViewportFillVh');
    }
  }
  if (chromeSource != null) {
    const chromeComp = chromeCompositionFromSource(chromeSource);
    if (!chromeComp || (chromeComp.fromPolicy !== true && !Array.isArray(chromeComp))) {
      throw new Error('implementation snapshot missing live chrome composition');
    }
    if (Array.isArray(chromeComp) && !sameBreakpoints(chromeComp, policy.composition)) {
      throw new Error('implementation snapshot chrome composition != YAML');
    }
  }
  if (shellSource != null) {
    const shellComp = shellCompositionFromSource(shellSource);
    if (shellComp == null) {
      throw new Error('implementation snapshot missing live shell composition');
    }
    if (shellComp.fromPolicy === true) {
      /* YAML-driven getter */
    } else if (Array.isArray(shellComp) && shellComp.length && !sameBreakpoints(shellComp, policy.composition)) {
      throw new Error('implementation snapshot shell composition != YAML');
    }
  }
  return {
    designWidths: { ...resize.DESIGN_WIDTHS },
    officialRootFontVw: resize.OFFICIAL_ROOT_FONT_VW,
    heroViewportFillVh: resize.HERO_VIEWPORT_FILL_VH,
    composition: [...(resize.COMPOSITION_BREAKPOINTS || resize.TORCHLIGHT_COMPOSITION_BREAKPOINTS || [])],
    qaBuckets: [...(resize.QA_BREAKPOINTS || [])],
    inventPadTree: resize.INVENT_PAD_TREE,
    padUsesPcTree: resize.PAD_USES_PC_TREE,
    localeFontScale: JSON.parse(JSON.stringify(typography.LOCALE_FONT_SCALE)),
    tierRules: { ...policy.tierRules },
    shrinkSteps: [...steps],
    shrinkFloorPercent: policy.shrinkFloorPercent,
    hugNoShrink: policy.hugNoShrink,
    openFlowNoShrink: policy.openFlowNoShrink,
    chromeOfficialRootFontVw: chromeVw,
  };
}
