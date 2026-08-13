/**
 * marks.mjs — file-scoped finding marks.
 *
 * The data transformations are pure. Figma pluginData access is kept in the
 * two small injected-api helpers at the bottom so this module never depends on
 * a global `figma` object and remains offline-testable.
 */

export const MARKS_KEY = "naming-lint:marks";
export const MARK_KINDS = ["fixed", "not-an-issue", "rule-wrong"];
export const MARKS_VERSION = 1;
export const MAX_SERIALIZED_BYTES = 400 * 1024;

const MARK_KIND_SET = new Set(MARK_KINDS);

export function emptyMarks() {
  return { version: MARKS_VERSION, marks: {} };
}

function keyFor(code, nodeId) {
  return `${code}::${nodeId}`;
}

function entryProblem(key, entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "标记不是对象";
  if (!MARK_KIND_SET.has(entry.mark)) return "mark 不是允许的三种值之一";
  for (const field of ["markedAt", "code", "nodeId", "path", "name", "rootName", "specVersion"]) {
    if (typeof entry[field] !== "string" || !entry[field]) return `${field} 缺失或不是非空字符串`;
  }
  if (key !== keyFor(entry.code, entry.nodeId)) return "标记键与 code/nodeId 不一致";
  return null;
}

function summarizedErrors(counts) {
  return [...counts].map(([reason, count]) => `${reason}：丢弃 ${count} 条`);
}

/**
 * Parse untrusted pluginData without throwing.
 *
 * Returns the usable store plus an exact count for individually recoverable
 * entries and human-readable reasons suitable for a status message.
 */
export function parseMarks(raw) {
  if (raw === "" || raw === null || raw === undefined) {
    return { marks: emptyMarks(), dropped: 0, errors: [] };
  }
  if (typeof raw !== "string") {
    return {
      marks: emptyMarks(),
      dropped: 0,
      errors: ["pluginData 不是字符串，已使用空标记；无法统计丢失条数"],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      marks: emptyMarks(),
      dropped: 0,
      errors: [`pluginData JSON 解析失败，已使用空标记；无法统计丢失条数：${error?.message ?? String(error)}`],
    };
  }

  const rawEntries = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && parsed.marks && typeof parsed.marks === "object" && !Array.isArray(parsed.marks)
    ? Object.entries(parsed.marks)
    : [];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { marks: emptyMarks(), dropped: 0, errors: ["pluginData 顶层不是对象，已使用空标记"] };
  }
  if (parsed.version !== MARKS_VERSION) {
    return {
      marks: emptyMarks(),
      dropped: rawEntries.length,
      errors: [`不支持的标记版本 ${String(parsed.version)}：丢弃 ${rawEntries.length} 条`],
    };
  }
  if (!parsed.marks || typeof parsed.marks !== "object" || Array.isArray(parsed.marks)) {
    return { marks: emptyMarks(), dropped: 0, errors: ["marks 不是对象，已使用空标记"] };
  }

  const valid = {};
  const reasonCounts = new Map();
  for (const [key, entry] of rawEntries) {
    const problem = entryProblem(key, entry);
    if (problem) {
      reasonCounts.set(problem, (reasonCounts.get(problem) ?? 0) + 1);
    } else {
      valid[key] = { ...entry };
    }
  }
  const dropped = [...reasonCounts.values()].reduce((sum, count) => sum + count, 0);
  return {
    marks: { version: MARKS_VERSION, marks: valid },
    dropped,
    errors: summarizedErrors(reasonCounts),
  };
}

