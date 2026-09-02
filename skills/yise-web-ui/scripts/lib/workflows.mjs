import { translationAxisClaim } from './translation/locale-policy.mjs';

export const WORKFLOW_IDS = ['figma-showcase', 'product-qa'];

/** Two human-facing review stops. Axis order stays Main → Translation → Interaction → Resize. */
export const HUMAN_REVIEW_STOPS = Object.freeze([
  {
    id: 'static-and-translation',
    after: Object.freeze(['Main static', 'Translation']),
    presentPage: true,
    prompt: '静态（有翻译表才带翻译）完成。打开 index.html QA 壳给人看（含切换器）。没问题再说继续，才做交互和拉伸。',
  },
  {
    id: 'interaction-and-resize',
    after: Object.freeze(['Interaction', 'Resize']),
    presentPage: true,
    prompt: '交互和自适应完成。再次打开 index.html QA 壳给人看（含切换器）。没问题再说继续，才 Pack。',
  },
]);

export const WORKFLOW_DECLARATIONS = {
  'figma-showcase': {
    id: 'figma-showcase',
    title: 'Figma showcase preview-first',
    completion: 'candidate-product-view-preview',
    productViewPath: 'index.html?product=1',
    requires: { productRepo: false, trueSandbox: false, pullRequest: false },
    sourcePlatforms: ['desktop'],
    claimedCapabilities: {
      desktopSourcePlatform: 'claimed',
      mobileSourcePlatform: 'not-claimed',
      responsiveAcceptance: 'not-claimed',
      pixelGridComparison: 'not-claimed',
      productRepoIntegration: 'not-claimed',
      pullRequestEvidence: 'not-claimed',
    },
  },
  'product-qa': {
    id: 'product-qa',
    title: 'Product QA evidence gates',
    completion: 'verified-gated-product-qa',
    productViewPath: 'index.html',
    requires: { productRepo: true, trueSandbox: true, pullRequest: true },
    sourcePlatforms: ['desktop'],
    claimedCapabilities: {
      desktopSourcePlatform: 'claimed',
      mobileSourcePlatform: 'when-declared',
      responsiveAcceptance: 'claimed-by-gate-f',
      pixelGridComparison: 'claimed-by-gate-e',
      productRepoIntegration: 'claimed',
      pullRequestEvidence: 'claimed',
    },
  },
};

export function workflowDeclaration(id) {
  return WORKFLOW_DECLARATIONS[id] ? JSON.parse(JSON.stringify(WORKFLOW_DECLARATIONS[id])) : null;
}

export function workflowProblem(id) {
  if (id == null) return null;
  if (!WORKFLOW_IDS.includes(id)) return `--workflow 只能是 ${WORKFLOW_IDS.join(' | ')}(当前 ${JSON.stringify(id)})`;
  return null;
}

export function declaredSourcePlatforms(spec) {
  const platforms = [];
  const push = (value) => {
    if (typeof value === 'string' && value) platforms.push(value);
  };
  if (Array.isArray(spec?.workflow?.sourcePlatforms)) spec.workflow.sourcePlatforms.forEach(push);
  if (Array.isArray(spec?.figma?.sourcePlatforms)) spec.figma.sourcePlatforms.forEach(push);
  return [...new Set(platforms)];
}

export function availableSourcePlatformsFromTruth(truth) {
  const platforms = [];
  const push = (value) => {
    if (typeof value === 'string' && value) platforms.push(value);
  };
  if (Array.isArray(truth?.sourcePlatforms)) truth.sourcePlatforms.forEach(push);
  if (truth?.sourcePlatform) push(truth.sourcePlatform);
  for (const section of Object.values(truth?.sections ?? {})) {
    push(section?.platform);
    push(section?.meta?.platform);
    push(section?.meta?.sourcePlatform);
  }
  return [...new Set(platforms)];
}

export function sourcePlatformEvidence(spec, truth) {
  const declared = declaredSourcePlatforms(spec);
  const available = availableSourcePlatformsFromTruth(truth);
  const claimed = [...new Set([...declared, ...available])];
  return {
    declared,
    available,
    claimed,
    status: claimed.length ? 'claimed' : 'not-claimed',
    note: claimed.length
      ? 'source platform evidence comes from spec.workflow/spec.figma declaration or truth metadata'
      : 'no source platform declared or observed; platform coverage is not claimed',
  };
}

export function unclaimedCapabilitiesFor(spec, truth) {
  const id = spec?.workflow?.id || null;
  const declaration = WORKFLOW_DECLARATIONS[id] || null;
  const evidence = sourcePlatformEvidence(spec, truth);
  const unclaimed = [];
  const caps = declaration?.claimedCapabilities ?? {};
  const hasMobileEvidence = evidence.claimed.includes('mobile') || evidence.claimed.includes('phone');
  for (const [cap, value] of Object.entries(caps)) {
    if (cap === 'mobileSourcePlatform' && hasMobileEvidence) continue;
    if (value === 'not-claimed') unclaimed.push(cap);
  }
  if (!hasMobileEvidence) {
    if (!unclaimed.includes('mobileSourcePlatform')) unclaimed.push('mobileSourcePlatform');
  }
  if (id === 'figma-showcase') {
    for (const cap of ['productRepoIntegration', 'trueSandboxVerification', 'pullRequestEvidence', 'fullVerifyGates']) {
      if (!unclaimed.includes(cap)) unclaimed.push(cap);
    }
  }
  const translation = translationAxisClaim({ spec, truth });
  if (!translation.claimed && !unclaimed.includes('independentTranslation')) {
    unclaimed.push('independentTranslation');
  }
  return unclaimed;
}

export function humanReviewStopAfterPreviewFirst({ spec = {}, truth = {}, previewOk = false } = {}) {
  if (!previewOk) {
    return {
      id: null,
      presentPage: false,
      nextHumanStep: 'preview:first 红了不许给人打开 index.html，也不许开 Interaction / Resize。',
    };
  }
  const translation = translationAxisClaim({ spec, truth });
  const stop = HUMAN_REVIEW_STOPS[0];
  return {
    id: stop.id,
    presentPage: true,
    translation,
    nextHumanStep: translation.claimed
      ? 'preview:first 已绿。第一次给人看：Main 静态 + 翻译。等人说继续，才做交互和拉伸。'
      : `preview:first 已绿。第一次给人看：Main 静态。${translation.note} 等人说继续，才做交互和拉伸。`,
  };
}
