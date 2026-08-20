import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateTypographyEvidence,
  evaluatePageFlowEvidence,
  evaluateFixedChromeEvidence,
  evaluateResizeEvidence,
  evaluateInteractionEvidence,
  evaluateRegionComparisonEvidence,
} from './visual-completion-gate.mjs';

const blocked = (reason, detail = {}) => ({ complete: false, blocked: true, failures: [{ reason, ...detail }] });
const array = (value) => Array.isArray(value) ? value : [];

function collectTypography(snapshot = {}, source = {}) {
  const faces = array(snapshot.fontFaces);
  const records = array(snapshot.records).map((record) => ({
    ...record,
    provenance: record.provenance || source.fonts?.[record.family] || null,
    browser: {
      ...(record.browser || {}),
      documentFontsStatus: record.browser?.documentFontsStatus || snapshot.documentFontsStatus || 'unknown',
      documentFontsCheck: record.browser?.documentFontsCheck === true,
      computedFamily: record.browser?.computedFamily || record.computedFamily || null,
      resolvedFamily: record.browser?.resolvedFamily || record.resolvedFamily || null,
      fallback: record.browser?.fallback === true || record.fallback === true,
      glyphsMissing: record.browser?.glyphsMissing === true || record.glyphsMissing === true,
    },
  }));
  const result = { schema: 'yise-typography-visual-evidence/v1', platform: snapshot.platform || source.platform || null, viewport: snapshot.viewport || source.viewport || null, sourceRef: source.fontManifest || null, fontFaces: faces, records };
  const evaluation = evaluateTypographyEvidence({ ...result, complete: true });
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

function collectPageFlow(snapshot = {}, source = {}) {
  const result = {
    schema: 'yise-page-flow-evidence/v1', platform: snapshot.platform || source.platform || null, viewport: snapshot.viewport || source.viewport || null,
    sourceRef: source.truth || null, states: array(snapshot.states),
    scrollContainer: snapshot.scrollContainer || null,
    sections: array(snapshot.sections).map((section) => ({ ...section, reachable: section.reachable === true, intersectsViewport: section.intersectsViewport === true })),
  };
  const evaluation = evaluatePageFlowEvidence({ ...result, complete: true });
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

function collectFixedChrome(snapshot = {}, source = {}) {
  const result = { schema: 'yise-fixed-chrome-evidence/v1', platform: snapshot.platform || source.platform || null, viewport: snapshot.viewport || source.viewport || null, sourceRef: source.truth || null,
    brand: snapshot.brand || null, rail: snapshot.rail || null, decorative: snapshot.decorative || null, active: snapshot.active || null, anchors: snapshot.anchors || null,
    viewportAnchored: snapshot.viewportAnchored === true, scrollBehaviorMeasured: snapshot.scrollBehaviorMeasured === true, scrollSamples: array(snapshot.scrollSamples) };
  const evaluation = evaluateFixedChromeEvidence(result);
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

function collectResize(snapshot = {}, source = {}) {
  const result = { schema: 'yise-resize-evidence/v1', sourceRef: source.truth || null, runtimeWired: snapshot.runtimeWired === true, planePolicy: snapshot.planePolicy || null, cropPolicy: snapshot.cropPolicy || null,
    viewports: array(snapshot.viewports).map((viewport) => ({ ...viewport, measured: viewport.measured === true })) };
  const evaluation = evaluateResizeEvidence(result);
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

function collectInteraction(snapshot = {}, source = {}) {
  const result = { schema: 'yise-interaction-evidence/v1', platform: snapshot.platform || source.platform || null, viewport: snapshot.viewport || source.viewport || null, sourceRef: source.truth || null,
    runtimeWired: snapshot.runtimeWired === true, steps: array(snapshot.steps).map((step) => ({ input: step.input || null, observedState: step.observedState || null, target: step.target || null, screenshot: step.screenshot || null })) };
  const evaluation = evaluateInteractionEvidence(result);
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

function collectComparison(snapshot = {}, source = {}) {
  const result = { schema: 'yise-region-comparison-evidence/v1', complete: snapshot.complete === true, platform: snapshot.platform || source.platform || null, viewport: snapshot.viewport || source.viewport || null,
    figmaImage: snapshot.figmaImage || source.figmaImage || null, localImage: snapshot.localImage || null, intendedSections: array(snapshot.intendedSections), regions: array(snapshot.regions), status: snapshot.status || 'blocked', evidenceLevel: snapshot.evidenceLevel || 'not-claimed', notClaimed: snapshot.notClaimed === true,
    sourceRef: source.figmaImage || null };
  const evaluation = evaluateRegionComparisonEvidence(result);
  return { ...result, complete: evaluation.complete, failures: evaluation.failures, blocked: !evaluation.complete };
}

export function collectVisualEvidence({ runtime = {}, source = {}, comparison = null } = {}) {
  const typography = collectTypography(runtime.typography || {}, source);
  const pageFlow = collectPageFlow(runtime.pageFlow || {}, source);
  const fixedChrome = collectFixedChrome(runtime.fixedChrome || {}, source);
  const resize = collectResize(runtime.resize || {}, source);
  const interaction = collectInteraction(runtime.interaction || {}, source);
  const regionComparison = collectComparison(comparison || runtime.comparison || {}, source);
  const failures = [typography, pageFlow, fixedChrome, resize, interaction, regionComparison].flatMap((part) => part.failures || []);
  return { schema: 'yise-final-visual-evidence-collection/v1', platform: source.platform || null, viewport: source.viewport || null, source, typography, pageFlow, fixedChrome, resize, interaction, comparison: regionComparison, complete: failures.length === 0, blocked: failures.length > 0, failures };
}

export function collectVisualEvidenceFromFile(inputPath) {
  if (!existsSync(inputPath)) return { schema: 'yise-final-visual-evidence-collection/v1', complete: false, blocked: true, failures: [{ reason: 'collector-input-missing', inputPath }] };
  try { return collectVisualEvidence(JSON.parse(readFileSync(inputPath, 'utf8'))); }
  catch (error) { return { schema: 'yise-final-visual-evidence-collection/v1', complete: false, blocked: true, failures: [{ reason: 'collector-input-invalid', message: error.message }] }; }
}

export { collectTypography, collectPageFlow, collectFixedChrome, collectResize, collectInteraction, collectComparison };

if (process.argv[1]?.endsWith('visual-evidence-collector.mjs')) {
  const args = process.argv.slice(2); const inputIndex = args.indexOf('--input'); const outIndex = args.indexOf('--out');
  if (inputIndex < 0 || !args[inputIndex + 1]) { process.stderr.write('usage: node scripts/visual-evidence-collector.mjs --input <snapshot.json> [--out <evidence.json>]\n'); process.exit(2); }
  const result = collectVisualEvidenceFromFile(resolve(args[inputIndex + 1]));
  if (outIndex >= 0 && args[outIndex + 1]) writeFileSync(resolve(args[outIndex + 1]), JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.complete ? 0 : 2);
}
