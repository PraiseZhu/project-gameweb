import assert from 'node:assert/strict';
import { symlinkProbe } from './helpers/symlink.mjs';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBAnswer } from '../src/b-answer.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runBDelta } from '../src/b-delta.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';

function frame(id, name, children = [], props = {}) { return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 800, height: 600 }, children, ...props }; }
async function fixture(root, { dual = false, twoScreens = false, localized = false, mutate = (document) => {
  document.children[0].children[0].children[0].fills = [{ type: 'IMAGE', imageRef: 'after' }];
}, version = '5678' } = {}) {
  const nodeId = '1:2'; const tokenValue = 'b4-delta-test-secret-9';
  const document = { id: nodeId, name: '规范页', type: 'CANVAS', children: [frame('10:1', 'cn_pc', [frame('10:2', 'sec/1-首页', [frame('10:3', 'img/背景', [], { fills: [{ type: 'IMAGE', imageRef: 'before' }] }), frame('10:4', 'btn/活动@link=event')])])] };
  if (twoScreens) document.children[0].children.push(frame('10:20', 'sec/2-次屏'));
  if (localized) document.children[0].children[0].children.push(frame('10:21', '文案', [], {
    type: 'TEXT', characters: '首页', style: { fontFamily: 'One Page Fixture', fontWeight: 400 },
  }));
  if (dual) {
    const mobile = structuredClone(document.children[0]);
    mobile.name = 'cn_mobile';
    const changeIds = (node) => { node.id = node.id.replace('10:', '20:'); node.children.forEach(changeIds); };
    changeIds(mobile);
    document.children.push(mobile);
  }
  const body = { version: '1234', nodes: { [nodeId]: { document } } };
  const fetchImpl = async () => ({ ok: true, json: async () => body });
  const options = { url: 'https://www.figma.com/design/B4DELTA/name?node-id=1-2', languages: localized ? 'cn,en,jp' : 'cn', baseLanguage: 'cn', platform: dual ? 'pc+mobile' : 'pc', runRoot: root, tokenValue, fetchImpl };
  const draft = await runAScope(options); assert.equal(draft.ok, true, draft.message);
  const scope = await runAScope({ ...options, runDir: draft.runDir, shownFp: draft.fingerprintPrefix, confirmQuote: '确认，按这个范围做', confirmSource: 'test' }); assert.equal(scope.ok, true, scope.message);
  const b1 = await runBExtract({ runRoot: root, runDir: draft.runDir, tokenValue, fetchImpl }); assert.equal(b1.ok, true, JSON.stringify(b1));
  const configPath = projectConfigPath(root, 'B4DELTA', nodeId);
  let l10nSnapshot;
  if (localized) {
    const bytes = readFileSync(new URL('./fixtures/fonts/one-page-static.otf', import.meta.url));
    writeProjectConfigAtomic(configPath, { fonts: {
      faces: { 'One Page Fixture/400': { cn: 'fixture', en: 'fixture', jp: 'fixture' } },
      resources: { fixture: { file: 'fixture.otf', format: 'otf', weights: [400], source: 'test', license: 'public domain', digest: 'sha256:' + byteDigest(bytes) } },
    } });
    writeFileSync(join(configPath, '..', 'fixture.otf'), bytes);
    l10nSnapshot = join(root, 'translations.json');
    writeFileSync(l10nSnapshot, JSON.stringify({ values: [['简中', '英语', '日语'], ['首页', 'A', '']] }));
  }
  const b2Options = { runRoot: root, runDir: draft.runDir, tokenValue, l10nSnapshot, fontDiscovery: { directories: [] } };
  const b2 = await runBSupplement(b2Options); assert.equal(b2.ok, true, JSON.stringify(b2));
  const b3 = runBHandoff({ runDir: draft.runDir, b2Version: JSON.parse(readFileSync(b2.supplementPath)).version }); assert.equal(b3.ok, true, JSON.stringify(b3));
  body.version = version; mutate(document);
  if (version !== '1234') {
  const changedDraft = await runAScope({ ...options, runDir: draft.runDir }); assert.equal(changedDraft.ok, true, changedDraft.message);
  const changedScope = await runAScope({ ...options, runDir: draft.runDir, shownFp: changedDraft.fingerprintPrefix, confirmQuote: '确认，按这个范围做', confirmSource: 'test' }); assert.equal(changedScope.ok, true, changedScope.message);
  }
  const b1Next = await runBExtract({ runRoot: root, runDir: draft.runDir, tokenValue, fetchImpl }); assert.equal(b1Next.ok, true, JSON.stringify(b1Next));
  const b2Next = await runBSupplement(b2Options); assert.equal(b2Next.ok, true, JSON.stringify(b2Next));
  return { runDir: draft.runDir, b3, b2Options, configPath, scopeVersion: b3.scopeVersion, contract: HANDOFF_CONSUMER, body, document, options, tokenValue };
}

