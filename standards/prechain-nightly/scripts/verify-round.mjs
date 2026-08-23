#!/usr/bin/env node
/**
 * 一轮看图是否真的跑完前置。只有 result.json 不算。
 * 校验 g2 与磁盘文件对应、宽高/字节、每轮 1–2 张、catalog/result 结构、verdicts 角色。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { PREFIX_NAMES } from "../../figma-naming/spec/spec.mjs";
import { scorePreparedRound } from "./score-round.mjs";

const ALLOWED_ROLES = new Set([...PREFIX_NAMES, "copy"]);

function listJpgs(dir, prefix) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith(prefix) && name.endsWith(".jpg")).sort();
}

function componentSetCount(summaryPath) {
  if (!existsSync(summaryPath)) return null;
  const text = readFileSync(summaryPath, "utf8");
  // summary.txt indexes component sets as `SET …`; its JPG exports are named
  // `set-*.jpg`. Count the source index rather than assuming its display label
  // uses the export filename convention.
  const matches = text.match(/^\s*(?:SET\s+|set-\d+\s+)/gmi);
  return matches ? matches.length : 0;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonl(path, label, problems) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      problems.push(`${label} 第 ${index + 1} 行不是 JSON：${error.message}`);
    }
  }
  return rows;
}

function checkListed(label, listed, diskNames, dir, kind) {
  const problems = [];
  const diskSet = new Set(diskNames);
  const listedNames = [];
  if (!Array.isArray(listed)) {
    problems.push(`${label} g2.${kind} 必须是数组`);
    return { problems, listedNames };
  }
  for (const row of listed) {
    const name = row?.name;
    if (typeof name !== "string" || /[\\/]/.test(name) || !diskSet.has(name)) {
      problems.push(`${label} g2 列出的 ${kind} 不在磁盘上：${name || "?"}`);
      continue;
    }
    listedNames.push(name);
    const st = statSync(join(dir, name));
    const bytes = Number(row.bytes);
    const width = Number(row.width);
    const height = Number(row.height);
    if (!Number.isFinite(bytes) || bytes !== st.size || st.size <= 0) {
      problems.push(`${label} ${name} bytes 必须等于文件大小且 > 0`);
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      problems.push(`${label} ${name} 宽高必须是正整数`);
    }
  }
  const listedSet = new Set(listedNames);
  if (listedSet.size !== listedNames.length) {
    problems.push(`${label} g2.${kind} 含重复文件名`);
  }
  const missing = diskNames.filter((name) => !listedSet.has(name));
  if (missing.length || listedSet.size !== diskSet.size) {
    problems.push(`${label} g2.${kind} 文件集合必须与磁盘完全一致，缺少：${missing.join(",") || "无"}`);
  }
  return { problems, listedNames };
}

export function verifyRound(roundDir, { judgePc, judgeMobile, goldPc, goldMobile, expectedRound } = {}) {
  const problems = [];
  const abs = resolve(roundDir);
  const required = [
    "g2.json", "review-manifest.json", "image-decisions.jsonl", "seen-images.jsonl",
    "verdicts.jsonl", "catalog-pc.json", "catalog-mobile.json", "result.json",
  ];
  for (const name of required) {
    if (!existsSync(join(abs, name))) problems.push(`缺 ${name}`);
  }
  if (problems.length) return { ok: false, proven: false, problems };

  let g2;
  try { g2 = readJson(join(abs, "g2.json")); }
  catch (error) { return { ok: false, proven: false, problems: [`g2.json 不是 JSON：${error.message}`] }; }
  if (!g2 || typeof g2 !== "object" || Array.isArray(g2)) {
    return { ok: false, proven: false, problems: ["g2.json 必须是对象"] };
  }

  const allowedByPack = new Map();
  const packs = [
    { label: "pc", dir: judgePc, expected: g2.pc },
    { label: "mobile", dir: judgeMobile, expected: g2.mobile },
  ];
  for (const pack of packs) {
    if (!pack.dir || !existsSync(pack.dir)) {
      problems.push(`${pack.label} 判断包不存在`);
      continue;
    }
    const pages = listJpgs(pack.dir, "page-");
    const sets = listJpgs(pack.dir, "set-");
    const indexCount = componentSetCount(join(pack.dir, "summary.txt"));
    if (indexCount != null && sets.length !== indexCount) {
      problems.push(`${pack.label} set jpg ${sets.length} ≠ 组件集 ${indexCount}`);
    }
    const pageCheck = checkListed(pack.label, pack.expected?.pages, pages, pack.dir, "pages");
    const setCheck = checkListed(pack.label, pack.expected?.sets, sets, pack.dir, "sets");
    problems.push(...pageCheck.problems, ...setCheck.problems);
    allowedByPack.set(pack.label, new Set([...pages, ...sets]));
  }

  let reviewManifest = null;
  try { reviewManifest = readJson(join(abs, "review-manifest.json")); }
  catch (error) { problems.push(`review-manifest.json 不是 JSON：${error.message}`); }
  const expectedImages = new Set();
  if (!reviewManifest || reviewManifest.schema !== "visual-review-manifest/v1" || !Array.isArray(reviewManifest.images)) {
    problems.push("review-manifest.json 必须是 visual-review-manifest/v1 且含 images 数组");
  } else {
    for (const row of reviewManifest.images) {
      const image = String(row?.image || "");
      if (!/^(pc|mobile)\/[^\\/]+\.jpg$/.test(image)) problems.push(`review-manifest 图片路径非法：${image || "?"}`);
      else if (expectedImages.has(image)) problems.push(`review-manifest 图片重复：${image}`);
      else expectedImages.add(image);
    }
    if (!expectedImages.size) problems.push("review-manifest images 不能为空");
  }
  const allJudgeImages = new Set([...allowedByPack.entries()].flatMap(([pack, names]) => [...names].map((name) => `${pack}/${name}`)));
  const manifestMissing = [...allJudgeImages].filter((image) => !expectedImages.has(image));
  const manifestExtra = [...expectedImages].filter((image) => !allJudgeImages.has(image));
  if (manifestMissing.length || manifestExtra.length || expectedImages.size !== allJudgeImages.size) {
    problems.push(`review-manifest 必须覆盖且只覆盖全部判断包截图；缺 ${manifestMissing.join(",") || "无"}，多 ${manifestExtra.join(",") || "无"}`);
  }

  const decisions = readJsonl(join(abs, "image-decisions.jsonl"), "image-decisions.jsonl", problems);
  const decisionsByImage = new Map();
  for (const [index, decision] of decisions.entries()) {
    const image = String(decision?.image || "");
    if (!expectedImages.has(image)) {
      problems.push(`image-decisions 第 ${index + 1} 行图片不在 manifest：${image || "?"}`);
      continue;
    }
    if (decisionsByImage.has(image)) {
      problems.push(`image-decisions 图片重复：${image}`);
      continue;
    }
    if (!String(decision?.judgement || "").trim()) problems.push(`image-decisions ${image} 缺 judgement`);
    if (!Array.isArray(decision?.verdicts)) problems.push(`image-decisions ${image} verdicts 必须是数组`);
    else if (!decision.verdicts.length && !String(decision?.nonVerdictReason || "").trim()) {
      problems.push(`image-decisions ${image} 无 verdict 时缺 nonVerdictReason`);
    }
    decisionsByImage.set(image, decision);
  }
  const decisionMissing = [...expectedImages].filter((image) => !decisionsByImage.has(image));
  if (decisionMissing.length) problems.push(`截图没有一一对应判断：${decisionMissing.join(",")}`);

  const seenTurns = readJsonl(join(abs, "seen-images.jsonl"), "seen-images.jsonl", problems);
  if (!seenTurns.length) problems.push("seen-images.jsonl 为空，不能证明看过图");
  const seenFiles = new Set();
  seenTurns.forEach((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      problems.push(`seen-images.jsonl 第 ${index + 1} 行必须是对象`);
      return;
    }
    const files = turn.files || turn.images || [];
    if (!Array.isArray(files)) {
      problems.push(`第 ${turn.turn ?? index + 1} 轮看图 files 必须是数组`);
      return;
    }
    if (files.length < 1 || files.length > 2) {
      problems.push(`第 ${turn.turn ?? index + 1} 轮看图必须 1–2 张，实际 ${files.length}`);
    }
    for (const file of files) {
      const raw = String(file ?? "");
      const qualified = raw.match(/^(pc|mobile)\/([^\\/]+)$/);
      if (qualified) {
        const [, pack, name] = qualified;
        if (!allowedByPack.get(pack)?.has(name)) {
          problems.push(`看过的图不在 ${pack} 判断包内：${raw}`);
          continue;
        }
        seenFiles.add(`${pack}/${name}`);
        continue;
      }

      const name = basename(raw);
      if (!raw || /[\\/]/.test(raw) || raw !== name) {
        problems.push(`看过的图必须是包限定路径（pc/<文件名> 或 mobile/<文件名>）或唯一文件名：${raw || "?"}`);
        continue;
      }
      const matches = [...allowedByPack.entries()]
        .filter(([, names]) => names.has(name))
        .map(([pack]) => pack);
      if (!matches.length) {
        problems.push(`看过的图不在判断包内：${raw}`);
      } else {
        // Legacy rows contain only export filenames. They can still prove two
        // views when the basenames differ; package-qualified paths are needed
        // only when two same-named exports must count separately.
        seenFiles.add(name);
      }
    }
  });
  if (seenFiles.size < 2) problems.push(`看过的独特小图不足 2 张（${seenFiles.size}），前置看图不完整`);
  const unseen = [...expectedImages].filter((image) => !seenFiles.has(image));
  const extraSeen = [...seenFiles].filter((image) => !expectedImages.has(image));
  if (unseen.length || extraSeen.length || seenFiles.size !== expectedImages.size) {
    problems.push(`seen-images 必须覆盖且只覆盖 manifest 全部截图；缺 ${unseen.join(",") || "无"}，多 ${extraSeen.join(",") || "无"}`);
  }

  const verdicts = readJsonl(join(abs, "verdicts.jsonl"), "verdicts.jsonl", problems);
  if (!verdicts.length) problems.push("verdicts.jsonl 为空");
  const verdictIds = new Set();
  for (const row of verdicts) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      problems.push("verdict 必须是对象");
      continue;
    }
    if (typeof row.id !== "string" || !row.id.trim()) problems.push("verdict 缺字符串 id");
    else if (verdictIds.has(row.id)) problems.push(`verdict id 重复：${row.id}`);
    else verdictIds.add(row.id);
    const role = String(row?.role || "").replace(/\/$/, "");
    if (!ALLOWED_ROLES.has(role) || role === "copy") problems.push(`verdict 角色不在可写总表：${row?.role}`);
    const sources = row?.sources;
    if (!Array.isArray(sources) || !sources.length) problems.push(`verdict ${row?.id || "?"} 缺截图来源 sources`);
    else for (const image of sources) if (!expectedImages.has(image)) problems.push(`verdict ${row?.id || "?"} 来源不在 manifest：${image}`);
  }
  const verdictById = new Map(verdicts.map((row) => [row?.id, String(row?.role || "").replace(/\/$/, "")]));
  for (const [image, decision] of decisionsByImage) {
    for (const visual of decision?.verdicts || []) {
      const role = String(visual?.role || "").replace(/\/$/, "");
      const kept = verdictById.get(visual?.id);
      if (!kept) problems.push(`截图 ${image} 的 verdict 未被写入：${visual?.id || "?"}`);
      else if (kept !== role) {
        // First-write / determined-follow: later screenshots may propose a different
        // role for a shared component set, but they must not overwrite the first write.
      }
    }
  }

  for (const name of ["catalog-pc.json", "catalog-mobile.json"]) {
    let doc;
    try { doc = readJson(join(abs, name)); }
    catch (error) {
      problems.push(`${name} 不是 JSON：${error.message}`);
      continue;
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      problems.push(`${name} 必须是对象`);
      continue;
    }
    if (doc.ok !== true) problems.push(`${name} 缺少 ok:true`);
    if (!Array.isArray(doc.hits) && !Array.isArray(doc.rows)) problems.push(`${name} 缺少 hits/rows 数组`);
  }

  let resultDoc;
  try { resultDoc = readJson(join(abs, "result.json")); }
  catch (error) {
    problems.push(`result.json 不是 JSON：${error.message}`);
    resultDoc = null;
  }
  if (!resultDoc || typeof resultDoc !== "object" || Array.isArray(resultDoc)) {
    problems.push("result.json 必须是对象");
  } else {
    if (resultDoc.ok !== true) problems.push("result.json 必须是 ok:true 的成功打分结果");
    if (!Number.isInteger(resultDoc.round) || resultDoc.round < 1) problems.push("result.json 缺少正整数 round");
    if (expectedRound != null && resultDoc.round !== expectedRound) problems.push(`result.json round 必须是 ${expectedRound}`);
    if (typeof resultDoc.gateOk !== "boolean") problems.push("result.json 缺少 gateOk 布尔值");
    if (resultDoc.gateOk !== true) problems.push("result.json gateOk 必须为 true");
    if (resultDoc.newDraftGateOk !== true) problems.push("result.json newDraftGateOk 必须为 true");
    if (resultDoc.falsePass === true) problems.push("result.json falsePass 不能为 true");
    if (!/^[a-f0-9]{64}$/.test(String(resultDoc.inputFingerprint || ""))) {
      problems.push("result.json 缺 inputFingerprint，不能关联本次四份评分输入");
    }
    if (!/^[a-f0-9]{64}$/.test(String(resultDoc.scoreFingerprint || ""))) {
      problems.push("result.json 缺 scoreFingerprint，不能证明评分产物版本");
    }
    if (!Array.isArray(resultDoc.pages)) problems.push("result.json 缺少 pages 数组");
    else {
      if (resultDoc.pages.length !== 2) problems.push(`result.json pages 必须有 PC/mobile 两页，实际 ${resultDoc.pages.length}`);
      const pageIds = new Set();
      for (const [index, page] of resultDoc.pages.entries()) {
        if (!page || typeof page !== "object" || !page.pageId) problems.push(`result.json pages[${index}] 缺 pageId`);
        else if (pageIds.has(page.pageId)) problems.push(`result.json pages pageId 重复：${page.pageId}`);
        else pageIds.add(page.pageId);
        if (page?.completenessOk !== true) problems.push(`result.json pages[${index}] completenessOk 必须为 true`);
        const gate = page?.newDraftGate;
        if (!gate || typeof gate !== "object") {
          problems.push(`result.json pages[${index}] 缺 newDraftGate`);
        } else {
          if (gate.pass !== true) problems.push(`result.json pages[${index}] newDraftGate.pass 必须为 true`);
          if (!(Number(gate.recall) >= 0.9)) problems.push(`result.json pages[${index}] newDraftGate.recall 必须 >= 0.9`);
          if (!(Number(gate.precision) >= 0.9)) problems.push(`result.json pages[${index}] newDraftGate.precision 必须 >= 0.9`);
          if (gate.completeness !== "green") problems.push(`result.json pages[${index}] newDraftGate.completeness 必须为 green`);
        }
        if (!page?.summary || typeof page.summary !== "object") problems.push(`result.json pages[${index}] 缺 summary`);
        else for (const key of ["goldDetermined", "hit", "miss", "wrong", "extra", "scored"]) {
          if (!Number.isInteger(page.summary[key]) || page.summary[key] < 0) problems.push(`result.json pages[${index}] summary.${key} 非法`);
        }
      }
    }
  }

  if (goldPc || goldMobile) {
    if (!goldPc || !goldMobile) {
      problems.push("评分复算必须同时提供 goldPc 与 goldMobile");
    } else {
      try {
        const recomputed = scorePreparedRound({
          round: expectedRound ?? resultDoc?.round,
          pcDoc: readJson(join(abs, "pc.json")),
          mobileDoc: readJson(join(abs, "mobile.json")),
          goldPcDoc: readJson(goldPc),
          goldMobileDoc: readJson(goldMobile),
        });
        if (resultDoc?.scoreFingerprint !== recomputed.scoreFingerprint) {
          problems.push("result.json 与当前 draft/gold 的评分复算不一致，结果已陈旧或输入被改写");
        }
      } catch (error) {
        problems.push(`评分复算失败：${error.message}`);
      }
    }
  }

  return { ok: problems.length === 0, proven: problems.length === 0, problems, seen: [...seenFiles] };
}

function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : "";
  };
  const roundDir = opt("round-dir");
  if (!roundDir) {
    console.error("用法：--round-dir <dir> --judge-pc <dir> --judge-mobile <dir>");
    process.exit(2);
  }
  const result = verifyRound(roundDir, {
    judgePc: opt("judge-pc"),
    judgeMobile: opt("judge-mobile"),
    goldPc: opt("gold-pc"),
    goldMobile: opt("gold-mobile"),
    expectedRound: Number(opt("round")) || undefined,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
