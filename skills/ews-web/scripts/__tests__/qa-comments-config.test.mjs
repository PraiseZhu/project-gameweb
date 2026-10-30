import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCommentShareCli, resolveCommentShare } from '../lib/comment-share.mjs';
import { buildCommentApiUrl } from '../../assets/runtime/qa-comments.mjs';
import { buildSyntheticDemo } from './helpers/build-demo.mjs';

test('comment share defaults to local IndexedDB and rejects external hosts', () => {
  assert.deepEqual(resolveCommentShare({}), { ok: true, commentApi: null, commentPageId: null, problems: [] });
  assert.equal(resolveCommentShare({ commentApi: '/api/qa-comments', commentPageId: 'etheria-ews-season-qa' }).ok, true);
  assert.equal(resolveCommentShare({ commentApi: 'https://qa-comments-realtime.workers.xd.team' }).ok, false);
  assert.equal(resolveCommentShare({ commentApi: '//evil.example/api' }).ok, false);
  assert.equal(resolveCommentShare({ commentPageId: 'has space' }).ok, false);
  assert.equal(resolveCommentShare({ commentPageId: 'a/b' }).ok, false);
  const over = applyCommentShareCli({ commentApi: null }, ['--comment-api', '/api/qa-comments', '--comment-page-id', 'ews-cli']);
  assert.equal(over.commentApi, '/api/qa-comments');
  assert.equal(over.commentPageId, 'ews-cli');
  const withQuery = resolveCommentShare({ commentApi: '/api/qa-comments?tenant=a', commentPageId: 'stable-page' });
  assert.equal(withQuery.ok, true);
  assert.equal(withQuery.commentApi, '/api/qa-comments?tenant=a');
  const withHash = resolveCommentShare({ commentApi: '/api/qa-comments?tenant=a#frag' });
  assert.equal(withHash.ok, true);
  assert.equal(withHash.commentApi, '/api/qa-comments?tenant=a');
});

test('comment API URL merges query, overwrites pageKey, drops fragment', () => {
  const origin = 'http://127.0.0.1:9';
  assert.equal(
    buildCommentApiUrl('/api/qa-comments?tenant=a', 'stable-page', null, origin),
    '/api/qa-comments?tenant=a&pageKey=stable-page',
  );
  const overwritten = new URL(buildCommentApiUrl('/api/qa-comments?tenant=a&pageKey=wrong', 'stable-page', null, origin), origin);
  assert.equal(overwritten.searchParams.get('tenant'), 'a');
  assert.equal(overwritten.searchParams.get('pageKey'), 'stable-page');
  assert.equal(overwritten.searchParams.getAll('pageKey').length, 1);
  assert.equal(overwritten.hash, '');
  const fromHash = buildCommentApiUrl('/api/qa-comments?tenant=a#frag', 'stable-page', null, origin);
  assert.equal(fromHash, '/api/qa-comments?tenant=a&pageKey=stable-page');
  assert.equal(fromHash.includes('#'), false);
  assert.equal(fromHash.includes('?tenant=a?'), false);
  assert.equal(
    buildCommentApiUrl('/api/qa-comments', 'stable-page', null, origin),
    '/api/qa-comments?pageKey=stable-page',
  );
});

test('boot reads commentApi from model.config, not a hardcoded null', () => {
  const boot = readFileSync(fileURLToPath(new URL('../../assets/runtime/boot.mjs', import.meta.url)), 'utf8');
  assert.match(boot, /commentApi:\s*model\.config\?\.commentApi/);
  assert.match(boot, /commentPageId:\s*model\.config\?\.commentPageId/);
  assert.doesNotMatch(boot, /commentApi:\s*null/);
});

test('ewsweb writes commentApi and commentPageId from CLI into the generated model', () => {
  const built = buildSyntheticDemo('ews-qc-config-', {
    args: ['--comment-api', '/api/qa-comments', '--comment-page-id', 'ews-cli-page'],
  });
  const disk = JSON.parse(readFileSync(join(built.out, 'model.json'), 'utf8'));
  assert.equal(disk.config.commentApi, '/api/qa-comments');
  assert.equal(disk.config.commentPageId, 'ews-cli-page');
  const html = readFileSync(join(built.out, 'index.html'), 'utf8');
  assert.match(html, /"commentApi":\s*"\/api\/qa-comments"/);
  assert.match(html, /"commentPageId":\s*"ews-cli-page"/);
});

test('ewsweb without comment flags stays local', () => {
  const built = buildSyntheticDemo('ews-qc-local-');
  const disk = JSON.parse(readFileSync(join(built.out, 'model.json'), 'utf8'));
  assert.equal(disk.config.commentApi, null);
  assert.equal(disk.config.commentPageId, null);
});
