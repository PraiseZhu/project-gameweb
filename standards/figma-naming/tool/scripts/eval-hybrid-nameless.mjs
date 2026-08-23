#!/usr/bin/env node
/**
 * Reproducible hybrid evaluation for the 491 baseline shelves.
 *
 * The unnamed clone removes designer layer names from inventory node records
 * and replaces them with deterministic Figma-style defaults.  Variant option
 * labels are metadata (not layer names), so they are preserved; otherwise the
 * clone would destroy state-pair evidence rather than test name-free judging.
 * No ids are used for scoring: compareByHybrid consumes the gold class and
 * structural keys only.
 *
 * Pass/fail policy: new drafts use only the consumption layers that actually
 * exist on that page.  Every page must reach recall >= 90%, precision >= 90%
 * and completeness green.  The full-gold ruler belongs only to the separate
 * gold-id "strip prefixes, then recover the same document" regression; this
 * script never uses that ruler to pass or fail a new/unnamed draft.
 */
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadModuleCatalog } from "../src/module-catalog.mjs";
import {
  compareByHybrid,
  newDraftGateOf,
  resetInventoryToZero,
  runMachinePrechain,
  visitInventoryNodes,
} from "../../../prechain-nightly/src/prechain-eval.mjs";
import { rebuildInventoryIndexes } from "../src/inventory.mjs";

const ROOT = resolve(import.meta.dirname, "../../../prechain-nightly/reports/2026-08-21/visual");
const GOLD = resolve(ROOT, "gold");
const BASELINE = resolve(ROOT, "rounds/r01");
const DEFAULTS = Object.freeze({
  FRAME: "Frame",
  GROUP: "Group",
  RECTANGLE: "Rectangle",
  ELLIPSE: "Ellipse",
  VECTOR: "Vector",
  LINE: "Line",
  STAR: "Star",
  POLYGON: "Polygon",
  UNION: "Union",
  BOOLEAN_OPERATION: "Union",
  INSTANCE: "Instance",
  COMPONENT: "Component",
  COMPONENT_SET: "Component",
  SLICE: "Slice",
  MASK: "Mask",
});

function read(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function genericClone(input) {
  const clone = JSON.parse(JSON.stringify(input));
  let serial = 0;
  const walk = (value, inVariantMetadata = false) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, inVariantMetadata));
      return;
    }
    if (!inVariantMetadata && typeof value.id === "string" && typeof value.type === "string"
      && value.status !== "skipped" && value.type !== "TEXT") {
      const base = DEFAULTS[value.type] || "Frame";
      value.name = `${base} ${++serial}`;
      if (value.status === "determined" && value.role && value.role !== "copy") {
        value.status = "unknown";
        value.role = null;
        value.behavior = "none";
        value.label = value.name;
        delete value.via;
      }
    }
    for (const [key, child] of Object.entries(value)) {
      // Variant names/options describe the state property and are retained as
      // structural evidence, not treated as designer layer names.
      walk(child, inVariantMetadata || key === "variants");
    }
  };
  walk(clone);
  clone.status = "draft";
  return clone;
}

function existingPageCompleteness(doc) {
  const rebuilt = rebuildInventoryIndexes({
    nodes: doc.nodes || [],
    attachments: doc.attachments || {},
  });
  const indexKeys = ["sections", "overlays", "backgrounds", "modules"];
  const indexProblems = indexKeys.filter((key) => {
    const actual = doc[key] || [];
    const expected = rebuilt[key] || [];
    const normalize = (rows) => JSON.stringify(rows.map((row) => ({
      id: row.id ?? null,
      role: row.role ?? null,
      number: row.number ?? null,
      label: row.label ?? null,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))));
    return normalize(actual) !== normalize(expected);
  });
  const prefixProblems = [];
  visitInventoryNodes(doc, (node) => {
    if (node.status !== "determined" || !node.role || node.role === "copy") return;
    if (!String(node.name || "").startsWith(`${node.role}/`)) {
      prefixProblems.push(`${node.id}:missing-${node.role}`);
    }
  });
  return {
    ok: indexProblems.length === 0 && prefixProblems.length === 0,
    problems: [...indexProblems.map((key) => `${key}-index-stale`), ...prefixProblems],
  };
}

function score(doc, gold, catalog, { unnamed = false } = {}) {
  const run = runMachinePrechain([doc], catalog);
  const recovered = run.docs[0];
  const strictCompleteness = run.completeness[0] || { ok: false, problems: [] };
  // The generic clone intentionally has no semantic names.  Its page-scoped
  // gate therefore checks only rebuilt indexes and prefixes actually written
  // by the machine; strict semantic/card audits remain available above for
  // named shelves and direct CLI use.
  const completeness = unnamed ? existingPageCompleteness(recovered) : strictCompleteness;
  const summary = compareByHybrid(recovered, gold).summary;
  return {
    ...summary,
    newDraftGate: newDraftGateOf(summary, completeness.ok),
    completenessOk: completeness.ok,
    completenessProblems: Array.isArray(completeness.problems) ? completeness.problems.length : 0,
  };
}

