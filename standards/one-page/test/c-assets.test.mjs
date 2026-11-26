import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runCAssets } from '../src/c-assets.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { measureAssets } from '../src/assets-manifest.mjs';
import { svgFallbackReason } from '../src/svg-eligibility.mjs';

const nodeId = '1:2';
const fileKey = 'C1GOLDEN';
const version = '12345';
const tokenValue = 'c1-fake-token-never-persist';
const vector = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M0 0H8V8H0Z" fill="#ff0000"/></svg>');
const json = (path) => JSON.parse(readFileSync(path));
const response = (body) => new Response(JSON.stringify(body));
function frame(id, name, children = [], props = {}) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 8 }, children, ...props };
}

function png(alpha, width = 8, mode = 'RGBA') {
  return execFileSync('python3', ['-B', '-c', 'from PIL import Image; import sys; im=Image.new(sys.argv[3], (int(sys.argv[2]),8)); color=(99,130,211,255); im.paste(color if sys.argv[3]=="RGBA" else color[:3], (0,0,im.width,8)); im.putpixel((1,1),(189,65,29,int(sys.argv[1])) if sys.argv[3]=="RGBA" else (189,65,29)); im.save(sys.stdout.buffer,"PNG")', String(alpha), String(width), mode]);
}

async function golden(context, settings = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'onepage-c1-')));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const producer = join(root, 'producer');
  const document = { id: nodeId, name: 'C1 fixture', type: 'CANVAS', children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', [
    frame('10:3', 'img/矢量', [frame('10:4', 'shape', [], { type: 'VECTOR', fills: [{ type: 'SOLID' }] })]),
    frame('10:5', 'img/位图', [], { fills: [{ type: 'IMAGE', imageRef: 'image' }] }),
    frame('10:6', 'img/特效', [], { effects: [{ type: 'LAYER_BLUR', radius: 2 }] }),
    frame('10:7', '首页', [], { type: 'TEXT', characters: '首页', style: { fontFamily: 'One Page Fixture', fontWeight: 400 } }),
  ])])] };
  settings.mutateDocument?.(document);
  const snapshot = { version, nodes: { [nodeId]: { document } } };
  const scope = { url: 'https://www.figma.com/design/' + fileKey + '/name?node-id=1-2', languages: 'cn,en', baseLanguage: 'cn',
    platform: 'pc', runRoot: producer, tokenValue, fetchImpl: async () => response(snapshot) };
  const draft = await runAScope(scope);
  assert.equal(draft.ok, true, JSON.stringify(draft));
  const { runDir } = draft;
  const confirmed = await runAScope({ ...scope, runDir, shownFp: draft.fingerprintPrefix, confirmQuote: '确认', confirmSource: 'test' });
  assert.equal(confirmed.ok, true, JSON.stringify(confirmed));
  const extract = await runBExtract({ ...scope, runDir });
  assert.equal(extract.ok, true, JSON.stringify(extract));
  const config = projectConfigPath(producer, fileKey, nodeId);
  const bytes = readFileSync(new URL('./fixtures/fonts/one-page-static.otf', import.meta.url));
  const foreign = readFileSync(new URL('./fixtures/fonts/one-page-variable.otf', import.meta.url));
  const resource = (file, content) => ({ file, format: 'otf', weights: [400], source: 'fixture', license: file + ' license', digest: 'sha256:' + byteDigest(content) });
  writeProjectConfigAtomic(config, { fonts: { faces: { 'One Page Fixture/400': { cn: 'base', en: 'foreign' } },
    resources: { base: resource('base.otf', bytes), foreign: resource('foreign.otf', foreign) } } });
  writeFileSync(join(config, '..', 'base.otf'), bytes);
  writeFileSync(join(config, '..', 'foreign.otf'), foreign);
  const l10nSnapshot = join(root, 'translations.json');
  writeFileSync(l10nSnapshot, JSON.stringify({ values: [['简中', '英语'], ['首页', 'A']] }));
  const b2 = await runBSupplement({ ...scope, runDir, l10nSnapshot, fontDiscovery: { directories: [] } });
  assert.equal(b2.ok && b2.result === 'pass', true, JSON.stringify(b2));
  const b3 = runBHandoff({ runDir, b2Version: json(b2.supplementPath).version });
  assert.equal(b3.ok, true, JSON.stringify(b3));
  const isolated = join(root, 'b3');
  cpSync(b3.pack, isolated, { recursive: true });
  rmSync(producer, { recursive: true });
  const calls = [];
  const downloads = { '10:3': vector, '10:5': png(255), '10:6': png(0), ...settings.downloads };
  const fetchImpl = async (address, init) => {
    const url = new URL(address);
    if (url.hostname === 'cdn.c1.test') {
      assert.equal(init.headers, undefined);
      const [id, format] = url.pathname.slice(1).split('/');
      return new Response(downloads[id + '/' + format] ?? downloads[id]);
    }
    assert.equal(init.headers['X-Figma-Token'], tokenValue);
    assert.equal(init.redirect, 'error');
    assert.equal(url.searchParams.get('version'), version);
    if (url.pathname.endsWith('/nodes')) return response(settings.snapshot?.(snapshot) ?? snapshot);
    assert.equal(url.pathname, '/v1/images/' + fileKey);
    const id = url.searchParams.get('ids');
    const format = url.searchParams.get('format');
    calls.push([id, format]);
    return response({ images: { [id]: 'https://cdn.c1.test/' + id + '/' + format + '?signed=do-not-persist' } });
  };
  return { root, calls, bytes, foreign, downloads, options: { pack: isolated, runDir: join(root, 'runs', 'c1'), expectVersion: b3.version,
    scopeVersion: b3.scopeVersion, consumerContract: HANDOFF_CONSUMER, tokenValue, fetchImpl } };
}

