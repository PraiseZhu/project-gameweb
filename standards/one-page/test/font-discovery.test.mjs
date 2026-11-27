import assert from 'node:assert/strict';
import { symlinkProbe } from './helpers/symlink.mjs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyAnswers } from '../src/apply-answers.mjs';
import { missingGlyphs } from '../src/cmap.mjs';
import { readFontAsset } from '../src/font-library.mjs';
import { buildFontQuestions, checkFontFiles, discoverFonts, sha256File } from '../src/fonts-b2.mjs';
import { inspectFontStructure } from '../src/font-inspect.mjs';
import { scanFonts, defaultFontDirectories } from '../src/font-scanner.mjs';

const workspace = new URL('../../../_tmp/', import.meta.url);
const license = 'SIL Open Font License 1.1';
const evidence = '许可文本核对记录 #1（可商用且可随网页交付）';
const now = '2026-11-26T03:00:00.000Z';
const family = 'One Page Fixture';
const makeNode = (id, weight, characters = '首页', fontFamily = family) => ({
  id, type: 'TEXT', status: 'determined', role: 'copy', name: '文案', text: { fontFamily, fontWeight: weight, characters },
});
const fixtureBytes = (name) => readFileSync(new URL('./fixtures/fonts/' + name, import.meta.url));

function fixtureFont() {
  const uint16 = (...values) => {
    const bytes = Buffer.alloc(values.length * 2);
    values.forEach((value, index) => bytes.writeUInt16BE(value, index * 2));
    return bytes;
  };
  const uint32 = (...values) => {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
    return bytes;
  };
  const familyBytes = Buffer.from(family, 'utf16le').swap16();
  const name = Buffer.concat([uint16(0, 1, 18, 3, 1, 0x0409, 1, familyBytes.length, 0), familyBytes]);
  const points = [...'首页金币'].map((character) => character.codePointAt(0)).sort((left, right) => left - right);
  const cmap = Buffer.concat([
    uint16(0, 1, 3, 10), uint32(12), uint16(12, 0), uint32(16 + points.length * 12, 0, points.length),
    ...points.map((point, index) => uint32(point, point, index + 1)),
  ]);
  const os2 = Buffer.alloc(96);
  os2.writeUInt16BE(4, 0);
  os2.writeUInt16BE(400, 4);
  const maxp = Buffer.alloc(32);
  maxp.writeUInt32BE(0x10000, 0);
  maxp.writeUInt16BE(points.length + 1, 4);
  const fvar = Buffer.concat([uint16(1, 0, 16, 2, 1, 20, 0, 8), Buffer.from('wght'), uint32(100 * 65536, 400 * 65536, 900 * 65536), uint16(0, 256)]);
  const tables = [['OS/2', os2], ['cmap', cmap], ['fvar', fvar], ['maxp', maxp], ['name', name]];
  const directory = Buffer.alloc(tables.length * 16);
  let offset = 12 + directory.length;
  const data = tables.flatMap(([tag, table], index) => {
    const record = index * 16;
    directory.write(tag, record, 'ascii');
    directory.writeUInt32BE(offset, record + 8);
    directory.writeUInt32BE(table.length, record + 12);
    const padding = Buffer.alloc((4 - (table.length % 4)) % 4);
    offset += table.length + padding.length;
    return [table, padding];
  });
  return Buffer.concat([uint32(0x10000), uint16(tables.length, 64, 2, directory.length - 64), directory, ...data]);
}

function fixture(context) {
  mkdirSync(workspace, { recursive: true });
  const root = mkdtempSync(fileURLToPath(new URL('font-discovery-', workspace)));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const directory = join(root, 'custom', 'EagleApp');
  const configDir = join(root, 'projects', 'page');
  const libraryDir = join(root, 'fonts-library');
  mkdirSync(directory, { recursive: true });
  mkdirSync(configDir, { recursive: true });
  const path = join(directory, 'misleading-name.ttf');
  const bytes = fixtureFont();
  writeFileSync(path, bytes);
  writeFileSync(path + '.license.txt', license);
  const fontDiscovery = { libraryDir, directories: [join(root, 'custom')] };
  const inventories = { pc: { nodes: [makeNode('10:1', 400), makeNode('10:2', 700)] } };
  const input = { inventories, languages: ['cn'], configDir, fontDiscovery };
  return { root, directory, configDir, libraryDir, path, bytes, fontDiscovery, inventories, input };
}

