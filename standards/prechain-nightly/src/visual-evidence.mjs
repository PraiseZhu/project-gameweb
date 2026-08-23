import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function naturalName(a, b) {
  return a.localeCompare(b, undefined, { numeric: true });
}

export function listJudgeImages(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".jpg"))
    .sort(naturalName);
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function componentSetCount(summaryPath) {
  if (!existsSync(summaryPath)) return null;
  const matches = readFileSync(summaryPath, "utf8").match(/^\s*(?:SET\s+|set-\d+\s+)/gmi);
  return matches ? matches.length : 0;
}

function imageDimensions(path) {
  const run = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", path], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || `无法读取 ${path} 的尺寸`);
  const width = Number(/pixelWidth: (\d+)/.exec(run.stdout)?.[1]);
  const height = Number(/pixelHeight: (\d+)/.exec(run.stdout)?.[1]);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error(`${path} 宽高无效`);
  }
  return { width, height };
}

function inspectPack(dir) {
  const inspect = (prefix) => listJudgeImages(dir, prefix).map((name) => {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.size <= 0) throw new Error(`${path} 是空文件`);
    return { name, bytes: st.size, ...imageDimensions(path) };
  });
  const pages = inspect("page-");
  const sets = inspect("set-");
  const indexedSets = componentSetCount(join(dir, "summary.txt"));
  if (indexedSets == null || sets.length !== indexedSets) {
    throw new Error(`${dir} 的 set jpg ${sets.length} ≠ summary 组件集 ${indexedSets ?? "缺失"}`);
  }
  return { pages, sets };
}

/** G2 的纯机器证据；只读取文件属性和像素，不把图片内容交给模型。 */
export function buildG2Evidence({ judgePc, judgeMobile }) {
  return { pc: inspectPack(judgePc), mobile: inspectPack(judgeMobile) };
}

function walk(value, fn, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, fn, seen));
    return;
  }
  if (typeof value.id === "string" && typeof value.type === "string") fn(value);
  Object.values(value).forEach((item) => walk(item, fn, seen));
}

function writableCandidate(node) {
  return node.status === "unknown" || (node.status === "determined" && !["copy", "ref"].includes(node.role));
}

function target(node) {
  return {
    id: node.id,
    type: node.type,
    name: node.name,
    status: node.status,
    role: node.role ?? null,
    box: node.box ?? null,
    componentId: node.componentId ?? null,
  };
}

function intersectsPageSlice(node, pageBox, slice) {
  if (!node.box || !pageBox || !Number.isFinite(node.box.y) || !Number.isFinite(node.box.h)) return true;
  const top = node.box.y - pageBox.y;
  const bottom = top + node.box.h;
  return bottom > slice.y && top < slice.y + slice.h;
}

