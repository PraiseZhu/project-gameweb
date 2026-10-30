import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEwsWeb } from '../ews-web.mjs';
import { validateReadyPair } from '../lib/handoff-contract.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import { defaultConfig, pcInventory, mobileInventory, writeReadyPack, writeAssets } from './helpers/ready-fixture.mjs';

const payload = '1;" onmouseover="globalThis.ewsInjected=true';
const validColor = { r: 0.2, g: 0.4, b: 0.6, a: 0.5 };

test('ready rejects malicious RGBA in both fill locations before CLI creates output', () => {
  for (const location of ['fills', 'style']) {
    for (const channel of ['r', 'g', 'b', 'a']) {
      const root = mkdtempSync(join(tmpdir(), 'ews-fill-xss-'));
      const pc = pcInventory();
      const node = pc.nodes.find((item) => item.id === '100:2');
      const fills = [{ type: 'SOLID', color: { ...validColor, [channel]: payload } }];
      if (location === 'style') node.style = { fills };
      else node.fills = fills;
      writeReadyPack(join(root, 'handoff'), { pc, mobile: mobileInventory() });
      writeFileSync(join(root, 'assets.json'), '{}');
      writeFileSync(join(root, 'config.json'), JSON.stringify(defaultConfig()));
      const result = runEwsWeb(['--handoff', join(root, 'handoff'), '--assets', join(root, 'assets.json'), '--config', join(root, 'config.json'), '--out', join(root, 'out')]);
      assert.equal(result.ok, false);
      assert.ok(result.problems.some((problem) => problem.includes('RGBA')));
      assert.equal(existsSync(join(root, 'out')), false);
    }
  }
});

test('ready checks unknown and attachment colors and rejects nonfinite/coerced values', () => {
  for (const value of [NaN, Infinity, -Infinity, null, true, '0.5', {}, []]) {
    const pc = pcInventory();
    pc.nodes.find((node) => node.id === '100:1').fills = [{ type: 'SOLID', color: { ...validColor, a: value } }];
    assert.equal(validateReadyPair(pc, mobileInventory()).ok, false);
  }
  const pc = pcInventory();
  pc.attachments.modals[0].nodes[1].style = { fills: [{ type: 'SOLID', color: { ...validColor, a: payload } }] };
  assert.equal(validateReadyPair(pc, mobileInventory()).ok, false);
});

test('finite RGBA survives CLI and renderer rejects poisoned models independently', () => {
  const root = mkdtempSync(join(tmpdir(), 'ews-fill-valid-'));
  const pc = pcInventory();
  pc.nodes.find((node) => node.id === '100:2').style = { fills: [{ type: 'SOLID', color: validColor }] };
  const docs = writeReadyPack(join(root, 'handoff'), { pc, mobile: mobileInventory() });
  writeAssets(join(root, 'assets'), docs);
  writeFileSync(join(root, 'config.json'), JSON.stringify(defaultConfig()));
  const result = runEwsWeb(['--handoff', join(root, 'handoff'), '--assets', join(root, 'assets/asset-map.json'), '--config', join(root, 'config.json'), '--out', join(root, 'out')]);
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  const node = { id: 'test', role: 'sec', pageBox: { x: 0, y: 0, w: 100, h: 100 }, fills: [{ type: 'SOLID', color: validColor }] };
  const model = { defaultLocale: 'zh-CN', platforms: { pc: { nodes: [node], screens: [{ key: 'hero', sectionId: 'test', nodes: [node] }] } } };
  assert.match(renderPageHtml(model), /rgba\(51,102,153,0.5\)/);
  for (const channel of ['r', 'g', 'b', 'a']) {
    node.fills = [{ type: 'SOLID', color: { ...validColor, [channel]: payload } }];
    assert.throws(() => renderPageHtml(model), /RGBA/);
  }
});
