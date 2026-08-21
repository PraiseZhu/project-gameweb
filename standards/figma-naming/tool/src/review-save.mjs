import { basename, resolve } from "node:path";
import { writeFilesAtomically } from "./atomic-writeback.mjs";
import { rebuildInventoryIndexes, renderHumanSummary } from "./inventory.mjs";

const INV_NAME_RE = /^inventory-[A-Za-z0-9._-]+\.json$/;

/** 源清单：inventory-*.json，排除保存产物 *.reviewed.json 和 *-feedback.json，避免列表套娃。 */
export function isSourceInventoryFile(name) {
  const n = String(name || "");
  if (!INV_NAME_RE.test(n)) return false;
  if (n.endsWith(".reviewed.json") || n.endsWith("-feedback.json")) return false;
  return true;
}

/** 核对页保存：重建索引后同时写 reviewed.json + reviewed.txt。备份/回滚交给 writeFilesAtomically。 */
export function persistReviewedInventory(root, file, inv) {
  if (!isSourceInventoryFile(file || "")) {
    const error = new Error("bad file");
    error.code = "bad-file";
    throw error;
  }
  if (inv?.schema !== "inventory/v2" || !Array.isArray(inv.nodes)) {
    const error = new Error("不是 inventory/v2");
    error.code = "bad-inventory";
    throw error;
  }
  const base = resolve(root);
  const reviewedPath = resolve(base, file.replace(/\.json$/, ".reviewed.json"));
  const txtPath = reviewedPath.replace(/\.json$/, ".txt");
  if (!reviewedPath.startsWith(`${base}/`) || !txtPath.startsWith(`${base}/`)) {
    const error = new Error("bad file");
    error.code = "bad-file";
    throw error;
  }
  rebuildInventoryIndexes(inv);
  inv.reviewedAt = new Date().toISOString();
  writeFilesAtomically([
    [reviewedPath, `${JSON.stringify(inv, null, 2)}\n`],
    [txtPath, renderHumanSummary(inv)],
  ]);
  return {
    ok: true,
    path: basename(reviewedPath),
    txt: basename(txtPath),
    counts: inv.counts,
  };
}