function verify(result, record = result.stagePath, overrides) {
  return checkEntry(record, { expectedStage: 'C', expectedOutputKind: 'c-assets', expectedOutputVersion: result.version, scopeVersion: result.scopeVersion, ...overrides });
}

test('真实 A/B1/B2/B3 → C1：断源输入、版本锁定 SVG/PNG、逐像素 Alpha、仅本语字体、可迁移、两轮确定性', async (context) => {
  const { options, root, calls, bytes, foreign, downloads } = await golden(context);
  assert.ok(readdirSync(join(options.pack, 'resources/fonts')).includes(byteDigest(foreign) + '.otf'));
  const first = await runCAssets(options);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await runCAssets(options);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(first.version, second.version);
  assert.equal(first.manifestSha256, second.manifestSha256);
  assert.notEqual(first.pack, second.pack);
  const expectedCalls = [['10:3', 'svg'], ['10:5', 'png'], ['10:6', 'png']];
  assert.deepEqual(calls, [...expectedCalls, ...expectedCalls]);
  const migrated = join(root, 'migrated');
  cpSync(first.pack, migrated, { recursive: true });
  rmSync(options.pack, { recursive: true });
  rmSync(options.runDir, { recursive: true });
  const checked = verify(first, join(migrated, 'stage-record.json'));
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const { assets, fonts } = checked.manifest;
  assert.deepEqual(assets.map(({ nodeId, format, lossless, hasAlpha, fallbackReason }) => [nodeId, format, lossless, hasAlpha, fallbackReason]), [
    ['10:3', 'svg', true, null, null], ['10:5', 'webp', false, false, 'bitmap-fill'], ['10:6', 'webp', true, true, 'effect-or-filter'],
  ]);
  assert.ok(assets.every(({ module, layer, width, height, visualFingerprint }) => module === '10:2' && layer.startsWith('img/') && width === 8 && height === 8 && visualFingerprint.length === 64));
  assert.deepEqual(readFileSync(join(migrated, assets[0].path)), vector);
  assert.deepEqual(readFileSync(join(migrated, assets[2].original.path)), downloads['10:6']);
  assert.equal(assets[1].quality, 90);
  assert.equal(assets[1].method, 6);
  assert.ok(assets[1].meanAbsoluteError.every((error) => error > 0 && error < 12));
  execFileSync('python3', ['-B', '-c', 'from PIL import Image; import sys; original=Image.open(sys.argv[1]); delivery=Image.open(sys.argv[2]); assert delivery.format=="WEBP" and original.size==delivery.size; assert original.convert("RGBA").tobytes()==delivery.convert("RGBA").tobytes()',
    join(migrated, assets[2].original.path), join(migrated, assets[2].path)]);
  assert.deepEqual(fonts.map(({ language, sha256 }) => [language, sha256]), [['cn', byteDigest(bytes)]]);
  assert.deepEqual(readFileSync(join(migrated, fonts[0].path)), bytes);
  assert.equal(readFileSync(join(migrated, fonts[0].license.path), 'utf8'), 'base.otf license');
  const manifest = readFileSync(join(migrated, 'assets/manifest.json'), 'utf8');
  assert.ok(!manifest.includes(tokenValue) && !manifest.includes('do-not-persist') && !manifest.includes(root));
  assert.equal(verify(first, join(migrated, 'stage-record.json'), { scopeVersion: '0'.repeat(64) }).ok, false);
  writeFileSync(join(migrated, assets[0].path), 'changed');
  assert.match(verify(first, join(migrated, 'stage-record.json')).reason, /SHA-256/);
});

