import { sameModulesOf } from '../../figma-naming/tool/src/handoff.mjs';

/**
 * 在 one-page B 入口做双端配对：复用旧交接包「按 sec 限定再唯一同名」规则。
 * 已配对 / 真单端 / 歧义分开记录；双端未匹配不自动当单端。
 */
export function pairEnds({ platform, pc = null, mobile = null } = {}) {
  const dual = platform === 'pc+mobile';
  const pcDoc = platform === 'mobile' ? null : pc;
  const mobileDoc = platform === 'pc' ? null : mobile;
  const raw = sameModulesOf(pcDoc, mobileDoc);
  return {
    paired: raw.paired,
    trueSingleEnd: dual ? [] : raw.unmatched,
    unmatchedDual: dual ? raw.unmatched : [],
    ambiguous: raw.ambiguous,
  };
}