test('B4 换图按视觉指纹输出自包含变化包并可由 checkEntry 独立核验', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'onepage-b4-test-')); context.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await fixture(root); const contract = join(root, 'consumer.json'); writeFileSync(contract, JSON.stringify(input.contract));
  const result = runBDelta({ runDir: input.runDir, basePack: input.b3.pack, expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: contract });
  assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.changeKind, 'asset-visual-only');
  const manifest = JSON.parse(readFileSync(result.manifestPath)); assert.equal(manifest.basePackVersion, input.b3.version); assert.equal(manifest.baseScopeVersion, input.b3.scopeVersion); assert.equal(manifest.affectedAssets.length, 1); assert.notEqual(manifest.affectedAssets[0].previousVisualFingerprint, manifest.affectedAssets[0].visualFingerprint);
  assert.equal(checkEntry(result.stagePath, { expectedStage: 'B', expectedOutputKind: 'b-delta-handoff', expectedOutputVersion: result.version, scopeVersion: input.scopeVersion, basePackVersion: input.b3.version }).ok, true);
  const isolated = join(root, 'b4.r1-copy'); cpSync(result.pack, isolated, { recursive: true }); rmSync(input.runDir, { recursive: true, force: true }); assert.equal(checkEntry(join(isolated, 'stage-record.json'), { expectedStage: 'B', expectedOutputKind: 'b-delta-handoff', expectedOutputVersion: result.version, scopeVersion: input.scopeVersion, basePackVersion: input.b3.version }).ok, true);
});

test('B4 拒绝未绑定微调锚点、包内符号链接', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'onepage-b4-boundary-')); context.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await fixture(root); const contract = join(root, 'consumer.json'); writeFileSync(contract, JSON.stringify(input.contract));
  const badAnchor = runBDelta({ runDir: input.runDir, basePack: input.b3.pack, expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: contract, manualTweakAnchors: [{ nodeId: 'n1' }] });
  assert.equal(badAnchor.ok, false); assert.equal(badAnchor.result, 'stopped'); assert.match(badAnchor.message, /微调锚点/);
  const first = runBDelta({ runDir: input.runDir, basePack: input.b3.pack, expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: contract }); assert.equal(first.ok, true, JSON.stringify(first));
  const original = join(root, 'manifest-copy.json');
  cpSync(first.manifestPath, original);
  rmSync(first.manifestPath);
  await symlinkProbe(context, 'B4 拒绝包内符号链接', original, first.manifestPath, () => {
    const rejected = checkEntry(first.stagePath, { expectedStage: 'B', expectedOutputKind: 'b-delta-handoff', expectedOutputVersion: first.version, scopeVersion: input.scopeVersion, basePackVersion: input.b3.version });
    assert.equal(rejected.ok, false);
    assert.match(rejected.reason, /普通文件|符号链接/);
  });
});

test('B4 屏幕新增优先升级完整 B3，不发布局部包', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'onepage-b4-upgrade-')); context.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await fixture(root); const contract = join(root, 'consumer.json'); writeFileSync(contract, JSON.stringify(input.contract));
  input.body.version = '6789'; input.document.children[0].children[0].children.push(frame('10:6', 'sec/2-新增'));
  const changedDraft = await runAScope({ ...input.options, runDir: input.runDir }); assert.equal(changedDraft.ok, true, changedDraft.message); const changedScope = await runAScope({ ...input.options, runDir: input.runDir, shownFp: changedDraft.fingerprintPrefix, confirmQuote: '确认，按这个范围做', confirmSource: 'test' }); assert.equal(changedScope.ok, true, changedScope.message);
  const b1 = await runBExtract({ runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fetchImpl: input.options.fetchImpl }); assert.equal(b1.ok, true, JSON.stringify(b1)); const b2 = await runBSupplement({ runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fontDiscovery: { directories: [] } }); assert.equal(b2.ok, true, JSON.stringify(b2));
  const result = runBDelta({ runDir: input.runDir, basePack: input.b3.pack, expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: contract }); assert.equal(result.ok, false); assert.equal(result.result, 'stopped'); assert.equal(result.code, 'upgrade-to-full-pack'); assert.equal(existsSync(join(input.runDir, 'b4.r1')), false);
});