test('缺失外传值、旧版本、错范围、错消费能力与 B3 字节篡改均在导出前阻断', async (context) => {
  const { options, calls } = await golden(context);
  for (const override of [{ expectVersion: undefined }, { expectVersion: '1'.repeat(64) }, { scopeVersion: '2'.repeat(64) },
    { consumerContract: undefined }, { consumerContract: { ...HANDOFF_CONSUMER, capabilities: [] } }]) {
    assert.equal((await runCAssets({ ...options, ...override })).code, 'b3-rejected');
  }
  writeFileSync(join(options.pack, 'production/assets.json'), '[]');
  assert.equal((await runCAssets(options)).code, 'b3-rejected');
  assert.deepEqual(calls, []);
  assert.throws(() => readdirSync(options.runDir), { code: 'ENOENT' });
});

test('SVG 内容超出允许集合时保留原 PNG；半透明 PNG 无损，RGB PNG 有损，不改变尺寸', async (context) => {
  const partial = png(128);
  const { options, calls } = await golden(context, { downloads: {
    '10:3/svg': Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="8" height="8"><filter id="blur"/></svg>'),
    '10:3/png': partial, '10:5': png(255, 8, 'RGB'),
  } });
  const result = await runCAssets(options);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(calls.slice(0, 2), [['10:3', 'svg'], ['10:3', 'png']]);
  const [asset, bitmap] = verify(result).manifest.assets;
  assert.equal(asset.fallbackReason, 'svg-outside-supported-subset');
  assert.equal(asset.lossless, true);
  assert.deepEqual(asset.meanAbsoluteError, [0, 0, 0, 0]);
  assert.deepEqual(readFileSync(join(result.pack, asset.original.path)), partial);
  assert.equal(bitmap.hasAlpha, false);
  assert.equal(bitmap.lossless, false);
});

test('SVG 白盒只接受兼容的可见矢量，不将位图、滤镜、混合、蒙版误标成 SVG', () => {
  const shape = { type: 'RECTANGLE', fills: [{ type: 'GRADIENT_RADIAL' }] };
  assert.equal(svgFallbackReason({ type: 'FRAME', children: [shape, { type: 'TEXT', visible: false }] }), null);
  assert.equal(svgFallbackReason({ ...shape, strokes: [{ type: 'IMAGE' }] }), 'bitmap-fill');
  assert.equal(svgFallbackReason({ ...shape, effects: [{ type: 'BACKGROUND_BLUR' }] }), 'effect-or-filter');
  assert.equal(svgFallbackReason({ ...shape, blendMode: 'MULTIPLY' }), 'blend-mode');
  assert.equal(svgFallbackReason({ ...shape, isMask: true }), 'unsupported-paint-or-mask');
  assert.equal(svgFallbackReason({ type: 'TEXT' }), 'non-vector-node');
});

