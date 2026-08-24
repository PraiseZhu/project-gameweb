#!/usr/bin/env node
/**
 * 设计师飞书命名规范发布件。
 *
 *   npm run feishu:doc -- generate     只生成机器稿（不调飞书）
 *   npm run feishu:doc -- publish      清掉旧页，按机器稿重铺，再对账
 *   npm run feishu:doc -- audit        读飞书全文，对前缀 / 参数 / 报警码 / 版本号
 *   npm run feishu:doc -- sync-local   看本地 main 上规范 5 文件 SHA；没变就退出，变了才 publish
 *
 * 飞书是发布件。规范改动只走 Git。本机定时用 sync-local，密钥不进 GitHub。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDesignerDoc,
  expectedFacts,
  extractFactsFromTables,
  diffFacts,
  auditGeneratedDoc,
  decideLocalSync,
  FEISHU_DOCUMENT_URL,
  FEISHU_SYNC_PATHS,
} from "../src/feishu-naming-doc.mjs";
import { createFeishuDocx, tenantAccessToken, publishDesignerDoc } from "../src/feishu-docx.mjs";

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(TOOL_ROOT, "../../..");
const DEFAULT_STAMP = resolve(homedir(), ".claude/.goal/feishu-local-publish/last-sync.json");

const cmd = process.argv[2] ?? "generate";

function fail(message, extra) {
  console.error(message);
  if (extra?.length) for (const line of extra) console.error(`- ${line}`);
  process.exit(1);
}

function gitTreeSha(repoRoot, ref, paths) {
  const tree = spawnSync("git", ["-C", repoRoot, "ls-tree", ref, ...paths], { encoding: "utf8" });
  if (tree.status !== 0) return "";
  const listed = (tree.stdout || "").trim().split("\n").filter(Boolean);
  if (listed.length !== paths.length) return "";
  return listed.map((line) => line.split(/\s+/)[2]).join(":");
}

function readStamp(path) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return typeof raw.sha === "string" ? raw.sha : "";
  } catch {
    return "";
  }
}

function writeStamp(path, sha, extra) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ sha, ...extra, at: new Date().toISOString() }, null, 2)}\n`);
}

async function clientFromEnv() {
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    const err = new Error("MISSING_FEISHU_SECRET");
    err.code = "MISSING_FEISHU_SECRET";
    throw err;
  }
  const token = await tenantAccessToken({ appId, appSecret });
  return createFeishuDocx({ token });
}

async function publishAndAudit(doc, client, command) {
  if (command === "publish") {
    await publishDesignerDoc(doc, client);
  }
  const tables = await client.readTables(doc.documentId);
  const text = await client.readPlainText(doc.documentId);
  const version = (text.match(/v\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)/) || [])[0] ?? "";
  const result = diffFacts({ ...extractFactsFromTables(tables), version });
  if (!result.ok) fail(`飞书对账失败 ${FEISHU_DOCUMENT_URL}`, result.errors);
  return result;
}

async function main() {
  const doc = buildDesignerDoc();
  const generated = auditGeneratedDoc(doc);
  if (!generated.ok) fail("生成稿缺项，拒绝发布", generated.errors);

  if (cmd === "generate") {
    console.log(JSON.stringify({
      ok: true,
      document_id: doc.documentId,
      document_url: doc.documentUrl,
      version: doc.version,
      blocks: doc.blocks.length,
      facts: expectedFacts(),
    }, null, 2));
    return;
  }

  if (cmd === "sync-local") {
    const stampPath = process.env.FEISHU_SYNC_STAMP || DEFAULT_STAMP;
    const ref = process.env.FEISHU_SYNC_REF || "main";
    const currentSha = gitTreeSha(REPO_ROOT, ref, FEISHU_SYNC_PATHS);
    const stampedSha = readStamp(stampPath);
    const hasSecrets = Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET);
    const decision = decideLocalSync({ hasSecrets, currentSha, stampedSha });
    if (decision.action === "fail") {
      if (decision.reason === "missing-secret") {
        fail("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，本机铺飞书没跑。");
      }
      fail(`读不到 ${ref} 上的规范文件 SHA，本机铺飞书没跑。`);
    }
    if (decision.action === "skip") {
      console.log(JSON.stringify({
        ok: true,
        command: cmd,
        action: "skip",
        reason: decision.reason,
        sha: currentSha,
        document_url: FEISHU_DOCUMENT_URL,
      }, null, 2));
      return;
    }
    const client = await clientFromEnv();
    const result = await publishAndAudit(doc, client, "publish");
    writeStamp(stampPath, currentSha, { version: result.expected.version, reason: decision.reason });
    console.log(JSON.stringify({
      ok: true,
      command: cmd,
      action: "publish",
      reason: decision.reason,
      sha: currentSha,
      document_url: FEISHU_DOCUMENT_URL,
      version: result.expected.version,
    }, null, 2));
    return;
  }

  if (cmd === "publish" || cmd === "audit") {
    let client;
    try {
      client = await clientFromEnv();
    } catch (err) {
      if (err.code === "MISSING_FEISHU_SECRET") {
        fail("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET，无法访问飞书。生成稿已自检通过，但发布/对账没跑。");
      }
      throw err;
    }
    const result = await publishAndAudit(doc, client, cmd);
    console.log(JSON.stringify({
      ok: true,
      command: cmd,
      document_url: FEISHU_DOCUMENT_URL,
      version: result.expected.version,
    }, null, 2));
    return;
  }

  fail(`未知命令 ${cmd}。用 generate | publish | audit | sync-local`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