function answer(input, card, value) {
  return applyAnswers({ ...input, config: {}, questions: [{ ...card, id: 'F1' }], answers: [{ id: 'F1', fingerprint: card.fingerprint, value }], now });
}

function verifyRealFormats(context) {
  for (const { format, fontFamily, outline, weights, glyphs, missing } of [
    { format: 'otf', fontFamily: family, outline: 'CFF2', weights: { min: 100, default: 400, max: 900 }, glyphs: '首页金币A', missing: 'B' },
    { format: 'woff', fontFamily: 'One Page Web Fixture', outline: 'glyf', weights: { min: 300, default: 400, max: 800 }, glyphs: '首页金币BC', missing: 'A' },
  ]) {
    const setup = fixture(context);
    const { path, directory, libraryDir, configDir } = setup;
    renameSync(path, path + '.unused');
    const original = fixtureBytes('one-page-variable.' + format);
    const filename = join(realpathSync(directory), 'test-source.' + format);
    const truncated = join(realpathSync(directory), 'broken.' + format);
    const misleading = join(realpathSync(directory), 'wrong-container.ttf');
    writeFileSync(filename, original);
    writeFileSync(truncated, original.subarray(0, 32));
    writeFileSync(misleading, original);
    const structure = inspectFontStructure(original);
    assert.equal(structure.container, format);
    assert.ok(structure.tables[outline]);
    if (format === 'woff') assert.ok(structure.tables.gvar);
    const asset = readFontAsset(filename);
    assert.equal(asset.identity.family, fontFamily);
    assert.equal(asset.identity.weight, 400);
    assert.equal(asset.identity.os2State, 'valid');
    assert.equal(asset.identity.cmapState, 'valid');
    assert.deepEqual(asset.identity.axes.wght, weights);
    assert.deepEqual(missingGlyphs(original, glyphs), []);
    assert.deepEqual(missingGlyphs(original, glyphs + missing), [missing]);
    assert.throws(() => readFontAsset(truncated), /无效/);
    assert.throws(() => readFontAsset(misleading), /无效/);

    const input = { ...setup.input, inventories: { pc: { nodes: [makeNode('10:1', 700, glyphs, fontFamily)] } } };
    const missingInput = { ...input, inventories: { pc: { nodes: [makeNode('10:1', 700, glyphs + missing, fontFamily)] } } };
    assert.deepEqual(discoverFonts(missingInput).missing[0].glyphs, [missing]);
    const [card] = discoverFonts(input).questions;
    assert.deepEqual(card.options.map((option) => option.id), [sha256File(original)]);
    const approved = answer(input, card, { confirmed: [{ id: card.options[0].id, license, evidence }] });
    const [entry] = JSON.parse(readFileSync(join(libraryDir, 'registry.json'))).entries;
    assert.equal(entry.identity.container, format);
    assert.deepEqual(readFileSync(join(libraryDir, entry.file)), original);
    renameSync(filename, filename + '.gone');
    const reused = discoverFonts({ ...input, fontDiscovery: { libraryDir, directories: [] } });
    assert.deepEqual(reused.questions, []);
    assert.deepEqual(reused.fonts, approved.fonts);
    const [resource] = Object.values(reused.fonts.resources);
    assert.equal(resource.format, format);
    assert.deepEqual(readFileSync(join(configDir, resource.file)), original);
    const verification = checkFontFiles({ ...input, fonts: reused.fonts });
    assert.deepEqual(verification.blockers, []);
    assert.equal(verification.fontInputs[0].digest, sha256File(original));
    context.diagnostic(format + ': ' + outline + ' / ' + fontFamily + ' / wght ' + weights.min + '-' + weights.max
      + ' / Level 2→1 + B2 核验通过；截断、扩展名伪装和缺字均拒绝；sha256=' + sha256File(original));
  }
}

