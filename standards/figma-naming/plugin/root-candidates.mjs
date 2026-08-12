/**
 * root-candidates.mjs — collect plausible page roots from a selected node.
 *
 * Rule: walk from the node up through `parent` until PAGE. A node is a
 * candidate only when it is a FRAME and its subtree contains at least one
 * `sec/`. INSTANCE and COMPONENT_SET are never candidates themselves, but the
 * walk continues through them so a selection inside an instance can still find
 * the page frame above it.
 */
import { parseName } from "../src/parse.mjs";

export function enumerateRootCandidates(node) {
  const candidates = [];
  let current = node;
  let isSelf = true;

  while (current && current.type !== "PAGE") {
    if (current.type === "FRAME") {
      const secTotal = countSec(current);
      if (secTotal > 0) {
        candidates.push({ node: current, secTotal, isSelf });
      }
    }
    if (!current.parent) break;
    current = current.parent;
    isSelf = false;
  }

  return candidates;
}

function countSec(node) {
  let total = 0;
  if (parseName(node.name).prefix === "sec") total++;
  for (const child of node.children ?? []) {
    total += countSec(child);
  }
  return total;
}