test('B4 保留合法 B2 needs-input 状态，不伪装成 stopped 或发布变化包', async (context) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'onepage-b4-needs-input-'))); context.after(() => rmSync(root, { recursive: true, force: true }));
  const input = await fixture(root); const contract = join(root, 'consumer.json'); writeFileSync(contract, JSON.stringify(input.contract));
  input.body.version = '7890'; input.document.children[0].children[0].children.push(frame('10:7', '文案', [], { type: 'TEXT', characters: 'A', style: { fontFamily: 'Missing Fixture', fontWeight: 400 } }));
  const changedDraft = await runAScope({ ...input.options, runDir: input.runDir }); assert.equal(changedDraft.ok, true, changedDraft.message); const changedScope = await runAScope({ ...input.options, runDir: input.runDir, shownFp: changedDraft.fingerprintPrefix, confirmQuote: '确认，按这个范围做', confirmSource: 'test' }); assert.equal(changedScope.ok, true, changedScope.message);
  const b1 = await runBExtract({ runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fetchImpl: input.options.fetchImpl }); assert.equal(b1.ok, true, JSON.stringify(b1)); const b2 = await runBSupplement({ runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fontDiscovery: { directories: [] } }); assert.equal(b2.ok, false); assert.equal(b2.result, 'needs-input');
  assert.equal(checkEntry(b2.stagePath, { expectedStage: 'B', expectedOutputKind: 'b-supplement', expectedOutputVersion: json(b2.supplementPath).version }).ok, false);
  const result = runBDelta({ runDir: input.runDir, basePack: input.b3.pack, expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: contract }); assert.equal(result.ok, false); assert.equal(result.result, 'needs-input'); assert.deepEqual(result.questions, b2.questions); assert.equal(existsSync(join(input.runDir, 'b4.r1')), false);
});

const delta = (input, overrides = {}) => runBDelta({ runDir: input.runDir, basePack: input.b3.pack,
  expectVersion: input.b3.version, scopeVersion: input.scopeVersion, consumerContract: input.contract, fontDiscovery: { directories: [] }, ...overrides });
const json = (path) => JSON.parse(readFileSync(path));
function testRoot(context) {
  const root = mkdtempSync(join(tmpdir(), 'onepage-b4-matrix-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('B4 同输入两次完整运行，比较版本与字节，不覆盖旧版', async (context) => {
  const input = await fixture(testRoot(context));
  const first = delta(input);
  assert.equal(first.ok, true, JSON.stringify(first));
  const bytes = readFileSync(first.manifestPath);
  const second = delta(input);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.notEqual(first.pack, second.pack);
  assert.equal(first.version, second.version);
  assert.deepEqual(readFileSync(second.manifestPath), bytes);
  assert.deepEqual(readFileSync(first.manifestPath), bytes);
});

test('B4 锁冲突不清理已有锁，正常重试释放本次锁', async (context) => {
  const input = await fixture(testRoot(context));
  const lock = join(input.runDir, '.b4.lock');
  mkdirSync(lock);
  assert.match(delta(input).message, /留锁/);
  assert.equal(existsSync(lock), true);
  assert.equal(existsSync(join(input.runDir, 'b4.r1')), false);
  rmSync(lock, { recursive: true });
  assert.equal(delta(input).ok, true);
  assert.equal(existsSync(lock), false);
});

for (const [name, mutation, kind] of [
  ['改色', (node) => { node.fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]; }, 'asset-visual-only'],
  ['改矢量', (node) => { node.vectorPaths = [{ data: 'M 0 0 L 10 10 Z' }]; }, 'asset-visual-only'],
  ['布局', (node) => { node.absoluteBoundingBox.width = 720; }, 'layout-impacted'],
]) {
  test('B4 分类：' + name, async (context) => {
    const input = await fixture(testRoot(context), { mutate: (document) => mutation(document.children[0].children[0].children[0]) });
    const result = delta(input);
    assert.equal(result.changeKind, kind, JSON.stringify(result));
  });
}

test('B4 未定位 Figma 变化不会被同期配置变化覆盖', async (context) => {
  const root = testRoot(context);
  const input = await fixture(root, { mutate() {} });
  const first = delta(input);
  assert.equal(first.changeKind, 'unlocated-version-change', JSON.stringify(first));
  const configPath = join(root, 'projects', 'B4DELTA-1-2', 'config.json');
  const config = json(configPath);
  config.links.event.url = 'https://example.com/event';
  writeProjectConfigAtomic(configPath, config);
  const b2 = await runBSupplement({ runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fontDiscovery: { directories: [] } });
  assert.equal(b2.ok, true, JSON.stringify(b2));
  const second = delta(input);
  assert.equal(second.changeKind, 'unlocated-version-change', JSON.stringify(second));
  const manifest = json(second.manifestPath);
  assert.equal(manifest.evidence.located, false);
  assert.deepEqual(manifest.changeSources, { figma: true, nonFigma: true });
});

