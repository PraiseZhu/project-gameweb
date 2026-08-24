/**
 * 飞书云文档最小客户端。只服务设计师命名规范发布件：清块、灌段、建表、读全文。
 * token 用 tenant_access_token（应用身份），不走 Cindy 个人登录。
 */
const API = "https://open.feishu.cn/open-apis";
export const FEISHU_TABLE_LIMIT = 9;
/** 飞书默认列宽 100。单位像素。16:9（约 1920 内容区）总宽 1800，两列表/三列表拉齐。 */
export const FEISHU_COLUMN_WIDTH = {
  2: [520, 1280],
  3: [400, 540, 860],
};

export function columnSetOf(widths) {
  return widths.map((column_width, column_index) => ({ column_index, column_width }));
}

export const BLOCK_TYPE = {
  p: 2,
  h1: 3,
  h2: 4,
  h3: 5,
  bullet: 12,
  quote: 15,
  divider: 22,
};

const BLOCK_FIELD = {
  [BLOCK_TYPE.p]: "text",
  [BLOCK_TYPE.h1]: "heading1",
  [BLOCK_TYPE.h2]: "heading2",
  [BLOCK_TYPE.h3]: "heading3",
  [BLOCK_TYPE.bullet]: "bullet",
  [BLOCK_TYPE.quote]: "quote",
};

export class FeishuHttpError extends Error {
  constructor(message, { status, code, url } = {}) {
    super(message);
    this.name = "FeishuHttpError";
    this.status = status;
    this.code = code;
    this.url = url;
  }
}

