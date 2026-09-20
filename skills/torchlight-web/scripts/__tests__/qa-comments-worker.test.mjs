import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { handleComments } from '../../deploy/qa-comments-realtime/worker.js';

const env = { ASSETS: { fetch: () => new Response('asset') } };
const base = 'https://qa-comments.test';
const values = new Map();
const kv = {
  async get(key) { return structuredClone(values.get(key) || null); },
  async put(key, value) { values.set(key, structuredClone(value)); },
  async list({ prefix }) { return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
};
const run = (request) => handleComments(request, kv, { id: 'test-user', name: '测试员' });
const row = {
  id: 'worker-test-row', pageKey: 'worker-test-page',
  context: { lang: 'zh-CN', region: 'global', state: 'home', composition: 'desktop' },
  anchor: { path: ['qa-shell', 'qa-copy'], tag: 'P', u: .4, v: .6 },
  body: '检查跨同事同步', createdAt: Date.now(), updatedAt: Date.now(), resolved: false,
};

test('XD Sites comment worker stores, updates and isolates page keys', async () => {
  const get = () => run(new Request(base + '/api/qa-comments?pageKey=worker-test-page'));
  let response = await get();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).comments, []);

  response = await run(new Request(base + '/api/qa-comments?pageKey=worker-test-page', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).comment.id, row.id);

  response = await get();
  assert.equal((await response.json()).comments.length, 1);
  response = await run(new Request(base + '/api/qa-comments?pageKey=other-page'));
  assert.deepEqual((await response.json()).comments, []);
  response = await run(new Request(base + '/api/qa-comments?pageKey=worker-test-page', {
    method: 'POST', body: JSON.stringify({ ...row, resolved: true, body: '不能覆盖原文' }),
  }));
  const updated = await response.json();
  assert.equal(updated.durable, true);
  assert.equal(updated.comment.resolved, true);
  assert.equal(updated.comment.body, row.body);
});

test('XD Sites comment worker appends replies without overwriting the original body', async () => {
  const pageKey = 'thread-page';
  const id = 'thread-root-comment';
  await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({ ...row, id, pageKey, body: '原始评论' }),
  }));
  const first = await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({
      ...row, id, pageKey, body: '不能覆盖原文', resolved: false,
      replies: [{ id: 'thread-reply-one', body: '第一条补充', createdAt: 100 }],
    }),
  }));
  const once = await first.json();
  assert.equal(once.comment.body, '原始评论');
  assert.equal(once.comment.replies.length, 1);
  assert.equal(once.comment.replies[0].body, '第一条补充');
  assert.equal(once.comment.replies[0].author.name, '测试员');
  const second = await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({
      ...row, id, pageKey, body: '仍然不能覆盖', resolved: true,
      replies: [
        { id: 'thread-reply-one', body: '篡改已有补充', createdAt: 100 },
        { id: 'thread-reply-two', body: '第二条补充', createdAt: 200 },
      ],
    }),
  }));
  const twice = await second.json();
  assert.equal(twice.comment.body, '原始评论');
  assert.equal(twice.comment.resolved, true);
  assert.deepEqual(twice.comment.replies.map((item) => item.body), ['第一条补充', '第二条补充']);
});

test('XD Sites comment worker rejects a 31st reply and keeps the comment visible', async () => {
  const pageKey = 'reply-cap-page';
  const id = 'reply-cap-comment';
  const replies = Array.from({ length: 30 }, (_, i) => ({
    id: 'cap-reply-' + String(i).padStart(2, '0'),
    body: '补充 ' + i,
    createdAt: i + 1,
  }));
  await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({ ...row, id, pageKey, body: '上限评论', replies }),
  }));
  const overflow = await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({
      ...row, id, pageKey, body: '上限评论', resolved: false,
      replies: [{ id: 'cap-reply-30', body: '第 31 条', createdAt: 99 }],
    }),
  }));
  assert.equal(overflow.status, 422);
  const listed = await (await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey))).json();
  assert.equal(listed.comments.length, 1);
  assert.equal(listed.comments[0].replies.length, 30);
  assert.equal(listed.comments[0].body, '上限评论');
  assert.equal([...values.keys()].some((name) => String(name).includes('cap-reply-30')), false);
});

test('GET still returns a comment whose stored replies array is invalid', async () => {
  const pageKey = 'corrupt-replies-page';
  const id = 'corrupt-replies-comment';
  await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({
      ...row, id, pageKey, body: '坏 replies 父评论',
      replies: [{ id: 'kept-reply-aa', body: '独立补充', createdAt: 1 }],
    }),
  }));
  for (const [name, value] of values) {
    if (value && value.id === id && !String(name).includes('/r/')) {
      values.set(name, { ...value, replies: 'broken' });
    }
  }
  const listed = await (await run(new Request(base + '/api/qa-comments?pageKey=' + pageKey))).json();
  assert.equal(listed.comments.length, 1);
  assert.equal(listed.comments[0].body, '坏 replies 父评论');
  assert.deepEqual(listed.comments[0].replies.map((item) => item.id), ['kept-reply-aa']);
});

