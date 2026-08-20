import { evaluateVisualCompletionEvidence, evaluateFinalVisualEvidenceChain } from './visual-completion-gate.mjs';

/** Final user-preview gate. Candidate preview evidence is never user delivery. */
const FINAL_EVIDENCE_LEVEL = 'confirmed-final';

export function isCompleteVisualAssetAudit(audit) {
  if (!audit || audit.schema !== 'yise-static-visual-asset-audit/v1') return false;
  if (audit.visualAssetsComplete !== true || audit.complete !== true) return false;
  if (!Array.isArray(audit.requirements) || !Array.isArray(audit.covered) || !Array.isArray(audit.platforms)) return false;
  if (!audit.requirements.length || audit.covered.length !== audit.requirements.length) return false;
  const requiredPlatforms = new Set(audit.requirements.map((entry) => String(entry?.platform || '')).filter(Boolean));
  if (!requiredPlatforms.size) return false;
  return [...requiredPlatforms].every((platform) => {
    const record = audit.platforms.find((entry) => entry?.platform === platform);
    return record?.complete === true && record.requirements === record.covered
      && record.requirements === audit.requirements.filter((entry) => entry.platform === platform).length;
  });
}

function blocked(reason, detail = {}) { return { userPreviewAllowed: false, previewDisposition: 'blocked-not-final-ready', reason, ...detail }; }

export function evaluateFinalPreviewGate({ staticAcceptance = null, visualAssetAudit = null, vectorEvidence = null, compositionEvidence = null, runtimeEvidence = null, finalEvidence = null, report = null, typographyEvidence = null, pageFlowEvidence = null, fixedChromeEvidence = null, resizeEvidence = null, interactionEvidence = null, regionComparisonEvidence = null, typography = null, pageFlow = null, fixedChrome = null, resize = null, interaction = null, comparison = null } = {}) {
  if (!staticAcceptance || staticAcceptance.complete !== true || staticAcceptance.accepted !== true) return blocked('static-acceptance-incomplete');
  if (!isCompleteVisualAssetAudit(visualAssetAudit)) return blocked('static-visual-assets-incomplete');
  if (staticAcceptance.partial === true || report?.partial === true) return blocked('partial-output-not-final');
  const completion = evaluateVisualCompletionEvidence({ visualAssets: visualAssetAudit, vectors: vectorEvidence, composition: compositionEvidence, runtime: runtimeEvidence });
  if (completion.complete !== true) return blocked(completion.failures[0]?.reason || 'visual-completion-evidence-incomplete', { completion });
  const evidenceChain = evaluateFinalVisualEvidenceChain({ typography: typographyEvidence || typography, pageFlow: pageFlowEvidence || pageFlow, fixedChrome: fixedChromeEvidence || fixedChrome, resize: resizeEvidence || resize, interaction: interactionEvidence || interaction, comparison: regionComparisonEvidence || comparison });
  if (evidenceChain.complete !== true) return blocked(evidenceChain.failures[0]?.reason || 'final-visual-evidence-chain-incomplete', { evidenceChain });
  const evidenceLevel = finalEvidence?.evidenceLevel ?? null;
  if (!finalEvidence) return blocked('final-evidence-not-confirmed', { evidenceLevel: null });
  if (staticAcceptance.staticAcceptanceId && finalEvidence.staticAcceptanceId
    && staticAcceptance.staticAcceptanceId !== finalEvidence.staticAcceptanceId) {
    return blocked('final-evidence-static-acceptance-mismatch', {
      staticAcceptanceId: staticAcceptance.staticAcceptanceId,
      finalEvidenceStaticAcceptanceId: finalEvidence.staticAcceptanceId,
    });
  }
  const evidenceAccepted = finalEvidence.accepted === true;
  if (evidenceLevel !== FINAL_EVIDENCE_LEVEL || evidenceAccepted !== true) return blocked('final-evidence-not-confirmed', { evidenceLevel });
  return { userPreviewAllowed: true, previewDisposition: 'final-ready', evidenceLevel: FINAL_EVIDENCE_LEVEL, staticAcceptanceId: staticAcceptance.staticAcceptanceId ?? null, staticTruthRef: staticAcceptance.staticTruthRef ?? null };
}

export function internalCandidatePreview(productView) { return { userPreviewAllowed: false, previewDisposition: 'internal-candidate-only', productView }; }
export { FINAL_EVIDENCE_LEVEL };
