// Generic deterministic text-layout diagnostics and repair planning.
// Translation values are never changed here. Plans are evidence objects;
// callers must apply only actions explicitly supported by their renderer.

const FIXED_ROLES = new Set(['nav', 'activity-calendar', 'heading-content-card', 'character-skill-label']);

function finite(value) { return Number.isFinite(Number(value)); }

export function classifyTextLayoutIssue({ truth = {}, browser = {}, semanticClass = null, role = null } = {}) {
  const container = browser.container || truth.container || {};
  const openFlow = container.mode === 'open-flow' || container.openFlow === true;
  const lineCounts = Array.isArray(browser.lineGraphemeCounts)
    ? browser.lineGraphemeCounts.map((x) => Number(x)).filter(Number.isFinite)
    : [];
  const lastLine = lineCounts.length ? lineCounts[lineCounts.length - 1] : null;
  const singleTailLine = lineCounts.length > 1 && lastLine === 1;
  const horizontalOverflow = browser.layoutHorizontalOverflow === true
    || (finite(browser.scrollWidth) && finite(browser.clientWidth) && Number(browser.scrollWidth) > Number(browser.clientWidth) + 0.5);
  const verticalGrowth = openFlow && (browser.verticalGrowth === true
    || (finite(browser.clientHeight) && finite(container.sourceBoxHeight)
      && Number(browser.clientHeight) > Number(container.sourceBoxHeight) + 0.5));
  const issues = [];
  if (singleTailLine) issues.push('single-tail-line');
  if (horizontalOverflow) issues.push('horizontal-overflow');
  if (verticalGrowth) issues.push('vertical-growth');
  // Figma/text exports may preserve LF, CRLF, or Unicode line separators.
  // Count source breaks without normalizing or rewriting the adopted copy.
  const sourceCharacters = String(truth.characters ?? truth.text?.characters ?? '');
  const explicitBreaks = (sourceCharacters.match(/[\r\n\u2028\u2029]/gu) || []).length;
  const lineCountMismatch = explicitBreaks > 0 && lineCounts.length > 0 && lineCounts.length < explicitBreaks + 1;
  if (lineCountMismatch) issues.push('bad-line-break');
  return {
    mode: openFlow ? 'open-flow' : 'framed-fixed',
    role: role || truth.role || semanticClass || 'unknown',
    lineCount: lineCounts.length,
    lineGraphemeCounts: lineCounts,
    lastLineGraphemes: lastLine,
    singleTailLine,
    horizontalOverflow,
    verticalGrowth,
    lineCountMismatch,
    issues,
    ok: issues.every((issue) => issue === 'vertical-growth'),
  };
}

export function buildTextLayoutRepairPlan({ truth = {}, browser = {}, semanticClass = null, role = null, issue = null } = {}) {
  const classification = issue || classifyTextLayoutIssue({ truth, browser, semanticClass, role });
  const openFlow = classification.mode === 'open-flow';
  const actions = [{ action: 'preserve-font-metrics', status: 'required', reason: 'Figma font size/line height remain source truth' }];
  const unresolved = [];
  if (classification.singleTailLine) {
    actions.push({ action: 'prefer-pretty-wrap', status: openFlow ? 'safe-candidate' : 'conditional', reason: 'avoid a one-grapheme final line without changing font metrics' });
    if (truth.layoutAdjustable === true || truth.layout?.adjustable === true) {
      actions.push({ action: 'adjust-component-position-or-gap', status: 'evidence-backed', reason: 'truth permits component movement' });
    } else {
      unresolved.push({ issue: 'single-tail-line', reason: 'no explicit truth permission to move the component' });
    }
  }
  if (classification.horizontalOverflow) {
    if (openFlow) {
      actions.push({ action: 'enforce-section-inline-bound', status: 'required', reason: 'open-flow width is bounded by section geometry' });
      unresolved.push({ issue: 'horizontal-overflow', reason: 'text exceeds section bound; movement/width change needs truth evidence' });
    } else if (truth.text?.truncation || truth.text?.autoResize === 'TRUNCATE') {
      actions.push({ action: 'apply-fidelity-truncation', status: 'allowed', reason: 'Figma explicitly requests truncation' });
    } else {
      unresolved.push({ issue: 'horizontal-overflow', reason: 'framed text has no explicit truncation permission' });
    }
  }
  if (classification.lineCountMismatch) unresolved.push({ issue: 'bad-line-break', reason: 'source explicit breaks and browser line count disagree' });
  if (classification.verticalGrowth) actions.push({ action: 'allow-natural-vertical-growth', status: 'expected', reason: 'open-flow text is not height-clipped' });
  const status = unresolved.length ? 'human-review' : 'planned';
  return { schema: 'translation-text-layout-repair/v1', status, mode: classification.mode, issues: classification.issues, actions, unresolved };
}

export function assessTextLayout(records = []) {
  const list = Array.isArray(records) ? records : [];
  const classified = list.map((record) => {
    const issue = record.layout || classifyTextLayoutIssue({
      truth: record.source || record.truth || {},
      browser: record.browser || {},
      semanticClass: record.semanticClass,
      role: record.role,
    });
    const plan = record.layoutPlan || buildTextLayoutRepairPlan({
      truth: record.source || record.truth || {}, browser: record.browser || {},
      semanticClass: record.semanticClass, role: record.role, issue,
    });
    return { ...record, layout: issue, layoutPlan: plan };
  });
  const failures = classified.filter((record) => !record.layout.ok && record.layout.issues.some((x) => x !== 'vertical-growth'));
  return {
    ok: failures.length === 0,
    status: failures.length ? 'failed' : 'passed',
    total: classified.length,
    failed: failures.length,
    byIssue: failures.reduce((out, record) => {
      for (const issue of record.layout.issues) if (issue !== 'vertical-growth') out[issue] = (out[issue] || 0) + 1;
      return out;
    }, {}),
    failures: failures.slice(0, 100),
    records: classified,
  };
}