test('Level 2 合并单卡；确认才入库；Level 1 断源复用及真实 OTF/WOFF 端到端核验', (context) => {
  const { input, libraryDir, path, bytes, configDir } = fixture(context);
  const found = discoverFonts(input);
  const [card] = found.questions;
  assert.equal(found.questions.length, 1);
  assert.equal(card.type, 'font-candidates');
  assert.equal(card.options.length, 1);
  assert.equal(card.options[0].id, sha256File(bytes));
  assert.deepEqual(card.options[0].matches.map((match) => match.weight), [400, 700]);
  assert.equal(existsSync(join(libraryDir, 'registry.json')), false);
  assert.equal(answer(input, card, { rejected: [card.options[0].id] }).fonts, undefined);
  assert.equal(existsSync(join(libraryDir, 'files')), false);
  const config = answer(input, card, { confirmed: [{ id: card.options[0].id, license, evidence }] });
  const registry = JSON.parse(readFileSync(join(libraryDir, 'registry.json')));
  assert.equal(registry.entries.length, 1);
  const [entry] = registry.entries;
  assert.equal(entry.confirmedAt, now);
  assert.equal(entry.identity.family, family);
  assert.match(entry.file, /^files\/one-page-fixture-VF-[0-9a-f]{8}\.ttf$/);
  assert.equal(lstatSync(join(libraryDir, entry.file)).isSymbolicLink(), false);
  assert.deepEqual(readFileSync(join(libraryDir, entry.file)), bytes);
  assert.equal(readFileSync(join(libraryDir, entry.licenseFile), 'utf8'), license);
  renameSync(path, path + '.gone');
  const reused = discoverFonts({ ...input, fontDiscovery: { libraryDir, directories: [] } });
  assert.deepEqual(reused.questions, []);
  assert.deepEqual(reused.fonts, config.fonts);
  const resource = Object.values(reused.fonts.resources)[0];
  assert.deepEqual(readFileSync(join(configDir, resource.file)), bytes);
  verifyRealFormats(context);
});

test('扫描自定义与 Windows 字体树：递归、缓存失效、TTC、SHA 去重和系统红标', (context) => {
  const { root, path, directory, bytes, fontDiscovery, input } = fixture(context);
  assert.deepEqual(defaultFontDirectories({ platform: 'darwin', home: root }).map((item) => item.path), [join(root, 'Library', 'Fonts'), '/Library/Fonts']);
  const windows = defaultFontDirectories({ platform: 'win32', env: { WINDIR: 'D:/Windows' } });
  assert.deepEqual(windows.map((item) => ({ ...item, path: item.path.split(String.fromCharCode(92)).join('/') })), [{ path: 'D:/Windows/Fonts', system: true }]);
  writeFileSync(join(directory, 'duplicate.ttf'), bytes);
  writeFileSync(join(directory, 'do-not-open.ttc'), bytes);
  const first = scanFonts(fontDiscovery);
  assert.equal(first.index.length, 2);
  assert.equal(first.cacheHits, 0);
  assert.equal(discoverFonts(input).questions[0].options.length, 1);
  assert.equal(scanFonts(fontDiscovery).cacheHits, 2);
  writeFileSync(path, 'broken');
  const after = scanFonts(fontDiscovery);
  assert.equal(after.cacheHits, 1);
  assert.equal(after.index.length, 1);

  const windowsRoot = join(root, 'D-drive', 'Windows', 'Fonts');
  const windowsNested = join(windowsRoot, 'LanguagePack', 'zh-CN');
  mkdirSync(windowsNested, { recursive: true });
  const windowsFont = join(realpathSync(windowsNested), 'windows-fixture.ttf');
  writeFileSync(windowsFont, bytes);
  writeFileSync(windowsFont + '.license.txt', license);
  writeFileSync(join(windowsNested, 'ignore.ttc'), bytes);
  const windowsDiscovery = { libraryDir: join(root, 'windows-library'), directories: [windowsRoot] };
  const firstWindowsScan = scanFonts(windowsDiscovery);
  assert.equal(firstWindowsScan.cacheHits, 0);
  assert.deepEqual(firstWindowsScan.index.map(({ path, system }) => ({ path, system })), [{ path: windowsFont, system: true }]);
  assert.equal(scanFonts(windowsDiscovery).cacheHits, 1);
  const updated = Buffer.from(bytes);
  updated.writeUInt16BE(500, inspectFontStructure(bytes).tables['OS/2'].offset + 4);
  writeFileSync(windowsFont, updated);
  const later = new Date('2026-11-26T04:00:00.000Z');
  utimesSync(windowsFont, later, later);
  const refreshed = scanFonts(windowsDiscovery);
  assert.equal(refreshed.cacheHits, 0);
  assert.equal(refreshed.index[0].identity.sha256, sha256File(updated));
  assert.equal(refreshed.index[0].identity.weight, 500);
  assert.equal(scanFonts(windowsDiscovery).cacheHits, 1);
  const [windowsCard] = discoverFonts({ ...input, fontDiscovery: windowsDiscovery }).questions;
  const [windowsCandidate] = windowsCard.options;
  assert.equal(windowsCandidate.id, sha256File(updated));
  assert.equal(windowsCandidate.severity, 'danger');
  assert.equal(windowsCandidate.warnings.length, 1);
  assert.match(windowsCandidate.warnings[0], /系统字体/);
  assert.equal(existsSync(join(windowsDiscovery.libraryDir, 'registry.json')), false);
});

