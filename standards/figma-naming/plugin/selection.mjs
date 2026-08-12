/**
 * selection.mjs — pure selection-change transition.
 *
 * Selection changes only refresh the candidate root dropdown. They never run
 * a scan and never mutate or invalidate an existing result: the result shown
 * is a snapshot of the last explicit "运行体检" action.
 */
import { enumerateRootCandidates } from "./root-candidates.mjs";

export function onSelectionChange(state = {}, selection = null, enumerate = enumerateRootCandidates) {
  const raw = selection ? enumerate(selection) : [];
  const selectedId = state.selectedCandidateId ?? null;
  const selected = raw.find((candidate) => candidate.node.id === selectedId)
    ?? raw[0]
    ?? null;

  return {
    candidates: raw.map(({ node, secTotal, isSelf }) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      secTotal,
      isSelf,
    })),
    runTarget: selected?.node.name ?? null,
    result: state.result ?? null,
    stale: false,
  };
}