function utf8ByteLength(value) {
  let bytes = 0;
  for (const ch of value) {
    const code = ch.codePointAt(0);
    bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function stringify(store) {
  return JSON.stringify({ version: MARKS_VERSION, marks: store });
}

/**
 * Serialize within the 400KB budget. Only oldest fixed marks may be evicted.
 * If protected review input alone is too large, fail explicitly.
 */
export function serializeMarks(marks) {
  const source = marks?.marks && typeof marks.marks === "object" ? marks.marks : {};
  const kept = Object.fromEntries(Object.entries(source).map(([key, value]) => [key, { ...value }]));
  let json = stringify(kept);
  if (utf8ByteLength(json) <= MAX_SERIALIZED_BYTES) return { json, dropped: 0 };

  const fixedOldestFirst = Object.entries(kept)
    .filter(([, entry]) => entry?.mark === "fixed")
    .sort((a, b) => String(a[1]?.markedAt ?? "").localeCompare(String(b[1]?.markedAt ?? "")));
  let dropped = 0;
  for (const [key] of fixedOldestFirst) {
    delete kept[key];
    dropped++;
    json = stringify(kept);
    if (utf8ByteLength(json) <= MAX_SERIALIZED_BYTES) return { json, dropped };
  }

  throw new Error(
    `标记数据超过 400KB；已尝试丢弃 ${dropped} 条 fixed，`
      + "not-an-issue / rule-wrong 不允许丢弃，未写入 pluginData",
  );
}

/** Return a new store with one mark applied or removed. */
export function applyMark(marks, finding, mark, { now, specVersion, rootName }) {
  const code = String(finding?.code ?? "");
  const nodeId = String(finding?.nodeId ?? "");
  if (!code || !nodeId) throw new Error("finding 缺少 code 或 nodeId");
  if (mark !== null && !MARK_KIND_SET.has(mark)) throw new Error(`未知标记：${String(mark)}`);
  const next = { version: MARKS_VERSION, marks: { ...(marks?.marks ?? {}) } };
  const key = keyFor(code, nodeId);
  if (mark === null) {
    delete next.marks[key];
    return next;
  }
  next.marks[key] = {
    mark,
    markedAt: String(now),
    code,
    nodeId,
    path: String(finding.path ?? ""),
    name: String(finding.name ?? ""),
    rootName: String(rootName ?? ""),
    specVersion: String(specVersion ?? ""),
  };
  return next;
}

/** Match persisted marks to the current, unfiltered findings. */
export function reconcile(marks, findings) {
  const current = new Map();
  const byKey = {};
  for (const finding of findings ?? []) {
    const key = keyFor(finding.code, finding.nodeId);
    current.set(key, finding);
    byKey[key] = marks?.marks?.[key] ?? null;
  }

  const stillReported = [];
  const stale = [];
  for (const [key, entry] of Object.entries(marks?.marks ?? {})) {
    const finding = current.get(key);
    if (finding && entry.mark === "fixed") {
      stillReported.push({ key, mark: entry, finding });
    } else if (!finding && (entry.mark === "not-an-issue" || entry.mark === "rule-wrong")) {
      stale.push({ key, mark: entry, reason: "finding-missing" });
    }
  }
  return { stillReported, stale, byKey };
}

/** Read file-level pluginData through an injected Figma-like api. */
export function readMarks(api) {
  try {
    if (!api?.root || typeof api.root.getPluginData !== "function") {
      throw new Error("figma.root.getPluginData 不可用");
    }
    return parseMarks(api.root.getPluginData(MARKS_KEY));
  } catch (error) {
    return {
      marks: emptyMarks(),
      dropped: 0,
      errors: [`读取 ${MARKS_KEY} 失败，已使用空标记：${error?.message ?? String(error)}`],
    };
  }
}

/** Serialize and write file-level pluginData through an injected api. */
export function writeMarks(api, marks) {
  const serialized = serializeMarks(marks);
  if (!api?.root || typeof api.root.setPluginData !== "function") {
    throw new Error("figma.root.setPluginData 不可用，标记未保存");
  }
  try {
    api.root.setPluginData(MARKS_KEY, serialized.json);
  } catch (error) {
    throw new Error(`写入 ${MARKS_KEY} 失败，标记未保存：${error?.message ?? String(error)}`);
  }
  return serialized;
}
