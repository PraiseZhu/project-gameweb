#!/usr/bin/env node
/**
 * 把核对页 JSONL 写回 draft。可带上一份稿做旧 id 映射。
 *
 * node scripts/apply-review-feedback.mjs <inventory.json> [feedback.jsonl] [--from previous.json] [--judge-pack <dir>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyReviewFeedback } from "../src/feedback-apply.mjs";
import { rebuildInventoryIndexes, renderHumanSummary } from "../src/inventory.mjs";
import { applyClipAndRewardPrefixes } from "../src/gold-morphology.mjs";
import { writeFilesAtomically } from "../src/atomic-writeback.mjs";
import { readJudgePack } from "../src/judgment.mjs";

function opt(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
function optAll(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i += 1) {
    if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const invPath = process.argv[2];
const feedbackPath = process.argv[3] && !String(process.argv[3]).startsWith("--") ? process.argv[3] : null;
const fromPath = opt("--from");
const peerPaths = optAll("--peer");
const judgePackPath = opt("--judge-pack");
if (!invPath) {
  console.error("usage: node scripts/apply-review-feedback.mjs <inventory.json> [feedback.jsonl] [--from previous.json] [--peer other.json] [--judge-pack <dir>]");
  process.exit(1);
}

const inv = JSON.parse(fs.readFileSync(invPath, "utf8"));
const rows = feedbackPath
  ? fs.readFileSync(feedbackPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const previousDoc = fromPath ? JSON.parse(fs.readFileSync(fromPath, "utf8")) : null;
const peers = peerPaths.map((file) => ({ path: path.resolve(file), doc: JSON.parse(fs.readFileSync(file, "utf8")) }));
let judgePack = null;
if (judgePackPath) {
  const pack = readJudgePack(judgePackPath);
  if (!pack.ok) {
    console.error(JSON.stringify({ ok: false, problems: pack.problems }, null, 2));
    process.exit(1);
  }
  judgePack = pack.summary;
}
const result = applyReviewFeedback(inv, rows, {
  previousDoc,
  peerDocs: peers.map((item) => item.doc),
  judgePack,
});

const allNodes = [];
const collectNodes = (value) => {
  if (Array.isArray(value)) return value.forEach(collectNodes);
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string" && typeof value.type === "string") allNodes.push(value);
  Object.values(value).forEach(collectNodes);
};
collectNodes(inv);

function hasTextDescendant(node, seen = new Set()) {
  if (!node || seen.has(node.id)) return false;
  seen.add(node.id);
  return allNodes
    .filter((candidate) => candidate.parentId === node.id)
    .some((child) => child.type === "TEXT" || hasTextDescendant(child, seen));
}

function reclassifyTextContainers(value) {
  if (Array.isArray(value)) {
    value.forEach(reclassifyTextContainers);
    return;
  }
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string" && typeof value.type === "string"
      && ["FRAME", "GROUP", "INSTANCE", "COMPONENT"].includes(value.type)
      && hasTextDescendant(value)
      && value.role === "img" && String(value.name || "").startsWith("img/")) {
    setDetermined(value, "mix");
  }
  Object.values(value).forEach(reclassifyTextContainers);
}
reclassifyTextContainers(inv);

const clip = applyClipAndRewardPrefixes(inv);
const peerClip = peers.map((item) => applyClipAndRewardPrefixes(item.doc));
const { clipFixed, innerFixed, stripped } = clip;

const writes = [];
const writeDoc = (file, doc) => {
  rebuildInventoryIndexes(doc);
  writes.push([file, `${JSON.stringify(doc, null, 2)}\n`]);
  const txtPath = file.replace(/\.json$/, ".txt");
  writes.push([txtPath, renderHumanSummary(doc)]);
  return doc.counts;
};
const counts = writeDoc(invPath, inv);
const peerCounts = peers.map((item) => ({ file: item.path, counts: writeDoc(item.path, item.doc) }));
writeFilesAtomically(writes);
console.log(JSON.stringify({
  inventory: path.resolve(invPath),
  feedback: feedbackPath ? path.resolve(feedbackPath) : null,
  from: fromPath ? path.resolve(fromPath) : null,
  peers: peerPaths.map((file) => path.resolve(file)),
  feedbackApplied: result.applied.length,
  feedbackMissing: result.missing,
  remapped: result.remapped,
  conflicts: result.conflicts,
  skippedUnknown: result.skippedUnknown,
  judgment: inv.judgment ?? null,
  morphology: result.morphology?.length ?? 0,
  peerSync: result.peerSync?.map((row) => ({ toPeer: row.toPeer.length, toSelf: row.toSelf.length })),
  clipFixed,
  innerFixed,
  stripped,
  peerClip,
  counts,
  peerCounts,
}, null, 2));

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  /* imported */
}