test('B4 双端仅 PC 换图：纳入实际配对的移动端，不把它标成已改', async (context) => {
  const input = await fixture(testRoot(context), { dual: true });
  const result = delta(input);
  assert.equal(result.changeKind, 'asset-visual-only', JSON.stringify(result));
  const manifest = json(result.manifestPath);
  assert.ok(manifest.affectedModules.every((module) => module.end === 'pc'));
  assert.ok(manifest.whiteboxScope.relatedModules.some((module) => module.end === 'mobile' && module.nodeId === '20:2' && module.pairedWith === '10:2'));
  assert.ok(manifest.blackboxGuide.modules.some((module) => module.end === 'mobile' && module.nodeId === '20:2'));
});

test('B4 拒绝错基线版本、消费者合同和跨包锚点', async (context) => {
  const input = await fixture(testRoot(context));
  assert.equal(delta(input, { expectVersion: '0'.repeat(64) }).responsibility, 'B3');
  assert.equal(delta(input, { consumerContract: { ...input.contract, capabilities: [] } }).responsibility, 'B3');
  assert.match(delta(input, { manualTweakAnchors: [{ nodeId: '10:3', basePackVersion: '0'.repeat(64) }] }).message, /微调锚点/);
  assert.equal(existsSync(join(input.runDir, 'b4.r1')), false);
});

async function advance(input, options = {}) {
  const args = { ...input.options, runDir: input.runDir, ...options };
  const draft = await runAScope(args);
  assert.equal(draft.ok, true, draft.message);
  const scope = await runAScope({ ...args, runDir: draft.runDir, shownFp: draft.fingerprintPrefix, confirmQuote: '确认新范围', confirmSource: 'test' });
  assert.equal(scope.ok, true, scope.message);
  const b1 = await runBExtract({ ...args, runDir: draft.runDir });
  assert.equal(b1.ok, true, JSON.stringify(b1));
  return draft.runDir;
}

for (const scenario of ['删屏', '双端配对歧义', '语言范围', '端别范围', '源文件']) {
  test('B4 在 B2 之前报告升级：' + scenario, async (context) => {
    const input = await fixture(testRoot(context), { dual: scenario === '端别范围' || scenario === '双端配对歧义', twoScreens: scenario === '删屏' });
    const overrides = {};
    input.body.version = '6789';
    if (scenario === '删屏') input.document.children[0].children.pop();
    if (scenario === '双端配对歧义') input.document.children[1].children[0].children.push(frame('20:8', 'btn/活动@link=event'));
    if (scenario === '语言范围') overrides.languages = 'cn,en';
    if (scenario === '端别范围') overrides.platform = 'pc';
    if (scenario === '源文件') Object.assign(overrides, { runDir: undefined, url: input.options.url.replace('B4DELTA', 'B4OTHER') });
    const runDir = await advance(input, overrides);
    const result = delta(input, { runDir });
    assert.equal(result.code, 'upgrade-to-full-pack', JSON.stringify(result));
    if (scenario === '双端配对歧义') assert.ok(result.pairingIssues.some((issue) => issue.reason === 'duplicate-module'));
    assert.equal(existsSync(join(runDir, 'b4.r1')), false);
  });
}

test('B4 仅补问新增按钮，保留此前答案，补齐后发布', async (context) => {
  const root = testRoot(context);
  const input = await fixture(root);
  const b2Options = { runRoot: root, runDir: input.runDir, tokenValue: input.tokenValue, fontDiscovery: { directories: [] } };
  const nodes = input.document.children[0].children[0].children;
  const answer = async (question, linkKey) => runBAnswer({ ...b2Options, answersValue: { answers: [
    { id: question.id, fingerprint: question.fingerprint, value: { choice: 'open-link', linkKey, url: null } },
  ] } });
  nodes.push(frame('10:8', 'btn/旧按钮'));
  input.body.version = '6789';
  await advance(input);
  const first = await runBSupplement(b2Options);
  assert.equal(first.result, 'needs-input');
  const previous = await answer(first.questions[0], 'old-button');
  assert.equal(previous.ok, true, JSON.stringify(previous));
  nodes.push(frame('10:9', 'btn/新按钮'));
  input.body.version = '7890';
  await advance(input);
  const second = await runBSupplement(b2Options);
  const pending = delta(input);
  assert.equal(pending.result, 'needs-input', JSON.stringify(pending));
  assert.equal(pending.questions.length, 1);
  assert.equal(pending.questions[0].locations[0].nodeId, '10:9');
  const resolved = await answer(second.questions[0], 'new-button');
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  assert.ok(resolved.todos.some((todo) => todo.key === 'old-button'));
  assert.equal(delta(input).changeKind, 'layout-impacted');
});

