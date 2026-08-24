#!/usr/bin/env node
/**
 * 设计师飞书命名规范发布件。
 *
 *   npm run feishu:doc -- generate   只生成机器稿（不调飞书）
 *   npm run feishu:doc -- publish    清掉旧页，按机器稿重铺，再对账
 *   npm run feishu:doc -- audit      读飞书全文，对前缀 / 参数 / 报警码 / 版本号
 *
 * 飞书是发布件。规范改动只走 Git；合进 main 后由 CI 调 publish。
 */
import { buildDesignerDoc, expectedFacts, extractFactsFromTables, diffFacts, auditGeneratedDoc, FEISHU_DOCUMENT_URL } from "../src/feishu-naming-doc.mjs";
import { createFeishuDocx, tenantAccessToken, publishDesignerDoc } from "../src/feishu-docx.mjs";

const cmd = process.argv[2] ?? "generate";

function fail(message, extra) {
  console.error(message);
  if (extra?.length) for (const line of extra) console.error(`- ${line}`);
  process.exit(1);
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
    if (cmd === "publish") {
      await publishDesignerDoc(doc, client);
    }
    const tables = await client.readTables(doc.documentId);
    const text = await client.readPlainText(doc.documentId);
    const version = (text.match(/v\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)/) || [])[0] ?? "";
    const result = diffFacts({ ...extractFactsFromTables(tables), version });
    if (!result.ok) fail(`飞书对账失败 ${FEISHU_DOCUMENT_URL}`, result.errors);
    console.log(JSON.stringify({
      ok: true,
      command: cmd,
      document_url: FEISHU_DOCUMENT_URL,
      version: result.expected.version,
    }, null, 2));
    return;
  }

  fail(`未知命令 ${cmd}。用 generate | publish | audit`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
