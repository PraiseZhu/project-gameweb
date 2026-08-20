#!/usr/bin/env node
/**
 * 把核对页 JSONL 写回 draft。可带上一份稿做旧 id 映射。
 *
 * node scripts/apply-review-feedback.mjs <inventory.json> [feedback.jsonl] [--from <previous-inventory.json>]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyReviewFeedback, setDetermined } from "../src/feedback-apply.mjs";

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
if (!invPath) {
  console.error("usage: node scripts/apply-review-feedback.mjs <inventory.json> [feedback.jsonl] [--from previous.json] [--peer other.json]");
  process.exit(1);
}

const inv = JSON.parse(fs.readFileSync(invPath, "utf8"));
const rows = feedbackPath
  ? fs.readFileSync(feedbackPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const previousDoc = fromPath ? JSON.parse(fs.readFileSync(fromPath, "utf8")) : null;
const peers = peerPaths.map((file) => ({ path: path.resolve(file), doc: JSON.parse(fs.readFileSync(file, "utf8")) }));
const result = applyReviewFeedback(inv, rows, { previousDoc, peerDocs: peers.map((item) => item.doc) });

const CLIP_RE = /可划动|划动区域/;
const INNER_RE = /^(奖励列表|奖励)$/;
const ROLE_PREFIX = /^(bg|btn|dyn|fix|hot|img|ind|kv|mix|modal|ref|scroll|sec|switch|tab|copy)\//;
function bodyOf(node) {
  return String(node?.name ?? "").replace(ROLE_PREFIX, "").trim();
}
let clipFixed = 0;
let innerFixed = 0;
function fixSiblings(siblings) {
  if (!Array.isArray(siblings)) return;
  const nodes = siblings.filter((node) => node && typeof node === "object" && typeof node.type === "string");
  const clips = nodes.filter((node) => node.type === "FRAME" && CLIP_RE.test(bodyOf(node)));
  const inners = nodes.filter((node) => node.type === "FRAME" && INNER_RE.test(bodyOf(node)));
  for (const clip of clips) {
    if (!(clip.status === "determined" && clip.role === "scroll" && String(clip.name).startsWith("scroll/"))) {
      setDetermined(clip, "scroll");
      clipFixed += 1;
    }
  }
  if (clips.length) {
    for (const inner of inners) {
      if (inner.role !== "img" || !String(inner.name).startsWith("img/")) {
        setDetermined(inner, "img");
        innerFixed += 1;
      }
    }
  }
}
const walkSiblings = (value) => {
  if (Array.isArray(value)) {
    fixSiblings(value);
    value.forEach(walkSiblings);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const child of Object.values(value)) walkSiblings(child);
};
walkSiblings(inv);

const recount = (value, acc) => {
  if (Array.isArray(value)) return value.forEach((item) => recount(item, acc));
  if (!value || typeof value !== "object") return;
  if (typeof value.id === "string" && typeof value.type === "string" && value.status) {
    acc[value.status] = (acc[value.status] ?? 0) + 1;
  }
  for (const child of Object.values(value)) recount(child, acc);
};
const counts = {};
recount(inv, counts);
if (inv.counts && typeof inv.counts === "object") inv.counts = { ...inv.counts, ...counts };

const writeDoc = (file, doc) => {
  const acc = {};
  recount(doc, acc);
  if (doc.counts && typeof doc.counts === "object") doc.counts = { ...doc.counts, ...acc };
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return acc;
};
writeDoc(invPath, inv);
const peerCounts = peers.map((item) => ({ file: item.path, counts: writeDoc(item.path, item.doc) }));
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
  morphology: result.morphology?.length ?? 0,
  peerSync: result.peerSync?.map((row) => ({ toPeer: row.toPeer.length, toSelf: row.toSelf.length })),
  clipFixed,
  innerFixed,
  counts,
  peerCounts,
}, null, 2));

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  /* imported */
}
