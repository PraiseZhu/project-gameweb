import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNavigation } from '../lib/nav-map.mjs';

test('label map wires every top-nav button and leaves 前往官网 pending', () => {
  const screens = [{ key: 'sec1' }, { key: 'sec2' }];
  const nodes = [
    { id: 'sec1', role: 'sec', status: 'determined', pageBox: { x: 0, y: 0, w: 200, h: 100 } },
    { id: 'nav', role: 'fix', name: 'fix/顶部导航通栏', status: 'determined', parentId: 'sec1', pageBox: { x: 0, y: 0, w: 200, h: 40 } },
    { id: 'home', role: 'btn', name: 'btn/顶部导航按钮', status: 'determined', parentId: 'nav', pageBox: { x: 0, y: 0, w: 80, h: 40 } },
    { id: 'home-t', type: 'TEXT', role: 'copy', parentId: 'home', status: 'determined', pageBox: { x: 0, y: 0, w: 80, h: 40 }, text: { characters: '官网主页' } },
    { id: 'info', role: 'btn', name: 'btn/顶部导航按钮', status: 'determined', parentId: 'nav', pageBox: { x: 90, y: 0, w: 80, h: 40 } },
    { id: 'info-t', type: 'TEXT', role: 'copy', parentId: 'info', status: 'determined', pageBox: { x: 90, y: 0, w: 80, h: 40 }, text: { characters: '赛事信息' } },
    { id: 'site', role: 'btn', name: 'btn/前往官网', status: 'determined', parentId: 'nav', pageBox: { x: 180, y: 0, w: 40, h: 40 } },
  ];
  const resolved = resolveNavigation({
    nodes,
    screens,
    config: { navigation: { 官网主页: 'sec1', 赛事信息: 'sec2' } },
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.map.home, 'sec1');
  assert.equal(resolved.map.info, 'sec2');
  assert.equal(resolved.pending.some((item) => item.id === 'site' && item.kind === 'official-site' && !item.href), true);
});

test('node-id config still wins; unknown destination fails closed', () => {
  const nodes = [
    { id: '100:13', role: 'btn', name: 'btn/cta', status: 'determined', pageBox: { x: 0, y: 0, w: 10, h: 10 } },
  ];
  const ok = resolveNavigation({
    nodes,
    screens: [{ key: 'gallery' }],
    config: { navigation: { '100:13': 'gallery' } },
  });
  assert.equal(ok.map['100:13'], 'gallery');
  const bad = resolveNavigation({
    nodes,
    screens: [{ key: 'gallery' }],
    config: { navigation: { '100:13': 'missing' } },
  });
  assert.equal(bad.ok, false);
});
