import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement as runBSupplementRaw } from '../src/b-supplement.mjs';
import { runBAnswer as runBAnswerRaw } from '../src/b-answer.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { byteDigest, checkHandoff, endFile, HANDOFF_CONSUMER, PACK_FILES, STAGE_FILE } from '../src/handoff-check.mjs';
import { checkEntry, buildStageRecord } from '../src/stage-record.mjs';
import { sha256Hex } from '../src/canonical.mjs';
import { indexVisualFingerprints } from '../src/visual-fingerprint.mjs';
import { validateOnePageData } from '../../figma-naming/tool/src/onepage/compile.mjs';

const ISOLATED_FONT_DISCOVERY = Object.freeze({ directories: [] });
const runBSupplement = (options = {}) => runBSupplementRaw({ fontDiscovery: ISOLATED_FONT_DISCOVERY, ...options });
const runBAnswer = (options = {}) => runBAnswerRaw({ fontDiscovery: ISOLATED_FONT_DISCOVERY, ...options });

const fileKey = 'TESTFILEKEY';
const tokenValue = 'b3-fixture-token';
const nodeId = '1:2';
const ttfFont = { family: 'Noto Sans SC', format: 'ttf', characters: '首页', license: 'SIL OFL 1.1',
  url: new URL('../../../skills/torchlight-web/fonts/NotoSansSC-VF.ttf', import.meta.url) };
const staticOtf = { family: 'One Page Fixture', format: 'otf', characters: '首页金币A', license: 'Public domain geometric fixtures for testing.',
  url: new URL('./fixtures/fonts/one-page-static.otf', import.meta.url) };
const json = (path) => JSON.parse(readFileSync(path));
const write = (path, value) => writeFileSync(path, JSON.stringify(value) + '\n');
const bin = (name) => fileURLToPath(new URL('../bin/' + name + '.mjs', import.meta.url));
const cli = (name, args) => JSON.parse(execFileSync(process.execPath, [bin(name), ...args], { encoding: 'utf8', env: { ...process.env, ONEPAGE_FONT_DIRS: '' } }));

function frame(id, name, children = [], props = {}) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 }, children, ...props };
}

function design(end, index, dynamic, localized, { family, characters }) {
  const list = frame(index + ':8', 'list/奖励列表@data=list:rewards', [frame(index + ':9', 'item/条目@template', [
    frame(index + ':10', '标题@field=title.cn', [], { type: 'TEXT', characters: '金币', style: { fontFamily: 'Noto Sans SC', fontWeight: 400 } }),
  ])], { layoutMode: 'VERTICAL' });
  return frame(index + ':1', 'cn_' + end, [frame(index + ':2', 'sec/1-首页', [
    frame(index + ':3', 'img/背景', [], { fills: [{ type: 'IMAGE', imageRef: 'golden-image' }] }),
    frame(index + ':4', '文案', [], { type: 'TEXT', characters, style: { fontFamily: family, fontWeight: 400 } }),
    frame(index + ':5', 'btn/活动@link=event'),
    ...(localized ? [frame(index + ':6', '英文栏目', [], { type: 'TEXT', characters: 'NEWS', style: { fontFamily: 'Bebas Neue', fontWeight: 400 } })] : []),
    ...(dynamic ? [frame(index + ':7', 'switch/轮播', [list]), frame(index + ':11', 'grp/状态@show=enabled', [], { visible: false })] : []),
  ])]);
}