export async function tenantAccessToken({ appId, appSecret, fetchImpl = fetch }) {
  if (!appId || !appSecret) throw new Error("需要 FEISHU_APP_ID 与 FEISHU_APP_SECRET");
  const res = await fetchImpl(`${API}/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.code) {
    throw new FeishuHttpError(`取 tenant_access_token 失败: ${body.msg || res.status}`, {
      status: res.status, code: body.code, url: "/auth/v3/tenant_access_token/internal",
    });
  }
  if (!body.tenant_access_token) throw new Error("飞书未返回 tenant_access_token");
  return body.tenant_access_token;
}

export function createFeishuDocx({ token, fetchImpl = fetch, sleepImpl } = {}) {
  if (!token) throw new Error("需要飞书 token");
  const sleep = sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function request(method, path, { query, body, retry = 2 } = {}) {
    const url = new URL(API + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null || v === "") continue;
        url.searchParams.set(k, String(v));
      }
    }
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429 && retry > 0) {
      await sleep(800);
      return request(method, path, { query, body, retry: retry - 1 });
    }
    if (!res.ok || json.code) {
      throw new FeishuHttpError(`飞书 ${method} ${path} 失败: ${json.msg || res.status}`, {
        status: res.status, code: json.code, url: path,
      });
    }
    return json.data ?? json;
  }

  async function listChildren(documentId, blockId, pageToken) {
    return request("GET", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(blockId)}/children`, {
      query: { page_size: 500, page_token: pageToken, document_revision_id: -1 },
    });
  }

  async function listAllChildren(documentId, blockId) {
    const items = [];
    let pageToken;
    do {
      const page = await listChildren(documentId, blockId, pageToken);
      items.push(...(page.items ?? page.children ?? []));
      pageToken = page.has_more ? page.page_token : "";
    } while (pageToken);
    return items;
  }

  async function deleteChildren(documentId, parentBlockId, startIndex, endIndex) {
    if (endIndex <= startIndex) return;
    return request("DELETE", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children/batch_delete`, {
      body: { start_index: startIndex, end_index: endIndex },
    });
  }

  async function clearDocument(documentId) {
    const children = await listAllChildren(documentId, documentId);
    if (!children.length) return { deleted: 0 };
    await deleteChildren(documentId, documentId, 0, children.length);
    return { deleted: children.length };
  }

  function textBlock(blockType, text) {
    if (blockType === BLOCK_TYPE.divider) return { block_type: BLOCK_TYPE.divider, divider: {} };
    const field = BLOCK_FIELD[blockType];
    if (!field) throw new Error(`不支持的块类型 ${blockType}`);
    return {
      block_type: blockType,
      [field]: {
        elements: [{ text_run: { content: text ?? "" } }],
        style: {},
      },
    };
  }

  async function appendBlocks(documentId, blocks, parentBlockId = documentId) {
    if (!blocks.length) return { appended: 0 };
    return request("POST", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(parentBlockId)}/children`, {
      body: { children: blocks },
    });
  }

  async function createTable(documentId, rows) {
    const height = rows.length;
    const width = rows[0]?.length ?? 0;
    if (!height || !width) throw new Error("空表");
    if (height > FEISHU_TABLE_LIMIT || width > FEISHU_TABLE_LIMIT) {
      throw new Error(`飞书单表上限 ${FEISHU_TABLE_LIMIT}×${FEISHU_TABLE_LIMIT}，收到 ${height}×${width}`);
    }
    const columnWidth = FEISHU_COLUMN_WIDTH[width] ?? Array.from({ length: width }, () => 240);
    const created = await request("POST", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`, {
      body: {
        children: [{
          block_type: 31,
          table: { property: { row_size: height, column_size: width, header_row: true, column_width: columnWidth } },
        }],
      },
    });
    const tableBlock = (created.children ?? [])[0];
    const tableBlockId = tableBlock?.block_id;
    if (!tableBlockId) throw new Error("建表成功但未返回 table block_id");

    const cellsPage = await listChildren(documentId, tableBlockId);
    const cells = cellsPage.items ?? cellsPage.children ?? [];
    const updates = [];
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const content = rows[r]?.[c];
        if (content === undefined || content === null || content === "") continue;
        const cell = cells[r * width + c];
        const textId = cell?.children?.[0];
        if (!textId) continue;
        updates.push({
          block_id: textId,
          update_text_elements: { elements: [{ text_run: { content: String(content) } }] },
        });
      }
    }
    for (let i = 0; i < updates.length; i += 50) {
      await request("PATCH", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/batch_update`, {
        body: { requests: updates.slice(i, i + 50) },
      });
    }
    for (const { column_index, column_width } of columnSetOf(columnWidth)) {
      await request("PATCH", `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(tableBlockId)}`, {
        body: { update_table_property: { column_index, column_width } },
      });
    }
    return { table_block_id: tableBlockId, rows: height, columns: width, filled: updates.length, column_width: columnWidth };
  }

  function blockText(block) {
    if (!block) return "";
    for (const field of ["heading1", "heading2", "heading3", "heading4", "text", "bullet", "quote"]) {
      const els = block[field]?.elements;
      if (!els) continue;
      return els.map((e) => e.text_run?.content ?? "").join("");
    }
    return "";
  }

  async function readPlainText(documentId) {
    const children = await listAllChildren(documentId, documentId);
    const chunks = [];
    for (const child of children) {
      const text = blockText(child);
      if (text) chunks.push(text);
      if (child.block_type === 31) {
        const cells = await listAllChildren(documentId, child.block_id);
        for (const cell of cells) {
          const inner = await listAllChildren(documentId, cell.block_id);
          for (const t of inner) {
            const cellText = blockText(t);
            if (cellText) chunks.push(cellText);
          }
        }
      }
    }
    return chunks.join("\n");
  }

  async function readTables(documentId) {
    const children = await listAllChildren(documentId, documentId);
    const tables = [];
    for (const child of children) {
      if (child.block_type !== 31) continue;
      const property = child.table?.property ?? {};
      const columns = Number(property.column_size || 0);
      const tableCells = await listAllChildren(documentId, child.block_id);
      const cells = [];
      for (const cell of tableCells) {
        const inner = await listAllChildren(documentId, cell.block_id);
        cells.push(inner.map((t) => blockText(t)).join(""));
      }
      const rows = [];
      if (columns > 0) {
        for (let i = 0; i < cells.length; i += columns) rows.push(cells.slice(i, i + columns));
      } else {
        rows.push(cells);
      }
      tables.push({ rows });
    }
    return tables;
  }

  return {
    request,
    listAllChildren,
    clearDocument,
    appendBlocks,
    createTable,
    readPlainText,
    readTables,
    textBlock,
    BLOCK_TYPE,
  };
}

export async function publishDesignerDoc(doc, client) {
  await client.clearDocument(doc.documentId);
  const pending = [];
  const flushText = async () => {
    if (!pending.length) return;
    await client.appendBlocks(doc.documentId, pending.splice(0, pending.length));
  };
  for (const block of doc.blocks) {
    if (block.type === "table") {
      await flushText();
      await client.createTable(doc.documentId, block.rows);
      continue;
    }
    const blockType = BLOCK_TYPE[block.type];
    if (!blockType) throw new Error(`未知块类型 ${block.type}`);
    pending.push(client.textBlock(blockType, block.text ?? ""));
    if (pending.length >= 40) await flushText();
  }
  await flushText();
}