test('B4 同 Figma 版本补齐缺译只影响日语，字体许可变化覆盖使用语言', async (context) => {
  const input = await fixture(testRoot(context), { localized: true, version: '1234', mutate() {} });
  writeFileSync(input.b2Options.l10nSnapshot, JSON.stringify({ values: [['简中', '英语', '日语'], ['首页', 'A', 'A']] }));
  assert.equal((await runBSupplement(input.b2Options)).ok, true);
  const copy = delta(input);
  assert.equal(copy.changeKind, 'non-figma-config-or-copy', JSON.stringify(copy));
  assert.deepEqual(json(copy.manifestPath).affectedLanguages, ['jp']);
  assert.deepEqual(json(copy.manifestPath).affectedSharedDeps.find(({ kind }) => kind === 'translations').languages, ['jp']);
  const config = json(input.configPath);
  config.fonts.resources.fixture.license = 'public domain (fixture attribution)';
  writeProjectConfigAtomic(input.configPath, config);
  assert.equal((await runBSupplement(input.b2Options)).ok, true);
  const fonts = delta(input);
  assert.deepEqual(json(fonts.manifestPath).affectedSharedDeps.find(({ kind }) => kind === 'fonts').languages, ['cn', 'en', 'jp']);
});

test('B4 拒绝不完整基线；暂存校验失败不占用正式轮次', async (context) => {
  const root = testRoot(context);
  const input = await fixture(root);
  const incomplete = join(root, 'incomplete');
  cpSync(input.b3.pack, incomplete, { recursive: true });
  rmSync(join(incomplete, 'production/config.json'));
  assert.equal(delta(input, { basePack: incomplete }).ok, false);
  const failure = delta(input, { manualTweakAnchors: [{ basePackVersion: input.b3.version, path: '/absolute-not-portable' }] });
  assert.match(failure.message, /绝对或越界/);
  assert.equal(existsSync(join(input.runDir, 'b4.r1')), false);
  assert.equal(existsSync(join(input.runDir, '.b4.lock')), false);
  assert.equal(delta(input).ok, true);
});

test('B4 并发 CLI 正常结束，发布轮次互异且锁由持有人清理', async (context) => {
  const root = testRoot(context);
  const input = await fixture(root);
  const contract = join(root, 'contract.json');
  writeFileSync(contract, JSON.stringify(input.contract));
  const args = [fileURLToPath(new URL('../bin/b-delta.mjs', import.meta.url)), '--run-dir', input.runDir,
    '--base-pack', input.b3.pack, '--expect-version', input.b3.version, '--scope-version', input.scopeVersion,
    '--consumer-contract', contract];
  const results = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    execFile(process.execPath, args, { env: { ...process.env, ONEPAGE_FONT_DIRS: '' } }, (error, stdout) => {
      try {
        const result = JSON.parse(stdout);
        assert.equal(Boolean(error), !result.ok);
        resolve(result);
      } catch (parseError) { reject(parseError); }
    });
  })));
  const published = results.filter((result) => result.ok);
  assert.ok(published.length > 0);
  assert.equal(new Set(published.map((result) => result.pack)).size, published.length);
  assert.equal(new Set(published.map((result) => result.version)).size, 1);
  for (const failed of results.filter((result) => !result.ok)) assert.match(failed.message, /留锁/);
  assert.equal(existsSync(join(input.runDir, '.b4.lock')), false);
});

test('B4 当前 B1 更新后拒绝仍绑定旧稿的 B2，并保留历史包', async (context) => {
  const input = await fixture(testRoot(context));
  const first = delta(input);
  assert.equal(first.ok, true, JSON.stringify(first));
  const bytes = readFileSync(first.manifestPath);
  input.body.version = '9012';
  input.document.children[0].children[0].children[0].opacity = 0.5;
  await advance(input);
  assert.match(delta(input).message, /旧 B1|最新 B1/);
  assert.equal(existsSync(join(input.runDir, 'b4.r2')), false);
  assert.deepEqual(readFileSync(first.manifestPath), bytes);
});