test('快照版本不符或同版本的视觉事实不符时停止，不拿当前稿冒充旧版本', async (context) => {
  const old = await golden(context, { snapshot: (data) => ({ ...data, version: 'new' }) });
  assert.match((await runCAssets(old.options)).message, /快照版本/);
  assert.deepEqual(old.calls, []);
  const changed = await golden(context, { snapshot: (data) => {
    const copy = structuredClone(data);
    copy.nodes[nodeId].document.children[0].children[0].children[0].opacity = 0.5;
    return copy;
  } });
  assert.match((await runCAssets(changed.options)).message, /视觉指纹/);
  assert.deepEqual(changed.calls, []);
  assert.deepEqual(readdirSync(changed.options.runDir), []);
});

test('错尺寸、格式异常、编码器不可用均不留本轮正式或暂存目录；可随后继续', async (context) => {
  const { options, root, downloads } = await golden(context, { downloads: { '10:5': png(255, 7) } });
  assert.match((await runCAssets(options)).message, /尺寸不符/);
  assert.deepEqual(readdirSync(options.runDir), []);
  downloads['10:5'] = Buffer.from('not PNG');
  assert.equal((await runCAssets(options)).code, 'image-invalid');
  assert.deepEqual(readdirSync(options.runDir), []);
  assert.equal((await runCAssets({ ...options, python: join(root, 'missing-python') })).code, 'encoder-unavailable');
  assert.deepEqual(readdirSync(options.runDir), []);
  downloads['10:5'] = png(255);
  const result = await runCAssets(options);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(readdirSync(options.runDir), ['c1.r1']);
});

test('H23 原件、备用、历史逐字节保留；超限只告警，不删除、不覆盖旧轮', async (context) => {
  const { options, root } = await golden(context);
  const retainedDir = join(root, 'retained');
  const files = { 'original/cover.png': png(255), 'backup/art.png': png(120), 'history/video.mp4': Buffer.from('计量占位，不作为已解码视频') };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(join(retainedDir, path, '..'), { recursive: true });
    writeFileSync(join(retainedDir, path), bytes);
  }
  truncateSync(join(retainedDir, 'history/video.mp4'), 15_000_001);
  const one = await runCAssets({ ...options, retainedDir });
  assert.equal(one.ok, true, JSON.stringify(one));
  const { retained } = verify(one).manifest;
  assert.deepEqual(retained.map((file) => file.kind), ['backup', 'history', 'original']);
  for (const entry of retained) assert.deepEqual(readFileSync(join(one.pack, entry.path)), readFileSync(join(retainedDir, entry.source)));
  assert.deepEqual(one.warnings.map(({ code }) => code), ['VIDEO_SIZE']);
  assert.deepEqual(measureAssets([{ path: 'x.mp4', bytes: 15_000_000 }, { path: 'y.png', bytes: 105_000_000 }]).warnings, []);
  assert.deepEqual(measureAssets([{ path: 'x.mp4', bytes: 15_000_001 }, { path: 'y.png', bytes: 105_000_000 }]).warnings.map(({ code }) => code), ['VIDEO_SIZE', 'DIRECTORY_SIZE']);
  writeFileSync(join(retainedDir, 'backup/art.png'), png(200));
  const two = await runCAssets({ ...options, retainedDir });
  assert.equal(two.ok, true, JSON.stringify(two));
  assert.notEqual(two.version, one.version);
  assert.equal(verify(one).ok, true);
  assert.equal(verify(two).ok, true);
  assert.deepEqual(readdirSync(options.runDir), ['c1.r1', 'c1.r2']);
});

