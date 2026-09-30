import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packFrozenDelivery } from '../freeze/pack-frozen-delivery.mjs';

test('delivery pack copies frozen pages without touching the original', () => {
  const demo = mkdtempSync(join(tmpdir(), 'torchlight-delivery-pack-'));
  const frozen = join(demo, 'frozen');
  mkdirSync(join(frozen, 'static-assets'), { recursive: true });
  writeFileSync(join(frozen, 'en.static.html'), '<!doctype html><title>en</title>');
  writeFileSync(join(frozen, 'static-assets', 'unused.webp'), 'unused');
  const result = packFrozenDelivery({ demoDir: demo, budgetBytes: 1024 * 1024 });
  assert.equal(result.ok, true, result.error);
  assert.equal(readFileSync(join(frozen, 'en.static.html'), 'utf8').includes('en'), true);
  assert.equal(existsSync(join(frozen, 'static-assets', 'unused.webp')), true);
  assert.equal(existsSync(join(demo, 'delivery', 'en.static.html')), true);
  assert.equal(existsSync(join(demo, 'delivery', 'static-assets', 'unused.webp')), false);
});

test('delivery pack fails closed when a referenced image is missing', () => {
  const demo = mkdtempSync(join(tmpdir(), 'torchlight-delivery-missing-'));
  const frozen = join(demo, 'frozen');
  mkdirSync(frozen, { recursive: true });
  writeFileSync(join(frozen, 'en.static.html'), '<img src="./static-assets/gone.webp">');
  const result = packFrozenDelivery({ demoDir: demo });
  assert.equal(result.ok, false);
  assert.match(result.error, /missing-image/);
  assert.equal(existsSync(join(demo, 'delivery')), false);
});
