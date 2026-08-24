/**
 * 未规范稿判断写回戳记。green-draft / 做页入口只认这份记录，
 * 不把 morph-only 或手改 JSON 当成已经看图判断。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const JUDGMENT_SCHEMA = "judgment-writeback/v1";
export const JUDGE_PACK_SCHEMA = "judge-pack/v1";

function snapshotHashOf(doc) {
  return typeof doc?.snapshot?.hash === "string" && doc.snapshot.hash ? doc.snapshot.hash : null;
}

export function emptyJudgment() {
  return {
    schema: JUDGMENT_SCHEMA,
    snapshotHash: null,
    visual: false,
    morphology: false,
    feedbackApplied: 0,
    judgePack: null,
    at: null,
  };
}

function hasPatch(patch, key) {
  return Object.prototype.hasOwnProperty.call(patch, key);
}

function packOk(pack) {
  return Boolean(pack && pack.schema === JUDGE_PACK_SCHEMA);
}

export function stampJudgment(doc, patch = {}) {
  if (!doc || typeof doc !== "object") return null;
  const prev = doc.judgment && typeof doc.judgment === "object" ? doc.judgment : emptyJudgment();
  const snapshotHash = snapshotHashOf(doc);
  const judgePack = hasPatch(patch, "judgePack") ? (patch.judgePack ?? null) : (prev.judgePack ?? null);
  const bound = packOk(judgePack);
  let visual;
  if (hasPatch(patch, "visual")) {
    // 本次宣称看图，必须同时交出本次判断包。禁止 visual=true 沿用旧包。
    visual = patch.visual === true && bound && hasPatch(patch, "judgePack");
  } else {
    visual = prev.visual === true && bound;
  }
  doc.judgment = {
    schema: JUDGMENT_SCHEMA,
    snapshotHash,
    visual,
    morphology: hasPatch(patch, "morphology") ? patch.morphology === true : prev.morphology === true,
    feedbackApplied: Number.isFinite(Number(patch.feedbackApplied))
      ? Number(patch.feedbackApplied)
      : Number(prev.feedbackApplied || 0),
    judgePack: bound ? judgePack : null,
    at: new Date().toISOString(),
  };
  return doc.judgment;
}

export function fixtureJudgment(doc, extra = {}) {
  const snapshotHash = snapshotHashOf(doc) || extra.snapshotHash || "sha256:fixture";
  if (!doc.snapshot || typeof doc.snapshot !== "object") {
    doc.snapshot = { hash: snapshotHash, lastModified: extra.lastModified || "2026-08-22T00:00:00Z" };
  } else if (!doc.snapshot.hash) {
    doc.snapshot.hash = snapshotHash;
  }
  return stampJudgment(doc, {
    visual: extra.visual !== false,
    morphology: extra.morphology !== false,
    feedbackApplied: extra.feedbackApplied ?? 1,
    judgePack: extra.judgePack ?? {
      schema: JUDGE_PACK_SCHEMA,
      snapshotHash: doc.snapshot.hash,
      pageId: doc.page?.id ?? doc.requestedNodeId ?? null,
      pageSlices: extra.pageSlices ?? 1,
      setSlices: extra.setSlices ?? 0,
      candidateCount: extra.candidateCount ?? 1,
    },
  });
}

function jpgCount(dir, pattern) {
  if (!dir || !existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => pattern.test(name)).length;
}

function nonEmpty(filePath) {
  return existsSync(filePath) && statSync(filePath).size > 0;
}

export function readJudgePack(dirPath) {
  if (!dirPath) {
    return { ok: false, problems: ["缺判断包目录"], summary: null };
  }
  const dir = resolve(dirPath);
  const packPath = join(dir, "pack.json");
  const pageSlicesPath = join(dir, "page-slices.json");
  const setSlicesPath = join(dir, "set-slices.json");
  const problems = [];
  if (!existsSync(packPath)) problems.push(`判断包缺 pack.json：${dir}`);
  if (!existsSync(pageSlicesPath)) problems.push(`判断包缺 page-slices.json：${dir}`);
  if (!existsSync(setSlicesPath)) problems.push(`判断包缺 set-slices.json：${dir}`);
  if (problems.length) return { ok: false, problems, summary: null };

  let pack;
  let pageSlices;
  let setSlices;
  try {
    pack = JSON.parse(readFileSync(packPath, "utf8"));
    pageSlices = JSON.parse(readFileSync(pageSlicesPath, "utf8"));
    setSlices = JSON.parse(readFileSync(setSlicesPath, "utf8"));
  } catch (error) {
    return { ok: false, problems: [`判断包 JSON 读失败：${error.message}`], summary: null };
  }
  if (pack?.schema !== JUDGE_PACK_SCHEMA) {
    problems.push(`判断包 schema 必须是 ${JUDGE_PACK_SCHEMA}，收到 ${pack?.schema ?? "(空)"}`);
  }
  const snapshotHash = pack?.snapshot?.hash ?? null;
  if (!snapshotHash) problems.push("判断包缺 snapshot.hash");
  const pageFiles = Array.isArray(pageSlices?.files) ? pageSlices.files : [];
  const setFiles = Array.isArray(setSlices?.files) ? setSlices.files : [];
  if (pageFiles.length < 1) problems.push("判断包 page-*.jpg 为空");
  for (const row of pageFiles) {
    const file = join(dir, row.file || "");
    if (!nonEmpty(file)) problems.push(`判断包页切片空白或缺失：${row.file}`);
  }
  for (const row of setFiles) {
    const file = join(dir, row.file || "");
    if (!nonEmpty(file)) problems.push(`判断包组件集切片空白或缺失：${row.file}`);
  }
  const livePages = jpgCount(dir, /^page-[a-z]\.jpg$/);
  const liveSets = jpgCount(dir, /^set-\d+\.jpg$/);
  if (livePages !== pageFiles.length) {
    problems.push(`判断包页切片数不一致：目录 ${livePages}，记录 ${pageFiles.length}`);
  }
  if (liveSets !== setFiles.length) {
    problems.push(`判断包组件集切片数不一致：目录 ${liveSets}，记录 ${setFiles.length}`);
  }
  const expectedSets = Array.isArray(pack?.componentSets) ? pack.componentSets.length : 0;
  if (setFiles.length !== expectedSets) {
    problems.push(`判断包组件集切片 ${setFiles.length} 与 pack.componentSets ${expectedSets} 不对齐`);
  }
  const summary = {
    schema: pack?.schema ?? null,
    snapshotHash,
    pageId: pack?.page?.id ?? null,
    pageSlices: pageFiles.length,
    setSlices: setFiles.length,
    candidateCount: Array.isArray(pack?.candidates) ? pack.candidates.length : 0,
    dir,
  };
  return { ok: problems.length === 0, problems, summary };
}

export function judgmentProblems(doc, { label = "清单", judgePackDir = null } = {}) {
  const problems = [];
  const judgment = doc?.judgment;
  if (!judgment || judgment.schema !== JUDGMENT_SCHEMA) {
    problems.push(`${label} 缺判断写回：未规范 draft 必须先走判断包看图写回，禁止只跑 morph 就打包`);
    return problems;
  }
  const liveHash = snapshotHashOf(doc);
  if (!liveHash) problems.push(`${label} 缺 snapshot.hash，无法核判断写回是否对应当前稿`);
  if (judgment.snapshotHash !== liveHash) {
    problems.push(`${label} 判断写回与当前快照不一致，须按判断包重判`);
  }
  if (judgment.visual !== true) {
    problems.push(`${label} 只跑了 morph，未走判断包看图写回`);
  }
  if (judgment.morphology !== true) {
    problems.push(`${label} 判断写回后未 morph 收口`);
  }
  const pack = judgment.judgePack;
  if (!pack || pack.schema !== JUDGE_PACK_SCHEMA) {
    problems.push(`${label} 缺判断包记录：apply-review-feedback 必须带 --judge-pack`);
  } else {
    if (!pack.snapshotHash) problems.push(`${label} 判断包缺 snapshot.hash`);
    if (pack.snapshotHash !== liveHash) {
      problems.push(`${label} 判断包快照与当前稿不一致，须重导判断包再写回`);
    }
    if (!Number.isInteger(pack.pageSlices) || pack.pageSlices < 1) {
      problems.push(`${label} 判断包页切片为空`);
    }
    if (!Number.isInteger(pack.setSlices) || pack.setSlices < 0) {
      problems.push(`${label} 判断包组件集切片记录非法`);
    }
  }
  if (judgePackDir) {
    const live = readJudgePack(judgePackDir);
    if (!live.ok) problems.push(...live.problems.map((item) => `${label} ${item}`));
    else {
      if (live.summary.snapshotHash !== liveHash) {
        problems.push(`${label} --judge-pack 快照与当前稿不一致`);
      }
      if (pack?.pageId && live.summary.pageId && pack.pageId !== live.summary.pageId) {
        problems.push(`${label} 判断包 page.id 与写回记录不一致`);
      }
    }
  }
  return problems;
}
