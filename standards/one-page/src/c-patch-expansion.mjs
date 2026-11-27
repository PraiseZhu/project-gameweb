import { canonicalJson } from './canonical.mjs';
import { pixelScope } from './c-check/pixel-scope.mjs';

const common = (path) => /^page\/(?:css\/(?:styles\.css|mobile\.css|locales\.css|font\/[^/]+)|js\/(?:config|main)\.js)$/.test(path);
const same = (left,right) => canonicalJson(left) === canonicalJson(right);

export function sharedExpansion(page, previousFiles) {
  const prior = Object.fromEntries(Object.entries(previousFiles).filter(([path]) => common(path)).sort());
  const all = [...new Set([...Object.keys(prior), ...Object.keys(page.files).filter(common)])].sort();
  const changed = all.filter((path) => !same(prior[path],page.files[path]));
  return { prior, changed, states:changed.length ? pixelScope(page).map(({ screen,caseId }) => ({ end:screen.end,screen:screen.domId,caseId })) : [] };
}

export function verifySharedExpansion(page, report, expansion) {
  if (!expansion || !same(expansion,sharedExpansion(page,expansion.prior))
    || !expansion.states.every((state) => report.pixels.filter((pixel) => pixel.screenId === state.screen && pixel.caseId === state.caseId
      && pixel.domId === state.screen && !pixel.region && pixel.status === 'pass').length === 1)) throw new Error('共用依赖扩验缺同版整屏证据');
}