async function golden(root, { platform = 'pc', languages = 'cn', dynamic = false, translations = null, discoveryFont = null } = {}) {
  const localized = languages !== 'cn';
  const fontFixture = discoveryFont || ttfFont;
  const document = { id: nodeId, name: '规范页', type: 'CANVAS', children: [design('pc', 10, dynamic, localized, fontFixture), ...(platform === 'pc+mobile' ? [design('mobile', 20, dynamic, localized, fontFixture)] : [])] };
  const body = { version: '1234', nodes: { [nodeId]: { document } } };
  const fetchImpl = async () => ({ ok: true, json: async () => body });
  const options = { url: 'https://www.figma.com/design/TESTFILEKEY/name?node-id=1-2', languages, baseLanguage: 'cn', platform, runRoot: root, tokenValue, fetchImpl };
  const draft = await runAScope(options);
  assert.equal(draft.ok, true, draft.message);
  const { runDir } = draft;
  const scope = await runAScope({ ...options, runDir, shownFp: draft.fingerprintPrefix, confirmQuote: '确认，按这个范围做', confirmSource: 'cindy-card' });
  assert.equal(scope.ok, true, scope.message);
  const b1 = await runBExtract({ runRoot: root, runDir, tokenValue, fetchImpl });
  assert.equal(b1.ok, true, JSON.stringify(b1.problems));
  const font = readFileSync(fontFixture.url);
  const configPath = projectConfigPath(root, fileKey, nodeId);
  const fontPath = join(configPath, '..', 'gold.ttf');
  const digest = byteDigest(font);
  if (discoveryFont) {
    const { family, format, license, characters } = discoveryFont;
    const evidence = '测试确认原件可商用并可随网页再分发';
    const library = join(root, 'fonts-library');
    const directory = join(root, 'scan', 'EagleApp');
    mkdirSync(directory, { recursive: true });
    const origin = join(directory, 'not-the-family-name.' + format);
    writeFileSync(origin, font);
    const previous = process.env.ONEPAGE_FONT_DIRS;
    process.env.ONEPAGE_FONT_DIRS = join(root, 'scan');
    try {
      const before = await runBSupplement({ runRoot: root, runDir, tokenValue, fontDiscovery: { directories: [join(root, 'scan')] } });
      assert.equal(before.result, 'needs-input');
      const [card] = json(before.questionsPath).filter((item) => item.type === 'font-candidates');
      assert.ok(card);
      assert.deepEqual(card.options.map(({ id }) => id), [digest]);
      const { identity } = card.options[0];
      assert.equal(identity.family, family);
      assert.equal(identity.container, format);
      if (format === 'otf') {
        assert.equal(identity.variable, false);
        assert.equal(identity.weight, 400);
      }
      for (const name of ['registry.json', 'files', 'licenses']) assert.equal(existsSync(join(library, name)), false);
      const answersValue = [{ id: card.id, fingerprint: card.fingerprint, value: {
        confirmed: [{ id: digest, license, evidence }],
      } }];
      const answered = await runBAnswer({ runRoot: root, runDir, tokenValue, answersValue, fontDiscovery: { directories: [join(root, 'scan')] } });
      assert.equal(answered.ok, true, JSON.stringify(answered));
      const { version, entries } = json(join(library, 'registry.json'));
      assert.equal(version, 1);
      assert.equal(entries.length, 1);
      const [entry] = entries;
      assert.equal(entry.sha256, digest);
      assert.deepEqual(entry.identity, identity);
      assert.equal(entry.licenseStatus, 'commercial-confirmed');
      assert.equal(entry.license, license);
      assert.equal(entry.evidence, evidence);
      const original = join(library, entry.file);
      const permission = join(library, entry.licenseFile);
      assert.deepEqual(readdirSync(join(library, 'files')).map((name) => 'files/' + name), [entry.file]);
      assert.deepEqual(readdirSync(join(library, 'licenses')).map((name) => 'licenses/' + name), [entry.licenseFile]);
      assert.equal(existsSync(join(library, '.registry-lock')), false);
      assert.ok(lstatSync(original).isFile());
      assert.notEqual(lstatSync(original).ino, lstatSync(origin).ino);
      assert.deepEqual(readFileSync(original), font);
      assert.equal(readFileSync(permission, 'utf8'), license);
      renameSync(join(root, 'scan'), join(root, 'disconnected-scan'));
      assert.equal(existsSync(origin), false);
      process.env.ONEPAGE_FONT_DIRS = '';
      const localCopies = join(configPath, '..', '.font-library');
      renameSync(localCopies, join(root, 'disconnected-project-fonts'));
      writeProjectConfigAtomic(configPath, {});
      if (format === 'otf') {
        for (const [path, originalBytes, changedBytes] of [
          [original, font, Buffer.concat([font, Buffer.from([0])])],
          [permission, Buffer.from(license), Buffer.from('仅限内部使用')],
        ]) {
          writeFileSync(path, changedBytes);
          try {
            const refused = await runBSupplement({ runRoot: root, runDir, tokenValue, fontDiscovery: { directories: [] } });
            assert.equal(refused.result, 'needs-input');
            assert.ok(json(refused.problemsPath).some(({ code }) => code === 'FONT_UNSET'));
            assert.ok(json(refused.questionsPath).every(({ type }) => type !== 'font-candidates'));
            assert.equal(existsSync(localCopies), false);
          } finally {
            writeFileSync(path, originalBytes);
          }
        }
      }
      const b2 = await runBSupplement({ runRoot: root, runDir, tokenValue, fontDiscovery: { directories: [] } });
      assert.equal(b2.ok, true, JSON.stringify(b2));
      assert.equal(b2.result, 'pass');
      assert.deepEqual(json(b2.questionsPath), []);
      const supplement = json(b2.supplementPath);
      const { faces, problems } = json(supplement.artifacts.fontAudit.path);
      assert.deepEqual(problems, []);
      assert.equal(faces.length, 1);
      assert.equal(faces[0].key, family + '/400');
      assert.ok(faces[0].locations.some((location) => location.characters === characters));
      assert.deepEqual(faces[0].langs.cn, { family, weight: identity.weight, axes: identity.axes, digest,
        resource: 'library-' + digest, licenseReview: { status: 'confirmed', hasEvidence: true } });
      const [fontInput] = json(b2.stagePath).inputs.filter(({ kind }) => kind === 'font-file');
      assert.equal(fontInput.digest, digest);
      assert.deepEqual(readFileSync(fontInput.path), font);
      assert.equal(lstatSync(fontInput.path).isFile(), true);
      return { runDir, configPath, font, digest, evidence, b2Version: supplement.version };
    } finally {
      if (previous === undefined) delete process.env.ONEPAGE_FONT_DIRS;
      else process.env.ONEPAGE_FONT_DIRS = previous;
    }
  }
  const foreign = readFileSync(new URL('../../../skills/yise-web-ui/fonts/BebasNeue-Regular.woff2', import.meta.url));
  const foreignDigest = byteDigest(foreign);
  const faceMap = (resource) => Object.fromEntries(languages.split(',').map((lang) => [lang, resource]));
  writeProjectConfigAtomic(configPath, {
    ...(dynamic ? { bindings: { 'sec/1::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage: 2 } } } } : {}),
    fonts: {
      faces: { 'Noto Sans SC/400': faceMap('gold'), ...(localized ? { 'Bebas Neue/400': faceMap('foreign') } : {}) },
      resources: {
        gold: { file: 'gold.ttf', format: 'ttf', weights: [400], source: 'Noto Sans SC', license: 'SIL OFL 1.1', digest: 'sha256:' + digest },
        ...(localized ? { foreign: { file: 'foreign.woff2', format: 'woff2', weights: [400], source: 'Bebas Neue', license: 'SIL OFL 1.1', digest: 'sha256:' + foreignDigest } } : {}),
      },
    },
  });
  writeFileSync(fontPath, font);
  if (localized) writeFileSync(join(fontPath, '..', 'foreign.woff2'), foreign);
  const l10nSnapshot = translations ? join(root, 'sheet.json') : undefined;
  if (l10nSnapshot) write(l10nSnapshot, { values: translations, source: { spreadsheetToken: 'golden-sheet', range: 'golden!A1:C2' } });
  const b2 = await runBSupplement({ runRoot: root, runDir, tokenValue, l10nSnapshot });
  assert.equal(b2.ok, true, JSON.stringify({ message: b2.message, questions: b2.questions, problems: b2.problems }));
  return { runDir, configPath, fontPath, digest, foreignDigest, b2Version: json(b2.supplementPath).version, scope, b1, b2 };
}

function temp(context) {
  const root = mkdtempSync(join(tmpdir(), 'onepage-b3-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

const buildArgs = ({ runDir, b2Version }) => ['--run-dir', runDir, '--b2-version', b2Version];
const verify = (result, overrides) => checkHandoff({ pack: result.pack, expectVersion: result.version, scopeVersion: result.scopeVersion, consumerContract: HANDOFF_CONSUMER, ...overrides });

test('真实 A/B1/B2 产物经 B3 CLI 出包，断开源目录和字体后经独立 CLI 验包', async (context) => {
  const root = temp(context);
  const producer = join(root, 'producer');
  const { runDir, b2Version, digest } = await golden(producer);
  const result = cli('b-handoff', ['--run-dir', runDir, '--b2-version', b2Version]);
  const isolated = join(root, 'isolated');
  cpSync(result.pack, isolated, { recursive: true });
  renameSync(producer, join(root, 'disconnected'));
  const contract = join(root, 'consumer.json');
  writeFileSync(contract, JSON.stringify(HANDOFF_CONSUMER));
  const checked = cli('handoff-check', ['--pack', isolated, '--expect-version', result.version, '--scope-version', result.scopeVersion, '--consumer-contract', contract]);
  assert.equal(checked.ok, true);
  assert.equal(checked.manifestSha256, result.manifestSha256);
  assert.equal(byteDigest(readFileSync(join(isolated, 'resources/fonts', digest + '.ttf'))), digest);
  assert.ok(json(join(isolated, PACK_FILES.todos)).some((todo) => todo.kind === 'link-url-pending' && todo.locations[0].nodeId === '10:5'));
  assert.equal(json(join(isolated, PACK_FILES.dataCheck)).status, 'n_a');
  assert.equal(checkEntry(join(isolated, STAGE_FILE), { expectedStage: 'B', expectedOutputKind: 'b-handoff',
    expectedOutputVersion: result.version, scopeVersion: result.scopeVersion, consumerContract: contract }).ok, true);
});

test('双端黄金：完整/部分/全缺译、字体、成对外链、分页和实际适用 QA 载荷', async (context) => {
  const root = temp(context);
  for (const scenario of [
    { languages: 'cn,en', translations: [['简中', '英语'], ['首页', 'HOME'], ['NEWS', 'NEWS'], ['金币', 'COINS']], missing: [] },
    { languages: 'cn,en,jp', translations: [['简中', '英语', '日语'], ['首页', 'HOME', ''], ['NEWS', 'NEWS', ''], ['金币', 'COINS', '']], missing: ['jp'] },
    { languages: 'cn,en', translations: null, missing: ['en'] },
  ]) {
    const input = await golden(join(root, 'scenario-' + scenario.missing.length + '-' + scenario.languages.length), { platform: 'pc+mobile', dynamic: true, ...scenario });
    const result = cli('b-handoff', buildArgs(input));
    assert.equal(verify(result).ok, true);
    const inventory = (end) => json(join(result.pack, endFile(end))).inventory;
    const todos = json(join(result.pack, PACK_FILES.todos));
    const translates = json(join(result.pack, PACK_FILES.translations));
    assert.equal(translates.matched.filter((row) => row.byLang.en === 'HOME').length, scenario.translations ? 2 : 0);
    if (!scenario.missing.length) assert.deepEqual(translates.pending, []);
    assert.deepEqual(todos.filter((row) => row.kind === 'pending-translation' && ['10:4', '20:4'].includes(row.nodeId)).map((row) => row.missingLanguages),
      scenario.missing.length ? [scenario.missing, scenario.missing] : []);
    assert.equal(todos.find((row) => row.kind === 'link-url-pending').locations.length, 2);
    assert.ok(json(join(result.pack, PACK_FILES.pairing)).paired.some((row) => row.pcId === '10:2' && row.mobileId === '20:2'));
    assert.equal(byteDigest(readFileSync(join(result.pack, 'resources/fonts', input.foreignDigest + '.woff2'))), input.foreignDigest);
    assert.equal(json(join(result.pack, PACK_FILES.fonts)).resources.foreign.license, 'SIL OFL 1.1');
    assert.equal(inventory('pc').nodes.find((node) => node.id === '10:11').status, 'skipped');
    const sampleIndex = json(join(result.pack, PACK_FILES.samples));
    const samples = Object.fromEntries(sampleIndex.samples.map((sample) => [sample.id, sample]));
    assert.ok(samples['success-full'].data.rewards[0].title.cn);
    assert.deepEqual(samples['empty-list'].data.rewards, []);
    assert.equal(samples['list-one'].data.rewards.length, 1);
    assert.ok(samples['list-many'].data.rewards.length > 2);
    assert.equal(samples['last-page-short'].data.rewards.length % 2, 1);
    assert.equal(samples['missing-current-language'].data.rewards[0]?.title?.cn, undefined);
    assert.deepEqual(samples['request-missing'].data, {});
    assert.equal(samples['partial-missing'].data.rewards[0]?.title?.cn, undefined);
    for (const sample of Object.values(samples)) {
      assert.equal(sample.testData, true);
      for (const end of ['pc', 'mobile']) assert.equal(validateOnePageData(inventory(end), sample.data, { state: sample.state }).ok, sample.expected !== 'reject');
    }
  }
});

test('TTF 与真实静态 CFF OTF 从扫描确认到 Level 1/B2，并断开生产端独立验 B3', async (context) => {
  const root = temp(context);
  const contract = join(root, 'consumer.json');
  write(contract, HANDOFF_CONSUMER);
  for (const discoveryFont of [ttfFont, staticOtf]) {
    const { format, license } = discoveryFont;
    const producer = join(root, 'producer-' + format);
    const input = await golden(producer, { discoveryFont });
    const result = cli('b-handoff', buildArgs(input));
    const isolated = join(root, 'isolated-' + format);
    cpSync(result.pack, isolated, { recursive: true });
    renameSync(producer, join(root, 'disconnected-producer-and-library-' + format));
    assert.equal(existsSync(producer), false);
    const checked = cli('handoff-check', ['--pack', isolated, '--expect-version', result.version, '--scope-version', result.scopeVersion, '--consumer-contract', contract]);
    assert.equal(checked.ok, true);
    assert.equal(checked.manifestSha256, result.manifestSha256);
    assert.equal(verify(result, { pack: isolated }).ok, true);
    const [resource] = Object.values(json(join(isolated, PACK_FILES.fonts)).resources);
    assert.equal(resource.license, license);
    assert.deepEqual(resource.licenseReview, { status: 'confirmed', evidence: input.evidence });
    assert.equal(resource.sha256, input.digest);
    assert.equal(resource.path, 'resources/fonts/' + input.digest + '.' + format);
    assert.deepEqual(readFileSync(join(isolated, resource.path)), input.font);
    context.diagnostic(format + ': L2 确认及登记、断开扫描源和旧项目副本、L1 原件复用及 B2 pass、迁移后 B3 独立验包；sha256=' + input.digest);
  }
});

test('接收侧拒绝缺文件、改字节、坏引用、路径逃逸、错版错范围及未知消费者', async (context) => {
  const root = temp(context);
  const result = cli('b-handoff', buildArgs(await golden(join(root, 'source'))));
  assert.equal(verify(result, { expectVersion: '1'.repeat(64) }).ok, false);
  assert.equal(verify(result, { scopeVersion: '1'.repeat(64) }).ok, false);
  assert.equal(verify(result, { consumerContract: undefined }).ok, false);
  assert.equal(verify(result, { consumerContract: { ...HANDOFF_CONSUMER, schema: 'future' } }).ok, false);
  assert.equal(verify(result, { consumerContract: { ...HANDOFF_CONSUMER, capabilities: [] } }).ok, false);
  const variants = [
    ['missing', (pack) => rmSync(join(pack, PACK_FILES.fonts)), /缺文件/],
    ['changed', (pack) => write(join(pack, PACK_FILES.dataContract), {}), /SHA-256/],
    ['boundary', (pack) => { rmSync(join(pack, PACK_FILES.assets)); symlinkSync(join(result.pack, PACK_FILES.assets), join(pack, PACK_FILES.assets)); }, /符号链接/],
    ['notPublished', (pack) => rmSync(join(pack, STAGE_FILE)), /缺文件/],
  ];
  for (const [name, alter, reason] of variants) {
    const pack = join(root, name);
    cpSync(result.pack, pack, { recursive: true });
    alter(pack);
    const checked = verify(result, { pack });
    assert.equal(checked.ok, false);
    assert.match(checked.message, reason);
  }
  for (const [name, change, reason] of [
    ['broken-guide', (body, pack) => {
      const path = PACK_FILES.guide;
      const guide = json(join(pack, path));
      guide.inventories[0] = '../elsewhere.json';
      write(join(pack, path), guide);
      const bytes = readFileSync(join(pack, path));
      body.files[path] = { size: bytes.length, sha256: byteDigest(bytes) };
    }, /黑盒指引/],
    ['escaped-manifest', (body) => { body.files['../README.md'] = body.files['README.md']; }, /非法包内路径/],
  ]) {
    const pack = join(root, name);
    cpSync(result.pack, pack, { recursive: true });
    const { version: oldVersion, ...body } = json(join(pack, 'manifest.json'));
    change(body, pack);
    const version = sha256Hex(body);
    write(join(pack, 'manifest.json'), { ...body, version });
    const checked = verify(result, { pack, expectVersion: version });
    assert.equal(checked.ok, false);
    assert.match(checked.message, reason);
  }
});

test('发布端拒绝错 B2、损坏 A/B1/B2、更新 B2 失败和孤儿轮，保留原包', async (context) => {
  const input = await golden(join(temp(context), 'source'));
  const { runDir, b2Version, b1, b2, configPath, fontPath } = input;
  const result = cli('b-handoff', buildArgs(input));
  const again = cli('b-handoff', buildArgs(input));
  assert.notEqual(result.pack, again.pack);
  assert.equal(again.version, result.version);
  assert.equal(again.manifestSha256, result.manifestSha256);
  const reject = (version, pattern) => {
    const checked = spawnSync(process.execPath, [bin('b-handoff'), ...buildArgs({ runDir, b2Version: version })], { encoding: 'utf8', env: { ...process.env, ONEPAGE_FONT_DIRS: '' } });
    assert.equal(checked.status, 1, checked.stdout + checked.stderr);
    assert.match(JSON.parse(checked.stdout).message, pattern);
    assert.equal(readdirSync(runDir).filter((name) => /^b3\.r/.test(name)).length, 2);
  };
  reject('1'.repeat(64), /给定的 B2 版本/);
  for (const path of [readdirSync(runDir).find((name) => /^scope\.v/.test(name)), b1.snapshotPath, b2.translationsPath, fontPath, configPath]) {
    const full = path.startsWith('/') ? path : join(runDir, path);
    const stored = readFileSync(full);
    write(full, {});
    reject(b2Version, /范围|摘要|字体|配置/);
    writeFileSync(full, stored);
  }
  const newer = join(runDir, 'b2.r2');
  mkdirSync(newer);
  reject(b2Version, /没有唯一环节记录/);
  const failed = buildStageRecord({ ...json(b2.stagePath), round: 3, output: { ...json(b2.stagePath).output, path: join(newer, 'b-supplement.json') }, result: 'needs-input' });
  write(join(runDir, 'stage-B-' + failed.version + '.json'), failed);
  reject(b2Version, /不是唯一最新 pass/);
  assert.equal(verify(result).ok, true);
});

test('构建并发不串包，已有锁或半写目录不冒充发布', async (context) => {
  const input = await golden(join(temp(context), 'source'));
  const instances = Array.from({ length: 4 }, () => new Promise((done, reject) => {
    const child = spawn(process.execPath, [bin('b-handoff'), ...buildArgs(input)], { env: { ...process.env, ONEPAGE_FONT_DIRS: '' } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => done({ code, result: JSON.parse(output) }));
  }));
  const runs = await Promise.all(instances);
  const good = runs.filter((row) => row.code === 0).map((row) => row.result);
  assert.ok(good.length);
  assert.equal(new Set(good.map((row) => row.pack)).size, good.length);
  assert.equal(new Set(good.map((row) => row.version)).size, 1);
  for (const result of good) assert.equal(verify(result).ok, true);
  mkdirSync(join(input.runDir, '.b3.lock'));
  const scratch = join(input.runDir, '.b3-writing-interrupted');
  mkdirSync(scratch);
  assert.equal(verify(good[0], { pack: scratch }).ok, false);
  assert.equal(spawnSync(process.execPath, [bin('b-handoff'), ...buildArgs(input)], { env: { ...process.env, ONEPAGE_FONT_DIRS: '' } }).status, 1);
  assert.equal(readdirSync(input.runDir).filter((name) => /^b3\.r/.test(name)).length, good.length);
});

test('中途改动合法 JSON 的字节仍算漂移，不发布且不覆盖', async (context) => {
  const input = await golden(join(temp(context), 'source'));
  const old = cli('b-handoff', buildArgs(input));
  const preload = "import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';\n"
    + "const write = fs.writeFileSync; fs.writeFileSync = (path, ...args) => {\n"
    + '  const result = write(path, ...args);\n'
    + "  if (path.endsWith('/manifest.json')) fs.appendFileSync(" + JSON.stringify(input.configPath) + ", '\\n');\n"
    + '  return result;\n}; syncBuiltinESMExports();';
  const child = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), bin('b-handoff'), ...buildArgs(input)], { encoding: 'utf8', env: { ...process.env, ONEPAGE_FONT_DIRS: '' } });
  assert.equal(child.status, 1, child.stdout + child.stderr);
  const rejected = JSON.parse(child.stdout);
  assert.match(rejected.message, /发生漂移/);
  assert.equal(verify(old, { pack: rejected.scratch }).ok, false);
  assert.deepEqual(readdirSync(input.runDir).filter((name) => /^b3\.r/.test(name)), ['b3.r1']);
  assert.equal(verify(old).ok, true);
});

test('视觉指纹跟踪填充图、描边、效果、向量、子节点与顺序，不依赖对象键顺序', () => {
  const root = frame('parent', 'img/图', [frame('leaf', '子层'), frame('other', '另一个')]);
  const original = indexVisualFingerprints(root);
  for (const field of ['imageRef', 'fills', 'strokes', 'effects', 'vectorPaths', 'fillGeometry']) {
    const modified = structuredClone(root);
    modified.children[0][field] = ['changed'];
    const next = indexVisualFingerprints(modified);
    assert.notEqual(next.get('leaf'), original.get('leaf'), field);
    assert.notEqual(next.get('parent'), original.get('parent'), field);
  }
  const reversed = { ...root, children: [...root.children].reverse() };
  assert.notEqual(indexVisualFingerprints(reversed).get('parent'), original.get('parent'));
  assert.equal(indexVisualFingerprints(Object.fromEntries(Object.entries(root).reverse())).get('parent'), original.get('parent'));
});
