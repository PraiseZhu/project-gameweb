import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeCapturedHtml } from '../freeze/capture-static-html.mjs';
import {
  annotateReplaceableHtml,
  mergeReplaceableIndex,
  parseReplaceableName,
  writeMergedReplaceableIndex,
} from '../freeze/replaceable-assets.mjs';

test('parse only the outer img/[replaceable] name', () => {
  assert.equal(parseReplaceableName('img/[replaceable]赛季福利箱'), '赛季福利箱');
  assert.equal(parseReplaceableName(' img/[replaceable]赛季福利箱 '), '赛季福利箱');
  assert.equal(parseReplaceableName('img/[replaceable]'), null);
  assert.equal(parseReplaceableName('img/[Replaceable]赛季福利箱'), null);
  assert.equal(parseReplaceableName('bg/[replaceable]赛季福利箱'), null);
  assert.equal(parseReplaceableName('kv/[replaceable]赛季福利箱'), null);
  assert.equal(parseReplaceableName('img/可替换素材'), null);
  assert.equal(parseReplaceableName('img/[replaceable]可替换素材'), null);
  assert.equal(parseReplaceableName('img/box/[replaceable]赛季福利箱'), null);
});

test('stamp the named layer and index one file per slot', () => {
  const html = [
    '<div data-tree="pc">',
    '<div data-name="img/[replaceable]赛季福利箱"><img src="./static-assets/img-a.webp"></div>',
    '<div data-name="bg/[replaceable]不要"><img src="./static-assets/img-b.webp"></div>',
    '<img data-name="img/[replaceable]赛季福利箱" src="./static-assets/img-a.webp">',
    '</div>',
    '<div data-tree="mobile">',
    '<img data-name="img/[replaceable]赛季福利箱" src="./static-assets/img-c.webp">',
    '</div>',
  ].join('');
  const marked = annotateReplaceableHtml(html, { lang: 'cn' });
  assert.equal(marked.region, 'cn');
  assert.equal(marked.slots['赛季福利箱'].pc, './static-assets/img-a.webp');
  assert.equal(marked.slots['赛季福利箱'].mobile, './static-assets/img-c.webp');
  assert.equal((marked.html.match(/data-asset="赛季福利箱"/g) || []).length, 3);
  assert.equal(marked.html.includes('data-asset-platform="mobile"'), true);
  assert.equal(marked.html.includes('bg/[replaceable]不要" data-asset'), false);
  const kept = sanitizeCapturedHtml(marked.html, 'function applyAdaptive(){}', 'cn');
  assert.equal(kept.includes('data-asset="赛季福利箱"'), true);
  assert.equal(kept.includes('data-asset-lang="cn"'), true);
});

test('same file twice is one slot; two files in one slot fail', () => {
  const clash = '<div data-tree="pc"><img data-name="img/[replaceable]箱" src="./static-assets/img-a.webp"><img data-name="img/[replaceable]箱" src="./static-assets/img-b.webp"></div>';
  assert.throws(() => annotateReplaceableHtml(clash, { lang: 'en' }), /REPLACEABLE_CONFLICT/);
  const nested = '<div data-tree="pc" data-name="img/[replaceable]箱"><img src="./static-assets/img-a.webp"><img src="./static-assets/img-b.webp"></div>';
  assert.throws(() => annotateReplaceableHtml(nested, { lang: 'en' }), /REPLACEABLE_AMBIGUOUS/);
});

test('cn and global indexes can share a key; a later freeze replaces only that language', () => {
  const cn = mergeReplaceableIndex(null, {
    region: 'cn',
    lang: 'cn',
    slots: { 赛季福利箱: { pc: './static-assets/img-cn.webp' } },
  });
  const global1 = mergeReplaceableIndex(null, {
    region: 'global',
    lang: 'en',
    slots: { 赛季福利箱: { pc: './static-assets/img-en.webp' } },
  });
  const global2 = mergeReplaceableIndex(global1, {
    region: 'global',
    lang: 'ko',
    slots: { 赛季福利箱: { pc: './static-assets/img-ko.webp' } },
  });
  const globalJa = mergeReplaceableIndex(global2, {
    region: 'global',
    lang: 'ja',
    slots: { 赛季福利箱: { pc: './static-assets/img-ja.webp' } },
  });
  assert.equal(cn.slots['赛季福利箱'].pc.cn, './static-assets/img-cn.webp');
  assert.equal(global2.slots['赛季福利箱'].pc.en, './static-assets/img-en.webp');
  assert.equal(global2.slots['赛季福利箱'].pc.ko, './static-assets/img-ko.webp');
  assert.equal(globalJa.slots['赛季福利箱'].pc.ja, './static-assets/img-ja.webp');
  const replaced = mergeReplaceableIndex(globalJa, {
    region: 'global',
    lang: 'en',
    slots: { 赛季福利箱: { pc: './static-assets/img-en2.webp' } },
  });
  assert.equal(replaced.slots['赛季福利箱'].pc.en, './static-assets/img-en2.webp');
  assert.equal(replaced.slots['赛季福利箱'].pc.ko, './static-assets/img-ko.webp');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'replaceable-'));
  const written = writeMergedReplaceableIndex(root, {
    region: 'global',
    lang: 'en',
    slots: { 赛季福利箱: { pc: './static-assets/img-en.webp' } },
  });
  assert.equal(written.wrote, true);
  const file = path.join(root, 'global', 'replaceable-index.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.region, 'global');
  assert.equal(saved.slots['赛季福利箱'].pc.en, './static-assets/img-en.webp');
});
