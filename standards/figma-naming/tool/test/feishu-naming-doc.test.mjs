import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PREFIXES, PARAMS, SPEC_VERSION } from "../../spec/spec.mjs";
import { RULES } from "../src/rules.mjs";
import {
  buildDesignerDoc,
  expectedFacts,
  extractFactsFromText,
  extractFactsFromDoc,
  extractFactsFromTables,
  diffFacts,
  auditGeneratedDoc,
  chunkTable,
  prefixesByGroup,
  paramRows,
  ruleRows,
  FEISHU_DOCUMENT_ID,
} from "../src/feishu-naming-doc.mjs";
import { publishDesignerDoc, FEISHU_TABLE_LIMIT } from "../src/feishu-docx.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("生成稿含当前版本、全部前缀、参数、报警码", () => {
  const doc = buildDesignerDoc();
  const audit = auditGeneratedDoc(doc);
  assert.equal(audit.ok, true, audit.errors.join("\n"));
  assert.equal(doc.version, SPEC_VERSION);
  assert.equal(doc.documentId, FEISHU_DOCUMENT_ID);
  assert.deepEqual(expectedFacts().prefixes, Object.keys(PREFIXES).map((p) => `${p}/`).sort());
  assert.deepEqual(expectedFacts().params, Object.keys(PARAMS).sort());
  assert.deepEqual(expectedFacts().rules, Object.keys(RULES).sort());
});

test("每个前缀分组都有表，且表体来自 PREFIXES", () => {
  const groups = prefixesByGroup();
  const named = groups.flatMap((g) => g.rows.map((r) => r.prefix.replace(/\/$/, "")));
  assert.deepEqual(named.sort(), Object.keys(PREFIXES).sort());
  for (const g of groups) assert.ok(g.rows.length, `${g.heading} 空表`);
});

test("参数表覆盖 PARAMS 每一个名字", () => {
  const text = paramRows().map((r) => r.param).join(" ");
  for (const name of Object.keys(PARAMS)) {
    assert.match(text, new RegExp(`@${name}\\b`), `参数表漏了 @${name}`);
  }
});

test("报警表覆盖 RULES 每一个错误码，修法来自 rule.fix", () => {
  const rows = ruleRows();
  assert.deepEqual(rows.map((r) => r.code).sort(), Object.keys(RULES).sort());
  for (const row of rows) {
    assert.equal(row.fix, RULES[row.code].fix);
  }
});

test("飞书表按 9 行上限切开，含表头", () => {
  const header = ["报警码", "你要做什么"];
  const body = Array.from({ length: 12 }, (_, i) => [`N-X-${i}`, "修"]);
  const chunks = chunkTable(header, body, FEISHU_TABLE_LIMIT);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].length, FEISHU_TABLE_LIMIT);
  assert.deepEqual(chunks[0][0], header);
  assert.equal(chunks[1].length, 5);
  assert.ok(chunks.every((c) => c.length <= FEISHU_TABLE_LIMIT));
});

test("对账能抓出版本、前缀、参数、报警码漂移", () => {
  const expected = expectedFacts();
  const okText = [
    expected.version,
    ...expected.prefixes,
    ...expected.params.map((p) => `@${p}`),
    ...expected.rules,
  ].join("\n");
  assert.equal(diffFacts(extractFactsFromText(okText)).ok, true);

  const missingPrefix = diffFacts(extractFactsFromText(okText.replace("sec/", "")));
  assert.equal(missingPrefix.ok, false);
  assert.ok(missingPrefix.errors.some((e) => e.includes("sec/")));

  const extraPrefix = diffFacts(extractFactsFromText(`${okText}\nrogue/`));
  assert.equal(extraPrefix.ok, false);
  assert.ok(extraPrefix.errors.some((e) => e.includes("rogue/")));

  const extraParam = diffFacts(extractFactsFromText(`${okText}\n@rogue`));
  assert.equal(extraParam.ok, false);
  assert.ok(extraParam.errors.some((e) => e.includes("@rogue")));

  const extraRule = diffFacts(extractFactsFromText(`${okText}\nN-FAKE-CODE`));
  assert.equal(extraRule.ok, false);
  assert.ok(extraRule.errors.some((e) => e.includes("N-FAKE-CODE")));

  const badVersion = diffFacts(extractFactsFromText(okText.replace(expected.version, "v0.0 (2000-01-01)")));
  assert.equal(badVersion.ok, false);
});

test("正文反例 txt/ 不对账，契约表多出来的前缀和参数要红", () => {
  const doc = buildDesignerDoc();
  const fromDoc = extractFactsFromDoc(doc);
  assert.equal(diffFacts(fromDoc).ok, true, diffFacts(fromDoc).errors.join("\n"));

  const polluted = extractFactsFromTables([
    ...doc.blocks.filter((b) => b.type === "table"),
    { fact: "prefix", rows: [["前缀"], ["rogue/"]] },
    { fact: "param", rows: [["参数"], ["@rogue"]] },
  ]);
  const result = diffFacts({ ...polluted, version: doc.version });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("rogue/")));
  assert.ok(result.errors.some((e) => e.includes("@rogue")));
});

test("CLI generate 不调飞书且退出 0", () => {
  const run = spawnSync(process.execPath, ["scripts/feishu-naming-doc.mjs", "generate"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FEISHU_APP_ID: "", FEISHU_APP_SECRET: "" },
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const payload = JSON.parse(run.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.version, SPEC_VERSION);
  assert.equal(payload.document_id, FEISHU_DOCUMENT_ID);
});

test("publish 先清文档再按稿灌段和表", async () => {
  const doc = buildDesignerDoc();
  const tables = [];
  const appended = [];
  const client = {
    async clearDocument(id) {
      assert.equal(id, FEISHU_DOCUMENT_ID);
      return { deleted: 3 };
    },
    textBlock(type, text) {
      return { block_type: type, text };
    },
    async appendBlocks(_id, blocks) {
      appended.push(...blocks);
      return { appended: blocks.length };
    },
    async createTable(_id, rows) {
      assert.ok(rows.length <= FEISHU_TABLE_LIMIT);
      assert.ok(rows[0].length <= FEISHU_TABLE_LIMIT);
      tables.push(rows);
      return { table_block_id: `t${tables.length}` };
    },
  };
  await publishDesignerDoc(doc, client);
  assert.ok(appended.length > 0, "没有写入文本块");
  assert.ok(tables.length >= 6, `表太少: ${tables.length}`);
  const cellText = tables.flat(2).join("\n");
  for (const prefix of Object.keys(PREFIXES)) {
    assert.match(cellText, new RegExp(`${prefix}/`), `发布表漏了 ${prefix}/`);
  }
  for (const code of Object.keys(RULES)) {
    assert.match(cellText, new RegExp(code), `发布表漏了 ${code}`);
  }
});