test('H23 原样记录中文和空格路径；易同名素材分别保留、确定性重跑且迁移可验', async (context) => {
  const { options, root } = await golden(context);
  const retainedDir = join(root, 'retained');
  const entries = new Map([
    ['original/活动 海报.png', png(128)],
    ['original/活动_海报.png', png(130)],
    ['original/活动/海报.png', png(132)],
    ['original/活动%20海报.png', png(134)],
    ['original/figma/活动 海报.png', png(136)],
    ['backup/ 备用图 .PNG', png(138)],
    ['history/旧 轮次/海报.png', png(140)],
  ]);
  for (const [source, bytes] of entries) {
    mkdirSync(join(retainedDir, source, '..'), { recursive: true });
    writeFileSync(join(retainedDir, source), bytes);
  }
  const first = await runCAssets({ ...options, retainedDir });
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = await runCAssets({ ...options, retainedDir });
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.manifestSha256, first.manifestSha256);
  const migrated = join(root, 'portable');
  cpSync(first.pack, migrated, { recursive: true });
  rmSync(options.pack, { recursive: true });
  rmSync(options.runDir, { recursive: true });
  rmSync(retainedDir, { recursive: true });
  const record = join(migrated, 'stage-record.json');
  const checked = verify(first, record);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  const { retained, assets } = checked.manifest;
  assert.deepEqual(retained.map(({ source }) => source), [...entries.keys()].sort());
  assert.equal(new Set(retained.map(({ path }) => path)).size, entries.size);
  for (const { kind, source, path, sha256 } of retained) {
    assert.match(path, new RegExp('^assets/retained/' + kind + '/[a-z0-9-]+\\.png$'));
    assert.deepEqual(readFileSync(join(migrated, path)), entries.get(source));
    assert.equal(sha256, byteDigest(entries.get(source)));
    assert.ok(assets.every((asset) => asset.original?.path !== path));
  }
  writeFileSync(join(migrated, retained[0].path), 'changed');
  assert.match(verify(first, record).reason, /SHA-256/);
  const retainedPath = join(migrated, retained[0].path);
  rmSync(retainedPath);
  const plainCopy = join(root, 'plain-copy.png');
  writeFileSync(plainCopy, entries.get(retained[0].source));
  symlinkSync(plainCopy, retainedPath);
  assert.match(verify(first, record).reason, /普通文件/);
});

test('H23 拒绝未知分类、不安全路径分隔符和符号链接，失败不发布', async (context) => {
  const { options, root } = await golden(context, { mutateDocument(document) { document.children[0].children[0].children.splice(0, 3); } });
  const retainedDir = join(root, 'retained');
  const original = join(retainedDir, 'original');
  mkdirSync(original, { recursive: true });
  const outside = join(root, 'outside.png');
  writeFileSync(outside, png(255));
  const paths = [join(retainedDir, '未知分类.png'), join(original, '目录\\海报.png'), join(original, '外部 海报.png')];
  for (const [index, pattern] of [/归入/, /路径/, /普通文件/].entries()) {
    if (index === 2) symlinkSync(outside, paths[index]);
    else writeFileSync(paths[index], 'test');
    const result = await runCAssets({ ...options, retainedDir });
    assert.equal(result.ok, false);
    assert.match(result.message, pattern);
    assert.deepEqual(readdirSync(options.runDir), []);
    rmSync(paths[index]);
  }
});