test('GET paginates independent /r/ keys in the same page scan and keeps the oldest 30', async () => {
  const pageKey = 'paged-replies-page';
  const id = 'paged-reply-parent';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageKey))).toString('hex');
  const prefix = 'qa-comments/v3/' + hash + '/';
  const data = new Map([[prefix + id, { ...row, id, pageKey, body: '分页补充父评论', replies: 'broken' }]]);
  for (let i = 0; i < 250; i += 1) {
    const replyId = 'late-reply-' + String(i).padStart(3, '0');
    data.set(prefix + id + '/r/' + replyId, {
      id: replyId, parentId: id, pageKey, body: '补充 ' + i, createdAt: 250 - i, author: { id: 'writer' },
    });
  }
  const calls = [];
  const storage = {
    async get(key) { return structuredClone(data.get(key) || null); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async list({ prefix, limit, cursor }) {
      calls.push({ prefix, limit, cursor });
      const keys = [...data.keys()].filter((name) => name.startsWith(prefix)).sort();
      const offset = Number(cursor || 0), end = offset + limit;
      return {
        keys: keys.slice(offset, end).map((name) => ({ name })),
        list_complete: end >= keys.length,
        cursor: end < keys.length ? String(end) : undefined,
      };
    },
  };
  const listed = await (await handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey), storage, { id: 'reader' })).json();
  assert.equal(listed.comments.length, 1);
  assert.equal(listed.comments[0].body, '分页补充父评论');
  assert.equal(listed.comments[0].replies.length, 30);
  assert.deepEqual(listed.comments[0].replies.map((item) => item.id), Array.from({ length: 30 }, (_, i) => 'late-reply-' + String(249 - i).padStart(3, '0')));
  const pages = calls.filter((call) => call.prefix === prefix);
  assert.ok(pages.length > 1);
  assert.equal(new Set(pages.map((call) => call.limit)).size, 1);
});

test('concurrent independent replies both survive last-write-wins parent updates', async () => {
  const pageKey = 'concurrent-reply-page';
  const id = 'concurrent-reply-comment';
  const data = new Map();
  const racingKv = {
    async get(key) { return structuredClone(data.get(key) || null); },
    async put(key, value) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      data.set(key, structuredClone(value));
    },
    async list({ prefix }) {
      return { keys: [...data.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
  await handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({ ...row, id, pageKey, body: '并发根评论' }),
  }), racingKv, { id: 'root-user', name: '发起人' });
  const responses = await Promise.all([
    handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
      method: 'POST', body: JSON.stringify({
        ...row, id, pageKey, body: '并发根评论', resolved: false,
        replies: [{ id: 'concurrent-reply-a', body: '同事甲补充', createdAt: 10 }],
      }),
    }), racingKv, { id: 'user-a', name: '同事甲' }),
    handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
      method: 'POST', body: JSON.stringify({
        ...row, id, pageKey, body: '并发根评论', resolved: false,
        replies: [{ id: 'concurrent-reply-b', body: '同事乙补充', createdAt: 11 }],
      }),
    }), racingKv, { id: 'user-b', name: '同事乙' }),
  ]);
  assert.ok(responses.every((response) => response.status === 200));
  const listed = await (await handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey), racingKv, { id: 'reader' })).json();
  assert.deepEqual(listed.comments[0].replies.map((item) => item.id).sort(), ['concurrent-reply-a', 'concurrent-reply-b']);
});

test('XD Sites comment worker rejects malformed rows', async () => {
  const response = await run(new Request(base + '/api/qa-comments?pageKey=worker-test-page', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'bad' }),
  }));
  assert.equal(response.status, 422);
});

test('API requires platform authentication and does not fall back to isolate memory', async () => {
  const response = await worker.fetch(new Request(base + '/api/qa-comments?pageKey=worker-test-page'), env);
  assert.equal(response.status, 401);
});

test('concurrent independent comments do not overwrite each other', async () => {
  await Promise.all(['parallel-one', 'parallel-two'].map((id) => run(new Request(base + '/api/qa-comments?pageKey=parallel', {
    method: 'POST', body: JSON.stringify({ ...row, id, pageKey: 'parallel' }),
  }))));
  const response = await run(new Request(base + '/api/qa-comments?pageKey=parallel'));
  assert.equal((await response.json()).comments.length, 2);
});

