import { createRuntime, getCurrentUser } from '@xd-cell/worker-sdk';

const API = '/api/qa-comments';
function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}
function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
}
function validReplies(replies) {
  if (replies == null) return true;
  if (!Array.isArray(replies) || replies.length > 30) return false;
  const ids = new Set();
  return replies.every((item) => item && validId(item.id) && !ids.has(item.id) &&
    (ids.add(item.id), true) &&
    typeof item.body === 'string' && item.body.trim().length > 0 && item.body.length <= 4000 &&
    Number.isFinite(Number(item.createdAt)));
}
function mergeReplies(previous, incoming, user, now) {
  const byId = new Map();
  for (const item of previous || []) {
    if (item && validId(item.id)) byId.set(item.id, item);
  }
  for (const item of incoming || []) {
    if (!item || !validId(item.id) || byId.has(item.id)) continue;
    byId.set(item.id, {
      id: item.id,
      body: String(item.body).trim(),
      createdAt: Number(item.createdAt) || now,
      author: { id: user.id, name: user.name || '同事' },
    });
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
function unionReplies(left, right) {
  const byId = new Map();
  for (const item of [...(left || []), ...(right || [])]) {
    if (item && validId(item.id) && !byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, 30);
}
function validReplyRecord(row, pageKey) {
  return row && row.pageKey === pageKey && validId(row.parentId) && validId(row.id) &&
    typeof row.body === 'string' && row.body.trim().length > 0 && row.body.length <= 4000 &&
    Number.isFinite(Number(row.createdAt));
}
function replyRecordKey(prefix, commentId, replyId) {
  return prefix + commentId + '/r/' + replyId;
}
function validCommentCore(row, pageKey) {
  return row && row.pageKey === pageKey && validId(row.id) && typeof row.body === 'string' &&
    row.body.trim().length > 0 && row.body.length <= 4000 &&
    row.context && ['lang', 'region', 'state', 'composition'].every((key) =>
      typeof row.context[key] === 'string' && row.context[key].length <= 200) &&
    row.anchor && Array.isArray(row.anchor.path) && row.anchor.path.length > 0 && row.anchor.path.length <= 50 &&
    row.anchor.path.every((part) => typeof part === 'string' && part.length > 0 && part.length <= 300) &&
    ['u', 'v'].every((key) => Number.isFinite(row.anchor[key]) && row.anchor[key] >= 0 && row.anchor[key] <= 1) &&
    typeof row.resolved === 'boolean';
}
function validRow(row, pageKey) {
  return validCommentCore(row, pageKey) && validReplies(row.replies);
}
async function listPrefix(kv, prefix) {
  const keys = [];
  const timings = { listMs: 0, getMs: 0, pages: 0, keys: 0 };
  // Vary the legal page size once per second to avoid reusing a stale list
  // query. Keep it constant within this scan so continuation cursors agree.
  const limit = 100 + Math.floor(Date.now() / 1000) % 100;
  timings.limit = limit;
  let cursor;
  const seenCursors = new Set();
  do {
    const started = Date.now();
    const result = await kv.list({ prefix, limit, ...(cursor ? { cursor } : {}) });
    timings.listMs += Date.now() - started;
    timings.pages += 1;
    const batch = (result.keys || []).filter((key) => key.name !== prefix + '__index');
    keys.push(...batch);
    timings.keys += batch.length;
    cursor = result.list_complete ? undefined : result.cursor;
    if (!result.list_complete && (!cursor || seenCursors.has(cursor))) throw new Error('incomplete_listing');
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return { keys, timings };
}
async function loadReplyRecords(kv, pageKey, commentId) {
  const prefixes = await Promise.all(['v2', 'v3'].map((version) => prefixFor(pageKey, version)));
  const stored = [];
  for (const prefix of prefixes) {
    const { keys } = await listPrefix(kv, prefix + commentId + '/r/');
    for (const key of keys) {
      const item = await kv.get(key.name, { type: 'json' });
      if (validReplyRecord(item, pageKey) && item.parentId === commentId) stored.push(item);
    }
  }
  return stored;
}
async function prefixFor(pageKey, version = 'v3') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageKey));
  return 'qa-comments/' + version + '/' + Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join('') + '/';
}
async function readListed(kv, pageKey, prefix) {
  // Independent records are the source of truth, including records omitted
  // from historical shared indexes. Reads never write a discovery snapshot.
  // Reply keys live under the same page prefix, so one paginated scan finds
  // both comments and thread replies; do not list /r/ again per comment.
  const { keys, timings } = await listPrefix(kv, prefix);
  const comments = [], replies = [];
  const commentKeys = keys.filter((key) => !key.name.includes('/r/'));
  const replyKeys = keys.filter((key) => key.name.includes('/r/'));
  timings.keys = commentKeys.length;
  const started = Date.now();
  for (let i = 0; i < commentKeys.length; i += 20) {
    const batch = await Promise.all(commentKeys.slice(i, i + 20)
      .map((key) => kv.get(key.name, { type: 'json' })));
    comments.push(...batch.filter((row) => validCommentCore(row, pageKey)));
  }
  for (let i = 0; i < replyKeys.length; i += 20) {
    const batch = await Promise.all(replyKeys.slice(i, i + 20)
      .map((key) => kv.get(key.name, { type: 'json' })));
    replies.push(...batch.filter((item) => validReplyRecord(item, pageKey)));
  }
  timings.getMs = Date.now() - started;
  return { rows: comments, replies, timings };
}
async function readComments(kv, pageKey) {
  const results = await Promise.all(['v2', 'v3'].map(async (version) => ({
    version, ...await readListed(kv, pageKey, await prefixFor(pageKey, version)),
  })));
  const byId = new Map();
  for (const result of results) for (const row of result.rows) {
    const previous = byId.get(row.id);
    if (!previous || Number(row.updatedAt || 0) >= Number(previous.updatedAt || 0)) byId.set(row.id, row);
  }
  const storedByParent = new Map();
  for (const result of results) for (const item of result.replies || []) {
    const list = storedByParent.get(item.parentId) || [];
    list.push(item);
    storedByParent.set(item.parentId, list);
  }
  for (const row of byId.values()) {
    const stored = storedByParent.get(row.id) || [];
    row.replies = unionReplies(validReplies(row.replies) ? row.replies : [], stored.map((item) => ({
      id: item.id, body: item.body, createdAt: item.createdAt, author: item.author,
    })));
  }
  return { rows: [...byId.values()], source: 'independent-keys', timings: results.map(({ version, timings }) => ({ version, ...timings })) };
}
// One key per comment: two colleagues creating comments cannot overwrite an array.
export async function handleComments(request, kv, user) {
  const url = new URL(request.url);
  const pageKey = url.searchParams.get('pageKey') || '';
  if (!pageKey || pageKey.length > 300) return json({ error: 'invalid_page_key' }, 400);
  if (request.method === 'GET') {
    const startedAt = Date.now();
    const result = await readComments(kv, pageKey);
    const comments = result.rows;
    comments.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return json({ comments, durable: true, transport: 'poll', pollIntervalMs: 1000, source: result.source, timings: result.timings, readMs: Date.now() - startedAt });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  if (raw.length > 160000) return json({ error: 'comment_too_large' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!validRow(input, pageKey)) return json({ error: 'invalid_comment' }, 422);
  const prefix = await prefixFor(pageKey, 'v3');
  const key = prefix + input.id;
  const previous = await kv.get(key, { type: 'json' }) ||
    await kv.get(await prefixFor(pageKey, 'v2') + input.id, { type: 'json' });
  const now = Date.now();
  const storedReplies = await loadReplyRecords(kv, pageKey, input.id);
  const existingReplies = unionReplies(previous && validReplies(previous.replies) ? previous.replies : [], storedReplies);
  const incomingReplies = mergeReplies([], input.replies, user, now);
  const merged = mergeReplies(existingReplies, input.replies, user, now);
  if (merged.length > 30) return json({ error: 'too_many_replies' }, 422);
  const comment = previous ? {
    ...previous,
    resolved: input.resolved,
    replies: merged,
    updatedAt: now,
  } : {
    id: input.id, pageKey, body: input.body.trim(), context: input.context, anchor: input.anchor,
    viewport: input.viewport, createdAt: now, updatedAt: now, resolved: input.resolved,
    replies: incomingReplies,
    author: { id: user.id, name: user.name || '同事' },
  };
  comment.replies = merged;
  await kv.put(key, comment, { type: 'json' });
  for (const item of incomingReplies) {
    if (existingReplies.some((reply) => reply.id === item.id)) continue;
    await kv.put(replyRecordKey(prefix, input.id, item.id), {
      id: item.id, parentId: input.id, pageKey, body: item.body, createdAt: item.createdAt, author: item.author,
    }, { type: 'json' });
  }
  return json({ comment, durable: true });
}
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname.replace(/\/$/, '');
    if (path === API) {
      try {
        const user = getCurrentUser(request);
        if (!user) return json({ error: 'login_required' }, 401);
        return await handleComments(request, createRuntime({ request, env }).kv, user);
      } catch {
        // A local isolate Map is not shared storage. Fail visibly; never pretend.
        return json({ error: 'shared_storage_unavailable' }, 503);
      }
    }
    if (path.startsWith(API + '/')) return json({ error: 'not_found' }, 404);
    return env.ASSETS.fetch(request);
  },
};
