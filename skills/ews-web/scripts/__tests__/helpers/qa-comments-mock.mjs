/**
 * Isolated mock of the torchlight QA comment HTTP protocol.
 * GET/POST /api/qa-comments?pageKey= → { comments|comment, durable: true }.
 * In-memory only. Not a live Worker and not imported by product runtime.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webm': 'video/webm',
  '.ico': 'image/x-icon',
};

function json(data, status = 200) {
  return { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) };
}

function validId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(id);
}

function validComment(row, pageKey) {
  return row && row.pageKey === pageKey && validId(row.id) && typeof row.body === 'string' &&
    row.body.trim().length > 0 && row.body.length <= 4000 &&
    row.context && ['lang', 'region', 'state', 'composition'].every((key) => typeof row.context[key] === 'string') &&
    row.anchor && Array.isArray(row.anchor.path) && row.anchor.path.length > 0 &&
    ['u', 'v'].every((key) => Number.isFinite(row.anchor[key])) &&
    typeof row.resolved === 'boolean';
}

export function createCommentStore() {
  return new Map();
}

export async function handleQaComments(request, store, user = { id: 'fixture-user', name: '同步测试员' }) {
  const url = new URL(request.url);
  const pageKey = url.searchParams.get('pageKey') || '';
  if (!pageKey || pageKey.length > 300) return json({ error: 'invalid_page_key' }, 400);
  const bucket = () => {
    if (!store.has(pageKey)) store.set(pageKey, new Map());
    return store.get(pageKey);
  };
  if (request.method === 'GET') {
    const comments = [...bucket().values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return json({ comments, durable: true, transport: 'poll', pollIntervalMs: 1000 });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'invalid_json' }, 400); }
  if (!validComment(input, pageKey)) return json({ error: 'invalid_comment' }, 422);
  const now = Date.now();
  const previous = bucket().get(input.id);
  const incomingReplies = Array.isArray(input.replies) ? input.replies : [];
  if (incomingReplies.length > 30) return json({ error: 'too_many_replies' }, 422);
  const comment = previous ? {
    ...previous,
    resolved: input.resolved,
    replies: incomingReplies,
    updatedAt: now,
  } : {
    id: input.id,
    pageKey,
    body: String(input.body).trim(),
    context: input.context,
    anchor: input.anchor,
    viewport: input.viewport,
    createdAt: now,
    updatedAt: now,
    resolved: input.resolved,
    replies: incomingReplies,
    author: { id: user.id, name: user.name || '同事' },
  };
  comment.replies = incomingReplies;
  bucket().set(input.id, comment);
  return json({ comment, durable: true });
}

function inside(root, target) {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(`..${sep}`));
}

export function createQaCommentsHarness({ demoDir, store, cases = new Map() } = {}) {
  const captured = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/qa-comments' || url.pathname === '/api/qa-comments/') {
      captured.push({
        method: req.method,
        pathname: url.pathname,
        search: Object.fromEntries(url.searchParams.entries()),
        href: url.pathname + url.search + url.hash,
        hash: url.hash || '',
      });
      try {
        const pageKey = url.searchParams.get('pageKey') || '';
        const state = cases.get(pageKey) || {};
        let body = '';
        for await (const chunk of req) body += chunk;
        if (req.method === 'POST') {
          state.posts = state.posts || [];
          try { state.posts.push({ body: JSON.parse(body), at: Date.now() }); } catch { state.posts.push({ raw: body, at: Date.now() }); }
          if (state.status) {
            res.writeHead(state.status, { 'Content-Type': 'application/json' });
            res.end('{}');
            return;
          }
        } else {
          state.gets = (state.gets || 0) + 1;
        }
        const request = new Request(url, { method: req.method, ...(body ? { body } : {}) });
        const response = await handleQaComments(request, store, { id: 'fixture-user', name: state.author || '同步测试员' });
        if (req.method === 'POST' && state.hold) {
          const hold = state.hold;
          state.hold = null;
          await hold;
        }
        if (req.method === 'POST' && state.dropAck) {
          state.dropAck = false;
          res.destroy();
          return;
        }
        res.writeHead(response.status, response.headers);
        res.end(response.body);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }
    try {
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      if (rel === '/') rel = '/index.html';
      const target = resolve(demoDir, `.${rel}`);
      if (!inside(demoDir, target) && resolve(target) !== resolve(demoDir, 'index.html')) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const info = await stat(target);
      if (!info.isFile()) { res.writeHead(404); res.end('not found'); return; }
      const buf = await readFile(target);
      res.writeHead(200, {
        'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  return {
    server,
    captured,
    listen() {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          const { port } = server.address();
          resolveListen(`http://127.0.0.1:${port}`);
        });
      });
    },
    close() {
      return new Promise((resolveClose) => server.close(() => resolveClose()));
    },
  };
}