test('H23 按实际目录拒绝父目录别名重叠，仍可复制独立外部目录', async (context) => {
  const { options, root } = await golden(context, { mutateDocument(document) { document.children[0].children[0].children.splice(0, 3); } });
  const runParent = join(root, 'runs');
  const runAlias = join(root, 'runs-alias');
  const nested = join(options.runDir, 'retained');
  const external = options.runDir + '-retained';
  const bytes = png(128);
  for (const source of [nested, external]) {
    mkdirSync(join(source, 'original'), { recursive: true });
    writeFileSync(join(source, 'original/活动 海报.png'), bytes);
  }
  symlinkSync(runParent, runAlias, 'dir');
  const aliasedRun = join(runAlias, 'c1');
  for (const [runDir, retainedDir] of [
    [options.runDir, join(aliasedRun, 'retained')],
    [aliasedRun, runParent],
    [options.runDir, aliasedRun],
  ]) {
    const result = await runCAssets({ ...options, runDir, retainedDir });
    assert.equal(result.ok, false);
    assert.match(result.message, /输入必须与发布目录分离/);
    assert.deepEqual(readdirSync(options.runDir), ['retained']);
  }
  const rootLink = join(root, 'retained-link');
  symlinkSync(external, rootLink, 'dir');
  assert.match((await runCAssets({ ...options, retainedDir: rootLink })).message, /普通目录/);
  assert.deepEqual(readdirSync(options.runDir), ['retained']);
  const result = await runCAssets({ ...options, runDir: aliasedRun, retainedDir: join(runAlias, 'c1-retained') });
  assert.equal(result.ok, true, JSON.stringify(result));
  const checked = verify(result);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.manifest.retained.length, 1);
  const [retained] = checked.manifest.retained;
  assert.equal(retained.source, 'original/活动 海报.png');
  assert.deepEqual(readFileSync(join(result.pack, retained.path)), bytes);
});

test('并行调用不释放另一执行者的锁；未完成事务不能被消费', async (context) => {
  const { options } = await golden(context);
  let resume;
  const pause = new Promise((resolve) => { resume = resolve; });
  const started = runCAssets({ ...options, fetchImpl: async (...args) => { await pause; return options.fetchImpl(...args); } });
  try {
    assert.equal((await runCAssets(options)).code, 'busy');
    assert.equal((await runCAssets(options)).code, 'busy');
    const names = readdirSync(options.runDir);
    assert.equal(names.some((name) => name.startsWith('c1.r')), false);
    assert.equal(verify({ version: '0'.repeat(64), scopeVersion: options.scopeVersion }, join(options.runDir, names.find((name) => name.startsWith('.c1-writing-')), 'stage-record.json')).ok, false);
  } finally { resume(); }
  assert.equal((await started).ok, true);
  assert.deepEqual(readdirSync(options.runDir), ['c1.r1']);
});

test('CLI 从外部文件收契约；无素材的 B3 可离线出 C1，不访问 Figma 或宿主字体目录', async (context) => {
  const { options, root } = await golden(context, { mutateDocument(document) { document.children[0].children[0].children.splice(0, 3); } });
  const contract = join(root, 'consumer.json');
  writeFileSync(contract, JSON.stringify(HANDOFF_CONSUMER));
  const cli = fileURLToPath(new URL('../bin/c-assets.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, '--pack', options.pack, '--run-dir', options.runDir,
    '--expect-version', options.expectVersion, '--scope-version', options.scopeVersion, '--consumer-contract', contract]);
  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  const { assets, fonts } = verify(result).manifest;
  assert.deepEqual(assets, []);
  assert.equal(fonts.length, 1);
});

test('构建期间上游变化会撤销发布，不把内存中的旧 B3 当当前包', async (context) => {
  const { options } = await golden(context);
  const result = await runCAssets({ ...options, fetchImpl: async (...args) => {
    const download = await options.fetchImpl(...args);
    if (new URL(args[0]).hostname === 'cdn.c1.test') writeFileSync(join(options.pack, 'README.md'), 'changed');
    return download;
  } });
  assert.match(result.message, /上游|B3 输入发生变化/);
  assert.deepEqual(readdirSync(options.runDir), []);
});

test('独立网页文字不能被误烘焙进整图；只读导出不满足时明确阻断', async (context) => {
  const { options, calls } = await golden(context, { mutateDocument(document) {
    const children = document.children[0].children[0].children;
    children[0].children.push(children.pop());
  } });
  const result = await runCAssets(options);
  assert.match(result.message, /独立网页文字/);
  assert.deepEqual(calls, []);
  assert.deepEqual(readdirSync(options.runDir), []);
});