test('风险候选红标；确认前篡改/软链不写库；Level 3 精确列出外语缺字', async (context) => {
  const { input, path, bytes, libraryDir, directory } = fixture(context);
  writeFileSync(path + '.license.txt', 'Noncommercial / 商用需授权');
  const risky = { ...input, fontDiscovery: { libraryDir, directories: [{ path: directory, system: true }] } };
  const [card] = discoverFonts(risky).questions;
  assert.equal(card.options[0].severity, 'danger');
  assert.match(card.options[0].warnings.join(' '), /系统/);
  assert.match(card.options[0].warnings.join(' '), /非商用|需授权/);
  assert.throws(() => answer(risky, card, { confirmed: [{ id: card.options[0].id, license: '非商用', evidence }] }));
  writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
  assert.throws(() => answer(risky, card, { confirmed: [{ id: card.options[0].id, license, evidence }] }));
  renameSync(path, path + '.target');
  await symlinkProbe(context, '确认前软链不写库', path + '.target', path, () => {
    assert.throws(() => answer(risky, card, { confirmed: [{ id: card.options[0].id, license, evidence }] }));
    assert.equal(existsSync(join(libraryDir, 'registry.json')), false);
  });
  assert.equal(existsSync(join(libraryDir, 'registry.json')), false);
  const missing = discoverFonts({ ...input, languages: ['cn', 'en'], translations: { matched: [{ nodeId: '10:1', byLang: { en: '𐀀' } }] } }).missing;
  const gap = missing.find((row) => row.lang === 'en' && row.weight === 400);
  assert.deepEqual(gap.glyphs, ['𐀀']);
  assert.equal(gap.family, family);
  assert.equal(gap.locations[0].nodeId, '10:1');
});

test('Level 1 复用拒绝登记漂移、软链替换与许可失效', async (context) => {
  const { input, libraryDir, bytes } = fixture(context);
  const [card] = discoverFonts(input).questions;
  const approved = answer(input, card, { confirmed: [{ id: card.options[0].id, license, evidence }] });
  const registryPath = join(libraryDir, 'registry.json');
  const registry = JSON.parse(readFileSync(registryPath));
  const registered = join(libraryDir, registry.entries[0].file);
  const replay = () => discoverFonts({ ...input, fonts: approved.fonts, fontDiscovery: { libraryDir, directories: [] } });
  writeFileSync(registered, Buffer.concat([bytes, Buffer.from([0])]));
  assert.ok(replay().blockers.length);
  writeFileSync(registered, bytes);
  renameSync(registered, registered + '.backup');
  await symlinkProbe(context, 'Level 1 拒绝软链替换', registered + '.backup', registered, () => {
    assert.ok(replay().blockers.length);
    rmSync(registered);
  });
  renameSync(registered + '.backup', registered);
  writeFileSync(join(libraryDir, registry.entries[0].licenseFile), '非商用');
  assert.ok(replay().blockers.length);
});

test('扫描优先能覆盖多字重的 VF，同等静态 TTF 先于 OTF；匹配按实际字形', (context) => {
  const { input, directory, bytes } = fixture(context);
  const staticFont = Buffer.from(bytes);
  for (let index = 0; index < staticFont.readUInt16BE(4); index += 1) {
    const offset = 12 + index * 16;
    if (staticFont.toString('ascii', offset, offset + 4) === 'fvar') staticFont.write('fake', offset);
  }
  const tables = inspectFontStructure(staticFont).tables;
  staticFont.writeUInt16BE(400, tables['OS/2'].offset + 4);
  const { cmap } = tables;
  assert.ok(cmap);
  const staticOtf = fixtureBytes('one-page-static.otf');
  const { tables: otfTables } = inspectFontStructure(staticOtf);
  assert.ok(otfTables['CFF ']);
  assert.equal(otfTables.fvar, undefined);
  const badCmap = Buffer.from(staticFont);
  badCmap.writeUInt16BE(0, cmap.offset + 2);
  writeFileSync(join(directory, 'static.ttf'), staticFont);
  writeFileSync(join(directory, 'fixture-static.otf'), staticOtf);
  writeFileSync(join(directory, 'bad-cmap.ttf'), badCmap);
  const [card] = discoverFonts(input).questions;
  assert.deepEqual(card.options.map((option) => option.identity.container), ['ttf', 'ttf', 'otf']);
  assert.equal(card.options[0].identity.variable, true);
  assert.deepEqual(card.suggested.map((option) => option.id), [sha256File(bytes)]);
});