function pageTargets(doc, slice) {
  const byId = new Map();
  walk(doc.nodes || [], (node) => {
    if (writableCandidate(node) && intersectsPageSlice(node, doc.page?.box, slice)) byId.set(node.id, target(node));
  });
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function componentSetTargets(doc, componentSetId) {
  const set = (doc.attachments?.componentSets || []).find((item) => item.id === componentSetId);
  if (!set) throw new Error(`找不到组件集 ${componentSetId}`);
  const byId = new Map();
  walk(set.variants || [], (node) => {
    if (writableCandidate(node)) byId.set(node.id, target(node));
  });
  return {
    componentSetId,
    componentSetName: set.name,
    targets: [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}

function sliceFiles(dir, file) {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`缺安全截图映射 ${path}`);
  return readJson(path).files || [];
}

function packManifest({ pack, judgeDir, doc, g2 }) {
  const pagesByName = new Map(sliceFiles(judgeDir, "page-slices.json").map((row) => [row.file, row]));
  const setsByName = new Map(sliceFiles(judgeDir, "set-slices.json").map((row) => [row.file, row]));
  const entries = [];
  for (const image of g2.pages) {
    const slice = pagesByName.get(image.name);
    if (!slice?.slice) throw new Error(`${pack}/${image.name} 缺 page slice 映射`);
    entries.push({
      image: `${pack}/${image.name}`,
      pack,
      kind: "page",
      imageMeta: image,
      slice: slice.slice,
      targets: pageTargets(doc, slice.slice),
    });
  }
  for (const image of g2.sets) {
    const set = setsByName.get(image.name);
    if (!set?.componentSetId) throw new Error(`${pack}/${image.name} 缺 component set 映射`);
    const scope = componentSetTargets(doc, set.componentSetId);
    entries.push({
      image: `${pack}/${image.name}`,
      pack,
      kind: "component-set",
      imageMeta: image,
      componentSetId: scope.componentSetId,
      componentSetName: scope.componentSetName,
      targets: scope.targets,
    });
  }
  return entries;
}

/**
 * 每张小图都带一个安全、局部的瘦树范围。Worker 不需要读 pack.json 或完整 inventory。
 */
export function buildReviewManifest({ judgePc, judgeMobile, pcDoc, mobileDoc, g2 }) {
  const images = [
    ...packManifest({ pack: "pc", judgeDir: judgePc, doc: pcDoc, g2: g2.pc }),
    ...packManifest({ pack: "mobile", judgeDir: judgeMobile, doc: mobileDoc, g2: g2.mobile }),
  ];
  const seen = new Set();
  for (const row of images) {
    if (seen.has(row.image)) throw new Error(`截图映射重复：${row.image}`);
    seen.add(row.image);
  }
  return { schema: "visual-review-manifest/v1", images };
}

/**
 * 复刻手动写回：同一 id 以第一次可写判断为准。后续相同角色只补来源；
 * 后续不同角色视为已确定跟随，不覆盖、不当成冲突失败。
 */
export function validateVisualReview(review, expectedImages, source) {
  if (!review || review.schema !== "visual-review/v1" || !Array.isArray(review.reviews)) {
    throw new Error(`${source} 必须是 visual-review/v1 且含 reviews 数组`);
  }
  const rows = [];
  const local = new Set();
  for (const row of review.reviews) {
    const image = String(row?.image || "");
    if (!expectedImages.has(image)) throw new Error(`${source} 包含未分配图片 ${image || "?"}`);
    if (local.has(image)) throw new Error(`${source} 同一图片重复判断 ${image}`);
    local.add(image);
    if (!String(row?.judgement || "").trim()) throw new Error(`${source} 的 ${image} 缺 judgement`);
    if (!Array.isArray(row?.verdicts)) throw new Error(`${source} 的 ${image} verdicts 必须是数组`);
    if (!row.verdicts.length && !String(row?.nonVerdictReason || "").trim()) {
      throw new Error(`${source} 的 ${image} 没有 verdict 时必须说明 nonVerdictReason`);
    }
    const ids = new Set();
    for (const verdict of row.verdicts) {
      const id = String(verdict?.id || "").trim();
      const role = String(verdict?.role || "").replace(/\/$/, "");
      if (!id || !String(verdict?.why || "").trim()) {
        throw new Error(`${source} 的 ${image} 含不完整 verdict`);
      }
      if (ids.has(id)) throw new Error(`${source} 的 ${image} verdict id 重复 ${id}`);
      ids.add(id);
    }
    rows.push({
      image,
      judgement: String(row.judgement).trim(),
      nonVerdictReason: row.nonVerdictReason ? String(row.nonVerdictReason).trim() : undefined,
      verdicts: row.verdicts.map((verdict) => ({
        id: String(verdict.id).trim(),
        role: String(verdict.role).replace(/\/$/, ""),
        why: String(verdict.why).trim(),
      })),
    });
  }
  return rows;
}

export function mergeFirstWriteVerdicts(reviews) {
  const byId = new Map();
  const followed = [];
  for (const review of reviews || []) {
    const image = String(review?.image || "");
    for (const verdict of review?.verdicts || []) {
      const id = String(verdict?.id || "").trim();
      const role = String(verdict?.role || "").replace(/\/$/, "");
      if (!id || !role) continue;
      const prior = byId.get(id);
      if (!prior) {
        byId.set(id, {
          id,
          role,
          why: String(verdict?.why || "").trim(),
          sources: image ? [image] : [],
        });
        continue;
      }
      if (prior.role === role) {
        if (image && !prior.sources.includes(image)) prior.sources.push(image);
        continue;
      }
      followed.push({ id, existing: prior.role, incoming: role, image });
    }
  }
  return {
    verdicts: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    followed,
  };
}