test('separate worker isolates retain every independent key without shared index state', async () => {
  const pageKey = 'cross-isolate-fixed-index';
  const [isolateA, isolateB] = await Promise.all([
    import('../../deploy/qa-comments-realtime/worker.js?isolate=fixed-a'),
    import('../../deploy/qa-comments-realtime/worker.js?isolate=fixed-b'),
  ]);
  const data = new Map();
  const sharedKv = {
    async get(key) { return structuredClone(data.get(key) || null); },
    async put(key, value) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      data.set(key, structuredClone(value));
    },
    async list({ prefix }) {
      return { keys: [...data.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
  const expected = Array.from({ length: 20 }, (_, i) => 'cross-isolate-' + i);
  const responses = await Promise.all(expected.map((id, i) => (i % 2 ? isolateA : isolateB).handleComments(
    new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
      method: 'POST', body: JSON.stringify({ ...row, id, pageKey }),
    }), sharedKv, { id: 'tester-' + i })));
  assert.ok(responses.every((response) => response.status === 200));
  const result = await (await isolateA.handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey), sharedKv, { id: 'reader' })).json();
  assert.equal(result.source, 'independent-keys');
  assert.deepEqual(result.comments.map((comment) => comment.id).sort(), expected.sort());
});

test('new comments bypass a 30-second cached empty list on the next poll', async (t) => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const data = new Map(), cachedLists = new Map();
  const storage = {
    async get(key) { return structuredClone(data.get(key) || null); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async list(options) {
      const key = JSON.stringify(options), cached = cachedLists.get(key);
      if (cached && now - cached.at < 30000) return structuredClone(cached.result);
      const result = { keys: [...data.keys()].filter(key => key.startsWith(options.prefix)).map(name => ({ name })), list_complete: true };
      cachedLists.set(key, { at: now, result });
      return structuredClone(result);
    },
  };
  const pageKey = 'cached-list-regression';
  const get = () => handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey), storage, { id: 'reader' });
  assert.deepEqual((await (await get()).json()).comments, []);
  await handleComments(new Request(base + '/api/qa-comments?pageKey=' + pageKey, {
    method: 'POST', body: JSON.stringify({ ...row, pageKey }),
  }), storage, { id: 'writer' });
  now += 1000;
  assert.equal((await (await get()).json()).comments[0].id, row.id);
});

test('multi-page discovery keeps page size stable across a clock boundary and recovers old index omissions', async (t) => {
  let now = 199000;
  t.mock.method(Date, 'now', () => now);
  const pageKey = 'paged-legacy-recovery';
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pageKey))).toString('hex');
  const prefix = 'qa-comments/v2/' + hash + '/';
  const data = new Map(Array.from({ length: 250 }, (_, i) => {
    const id = 'legacy-item-' + i;
    return [prefix + id, { ...row, id, pageKey, createdAt: 1000, updatedAt: 1000, author: { id: 'original-author' } }];
  }));
  data.set(prefix + '__index', { ids: [] });
  const calls = [];
  const storage = {
    async get(key) { return structuredClone(data.get(key) || null); },
    async put(key, value) { data.set(key, structuredClone(value)); },
    async list({ prefix, limit, cursor }) {
      calls.push({ prefix, limit, cursor });
      now += 1000;
      const keys = [...data.keys()].filter(key => key.startsWith(prefix)).sort();
      const offset = Number(cursor || 0), end = offset + limit;
      return { keys: keys.slice(offset, end).map(name => ({ name })), list_complete: end >= keys.length,
        cursor: end < keys.length ? String(end) : undefined };
    },
  };
  const url = base + '/api/qa-comments?pageKey=' + pageKey;
  const result = await (await handleComments(new Request(url), storage, { id: 'reader' })).json();
  assert.equal(result.comments.length, 250);
  const pages = calls.filter(call => call.prefix === prefix);
  assert.ok(pages.length > 1);
  assert.equal(new Set(pages.map(call => call.limit)).size, 1);
  assert.deepEqual(data.get(prefix + '__index'), { ids: [] });
  const updated = await (await handleComments(new Request(url, { method: 'POST', body: JSON.stringify({
    ...row, pageKey, id: 'legacy-item-0', body: 'must not replace legacy body', resolved: true,
  }) }), storage, { id: 'resolver' })).json();
  assert.equal(updated.comment.author.id, 'original-author');
  assert.equal(updated.comment.body, row.body);
  const merged = await (await handleComments(new Request(url), storage, { id: 'reader' })).json();
  assert.equal(merged.comments.length, 250);
  assert.equal(merged.comments.find(row => row.id === 'legacy-item-0').resolved, true);
});
