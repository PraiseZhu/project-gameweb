/**
 * root-candidates.mjs — collect plausible page roots from a selected node.
 *
 * Rule: walk from the node up through `parent` until PAGE. A node is a
 * candidate when it is a FRAME and either:
 *   1. its subtree already contains at least one `sec/`（旧稿 / 已命名稿）
 *   2. it is the selected FRAME itself, even with 0 `sec/`（新稿还没分区名）
 *
 * INSTANCE and COMPONENT_SET are never candidates themselves, but the walk
 * continues through them so a selection inside an instance can still find
 * the page frame above it.
 *
 * 为什么第 2 条必须有：候选根闸门原来是给「体检已命名稿」写的——子树没
 * `sec/` 就当选错了。命名工具的主路径正好相反：新页面稿（cn_pc 这类工作
 * 区画板）本来就还没 `sec/`，选中它却报「没有候选根」，「开始命名」点不了。
 * 祖先链上没有含 `sec/` 的 FRAME 时，才把当前选中的 FRAME 自己列进去；
 * 已经有 `sec/` 祖先时不猜、不补，避免把随便一个内层空 FRAME 当成页面根。
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

  // 新稿回退：整条祖先链都没有含 sec/ 的 FRAME，但人选中的就是一个 FRAME。
  // 这时当前节点就是他想命名的范围，不要再挡在下拉框外面。
  if (candidates.length === 0 && node?.type === "FRAME") {
    candidates.push({ node, secTotal: 0, isSelf: true });
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
