import test from 'node:test';
import assert from 'node:assert/strict';
import { collectStaticBrowserSnapshot } from '../lib/static-browser-evidence.mjs';

test('static browser collector blocks without a real demo and viewport contract instead of inventing evidence', async () => {
  const snapshot = await collectStaticBrowserSnapshot({ demoDir: null, contract: {} });
  assert.equal(snapshot.comparison.blocked, true);
  assert.equal(snapshot.comparison.failures[0].reason, 'static-browser-contract-missing-demo-or-viewport');
  assert.deepEqual(snapshot.runtime, {});
});

test('static browser collector blocks when font provenance manifest is absent before claiming browser facts', async () => {
  const snapshot = await collectStaticBrowserSnapshot({
    demoDir: 'this-directory-does-not-exist',
    contract: { platform: 'pc', viewport: { width: 1920, height: 1080 } },
  });
  assert.equal(snapshot.comparison.blocked, true);
  assert.equal(snapshot.comparison.failures[0].reason, 'fonts-manifest-missing');
});