test('拒绝只记当时的用字范围；其它候选或条目拒绝不会改写许可', (context) => {
  const { input, path, bytes, libraryDir } = fixture(context);
  const [card] = discoverFonts(input).questions;
  const id = card.options[0].id;
  const rejected = answer(input, card, { rejected: [id] });
  const remaining = discoverFonts({ ...input, rejected: rejected.meta.fontRejections });
  assert.deepEqual(remaining.questions, []);
  assert.equal(remaining.missing.length, 2);
  const changed = { pc: { nodes: [makeNode('10:1', 400), makeNode('10:2', 700, '金币')] } };
  const [newCard] = discoverFonts({ ...input, inventories: changed, rejected: rejected.meta.fontRejections }).questions;
  assert.deepEqual(newCard.options[0].matches.map((need) => need.weight), [700]);
  assert.throws(() => answer(input, card, { confirmed: [{ id, license, evidence }, { id: 'not-in-card', license, evidence }] }));
  assert.equal(existsSync(join(libraryDir, 'registry.json')), false);
  writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
  assert.notEqual(discoverFonts(input).questions[0].options[0].id, id);
});

test('手供新原件只有明确确认后才落库；坏摘要不得被规范化洗白', (context) => {
  const { input, inventories, configDir, libraryDir, bytes } = fixture(context);
  const offline = { ...input, fontDiscovery: { libraryDir, directories: [] } };
  const discovery = discoverFonts(offline);
  const [card] = buildFontQuestions(inventories, { languages: ['cn'], discovery }).questions;
  const spec = { resourceId: 'hand-supplied', file: 'provided.ttf', weights: [400], format: 'ttf', source: '设计师原件', license, digest: sha256File(bytes) };
  writeFileSync(join(configDir, spec.file), bytes);
  assert.throws(() => answer(input, card, spec));
  const approved = { ...spec, licenseReview: { status: 'confirmed', evidence } };
  assert.throws(() => answer(input, card, { ...approved, digest: 'bad' }));
  assert.equal(existsSync(join(libraryDir, 'registry.json')), false);
  const first = answer(input, card, approved);
  assert.match(first.fonts.faces[family + '/400'].cn, /^library-/);
  const registry = JSON.parse(readFileSync(join(libraryDir, 'registry.json')));
  assert.equal(registry.entries[0].source, spec.source);
  assert.equal(registry.entries[0].sha256, spec.digest);
});

test('Level 1 拒绝重复身份、登记路径逃逸、坏表、轴登记不符', (context) => {
  const { input, libraryDir, bytes } = fixture(context);
  const [card] = discoverFonts(input).questions;
  answer(input, card, { confirmed: [{ id: card.options[0].id, license, evidence }] });
  const path = join(libraryDir, 'registry.json');
  const registry = JSON.parse(readFileSync(path));
  const [entry] = registry.entries;
  const replay = () => discoverFonts({ ...input, fontDiscovery: { libraryDir, directories: [] } });
  for (const entries of [[entry, entry], [{ ...entry, file: '../elsewhere.ttf' }], [
    { ...entry, identity: { ...entry.identity, axes: { wght: { min: 100, default: 400, max: 999 } } } },
  ]]) {
    writeFileSync(path, JSON.stringify({ ...registry, entries }));
    assert.equal(replay().fonts, undefined);
    assert.equal(replay().missing.length, 2);
  }
  const badBytes = Buffer.from(bytes);
  badBytes.writeUInt16BE(0, inspectFontStructure(bytes).tables.cmap.offset + 2);
  writeFileSync(path, JSON.stringify(registry));
  writeFileSync(join(libraryDir, entry.file), badBytes);
  assert.equal(replay().fonts, undefined);
});