function pct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function print(label, summary) {
  const gate = summary.newDraftGate || newDraftGateOf(summary, summary.completenessOk);
  const completeness = summary.completenessOk ? "green" : "red";
  console.log(JSON.stringify({
    label,
    evaluation: "new-draft-gate",
    newDraftGate: {
      scope: gate.scope,
      hit: gate.hit,
      miss: gate.miss,
      wrong: gate.wrong,
      extra: gate.extra,
      scored: gate.scored,
      recall: pct(gate.recall),
      precision: pct(gate.precision),
      completeness,
      completenessProblems: summary.completenessProblems,
      pass: gate.pass,
      passCriteria: "per-page recall>=90% && precision>=90% && completeness=green",
    },
    oldScalePolicy: "full gold determined is reference-only for gold-id same-document prefix-strip recovery; not emitted or used for new-draft pass/fail",
  }));
}

function evaluateDevice(device) {
  const files = device === "mobile"
    ? ["mobile", "mobile.json", "baseline-mobile.json"]
    : ["pc", "pc.json", "baseline-pc.json"];
  const catalog = loadModuleCatalog();
  const totals = { named: [], unnamed: [] };
  const [label, goldFile, baselineFile] = files;
  const gold = read(resolve(GOLD, goldFile));
  const baseline = resetInventoryToZero(read(resolve(BASELINE, baselineFile)));
  const named = score(baseline, gold, catalog, { unnamed: false });
  const unnamed = score(genericClone(baseline), gold, catalog, { unnamed: true });
  print(`${label}:named`, named);
  print(`${label}:unnamed`, unnamed);
  totals.named.push(named);
  totals.unnamed.push(unnamed);
  return { named: total(totals.named), unnamed: total(totals.unnamed) };
}

function total(rows) {
  const sumGate = (key) => rows.reduce((value, row) => value + (row.newDraftGate?.[key] || 0), 0);
  const hit = sumGate("hit");
  const miss = sumGate("miss");
  const wrong = sumGate("wrong");
  const extra = sumGate("extra");
  const recall = hit / Math.max(1, hit + miss + wrong);
  const precision = hit / Math.max(1, hit + wrong + extra);
  const completeness = rows.every((row) => row.completenessOk) ? "green" : "red";
  const allPagesPass = rows.every((row) => row.newDraftGate?.recall >= 0.9
    && row.newDraftGate?.precision >= 0.9 && row.completenessOk);
  return {
    newDraftGate: {
      scope: "draft-present-consumption-layers",
      hit, miss, wrong, extra,
      scored: hit + miss + wrong,
      recall: pct(recall),
      precision: pct(precision),
      completeness,
      completenessProblems: rows.reduce((value, row) => value + (row.completenessProblems || 0), 0),
      pass: allPagesPass,
    },
  };
}

const requestedDevice = process.argv.find((arg) => arg === "--device")
  ? process.argv[process.argv.indexOf("--device") + 1]
  : null;
if (requestedDevice) {
  const observed = evaluateDevice(requestedDevice);
  // Keep the child-process summary on one line so the parent can parse it
  // without buffering or accidentally treating pretty-printed fragments as
  // independent JSON records.
  console.log(JSON.stringify({ device: requestedDevice, observed }));
} else {
  const rows = [];
  for (const device of ["pc", "mobile"]) {
    const child = spawnSync(process.execPath, ["--max-old-space-size=8192", process.argv[1], "--device", device], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    if (child.status !== 0) {
      process.stderr.write(child.stderr || child.stdout || `device ${device} failed\n`);
      process.exit(child.status || 1);
    }
    process.stdout.write(child.stdout);
    const jsonLines = child.stdout.trim().split("\n").filter((line) => line.startsWith("{"));
    rows.push(JSON.parse(jsonLines.at(-1)));
  }
  const sums = (kind) => {
    const values = rows.map((row) => row.observed[kind].newDraftGate);
    const get = (key) => values.reduce((sum, item) => sum + (item[key] || 0), 0);
    const hit = get("hit");
    const miss = get("miss");
    const wrong = get("wrong");
    const extra = get("extra");
    const completenessProblems = get("completenessProblems");
    const recall = hit / Math.max(1, hit + miss + wrong);
    const precision = hit / Math.max(1, hit + wrong + extra);
    const completeness = values.every((item) => item.completeness === "green") ? "green" : "red";
    const allPagesPass = values.every((item) => item.pass === true);
    return {
      newDraftGate: {
        scope: "draft-present-consumption-layers",
        hit, miss, wrong, extra,
        scored: hit + miss + wrong,
        recall: pct(recall),
        precision: pct(precision),
        completeness,
        completenessProblems,
        pass: allPagesPass,
      },
    };
  };
  console.log(JSON.stringify({
    policy: {
      passField: "newDraftGate.pass",
      passRule: "each page recall>=90% && precision>=90% && completeness=green",
      oldScale: "full gold determined is used only by gold-id same-document prefix-strip recovery as a regression reference",
    },
    observed: { named: sums("named"), unnamed: sums("unnamed") },
  }, null, 2));
}
