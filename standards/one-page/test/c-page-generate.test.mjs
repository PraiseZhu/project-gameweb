import assert from 'node:assert/strict';
import { pillowPython } from './helpers/python.mjs';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBAnswer } from '../src/b-answer.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runCAssets } from '../src/c-assets.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { buildStageRecord, checkEntry } from '../src/stage-record.mjs';
import { sha256Hex } from '../src/canonical.mjs';
import { computeScopeVersion } from '../src/scope-record.mjs';
import { buildPage, resolveTabBindings } from '../src/c-page-render.mjs';
import { inspectC2Contract } from '../src/c2-contract.mjs';
import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { launchChromium } from '../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { browserCaseMs, checkCliMs, compositeCaseMs, measureStage } from './browser-test-budget.mjs';

const nodeId = '1:2';
const fileKey = 'C2GOLDEN';
const version = '12345';
const tokenValue = 'c2-fake-token-never-persist';
const vector = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8"><path d="M0 0H8V8H0Z" fill="#ff0000"/></svg>');
const json = (path) => JSON.parse(readFileSync(path));
const response = (body) => new Response(JSON.stringify(body));
function frame(id, name, children = [], props = {}) {
  return { id, name, type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 8, height: 8 }, children, ...props };
}

function png(alpha, width = 8, mode = 'RGBA') {
  return execFileSync(pillowPython(), ['-B', '-c', 'from PIL import Image; import sys; im=Image.new(sys.argv[3], (int(sys.argv[2]),8)); color=(99,130,211,255); im.paste(color if sys.argv[3]=="RGBA" else color[:3], (0,0,im.width,8)); im.putpixel((1,1),(189,65,29,int(sys.argv[1])) if sys.argv[3]=="RGBA" else (189,65,29)); im.save(sys.stdout.buffer,"PNG")', String(alpha), String(width), mode]);
}

async function golden(context, settings = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'onepage-c2-')));
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
  const scope = { url: 'https://www.figma.com/design/' + fileKey + '/name?node-id=1-2', languages: 'cn,en', baseLanguage: settings.baseLanguage ?? 'cn',
    platform: settings.platform ?? 'pc', runRoot: producer, tokenValue, fetchImpl: async () => response(snapshot) };
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
  const project = { ...structuredClone(settings.config ?? {}), fonts: { faces: { 'One Page Fixture/400': { cn: 'base', en: 'foreign' } },
    resources: { base: resource('base.otf', bytes), foreign: resource('foreign.otf', foreign) } } };
  const confirmedScope = json(confirmed.scopePath);
  if (project.dataContract?.c2 && !Object.hasOwn(project.dataContract.c2,'scopeVersion')) {
    project.dataContract.c2.scopeVersion = computeScopeVersion({...confirmedScope,fileVersion:project.dataContract.c2.fileVersion});
  }
  settings.prepareConfig?.(project,confirmedScope);
  writeProjectConfigAtomic(config, project);
  writeFileSync(join(config, '..', 'base.otf'), bytes);
  writeFileSync(join(config, '..', 'foreign.otf'), foreign);
  const l10nSnapshot = join(root, 'translations.json');
  writeFileSync(l10nSnapshot, JSON.stringify({ values: [['简中', '英语'], ['首页', 'A']] }));
  const b2Options = { ...scope, runDir, l10nSnapshot, fontDiscovery: { directories: [] } };
  let b2 = await runBSupplement(b2Options);
  if (settings.b2Blocked) return { b2, runDir, config };
  if (settings.answerCurrent) b2 = await settings.answerCurrent({ b2, config, b2Options, root, confirmedScope });
  if (settings.answer) {
    const answers = join(root,'answers.json');
    writeFileSync(answers,JSON.stringify({ answers:b2.questions.map((card) => ({ id:card.id, fingerprint:card.fingerprint, value:settings.answer(card) })) }));
    b2 = await runBAnswer({ ...b2Options, answers });
  }
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
    scopeVersion: b3.scopeVersion, consumerContract: HANDOFF_CONSUMER, tokenValue, fetchImpl, python: pillowPython() } };
}
import { runCGenerate } from '../src/c-page-generate.mjs';
import { runCCheck as checkPage } from '../src/c-check/index.mjs';

const runCCheck = (...args) => measureStage('C3 c-check in-process',() => checkPage(...args));
import { hasPagingResult } from '../src/c-check/pagination-audit.mjs';

async function inputs(context, settings) {
  const { root, options } = await golden(context, settings);
  const retainedDir = settings?.retained ? join(root, 'retained') : undefined;
  for (const [path, bytes] of Object.entries(settings?.retained ?? {})) {
    mkdirSync(join(retainedDir, path, '..'), { recursive: true });
    writeFileSync(join(retainedDir, path), bytes);
  }
  const assets = await runCAssets({ ...options, retainedDir });
  assert.equal(assets.ok, true, JSON.stringify(assets));
  return { root, options: { pack: options.pack, expectVersion: options.expectVersion, scopeVersion: assets.scopeVersion,
    consumerContract: options.consumerContract, runDir: join(root, 'runs', 'c2'), assetsPack: assets.pack,
    assetsVersion: assets.version, assetsSha256: assets.manifestSha256 } };
}

test('A/B1/B2/B3/C1 → C2：真实工具链、两轮字节一致、断源迁移独立验包', async (context) => {
  const { options, root } = await inputs(context);
  const first = runCGenerate(options);
  assert.equal(first.ok, true, JSON.stringify(first));
  const second = runCGenerate(options);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(first.version, second.version);
  assert.equal(first.metaSha256, second.metaSha256);
  assert.notEqual(first.pack, second.pack);
  const transferred = join(root, 'transferred');
  cpSync(first.pack, transferred, { recursive: true });
  for (const path of [options.pack, options.assetsPack, options.runDir]) rmSync(path, { recursive: true });
  const stage = join(transferred, 'stage-record.json');
  const expected = { expectedStage: 'C', expectedOutputKind: 'c-page-generate', expectedOutputVersion: first.version, scopeVersion: first.scopeVersion };
  const checked = checkEntry(stage, expected);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.deepEqual(readdirSync(join(transferred, 'page')).sort(), ['README.md','assets','cn.html','css','js']);
  const html = readFileSync(join(transferred, 'page', 'cn.html'), 'utf8');
  assert.match(html, /<h1[^>]*><span data-slogan-ink>首页<\/span><\/h1>/);
  assert.ok(!html.includes(root) && !html.includes(tokenValue) && !html.includes('data-figma-'));
  writeFileSync(join(transferred, 'page', 'cn.html'), 'tampered');
  assert.equal(checkEntry(stage, expected).ok, false);
});

test('C3：真实 C2 成品经 Chromium 与独立合成参考生成三图；缺参考不放行',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const { options, root } = await inputs(context, { mutateDocument(document) {
      document.children[0].children[0].children.find((node) => node.id === '10:7').absoluteBoundingBox.width = 100;
    } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const meta = json(join(product.pack, 'c2-build-meta.json'));
    const copyId = meta.nodes.find((row) => row.nodeId === '10:7').domId;
    const localId = meta.nodes.find((row) => row.nodeId === '10:3').domId;
    const out = join(root, 'checks');
    const refs = join(root, 'refs');
    mkdirSync(out);
    mkdirSync(refs);
    const reference = execFileSync('python3', ['-c', 'from PIL import Image; import sys; Image.new("RGB", (1280,720), "white").save(sys.stdout.buffer, "PNG")']);
    writeFileSync(join(refs, 'reference.png'), reference);
    const index = Buffer.from(JSON.stringify({ schema: 'onepage-pixel-reference/v1', baseLanguage: meta.baseLanguage,
      scopeVersion: meta.scopeVersion, b3Digest: meta.b3.digest,
      screens: [{ end: 'pc', nodeId: '10:2', viewport: { width: 1280, height: 720 }, path: 'reference.png', sha256: byteDigest(reference),
        textMasks: [{ domId: copyId, rect: [638,358,34,22] }] }] }));
    const references = join(refs, 'index.json');
    writeFileSync(references, index);
    const checked = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, references, referencesSha256: byteDigest(index), handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const report = json(join(checked.rounds[0].root, 'check-report.json'));
    assert.equal(report.pixels.length, 1, JSON.stringify(report.findings.filter((row) => row.status !== 'pass')));
    assert.ok(report.pixels[0].effectivePixels < 1280 * 720);
    for (const path of Object.values(report.pixels[0].artifacts)) assert.ok(readFileSync(join(checked.rounds[0].root, path)).length);
    assert.equal(report.findings.filter((row) => row.check === 'D07').length, 9);
    const entry = { expectedStage: 'C', expectedOutputKind: 'c-single-page', expectedOutputVersion: report.version,
      scopeVersion: product.scopeVersion, pagePack: product.pack, pageVersion: product.version };
    assert.equal(checked.status, 'pass', JSON.stringify(report.findings.filter((row) => !['pass', 'n_a'].includes(row.status))));
    assert.equal(checkEntry(join(checked.rounds[0].root, 'stage-record.json'), entry).ok, true);
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(checked.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'single-screen'), { recursive: true, force: false, errorOnExist: true });
    writeFileSync(join(checked.rounds[0].root, report.pixels[0].artifacts.diff), 'changed');
    assert.equal(checkEntry(join(checked.rounds[0].root, 'stage-record.json'), entry).ok, false);
    const localIndex = JSON.parse(index);
    localIndex.screens[0].local = [{ domId: localId, region: [638,358,4,4] }];
    const localBytes = Buffer.from(JSON.stringify(localIndex));
    writeFileSync(references, localBytes);
    const local = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, references, referencesSha256: byteDigest(localBytes), handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const localReport = json(join(local.rounds[0].root, 'check-report.json'));
    assert.deepEqual(localReport.pixels.map(({ status }) => status), ['pass','fail']);
    assert.equal(localReport.pixels[1].effectivePixels, 16);
    assert.equal(localReport.coverage.D13.status, 'fail');
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(local.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'local-pixel-failure'), { recursive: true, force: false, errorOnExist: true });
    const missing = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion, out });
    assert.equal(missing.status, 'needs-human-decision');
    assert.equal(missing.rounds[0].findings.find((row) => row.check === 'D04').status, 'not_run');
    assert.equal(checkEntry(join(missing.rounds[0].root, 'stage-record.json'), {
      ...entry, expectedOutputVersion: missing.rounds[0].version,
    }).ok, false);
  });

test('双门缺期望、错版本、错契约、错范围或 C1 实际字节变化均不发布', async (context) => {
  const { options } = await inputs(context);
  for (const overrides of [{ expectVersion: undefined }, { expectVersion: '1'.repeat(64) }, { scopeVersion: '2'.repeat(64) },
    { consumerContract: undefined }, { assetsVersion: undefined }, { assetsVersion: '3'.repeat(64) },
    { assetsSha256: undefined }, { assetsSha256: '4'.repeat(64) }]) {
    assert.equal(runCGenerate({ ...options, ...overrides }).ok, false);
  }
  const manifest = json(join(options.assetsPack, 'assets/manifest.json'));
  writeFileSync(join(options.assetsPack, manifest.assets[0].path), 'not the original');
  assert.equal(runCGenerate(options).ok, false);
  assert.throws(() => readdirSync(options.runDir), { code: 'ENOENT' });
});

test('CLI 按独立外传版本、清单 SHA 和契约出包', async (context) => {
  const { root, options } = await inputs(context);
  assert.equal(generateCli(root, options).ok, true);
});

function generateCli(root, options) {
  const contract = join(root, 'contract.json');
  writeFileSync(contract, JSON.stringify(options.consumerContract));
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../bin/c-generate.mjs', import.meta.url)),
    '--pack', options.pack, '--expect-version', options.expectVersion, '--scope-version', options.scopeVersion,
    '--consumer-contract', contract, '--assets-pack', options.assetsPack, '--assets-version', options.assetsVersion,
    '--assets-sha256', options.assetsSha256, '--run-dir', options.runDir], { env: { ...process.env, ONEPAGE_FONT_DIRS: '' } }));
  return result;
}

function tabFixture(artMode) {
  const document = frame('1:1','cn_pc',[frame('1:2','sec/1-首页',[
    frame('1:3','tab/甲@for=switch/展示'),frame('1:4','tab/乙@for=switch/展示'),
    frame('1:5','switch/展示',[frame('1:6','grp/内容一'),frame('1:7','grp/内容二')]),
  ])]);
  const config = { bindings: {'sec/1::switch/展示': { pagination:{ kind:'panels', panels:['grp/内容一','grp/内容二'] } } } };
  if (artMode) document.children[0].children.slice(0,2).forEach((tab,index)=>tab.children.push(frame('1:8' + index,'img/选中')));
  const inventory = compileOnePage(document, { requestedNodeId:'1:1', config });
  assert.equal(inventory.ok, true, JSON.stringify(inventory.issues));
  const node = (id) => ({ id, scope:'page' });
  const declarations = [{ end:'pc', tab:node('1:3'), switch:node('1:5'), panel:node('1:7'), source:'fixture: designer maps 甲 to 内容二' },
    { end:'pc', tab:node('1:4'), switch:node('1:5'), panel:node('1:6'), source:'fixture: designer maps 乙 to 内容一' }];
  const assets = artMode ? declarations.map((declaration,index) => {
    declaration.selectedArt = node('1:8' + index);
    return {end:'pc',nodeId:declaration.selectedArt.id,path:'/pixel',sha256:(artMode==='same' ? 'a' : String(index)).repeat(64),width:8,height:8};
  }) : [];
  return { baseLanguage: 'cn', ends: ['pc'], inventories: { pc: inventory }, manifest: { assets, fonts: [] }, pairing: {}, tabDeclarations: declarations };
}

function variantFixture(end = 'pc') {
  const stateSet = (id, name, options, children) => frame(id, name, options.map((value, index) =>
    frame(id + ':' + index, 'State=' + value, [frame(id + ':' + index + ':1', 'grp/' + children[index])], { type:'COMPONENT' })),
  { type:'COMPONENT_SET', componentPropertyDefinitions:{ State:{ type:'VARIANT', variantOptions:options } } });
  const menu = stateSet('2:4','dropmenu/菜单',['off','on'],['闭','开']);
  const states = stateSet('2:5','grp/结果',['idle','win'],['默认','结果']);
  const size = end === 'pc' ? [3840,2160] : [750,1430];
  const box = { x:0,y:0,width:size[0],height:size[1] };
  const document = frame('2:1','Canvas',[frame('2:2','design',[
    frame('2:3','sec/1-首页',[
      frame('2:6','dropmenu/菜单',[],{type:'INSTANCE',componentId:'2:4:0'}),
      frame('2:7','grp/结果@state=result',[],{type:'INSTANCE',componentId:'2:5:0'}),
      frame('2:8','btn/切换@action=win'),
    ],{absoluteBoundingBox:box}),
  ]),menu,states],{type:'CANVAS'});
  const inventory = compileOnePage(document,{requestedNodeId:'2:2',config:{
    bindings:{'node:2:7':{state:{property:'State',values:{success:'win'}}}},
    actions:{win:{type:'set-state',target:'node:2:7',property:'State',value:'win'}},
  }});
  assert.equal(inventory.ok,true,JSON.stringify(inventory.issues));
  return inventory;
}

test('B3 明确实例与组件集关系：生成闭合菜单和声明状态，缺特定变体才阻断', () => {
  const pc = variantFixture();
  const input = {baseLanguage:'cn',ends:['pc'],inventories:{pc},manifest:{fonts:[],assets:[]},pairing:{}};
  assert.match(buildPage(input).files['cn.html'], /data-menu/);
  pc.attachments.componentSets.find((set) => set.id === '2:4').variants.pop();
  assert.throws(() => buildPage(input), /组件对应变体缺失或歧义.*2:6.*on/);
});

test('H29 制作关系校验：反序显式映射，拒缺失、歧义、跨组、跨端和目标冲突', () => {
  const fixture = tabFixture();
  const { inventories, tabDeclarations: declarations } = fixture;
  const [first, second] = declarations;
  assert.deepEqual(buildPage(fixture).trace.tabBindings, declarations);
  assert.throws(() => resolveTabBindings(inventories), /pc \/ 1:3 \/ 1:5 \/ 1:6, 1:7/);
  assert.throws(() => resolveTabBindings(inventories, [first, first, second]), /歧义/);
  assert.throws(() => resolveTabBindings(inventories, [{ ...first, switch: { id:'1:9', scope:'page' } }, second]), /跨组/);
  assert.throws(() => resolveTabBindings(inventories, [first, second, { ...second, end:'mobile' }]), /跨端/);
  assert.throws(() => resolveTabBindings(inventories, [first, { ...second, panel:first.panel }]), /冲突/);
});

function productionSettings(mode) {
  const settings = {
    config: { bindings: { 'sec/1::switch/展示': { pagination:{ kind:'panels', panels:['grp/内容一','grp/内容二'] } },
      'node:10:25': { fieldTarget:'component-input', functionContract:'non-executable legacy marker' } } },
    mutateDocument(document) {
      const art = (id) => frame(id,'img/选中',[frame(id+':1','shape',[],{type:'VECTOR',fills:[{type:'SOLID'}]})]);
      document.children[0].children[0].children.push(frame('10:10','tab/甲@for=switch/展示',[art('10:20')]), frame('10:11','tab/乙@for=switch/展示',[art('10:21')]),
        frame('10:12','switch/展示',[frame('10:13','grp/内容一'),frame('10:14','grp/内容二')]),frame('10:25','dyn/分数@field=score'));
      const states = ['off','on'].map((state,index) => frame('11:'+index,'State='+state,
        [frame('11:'+index+':1','grp/菜单内容')],{type:'COMPONENT'}));
      document.children.push(frame('11:3','dropmenu/菜单',states,{ type:'COMPONENT_SET',
        componentPropertyDefinitions:{State:{type:'VARIANT',variantOptions:['off','on']}} }));
      document.children[0].children[0].children.push(frame('11:4','dropmenu/菜单',[],{type:'INSTANCE',componentId:'11:0'}));
    },
    downloads: { '10:20':vector,'10:21':mode === 'different' ? Buffer.from(vector.toString().replace('#ff0000','#00ff00')) : vector },
  };
  if (mode) settings.config.dataContract = { c2: { fileVersion:version,
    tabs:['10:10','10:11'].map((tabId,index) => ({ end:'pc',tabId,switchId:'10:12',panelId:index ? '10:13' : '10:14',source:'confirmed design fixture',selection:{ kind:'asset',nodeId:index ? '10:21' : '10:20' } })),
    componentInputs:[{end:'pc',nodeId:'10:25',receiver:'text-content',valueShape:'scalar',valueTypes:['string','number','boolean'],source:'approved data fixture'}] } };
  return settings;
}

function layoutSettings() {
  const settings = productionSettings('same');
  settings.config.motions = { 'second-batch':{ rule:'content-left', unit:'batches', trigger:'section-enter',
    source:'fixture B2 explicit order', composition:'nested-standard', batches:[['node:14:3','node:14:1'],['node:14:2']] },
    'nav-crystal':{rule:'foreground-crystal',unit:'whole',trigger:'section-enter',direction:'right',source:'fixture crystal direction'} };
  settings.config.links = { 'fixture-social':{url:null} };
  const mutate = settings.mutateDocument;
  settings.mutateDocument = (document) => {
    mutate(document);
    const page = document.children[0];
    const first = page.children[0];
    const box = (x,y,width,height) => ({absoluteBoundingBox:{x,y,width,height}});
    const text = (id) => frame(id,'首页',[],{...box(210,250,130,64),type:'TEXT',characters:'首页',style:{fontFamily:'One Page Fixture',fontWeight:400,fontSize:30,textTruncation:'ENDING'}});
    const art = (id,x,y) => frame(id,'img/'+id,[frame(id+':1','shape',[],{type:'VECTOR',fills:[{type:'SOLID'}]})],box(x,y,8,8));
    Object.assign(first,box(0,0,3840,2160));
    first.children = first.children.filter((node)=>node.id!=='10:7');
    first.children.push(frame('12:1','title/标题',[text('12:2')],box(180,200,280,130)),
      frame('12:3','grp/叠层',[art('12:4',218,254),text('12:5'),art('12:6',219,255)],box(200,230,280,130)),
      frame('12:7','fix/本屏按钮',[frame('12:8','btn/下一屏@sec=next')],box(400,400,280,120)));
    first.children.unshift(frame('14:0','bg/首页背景',[frame('14:5','shape',[],{type:'VECTOR',fills:[{type:'SOLID'}]})],box(0,0,8,8)));
    page.children.push(frame('13:1','sec/2-第二屏',[frame('13:2','title/标题',[frame('13:3','首页',[],{
      ...box(200,2460,200,80),type:'TEXT',characters:'首页',style:{fontFamily:'One Page Fixture',fontWeight:400},
    })],box(180,2400,280,130)),frame('14:4','grp/分批@motion=second-batch',[
      frame('14:1','grp/甲'),frame('14:2','grp/乙'),frame('14:3','grp/丙'),
    ],box(200,2570,280,130))],box(0,2160,3840,2160)),frame('13:4','fix/共用导航',[
      frame('13:5','btn/首页@sec=1'),frame('13:6','btn/第二屏@sec=2'),
      { ...art('14:6',167,154), name:'img/晶体@part=foreground@motion=nav-crystal' },
    ],box(100,120,560,100)),frame('13:7','fix/第二屏起@from=2',[frame('13:8','btn/首页@sec=1')],box(100,220,160,100)));
    page.children.push(frame('14:7','fix/外链入口',[frame('14:8','btn/社媒入口@link=fixture-social')],box(800,120,80,60)));
  };
  Object.assign(settings.downloads,{'12:4':vector,'12:6':vector,'14:0':vector,'14:6':vector});
  return settings;
}

test('缺 TAB 关系和组件接收器时 B2 逐项补问；普通无此声明的包保持兼容', async (context) => {
  const { b2, runDir } = await golden(context, { ...productionSettings(), b2Blocked:true });
  assert.equal(b2.result,'needs-input');
  assert.deepEqual(b2.questions.filter((card)=>card.type==='tab-panel').map((card)=>card.panelIds), [['10:13','10:14'],['10:13','10:14']]);
  assert.equal(b2.questions.find((card)=>card.type==='component-input').locations[0].nodeId,'10:25');
  assert.equal(runBHandoff({runDir,b2Version:json(b2.supplementPath).version}).ok,false);
});

test('生产 B2 拒歧义、跨端、跨组、组外素材、未知接收器、非法形态和旧版本', async (context) => {
  for (const change of [(block)=>block.tabs.push(block.tabs[0]), (block)=>{block.tabs[0].end='mobile';}, (block)=>{block.tabs[0].switchId='10:13';},
    (block)=>{block.tabs[0].selection.nodeId='10:21';}, (block)=>{block.tabs[0].selection={};}, (block)=>{block.componentInputs[0].receiver='eval';},
    (block)=>{block.componentInputs[0].valueShape='object';}, (block)=>{block.fileVersion='older';}]) {
    const settings=productionSettings('same');
    change(settings.config.dataContract.c2);
    const { b2 } = await golden(context,{...settings,b2Blocked:true});
    assert.equal(b2.result,'needs-input');
    assert.ok(b2.problems.some((problem)=>problem.code==='C2_DECLARATION'));
  }
});

test('生产 B2→B3→C1→C2 CLI 保留反序绑定和受约束接收器', async (context) => {
  const settings = productionSettings('same');
  const block = settings.config.dataContract.c2;
  delete settings.config.dataContract;
  settings.answer = (card) => {
    if (card.type === 'tab-panel') {
      const { panelId, source, selection } = block.tabs.find(({tabId})=>tabId===card.locations[0].nodeId);
      return {panelId,source,selection};
    }
    assert.equal(card.type,'component-input');
    const { receiver,valueShape,valueTypes,source } = block.componentInputs[0];
    return {receiver,valueShape,valueTypes,source};
  };
  const { root, options } = await inputs(context, settings);
  const result = generateCli(root, options);
  assert.equal(result.ok,true);
  const meta = json(join(result.pack,'c2-build-meta.json'));
  assert.deepEqual(meta.tabBindings.map(({tab,panel})=>[tab.id,panel.id]),[['10:10','10:14'],['10:11','10:13']]);
  assert.equal(meta.componentInputs[0].receiver,'text-content');
});

test('C3 Chromium：以真实 B3 样例验证组件接收及未配置、404、失败状态',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const { root, options } = await inputs(context, productionSettings('same'));
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const out = join(root, 'checks');
    mkdirSync(out);
    const checked = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const data = checked.rounds[0].findings.filter((row) => row.check === 'D09');
    for (const [scenario, state] of [['success-full', 'ready'], ['request-404', 'unpublished'],
      ['request-missing', 'unpublished'], ['request-failure', 'unavailable']]) {
      const observation = data.find((row) => row.target === 'pc:' + scenario);
      assert.equal(observation?.status, 'pass', JSON.stringify(checked.rounds[0].findings.filter((row) => row.status !== 'pass')));
      assert.equal(observation.detail.state, state);
    }
    assert.equal(checked.status, 'needs-human-decision');
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(checked.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'data-samples'), { recursive: true, force: false, errorOnExist: true });
  });

test('C3 Chromium：离网图片失败时恢复本地素材，实际复制按钮可写剪贴板',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const { root, options } = await inputs(context, { config: { actions: { 'copy-fixture': { type: 'copy-text', value: 'c3-fixture-copy' } } },
      downloads: { '10:91': vector },
      mutateDocument(document) {
        const screen = document.children[0].children[0];
        Object.assign(screen.absoluteBoundingBox, { width: 3840, height: 2160 });
        const headline = screen.children.find((node) => node.id === '10:7');
        headline.absoluteBoundingBox = { x: 100, y: 125, width: 240, height: 90 };
        screen.children = [screen.children[0], headline,
          frame('10:91','bg/首屏底图',[frame('10:92','shape',[],{ type:'VECTOR', fills:[{ type:'SOLID' }] })]),
          frame('10:90','btn/复制@action=copy-fixture', [],
          { absoluteBoundingBox: { x: 300, y: 300, width: 250, height: 100 } })];
        screen.children[0].name = 'img/封面@field=cover';
      } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const out = join(root, 'checks');
    mkdirSync(out);
    const checked = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const report = json(join(checked.rounds[0].root, 'check-report.json'));
    const fallback = report.findings.filter((row) => row.check === 'D11' && row.target.includes(':fallback:'));
    assert.ok(fallback.length && fallback.every((row) => row.status === 'pass' && row.detail.expectedFallback), JSON.stringify(report.findings.filter((row) => !['pass','n_a'].includes(row.status))));
    assert.ok(report.findings.some((row) => row.check === 'D12' && row.target.endsWith(':copy-control') && row.status === 'pass'));
    assert.ok(report.findings.some((row) => row.check === 'D05' && row.target.endsWith(':text-geometry')
      && row.status === 'pass' && row.detail.compared > 0), JSON.stringify(report.findings.filter((row) => row.check === 'D05')));
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(checked.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'cover-copy'), { recursive: true, force: false, errorOnExist: true });
  });

test('C3 Chromium：正式双端多屏每端九档，断点往返绑定同屏；漏参考拒绝下游',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const { root, options } = await inputs(context, { platform: 'pc+mobile', mutateDocument(document) {
      document.children = ['pc', 'mobile'].map((end, index) => {
        const prefix = String(30 + index);
        return frame(prefix + ':1', 'cn_' + end, [1, 2].map((number) => frame(prefix + ':' + (number + 1), 'sec/' + number + '-画面', [],
          { absoluteBoundingBox: { x: 0, y: (number - 1) * 1080, width: end === 'pc' ? 3840 : 750, height: end === 'pc' ? 2160 : 1430 } })));
      });
    } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const out = join(root, 'checks');
    mkdirSync(out);
    const checked = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const report = json(join(checked.rounds[0].root, 'check-report.json'));
    const devices = report.findings.filter((row) => row.check === 'D07');
    assert.equal(devices.length, 19, JSON.stringify(report.findings.filter((row) => row.status !== 'pass')));
    assert.ok(devices.every((row) => row.status === 'pass'), JSON.stringify(devices.filter((row) => row.status !== 'pass')));
    assert.ok(devices.filter((row) => row.target !== 'breakpoint-roundtrip').every((row) => row.detail.length === 2));
    assert.equal(report.coverage.D02.status, 'pass');
    assert.equal(report.coverage.D04.status, 'not_run');
    assert.equal(report.coverage.D13.status, 'fail');
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(checked.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'dual-viewports'), { recursive: true, force: false, errorOnExist: true });
  });

test('C3 Chromium：生产双端 TAB、隐藏面板、弹层焦点与备案素材',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const tabs = ['pc','mobile'].flatMap((end, index) => ['5','6'].map((id, position) => ({ end,
      tabId: (50 + index) + ':' + id, switchId: (50 + index) + ':7', panelId: (50 + index) + ':' + (8 + position),
      source: '双端同义屏设计', selection: { kind: 'none' } })));
    const retained = { 'original/活动 原图.png': png(120), 'backup/备用.png': png(140), 'history/旧稿.png': png(160) };
    const settings = { platform: 'pc+mobile', retained, config: {
      bindings: { 'sec/1::switch/介绍': { pagination: { kind: 'panels', panels: ['grp/第一','grp/第二'] } },
        'sec/1::switch/内页': { pagination: { kind:'panels', panels:['grp/单项'] } } },
      actions: { details: { type: 'open-modal', targets: ['modal/详情'] }, innerNext: { type:'next-page', targets:['switch/内页'] },
        innerPrevious: { type:'previous-page', targets:['switch/内页'] } },
      links: { download: { url: null } },
      dataContract: { c2: { fileVersion: version, tabs, componentInputs: [] } },
    }, mutateDocument(document) {
      document.children = ['pc','mobile'].flatMap((end, index) => {
        const prefix = String(50 + index) + ':';
        const box = (x,y,width,height) => ({ absoluteBoundingBox: { x: x + index * 5000,y,width,height } });
        const node = (id, name, x, y, width, height, children = []) => frame(prefix + id, name, children, box(x,y,width,height));
        const panel = node('7','switch/介绍',90,220,500,400, [node('8','grp/第一',90,220,500,400),
          node('9','grp/第二',90,220,500,400,[node('14','btn/更多@action=details',140,290,220,90),
            node('18','switch/内页',130,390,400,210,[node('19','grp/单项',130,390,400,210)]),
            node('20','btn/上一页@action=innerPrevious',140,430,160,80), node('21','btn/下一页@action=innerNext',330,430,160,80)])]);
        const first = node('2','sec/1-首页',0,0,end === 'pc' ? 3840 : 750,end === 'pc' ? 2160 : 1430, [
          node('5','tab/第一@for=switch/介绍',80,60,180,85), node('6','tab/第二@for=switch/介绍',285,60,180,85),
          node('10','btn/详情@action=details',480,60,180,85), panel,
          node('13','btn/下载@link=download',80,650,260,95),
        ]);
        return [node('1','cn_' + end,0,0,750,1430,[first]), node('11','modal/详情',90,690,420,300,[node('12','grp/内容',90,690,420,300)])];
      });
    } };
    await assert.rejects(golden(context, { ...settings, mutateDocument(document) {
      settings.mutateDocument(document);
      document.children[0].children[0].children.find((node) => node.id === '50:10').name = 'btn/详情@go=modal/详情';
    } }), /production\/inventory-pc\.json：节点动作存在坏引用：50:10/);
    const { root, options } = await inputs(context, settings);
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const out = join(root, 'checks');
    mkdirSync(out);
    const checked = await runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER });
    const report = json(join(checked.rounds[0].root, 'check-report.json'));
    const selected = report.findings.filter((row) => row.target.endsWith(':tab-roundtrip'));
    const dialogs = report.findings.filter((row) => row.target.endsWith(':overlay-roundtrip') || row.target.endsWith(':overlay'));
    assert.equal(selected.length, 2, JSON.stringify(report.findings.filter((row) => row.status === 'not_run')));
    assert.ok(selected.every((row) => row.status === 'pass'), JSON.stringify(selected));
    const tabActions = report.findings.filter((row) => row.check === 'D08' && row.target.endsWith(':activation'));
    assert.equal(tabActions.length, 4);
    assert.ok(tabActions.every((row) => row.status === 'pass' && row.detail.inactivePanels), JSON.stringify(tabActions));
    assert.equal(dialogs.length, 6, JSON.stringify(dialogs));
    assert.ok(dialogs.every((row) => row.status === 'pass'), JSON.stringify(dialogs));
    const links = report.findings.filter((row) => row.check === 'D10' && /:(stub-http|blocked-protocol)$/.test(row.target));
    assert.equal(links.length, 4, JSON.stringify(links));
    assert.ok(links.every((row) => row.status === 'pass'), JSON.stringify(links));
    const assets = json(join(product.pack, 'page', 'assets', 'manifest.json')).retained;
    assert.deepEqual(assets.map((item) => item.kind).sort(), ['backup','history','original']);
    for (const asset of assets) {
      assert.deepEqual(readFileSync(join(product.pack, 'page', asset.path)), retained[asset.source]);
      assert.ok(report.findings.some((row) => row.check === 'D06' && row.target === asset.path && row.status === 'pass'));
    }
    assert.equal(report.coverage.D13.status, 'fail');
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(checked.rounds[0].root,
      join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, 'paired-controls'), { recursive: true, force: false, errorOnExist: true });
    const changed = join(product.pack, 'page', assets[0].path);
    const retainedOriginal = readFileSync(changed);
    writeFileSync(changed, 'bad retained bytes');
    await assert.rejects(runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion,
      out, handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER }), /SHA-256|大小|字节/);
    writeFileSync(changed, retainedOriginal);
    const meta = json(join(product.pack, 'c2-build-meta.json'));
    const referenceDir = join(root, 'tab-references');
    mkdirSync(referenceDir);
    const references = join(referenceDir, 'index.json');
    const screens = [];
    const { browser } = await launchChromium();
    try {
      for (const [end, prefix, viewport, scale] of [['pc','50',{ width:1280,height:720 },1/3], ['mobile','51',{ width:375,height:715 },1/2]]) {
        const page = await browser.newPage({ viewport });
        for (const state of [null, '5', '6']) {
          const boxes = [['5','第一',80,60,180,85],['6','第二',285,60,180,85],['10','详情',480,60,180,85],['13','下载',80,650,260,95]];
          if (state === '6') boxes.push(['14','更多',140,290,220,90]);
          await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0;font:' + (scale * 32) + 'px sans-serif}button{box-sizing:border-box;position:absolute;display:grid;font:inherit}</style>'
            + boxes.map(([id, text, x, y, width, height]) => '<button id="target-' + id + '" style="left:' + x * scale + 'px;top:' + y * scale + 'px;width:' + width * scale + 'px;height:' + height * scale + 'px">' + text + '</button>').join(''));
          if (state) await page.locator('#target-' + state).click();
          const bytes = await page.screenshot();
          const path = end + '-' + (state ?? 'default') + '.png';
          writeFileSync(join(referenceDir, path), bytes);
          const local = boxes.map(([id, , x,y,width,height]) => ({ domId: meta.nodes.find((row) => row.nodeId === prefix + ':' + id).domId,
            region: [Math.floor(x * scale + 1e-6), Math.floor(y * scale + 1e-6),
              Math.ceil((x + width) * scale - 1e-6) - Math.floor(x * scale + 1e-6), Math.ceil((y + height) * scale - 1e-6) - Math.floor(y * scale + 1e-6)] }));
          screens.push({ end, nodeId: prefix + ':2', ...(state ? { state: { kind:'tab', tabId:prefix + ':' + state } } : {}), viewport, path, sha256: byteDigest(bytes), local });
        }
        await page.close();
      }
    } finally { await browser.close(); }
    const runReference = async (screens) => {
      const index = Buffer.from(JSON.stringify({ schema:'onepage-pixel-reference/v1', baseLanguage: meta.baseLanguage,
        scopeVersion: meta.scopeVersion, b3Digest: meta.b3.digest, screens }));
      writeFileSync(references, index);
      return runCCheck({ pack: product.pack, expectVersion: product.version, scopeVersion: product.scopeVersion, out,
        handoffPack: options.pack, consumerContract: HANDOFF_CONSUMER, references, referencesSha256: byteDigest(index) });
    };
    const signed = await runReference(screens);
    assert.equal(signed.status, 'pass', JSON.stringify(signed.rounds[0].problems));
    const hidden = signed.rounds[0].findings.filter((row) => row.target.endsWith(':pagination-hidden'));
    assert.equal(hidden.length, 4, JSON.stringify(hidden));
    assert.ok(hidden.every((row) => row.status === 'pass' && row.detail.pages === 1 && row.detail.sampleId === '@initial'
      && row.detail.caseId === meta.nodes.find((node) => node.end === row.detail.end && ['50:6','51:6'].includes(node.nodeId)).domId));
    const innerId = meta.nodes.find((row) => row.nodeId === '51:14').domId;
    const activeTab = meta.nodes.find((row) => row.nodeId === '51:6').domId;
    const localProof = json(join(signed.rounds[0].root, 'check-report.json')).pixels.filter((pixel) => pixel.domId === innerId);
    assert.deepEqual(localProof.map((pixel) => pixel.caseId), [activeTab]);
    const missingLocal = structuredClone(screens);
    const activeReference = missingLocal.find((reference) => reference.state?.tabId === '51:6');
    activeReference.local = activeReference.local.filter((row) => row.domId !== innerId);
    const withoutLocal = await runReference(missingLocal);
    assert.ok(withoutLocal.rounds[0].problems.some((row) => row.check === 'D04' && row.target === innerId + ':' + activeTab + ':local'));
    const omitted = await runReference(screens.slice(0,-1));
    assert.ok(omitted.rounds[0].problems.some((row) => row.check === 'D04' && /必验视觉/.test(row.detail)));
    for (const region of [[0,0,1,1], [1,1,60,29]]) {
      const bad = structuredClone(screens);
      bad[0].local[0].region = region;
      const rejected = await runReference(bad);
      assert.ok(rejected.rounds[0].problems.some((row) => row.check === 'D04' && /权威设计框/.test(row.detail)));
    }
    const signedEvidence = signed.rounds[0].root;
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) {
      for (const [label, path] of [['tab-state-signed', signedEvidence], ['tab-state-missing', omitted.rounds[0].root], ['tab-reference-source', referenceDir]]) {
        cpSync(path, join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, label), { recursive:true, force:false, errorOnExist:true });
      }
    }
    const signedReport = json(join(signedEvidence, 'check-report.json'));
    const signedPath = join(signedEvidence, 'stage-record.json');
    const entry = { expectedStage:'C', expectedOutputKind:'c-single-page', expectedOutputVersion:signedReport.version,
      scopeVersion: product.scopeVersion, pageVersion: product.version, pagePack: product.pack };
    rmSync(options.pack, { recursive:true });
    rmSync(referenceDir, { recursive:true });
    assert.equal(checkEntry(signedPath, entry).ok, true);
    const reportPath = join(signedEvidence, 'check-report.json');
    const logPath = join(signedEvidence, 'browser-log.json');
    const originalLog = readFileSync(logPath);
    const originalStage = readFileSync(signedPath);
    const { version: baselineVersion, ...wrongStateReport } = structuredClone(signedReport);
    assert.equal(baselineVersion, entry.expectedOutputVersion);
    const wrongLog = JSON.parse(originalLog);
    const scopeId = hidden[0].id;
    for (const rows of [wrongStateReport.findings, wrongLog.findings]) rows.find((row) => row.id === scopeId).detail.caseId = 'default';
    const wrongLogBytes = Buffer.from(JSON.stringify(wrongLog));
    wrongStateReport.evidence['browser-log.json'] = { bytes:wrongLogBytes.length, sha256:byteDigest(wrongLogBytes) };
    const wrongVersion = sha256Hex(wrongStateReport);
    const wrongReportBytes = Buffer.from(JSON.stringify({ ...wrongStateReport, version:wrongVersion }));
    const originalRecord = JSON.parse(originalStage);
    writeFileSync(logPath, wrongLogBytes);
    writeFileSync(reportPath, wrongReportBytes);
    writeFileSync(signedPath, JSON.stringify(buildStageRecord({ ...originalRecord,
      output:{ ...originalRecord.output, version:wrongVersion, digest:byteDigest(wrongReportBytes) } })));
    assert.match(checkEntry(signedPath, { ...entry, expectedOutputVersion:wrongVersion }).reason, /D08 缺精确分页动作证据/);
    writeFileSync(logPath, originalLog);
    writeFileSync(signedPath, originalStage);
    const omittedPixels = signedReport.pixels.filter((pixel) => pixel.caseId === meta.nodes.find((node) => node.nodeId === '51:6').domId);
    const { version: oldVersion, ...body } = signedReport;
    assert.equal(oldVersion, entry.expectedOutputVersion);
    body.pixels = body.pixels.filter((pixel) => !omittedPixels.includes(pixel));
    for (const pixel of omittedPixels) for (const path of Object.values(pixel.artifacts)) delete body.evidence[path];
    const newVersion = sha256Hex(body);
    const changedReport = Buffer.from(JSON.stringify({ ...body, version: newVersion }));
    writeFileSync(reportPath, changedReport);
    const signedStage = json(signedPath);
    writeFileSync(signedPath, JSON.stringify(buildStageRecord({ ...signedStage, output: { ...signedStage.output, version: newVersion, digest: byteDigest(changedReport) } })));
    assert.match(checkEntry(signedPath, { ...entry, expectedOutputVersion: newVersion }).reason, /必验屏状态/);
    const obstruction = await inputs(context, { ...settings, mutateDocument(document) {
      settings.mutateDocument(document);
      for (const [index, prefix] of [[0,'50'],[2,'51']]) {
        const second = document.children[index].children[0].children.find((node) => node.id === prefix + ':7').children[1];
        const box = { x:120 + index * 2500, y:260, width:220, height:95 };
        second.children.push(frame(prefix + ':90','btn/独立详情@action=details',[],{ absoluteBoundingBox:box }),
          frame(prefix + ':91','grp/遮挡',[],{ absoluteBoundingBox:{ ...box, x: box.x + (index ? 300 : 0) } }));
      }
    } });
    const badPage = runCGenerate(obstruction.options);
    assert.ok(badPage.ok, JSON.stringify(badPage));
    const badMeta = json(join(badPage.pack, 'c2-build-meta.json'));
    const hiddenAction = badMeta.nodes.find((row) => row.nodeId === '50:90').domId;
    const badResult = await runCCheck({ pack:badPage.pack, expectVersion:badPage.version, scopeVersion:badPage.scopeVersion,
      out, handoffPack:obstruction.options.pack, consumerContract:HANDOFF_CONSUMER });
    assert.ok(badResult.rounds[0].problems.some((row) => row.check === 'D08' && row.detail?.actionId === hiddenAction
      && row.status === 'fail'), JSON.stringify(badResult.rounds[0].problems.filter((row) => row.check === 'D08')));
    assert.equal(badResult.status, 'needs-human-decision');
  });

test('C3 Chromium：单页分页逐动作验隐藏并签发，错误显示阻断',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const { root, options } = await inputs(context, { config: {
      bindings: { 'sec/1::switch/单页': { pagination:{ kind:'panels', panels:['grp/卡片'] } } },
      actions: { next:{ type:'next-page', targets:['switch/单页'] }, previous:{ type:'previous-page', targets:['switch/单页'] } },
    }, mutateDocument(document) {
      const screen = document.children[0].children[0];
      Object.assign(screen.absoluteBoundingBox, { width:3840, height:2160 });
      const box = (x,y,width,height) => ({ absoluteBoundingBox:{ x,y,width,height } });
      screen.children = [frame('10:32','switch/单页',[frame('10:33','grp/卡片',[],box(100,100,480,300))],box(100,100,480,300)),
        frame('10:34','btn/上一页@action=previous',[],box(100,480,210,70)),
        frame('10:35','btn/下一页@action=next',[],box(350,480,210,70))];
    } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const metaPath = join(product.pack,'c2-build-meta.json');
    const meta = json(metaPath);
    const out = join(root,'checks');
    const refDir = join(root,'refs');
    mkdirSync(out);
    mkdirSync(refDir);
    const reference = execFileSync('python3',['-B','-c','from PIL import Image; import sys; Image.new("RGB",(1280,720),"white").save(sys.stdout.buffer,"PNG")']);
    writeFileSync(join(refDir,'default.png'),reference);
    const index = Buffer.from(JSON.stringify({ schema:'onepage-pixel-reference/v1', baseLanguage:meta.baseLanguage, scopeVersion:meta.scopeVersion,
      b3Digest:meta.b3.digest, screens:[{ end:'pc',nodeId:'10:2',viewport:{width:1280,height:720},path:'default.png',sha256:byteDigest(reference) }] }));
    const references = join(refDir,'index.json');
    writeFileSync(references,index);
    const run = (expectVersion) => runCCheck({ pack:product.pack, expectVersion, scopeVersion:product.scopeVersion,
      out, handoffPack:options.pack, consumerContract:HANDOFF_CONSUMER, references, referencesSha256:byteDigest(index) });
    const signed = await run(product.version);
    assert.equal(signed.status,'pass',JSON.stringify(signed.rounds[0].problems));
    const actual = json(join(signed.rounds[0].root,'check-report.json'));
    const actions = meta.nodes.filter((row) => ['10:34','10:35'].includes(row.nodeId)).map((row) => row.domId).sort();
    const proofs = actual.findings.filter((row) => row.target.endsWith(':pagination-hidden'));
    assert.deepEqual(proofs.map((row) => row.detail.actionId).sort(),actions);
    assert.ok(proofs.every((row) => row.status === 'pass' && row.detail.pages === 1 && row.detail.hidden));
    assert.equal(checkEntry(join(signed.rounds[0].root,'stage-record.json'), { expectedStage:'C', expectedOutputKind:'c-single-page',
      expectedOutputVersion:actual.version, scopeVersion:product.scopeVersion, pageVersion:product.version, pagePack:product.pack }).ok,true);
    const script = 'page/js/main.js';
    const runtime = readFileSync(join(product.pack,script),'utf8');
    const broken = Buffer.from(runtime.replace('hide(control, count <= 1)', 'hide(control, false)'));
    assert.notEqual(broken.toString(),runtime);
    const { version: before, ...body } = meta;
    assert.equal(before, product.version);
    body.files[script] = { bytes:broken.length, sha256:byteDigest(broken) };
    const version = sha256Hex(body);
    const metadata = Buffer.from(JSON.stringify({ ...body,version }));
    const stagePath = join(product.pack,'stage-record.json');
    const stage = json(stagePath);
    writeFileSync(join(product.pack,script),broken);
    writeFileSync(metaPath,metadata);
    writeFileSync(stagePath,JSON.stringify(buildStageRecord({ ...stage, output:{ ...stage.output,version,digest:byteDigest(metadata) } })));
    const rejected = await run(version);
    assert.equal(rejected.status,'needs-human-decision');
    const rejectedProofs = rejected.rounds[0].problems.filter((row) => row.target.endsWith(':pagination-hidden'));
    assert.deepEqual(rejectedProofs.map((row) => row.detail.actionId).sort(),actions);
    assert.ok(rejectedProofs.every((row) => row.status === 'fail' && row.detail.pages === 1 && !row.detail.hidden));
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) for (const [name,result] of [['single-page-signed',signed],['single-page-visible-rejected',rejected]]) {
      cpSync(result.rounds[0].root,join(process.env.ONEPAGE_C3_ARTIFACT_ROOT,name),{ recursive:true,force:false,errorOnExist:true });
    }
  });

test('C3 Chromium：同页先验第一屏非默认 TAB，再独立验证第二屏分页',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: browserCaseMs }, async (context) => {
    const sections = [20, 21];
    const tabs = sections.flatMap((section) => [0, 1].map((index) => ({ end:'pc', tabId:section + ':' + (5 + index),
      switchId:section + ':7', panelId:section + ':' + (8 + index), source:'双屏分页设计', selection:{ kind:'none' } })));
    const { root, options } = await inputs(context, { config:{
      dataContract:{ c2:{ fileVersion:version, tabs, componentInputs:[] } },
      bindings:Object.fromEntries(sections.flatMap((section, index) => [
        ['sec/' + (index + 1) + '::switch/分页' + section, { pagination:{ kind:'panels', panels:['grp/前'] } }],
        ['sec/' + (index + 1) + '::switch/分组' + section, { pagination:{ kind:'panels', panels:['grp/第一','grp/第二'] } }],
      ])),
      actions:Object.fromEntries(sections.flatMap((section) => ['next','previous'].map((direction) =>
        [direction + section, { type:direction + '-page', targets:['switch/分页' + section] }]))),
    }, mutateDocument(document) {
      document.children[0].children = sections.map((section, index) => {
        const node = (id, name, x, y, width, height, children = []) => frame(section + ':' + id, name, children,
          { absoluteBoundingBox:{ x, y:y + index * 2300, width, height } });
        return node(2,'sec/' + (index + 1) + '-分页',0,0,3840,2160,[
          node(5,'tab/第一@for=switch/分组' + section,80,60,180,85), node(6,'tab/第二@for=switch/分组' + section,285,60,180,85),
          node(7,'switch/分组' + section,80,180,500,150,[node(8,'grp/第一',80,180,500,150),node(9,'grp/第二',80,180,500,150)]),
          node(10,'switch/分页' + section,80,350,500,150,[node(11,'grp/前',80,350,500,150)]),
          node(13,'btn/下一页@action=next' + section,80,530,180,85), node(14,'btn/上一页@action=previous' + section,285,530,180,85),
        ]);
      });
    } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const meta = json(join(product.pack,'c2-build-meta.json'));
    const out = join(root,'checks');
    mkdirSync(out);
    const result = await runCCheck({ pack:product.pack, expectVersion:product.version, scopeVersion:product.scopeVersion,
      out, handoffPack:options.pack, consumerContract:HANDOFF_CONSUMER });
    const evidence = result.rounds[0].root;
    if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(evidence,join(process.env.ONEPAGE_C3_ARTIFACT_ROOT,'two-screen-pagination'),
      { recursive:true,force:false,errorOnExist:true });
    const report = json(join(evidence,'check-report.json'));
    const rows = report.findings.filter((row) => row.check === 'D08' && /:pagination-(action|hidden|unavailable)$/.test(row.target));
    const domId = (section, id) => meta.nodes.find((node) => node.nodeId === section + ':' + id).domId;
    const expected = sections.flatMap((section) => ['default',domId(section,5),domId(section,6)].flatMap((caseId) =>
      [13,14].map((action) => ({ end:'pc', screen:domId(section,2), caseId, sampleId:'@initial',
        owner:domId(section,10), actionId:domId(section,action) }))));
    assert.equal(rows.length,expected.length,JSON.stringify(rows));
    const firstActive = rows.findIndex((row) => row.detail.caseId === domId(20,6));
    const secondActive = rows.findIndex((row) => row.detail.caseId === domId(21,5));
    assert.ok(firstActive >= 0 && secondActive > firstActive);
    for (const scope of expected) {
      assert.ok(hasPagingResult(rows,scope),JSON.stringify(rows.filter((row) => row.status !== 'pass')));
      const same = (row) => Object.entries(scope).every(([key,value]) => row.detail[key] === value);
      const proof = rows.find(same);
      assert.equal(proof.detail.pages,1);
      assert.equal(hasPagingResult(rows.filter((row) => !same(row)),scope),false);
    }
  });

async function compositeReferences(root, meta) {
  const directory = join(root, 'references');
  mkdirSync(directory);
  const screens = [];
  const font = readFileSync(new URL('./fixtures/fonts/one-page-static.otf', import.meta.url)).toString('base64');
  const { browser } = await launchChromium();
  try {
    for (const [end, prefix, viewport, scale] of [
      ['pc','40',{ width: 1280, height: 720 },1 / 3], ['mobile','41',{ width: 375, height: 715 },1 / 2],
    ]) {
      const page = await browser.newPage({ viewport });
      try {
        for (const number of [1, 2]) {
          const nodeId = prefix + ':' + (number + 1);
          const path = end + '-' + number + '.png';
          const style = (x, y, width, height) => 'position:absolute;left:' + x * scale + 'px;top:' + y * scale
            + 'px;width:' + width * scale + 'px;height:' + height * scale + 'px';
          const content = number === 1
            ? '<button style="' + style(100, 475, 260, 100) + ';display:grid;font-size:' + (viewport.width / 19.2) + 'px">下一屏</button>'
            : [100, 280].map((x) => '<span style="' + style(x, 90, 150, 60) + '">首页</span>').join('');
          await page.setContent('<!doctype html><meta charset="utf-8"><style>@font-face{font-family:oracle;src:url(data:font/otf;base64,'
            + font + ')}*{box-sizing:border-box}body{background:white;margin:0;font:' + 24 * scale + 'px oracle}</style>' + content);
          await page.evaluate(() => document.fonts.ready);
          const bytes = await page.screenshot();
          writeFileSync(join(directory, path), bytes);
          const button = meta.nodes.find((row) => row.end === end && row.nodeId === prefix + ':13');
          const local = number === 1 ? [{ domId: button.domId, region: [Math.floor(100 * scale), Math.floor(475 * scale),
            Math.ceil(360 * scale) - Math.floor(100 * scale), Math.ceil(575 * scale) - Math.floor(475 * scale)] }] : [];
          screens.push({ end, nodeId, path, viewport, local, sha256: byteDigest(bytes) });
        }
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
  const index = { schema: 'onepage-pixel-reference/v1', baseLanguage: meta.baseLanguage, scopeVersion: meta.scopeVersion,
    b3Digest: meta.b3.digest, screens };
  const path = join(directory, 'index.json');
  const bytes = Buffer.from(JSON.stringify(index));
  writeFileSync(path, bytes);
  return { directory, index, path, digest: byteDigest(bytes) };
}

test('C3 Chromium：独立双端参考正式签发、移走来源后验包，并阻断漏图与错图',
  { skip: process.env.ONEPAGE_C3_BROWSER !== '1', timeout: compositeCaseMs }, async (context) => {
    const { root, options } = await inputs(context, { platform: 'pc+mobile', config: {
      bindings: { 'sec/1::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励列表', perPage: 2 } },
        'sec/2::list/导航槽': { slotMapping: { kind: 'key', field: 'id', keys: ['home','shop'] }, missing: 'design-default' } },
      actions: { nextCard: { type:'next-page', targets:['switch/轮播'] }, previousCard: { type:'previous-page', targets:['switch/轮播'] } },
    }, mutateDocument(document) {
      document.children = ['pc','mobile'].map((end, index) => {
        const prefix = String(40 + index) + ':';
        const box = (x, y, width, height) => ({ absoluteBoundingBox: { x, y, width, height } });
        const text = (id, caption, name, x, y) => frame(prefix + id, name, [], { ...box(x,y,150,60), type: 'TEXT',
          characters: caption, style: { fontFamily: 'One Page Fixture', fontWeight: 400, fontSize: 24 } });
        const list = frame(prefix + '5', 'list/奖励列表@data=list:rewards', [frame(prefix + '6', 'item/条目@template', [
          text('7','金币','名称@field=name',100,200),
        ], box(100,200,200,100))], { ...box(100,200,500,200), layoutMode: 'HORIZONTAL' });
        const slots = frame(prefix + '8', 'list/导航槽@data=slots:navs', [
          frame(prefix + '9', 'item/首槽', [text('10','首页','名称@field=label',100,2250)], box(100,2250,180,80)),
          frame(prefix + '11', 'item/次槽', [text('12','首页','名称@field=label',320,2250)], box(320,2250,180,80)),
        ], { ...box(100,2250,500,180), layoutMode: 'HORIZONTAL' });
        const width = end === 'pc' ? 3840 : 750;
        const height = end === 'pc' ? 2160 : 1430;
        return frame(prefix + '1', 'cn_' + end, [frame(prefix + '2','sec/1-首页', [frame(prefix + '4','switch/轮播',[list], box(100,200,500,200)),
          frame(prefix + '14','btn/前一页@action=previousCard', [], box(410,850,150,80)),
          frame(prefix + '15','btn/后一页@action=nextCard', [], box(580,850,150,80)),
          frame(prefix + '13','btn/下一屏@sec=2', [], box(100,475,260,100))], box(0,0,width,height)),
          frame(prefix + '3','sec/2-导航',[slots], box(0,2160,width,height))]);
      });
    } });
    const product = runCGenerate(options);
    assert.ok(product.ok, JSON.stringify(product));
    const out = join(root, 'checks');
    mkdirSync(out);
    const references = await compositeReferences(root, json(join(product.pack, 'c2-build-meta.json')));
    const contractPath = join(root, 'consumer-contract.json');
    writeFileSync(contractPath, JSON.stringify(HANDOFF_CONSUMER));
    const args = ['--pack', product.pack, '--expect-version', product.version, '--scope-version', product.scopeVersion,
      '--out', out, '--handoff-pack', options.pack, '--consumer-contract', contractPath, '--references', references.path];
    const cli = new URL('../bin/c-check.mjs', import.meta.url).pathname;
    const run = (stage, digest) => measureStage('C3 c-check CLI: ' + stage, async () => {
      try {
        const { stdout } = await promisify(execFile)(process.execPath, [cli, ...args, '--references-sha256', digest],
          { maxBuffer: 8 * 1024 * 1024, timeout: checkCliMs, killSignal: 'SIGKILL', signal: context.signal });
        return { exit: 0, result: JSON.parse(stdout) };
      } catch (error) { if (error.code !== 1 || !error.stdout?.length) throw error; return { exit: error.code, result: JSON.parse(error.stdout) }; }
    });
    const issued = await run('issue',references.digest);
    const checked = issued.result;
    const report = json(join(checked.rounds[0].root, 'check-report.json'));
    const lists = report.findings.filter((row) => row.check === 'D09' && row.target.includes(':presentation:'));
    assert.ok(lists.some((row) => row.detail.count === 0 && row.detail.active === 0), JSON.stringify(report.findings.filter((row) => row.status !== 'pass')));
    assert.ok(lists.some((row) => row.detail.pageCount > 1));
    assert.ok(lists.every((row) => row.status === 'pass'), JSON.stringify(lists.filter((row) => row.status !== 'pass')));
    const gestures = report.findings.filter((row) => row.check === 'D08' && row.target.includes(':touch:'));
    assert.ok(new Set(gestures.map((row) => row.target.split(':')[0])).size >= 2);
    assert.ok(gestures.every((row) => row.status === 'pass'), JSON.stringify(gestures.filter((row) => row.status !== 'pass')));
    const dragClicks = report.findings.filter((row) => row.check === 'D08' && row.target.includes(':drag-click:'));
    assert.equal(dragClicks.length, gestures.length);
    assert.ok(dragClicks.every((row) => row.status === 'pass'), JSON.stringify(dragClicks.filter((row) => row.status !== 'pass')));
    const clicks = report.findings.filter((row) => row.target.endsWith(':pagination-action'));
    assert.equal(new Set(clicks.map((row) => row.detail.actionId)).size, 4, JSON.stringify(clicks));
    assert.ok(clicks.every((row) => row.status === 'pass' && row.detail.sampleId !== '@initial' && row.detail.pages > 1), JSON.stringify(clicks.filter((row) => row.status !== 'pass' || row.detail.sampleId === '@initial')));
    assert.equal(issued.exit, 0, JSON.stringify(report.findings.filter((row) => !['pass','n_a'].includes(row.status))));
    assert.equal(report.coverage.D13.status, 'pass');
    assert.ok(report.findings.some((row) => row.check === 'D11' && row.target === 'video-stub-lifecycle' && row.status === 'pass'));
    const archive = (directory, name) => {
      if (process.env.ONEPAGE_C3_ARTIFACT_ROOT) cpSync(directory, join(process.env.ONEPAGE_C3_ARTIFACT_ROOT, name),
        { recursive: true, force: false, errorOnExist: true });
    };
    archive(checked.rounds[0].root, 'dual-composite');
    archive(references.directory, 'independent-references');
    const first = references.index.screens.shift();
    const correctPng = readFileSync(join(references.directory, first.path));
    const writeIndex = () => {
      const bytes = Buffer.from(JSON.stringify(references.index));
      writeFileSync(references.path, bytes);
      return byteDigest(bytes);
    };
    const missing = await run('missing reference',writeIndex());
    assert.equal(missing.exit, 1);
    assert.ok(missing.result.rounds[0].findings.some((row) => row.check === 'D04' && row.status === 'not_run'));
    archive(missing.result.rounds[0].root, 'composite-missing-reference');
    const wrongPng = execFileSync('python3', ['-B','-c','from PIL import Image; import sys; Image.new("RGB",(1280,720),"black").save(sys.stdout.buffer,"PNG")']);
    writeFileSync(join(references.directory, first.path), wrongPng);
    references.index.screens.unshift({ ...first, sha256: byteDigest(wrongPng) });
    const wrong = await run('wrong reference',writeIndex());
    assert.equal(wrong.exit, 1);
    assert.ok(wrong.result.rounds[0].findings.some((row) => row.check === 'D04' && row.status === 'fail'));
    archive(wrong.result.rounds[0].root, 'composite-wrong-reference');
    references.index.screens[0] = first;
    writeFileSync(join(references.directory, first.path), correctPng);
    const brokenPack = join(root, 'broken-paging');
    cpSync(product.pack, brokenPack, { recursive:true });
    const script = 'page/js/main.js';
    const runtime = readFileSync(join(brokenPack, script), 'utf8');
    const broken = Buffer.from(runtime.replace("case 'next-page': case 'previous-page': targets.forEach", "case 'next-page': break; case 'previous-page': targets.forEach"));
    assert.notEqual(broken.toString(), runtime);
    const metaPath = join(brokenPack,'c2-build-meta.json');
    const { version: before, ...body } = json(metaPath);
    assert.equal(before, product.version);
    body.files[script] = { bytes:broken.length, sha256:byteDigest(broken) };
    const version = sha256Hex(body);
    const metadata = Buffer.from(JSON.stringify({ ...body,version }));
    const stagePath = join(brokenPack,'stage-record.json');
    const stage = json(stagePath);
    writeFileSync(join(brokenPack,script),broken);
    writeFileSync(metaPath,metadata);
    writeFileSync(stagePath,JSON.stringify(buildStageRecord({ ...stage, output:{ ...stage.output,version,digest:byteDigest(metadata) } })));
    const brokenResult = await runCCheck({ pack:brokenPack, expectVersion:version, scopeVersion:product.scopeVersion, out,
      handoffPack:options.pack, consumerContract:HANDOFF_CONSUMER,
      references:references.path, referencesSha256:writeIndex() });
    const badReport = json(join(brokenResult.rounds[0].root,'check-report.json'));
    const ids = body.nodes.filter((row) => ['40:15','41:15'].includes(row.nodeId)).map((row) => row.domId);
    for (const actionId of ids) {
      assert.ok(badReport.findings.some((row) => row.detail?.actionId === actionId && row.target.endsWith(':pagination-hidden') && row.status === 'pass'));
      assert.ok(badReport.findings.some((row) => row.detail?.actionId === actionId && row.target.endsWith(':pagination-action') && row.status === 'fail'
        && row.detail.steps[0].hit.ok));
    }
    assert.ok(badReport.findings.some((row) => row.target.includes(':touch:') && row.status === 'pass'));
    assert.equal(badReport.coverage.D04.status, 'pass');
    assert.equal(badReport.coverage.D13.status, 'fail');
    archive(brokenResult.rounds[0].root, 'composite-broken-pagination');
    const migrated = join(root, 'received');
    mkdirSync(migrated);
    const evidence = join(migrated, 'evidence');
    const pagePack = join(migrated, 'page-pack');
    cpSync(checked.rounds[0].root, evidence, { recursive: true });
    cpSync(product.pack, pagePack, { recursive: true });
    for (const path of [options.pack, options.assetsPack, options.runDir, references.directory, out]) rmSync(path, { recursive: true, force: true });
    const entry = checkEntry(join(evidence, 'stage-record.json'), { expectedStage: 'C', expectedOutputKind: 'c-single-page',
      expectedOutputVersion: report.version, scopeVersion: product.scopeVersion, pageVersion: product.version, pagePack });
    assert.equal(entry.ok, true, JSON.stringify(entry));
  });

test('P1：基础语 TAB 仍需映射，外语 TAB 及外语固定根的子树不进入 C2', async (context) => {
  const fixture = tabFixture();
  const inventory = fixture.inventories.pc;
  const mainTab = inventory.nodes.find(({id})=>id==='1:3');
  const mainRelation = inventory.relations.find((row)=>row.kind==='tab' && row.from.id==='1:3');
  inventory.nodes.push({ ...mainTab, id:'1:31', langs:['en'] },
    { id:'1:32', scope:'page', parentId:'1:2', role:'grp', status:'determined', langs:['en'] },
    { ...mainTab, id:'1:33', parentId:'1:32' },
    { id:'1:34', scope:'page', parentId:'1:1', role:'fix', status:'determined', langs:['en'] },
    { id:'1:35', scope:'page', parentId:'1:34', role:'btn', status:'determined', label:'ForeignAction', action:{type:'next-section'} },
    { id:'1:36', scope:'page', parentId:'1:34', role:'copy', status:'determined', text:{characters:'ForeignCopy'} },
    { id:'1:37', scope:'page', parentId:'1:34', role:'img', status:'determined' });
  for (const id of ['1:31','1:33']) inventory.relations.push({ ...mainRelation, from:{id,scope:'page'} });
  fixture.manifest.assets.push({end:'pc',nodeId:'1:37',path:'assets/foreign.svg',width:8,height:8});
  const {questions,faults}=inspectC2Contract(fixture.inventories,undefined,{fileVersion:version,baseLanguage:'cn'});
  assert.deepEqual(faults,[]);
  assert.deepEqual(questions.map((card)=>card.locations[0].nodeId),['1:3','1:4']);
  assert.throws(()=>buildPage({...fixture,tabDeclarations:[fixture.tabDeclarations[0]]}),/缺失或歧义/);
  const built=buildPage(fixture);
  assert.deepEqual(built.trace.tabBindings.map(({tab})=>tab.id),['1:3','1:4']);
  assert.ok(!built.trace.nodes.some(({nodeId})=>/^1:3[1-7]$/.test(nodeId)));
  assert.doesNotMatch(built.files['cn.html'],/ForeignAction|ForeignCopy|assets\/foreign.svg/);

  const settings = productionSettings('same');
  const mutate = settings.mutateDocument;
  settings.mutateDocument = (document) => {
    mutate(document);
    const page = document.children[0];
    page.children[0].children.push(frame('15:2','btn/ForeignGroup@sec=1@lang=en',[frame('15:3','tab/InheritedTab@for=switch/展示')]));
    page.children.push(frame('15:4','btn/ForeignRoot@sec=1@lang=en',[
      frame('15:6','ForeignCopy',[],{type:'TEXT',characters:'首页',style:{fontFamily:'One Page Fixture',fontWeight:400}}),
      frame('15:7','img/ForeignAsset',[frame('15:8','shape',[],{type:'VECTOR',fills:[{type:'SOLID'}]})]),
    ]));
  };
  const missing = structuredClone(settings.config);
  missing.dataContract.c2.tabs.pop();
  const blocked = await golden(context,{...settings,config:missing,b2Blocked:true});
  assert.equal(blocked.b2.result,'needs-input');
  assert.deepEqual(blocked.b2.questions.filter((card)=>card.type==='tab-panel').map((card)=>card.locations[0].nodeId),['10:11']);
  const { root, options } = await inputs(context,settings);
  const result=generateCli(root,options);
  const meta=json(join(result.pack,'c2-build-meta.json'));
  assert.deepEqual(meta.tabBindings.map(({tab})=>tab.id),['10:10','10:11']);
  assert.ok(!meta.nodes.some(({nodeId})=>nodeId.startsWith('15:')));
  const html=readFileSync(join(result.pack,'page/cn.html'),'utf8');
  assert.doesNotMatch(html,/InheritedTab|ForeignGroup|ForeignRoot/);
  assert.equal((html.match(/首页<\/span>/g)??[]).length,1);
  const assets=json(join(result.pack,'page/assets/manifest.json'));
  assert.ok(!assets.assets.some(({nodeId})=>nodeId==='15:7'));
});

test('P1：旧 fileVersion 重新发卡，拒旧卡及坏答，分两次答复后正式出页', async (context) => {
  const settings=productionSettings('same');
  const current = structuredClone(settings.config.dataContract.c2);
  settings.config.dataContract.c2.fileVersion = '12344';
  settings.config.dataContract.c2.tabs[0].source = 'OLD_MUST_NOT_REVIVE';
  settings.config.dataContract.c2.componentInputs[0].source = 'OLD_MUST_NOT_REVIVE';
  settings.answerCurrent = async ({b2,config,b2Options,root}) => {
    assert.equal(b2.result,'needs-input');
    const original=readFileSync(config);
    const cards=b2.questions.filter((card)=>['tab-panel','component-input'].includes(card.type));
    assert.equal(cards.length,3);
    assert.ok(cards.every((card)=>card.fileVersion===version));
    const values=(card)=>{
      if(card.type==='tab-panel') {
        const {panelId,source,selection}=current.tabs.find(({tabId})=>tabId===card.locations[0].nodeId);
        return {panelId,source,selection};
      }
      const {receiver,valueShape,valueTypes,source}=current.componentInputs[0];
      return {receiver,valueShape,valueTypes,source};
    };
    const answer=(card,value=values(card),fingerprint=card.fingerprint)=>({id:card.id,fingerprint,value});
    const submit=async (answers)=>{
      const path=join(root,'versioned-answers.json');
      writeFileSync(path,JSON.stringify({answers}));
      return runBAnswer({...b2Options,answers:path});
    };
    const [first,second]=cards;
    const {id,fingerprint,...cardBody}=first;
    const oldFingerprint=sha256Hex({...cardBody,fileVersion:'12344'});
    const stale=await submit([answer(first,values(first),oldFingerprint)]);
    assert.match(stale.message,/过期/);
    assert.deepEqual(readFileSync(config),original);
    const invalid=await submit([answer(first),answer(second,{...values(second),panelId:values(first).panelId})]);
    assert.match(invalid.message,/冲突/);
    assert.deepEqual(readFileSync(config),original);
    const partial=await submit([answer(first)]);
    assert.equal(partial.result,'needs-input');
    const afterFirst=json(config).dataContract.c2;
    assert.equal(afterFirst.fileVersion,version);
    assert.equal(afterFirst.tabs.length,1);
    assert.deepEqual(afterFirst.componentInputs,[]);
    assert.equal(partial.questions.filter((card)=>['tab-panel','component-input'].includes(card.type)).length,2);
    return submit(partial.questions.map((card)=>answer(card)));
  };
  const {root,options}=await inputs(context,settings);
  const result=generateCli(root,options);
  const trace=json(join(result.pack,'c2-build-meta.json'));
  assert.deepEqual(trace.tabBindings.map(({tab,panel})=>[tab.id,panel.id]),[['10:10','10:14'],['10:11','10:13']]);
  assert.equal(trace.componentInputs[0].source,current.componentInputs[0].source);
  assert.doesNotMatch(JSON.stringify(trace),/OLD_MUST_NOT_REVIVE/);
});

test('P1 范围变化：同一 fileVersion 的 cn 声明不得进入 en；新卡分轮合并后出页', async (context) => {
  let previous;
  let previousCards;
  const before = productionSettings('same');
  const declarations = structuredClone(before.config.dataContract.c2);
  delete before.config.dataContract;
  const valueOf = (card, source) => {
    const nodeId = card.locations[0].nodeId;
    if (card.type === 'tab-panel') {
      const {panelId,selection}=declarations.tabs.find((row)=>row.tabId===nodeId);
      return {panelId,selection,source};
    }
    const {receiver,valueShape,valueTypes}=declarations.componentInputs.find((row)=>row.nodeId===nodeId);
    return {receiver,valueShape,valueTypes,source};
  };
  const answers = (cards, source) => ({ answers:cards.map((card)=>({ id:card.id,fingerprint:card.fingerprint,value:valueOf(card,source) })) });
  before.answerCurrent = async ({b2,config,b2Options,confirmedScope}) => {
    previousCards = b2.questions;
    assert.equal(previousCards.length,3);
    assert.ok(previousCards.every((card)=>card.scopeVersion===confirmedScope.scopeVersion));
    const result = await runBAnswer({...b2Options,answersValue:answers(previousCards,'OLD_CN_SCOPE')});
    assert.equal(result.result,'pass',JSON.stringify(result));
    previous = json(config).dataContract.c2;
    return result;
  };
  const cn = await inputs(context,before);
  assert.equal(generateCli(cn.root,cn.options).ok,true);
  const after = {...productionSettings('same'),baseLanguage:'en'};
  after.prepareConfig = (project) => { project.dataContract.c2 = structuredClone(previous); };
  after.answerCurrent = async ({b2,config,b2Options,confirmedScope}) => {
    assert.equal(previous.fileVersion,confirmedScope.fileVersion);
    assert.notEqual(previous.scopeVersion,confirmedScope.scopeVersion);
    assert.equal(b2.result,'needs-input',JSON.stringify(b2));
    assert.equal(b2.questions.length,3);
    assert.ok(b2.questions.every((card)=>card.scopeVersion===confirmedScope.scopeVersion));
    const original=readFileSync(config);
    const stale=await runBAnswer({...b2Options,answersValue:answers(previousCards,'OLD_CN_SCOPE')});
    assert.match(stale.message,/过期/);
    assert.deepEqual(readFileSync(config),original);
    const partial=await runBAnswer({...b2Options,answersValue:answers([b2.questions[0]],'EN_SCOPE')});
    assert.equal(partial.result,'needs-input');
    assert.equal(partial.questions.length,2);
    const first = json(config).dataContract.c2;
    assert.equal(first.scopeVersion,confirmedScope.scopeVersion);
    assert.equal(first.tabs.length + first.componentInputs.length,1);
    assert.doesNotMatch(JSON.stringify(first),/OLD_CN_SCOPE/);
    return runBAnswer({...b2Options,answersValue:answers(partial.questions,'EN_SCOPE')});
  };
  const en=await inputs(context,after);
  const result=generateCli(en.root,en.options);
  const trace=json(join(result.pack,'c2-build-meta.json'));
  assert.equal(trace.baseLanguage,'en');
  assert.equal(trace.tabBindings.length,2);
  assert.equal(trace.componentInputs.length,1);
  assert.ok([...trace.tabBindings,...trace.componentInputs].every((item)=>item.source==='EN_SCOPE'));
});

test('P2 范围变化：无活动对象时只清理过期声明，同范围错误仍阻断', async (context) => {
  const old=productionSettings('same').config.dataContract.c2;
  for (const legacy of [false,true]) {
    const {root,options}=await inputs(context,{prepareConfig(project,scope){
      const historical=structuredClone(old);
      if (!legacy) historical.scopeVersion=computeScopeVersion({...scope,baseLanguage:'en'});
      project.dataContract={c2:historical};
    },answerCurrent({b2,config}){
      assert.equal(b2.result,'pass',JSON.stringify(b2));
      assert.equal(b2.questions.length,0);
      assert.equal(json(config).dataContract?.c2,undefined);
      return b2;
    }});
    assert.equal(json(join(options.pack,'production/data-contract.json')).c2,undefined);
    assert.equal(generateCli(root,options).ok,true);
  }
  for (const problem of ['current-rows','current-mismatch','malformed']) {
    const {b2,config}=await golden(context,{b2Blocked:true,prepareConfig(project,scope){
      const current={...structuredClone(old),scopeVersion:scope.scopeVersion};
      if (problem==='current-mismatch') current.fileVersion='12344';
      if (problem==='malformed') current.tabs=null;
      project.dataContract={c2:current};
    }});
    assert.equal(b2.result,'needs-input');
    assert.ok(b2.problems.some((item)=>item.code==='C2_DECLARATION'));
    assert.ok(Object.hasOwn(json(config).dataContract,'c2'));
  }
  const active=productionSettings('same');
  active.prepareConfig=(project)=>{project.dataContract.c2.tabs=[];};
  const {b2}=await golden(context,{...active,b2Blocked:true});
  assert.equal(b2.result,'needs-input');
  assert.equal(b2.questions.filter((card)=>card.type==='tab-panel').length,2);
});

test('C1 自身字节齐全但选中素材指纹不对应 B3 时 C2 阻断', async (context) => {
  const { options } = await inputs(context, productionSettings('same'));
  const manifestPath = join(options.assetsPack,'assets/manifest.json');
  const stagePath = join(options.assetsPack,'stage-record.json');
  const { version: previous, ...body } = json(manifestPath);
  assert.equal(previous,options.assetsVersion);
  body.assets.find((item)=>item.nodeId==='10:20').visualFingerprint='0'.repeat(64);
  const version = sha256Hex(body);
  const bytes = Buffer.from(JSON.stringify({...body,version}));
  const digest = byteDigest(bytes);
  const stage = json(stagePath);
  writeFileSync(manifestPath,bytes);
  writeFileSync(stagePath,JSON.stringify(buildStageRecord({...stage,output:{...stage.output,version,digest}})));
  assert.equal(checkEntry(stagePath,{expectedOutputKind:'c-assets',expectedStage:'C',expectedOutputVersion:version,scopeVersion:options.scopeVersion}).ok,true);
  const result = runCGenerate({...options,assetsVersion:version,assetsSha256:digest});
  assert.equal(result.ok,false);
  assert.match(result.message,/导出计划/);
  assert.throws(()=>readdirSync(options.runDir),{code:'ENOENT'});
});

test('占用发布锁不是本次运行的事务，拒写且保留；释放后允许重新出包', async (context) => {
  const { options } = await inputs(context);
  const lock = join(options.runDir, '.c2-lock');
  mkdirSync(lock, { recursive:true });
  assert.equal(runCGenerate(options).ok, false);
  assert.deepEqual(readdirSync(options.runDir), ['.c2-lock']);
  rmSync(lock, { recursive:true });
  const result = runCGenerate(options);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(readdirSync(options.runDir), ['c2.r1']);
});

function browserFixture(runtime, configPath) {
  const card = '<template data-item-template><article id="item" data-carousel-item><span id="name">default</span><button id="link" data-action>Visit</button></article></template>';
  const section = (end, list) => {
    const tap = (id) => '<button data-action id="' + end + id + '">' + id + '</button>';
    return '<div data-device="' + end + '"><section data-screen="1" id="' + end + 'home"><h1 data-slogan>Static</h1>'
      + '<img data-src="/' + end + '-hero" data-hero-background alt=""><div data-hero-video hidden></div>' + tap('next') + '</section>'
      + '<section data-screen="2" id="' + end + 'second">' + tap('home-button') + tap('open') + tap('outside') + tap('language') + tap('social')
      + '<input id="' + end + 'input"><textarea></textarea><div contenteditable="true"><span>editable</span></div><button data-copy>Copy</button>'
      + '<div id="' + end + 'slots" data-node-key="slot-fixture"><span id="' + end + 'slot-text">old</span></div><div id="' + end + 'cover"><img data-src="/fallback" alt=""></div>'
      + '<div id="' + end + 'modal" role="dialog" data-overlay data-dismiss-backdrop hidden inert tabindex="-1">'
      + '<div data-overlay-content>' + tap('close') + '</div></div>'
      + '<div id="' + end + 'carousel" data-carousel="cards"><div class="test-list" id="' + end + 'list" data-node-key="data-list">' + list + '</div>'
      + '<span data-empty-for="' + end + 'list">Empty</span><span data-pager-for="' + end + 'carousel">01/01</span>'
      + '<div data-ind-for="' + end + 'carousel"></div>' + tap('advance') + tap('previous') + '</div>'
      + '<div data-carousel="panels" id="' + end + 'panels"><div id="' + end + 'first-card" data-item-key="first">first</div>'
      + '<div id="' + end + 'second-card" data-item-key="second">second</div>' + tap('advance-panels') + '</div></section></div>';
  };
  const markup = ['pc', 'mobile'].map((end) => section(end, card.replace(/id="/g, 'id="' + end))).join('');
  return '<!doctype html><html class="no-js"><head><link rel="stylesheet" href="/css/styles.css"><style>.test-list{display:flex;gap:8px;width:240px;min-height:60px}.test-list article{width:100px}section{height:100vh}</style><script src="' + configPath
    + '" defer></script><script src="' + runtime + '" defer></script></head><body>' + markup
    + '<div id="page-footer" hidden></div><output id="site-status" role="status"></output></body></html>';
}

function browserConfig(origin) {
  return 'window.fixtureVideoCalls=0;window.fixtureLinks=[];window.open=(...args)=>fixtureLinks.push(args);'
    + 'window.fixtureVideoPlays=0;window.createBackgroundVideo=(mount,{src})=>{fixtureVideoCalls++;return {async play(){fixtureVideoPlays++;if(fixtureVideoPlays===1)await fetch(src);if(location.search.includes("video-fail"))throw Error("play");mount.dispatchEvent(new Event("playing"));},pause(){}}};'
    + 'window.OnePageConfig=' + JSON.stringify(['pc','mobile'].reduce((config, end) => {
      const action = (type, ...targets) => ({ type, targets });
      Object.assign(config.actions, { [end+'next']: action('next-section'), [end+'home-button']: action('go-section', end+'home'),
        [end+'open']: action('open-modal', end+'modal'), [end+'close']: action('close-modal', end+'modal'),
        [end+'outside']: { ...action('open-link'), key:'valid' }, [end+'link']: { ...action('open-link'), key:'invalid' },
        [end+'language']: { ...action('open-link'), key:'lang-link' }, [end+'social']: { ...action('open-link'), key:'social-link' },
        [end+'advance']: action('next-page', end+'carousel'), [end+'previous']: action('previous-page', end+'carousel'),
        [end+'advance-panels']: action('next-page', end+'panels') });
      Object.assign(config.bindings, { [end+'carousel']: { pagination:{ list:end+'list', perPage:end === 'pc' ? 1 : 2 } },
        [end+'cover']: { fields:{field:{target:'image',path:['cover']}} },
        [end+'slots']: { data:{kind:'slots',path:['slots'],slots:[end+'slot-text'],missing:'pending'} },
        [end+'slot-text']: {fields:{field:{target:'text',path:['slots',{slotOf:'slot-fixture',index:0},'name']}}},
        [end+'list']: { data:{ kind:'list', path:['rows'] } }, [end+'name']: { fields:{ field:{ target:'text', path:['rows',{ itemOf:'data-list' },'name'] } } },
        [end+'link']: { fields:{ field:{ target:'link', path:['rows',{ itemOf:'data-list' },'url'] } } },
        [end+'panels']: { pagination:{ panels:[end+'first-card',end+'second-card'] } } });
      return config;
    }, { language:'en', bindings:{}, actions:{}, links:{ valid:origin+'/local', invalid:'javascript:void(0)', 'lang-link':null, 'social-link':null },
      languageUrls:{'lang-link':origin+'/other-language'}, social:{'social-link':{url:origin+'/social',platform:'site'}},
      dataUrl:null, components:{ backgroundVideo:{ src:origin+'/movie', options:{} } } }))
    + ';const testCase=new URL(location.href).searchParams.get("mode");OnePageConfig.dataUrl=testCase?location.origin+"/api/"+testCase:null;';
}

function callBrowser(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio:['pipe','pipe','pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout + stderr) : reject(new Error(stdout + '\n' + stderr)));
    child.stdin.end(script);
  });
}

test('浏览器实跑：生成的反序 TAB，以及独立运行时夹具的切屏、轮播、弹层、数据、保护与端切换',
  { skip: process.env.ONEPAGE_C2_BROWSER !== '1' && '使用 ONEPAGE_C2_BROWSER=1 与已安装的 ego-browser 运行', timeout: browserCaseMs }, async (context) => {
    const { files } = buildPage(tabFixture());
    const pages = Object.fromEntries([['pc',['pc']],['mobile',['mobile']],['dual',['pc','mobile']]].map(([name, ends]) => [name,
      buildPage({baseLanguage:'cn',ends,inventories:Object.fromEntries(ends.map((end)=>[end,variantFixture(end)])),manifest:{assets:[],fonts:[]},pairing:{}}).files]));
    for (const mode of ['same','different']) pages[mode] = buildPage(tabFixture(mode)).files;
    const shipped = {};
    for (const mode of ['same','different']) {
      const { root, options } = await inputs(context, productionSettings(mode));
      const result = generateCli(root, options);
      const meta = json(join(result.pack,'c2-build-meta.json'));
      shipped[mode] = Object.fromEntries(Object.keys(meta.files).map((path) => [path.slice(5),readFileSync(join(result.pack,path))]));
    }
    {
      const { root, options } = await inputs(context, layoutSettings());
      const result = generateCli(root, options);
      const meta = json(join(result.pack,'c2-build-meta.json'));
      shipped.layout = Object.fromEntries(Object.keys(meta.files).map((path)=>[path.slice(5),readFileSync(join(result.pack,path))]));
    }
    const requests = [];
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      requests.push(request.url);
      if (['/pc-hero','/mobile-hero','/fallback','/pixel'].includes(path)) {
        response.setHeader('content-type','image/svg+xml'); response.end(vector); return;
      }
      if (path === '/movie') { response.end(); return; }
      const published = /^\/(published-same|published-different|published-layout)\/(.+)$/.exec(path);
      if (published) {
        const [,prefix,file] = published;
        const content = shipped[prefix.slice(10)][file];
        response.statusCode = content ? 200 : 404;
        response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml'
          : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
        if (file === 'js/config.js') {
          const value = request.headers.referer?.includes('bad=1') ? 'bad' : 'ok';
          const social = prefix==='published-layout' ? '\nOnePageConfig.social["fixture-social"]={url:' + JSON.stringify(origin+'/social') + '};' : '';
          response.end(content + '\nOnePageConfig.dataUrl=' + JSON.stringify(origin+'/component/'+value) + ';' + social);
        } else response.end(content);
        return;
      }
      if (path.startsWith('/component/')) {
        response.setHeader('content-type','application/json');
        response.end(JSON.stringify({score:path.endsWith('/bad') ? {score:0} : '<b>actual</b>'}));
        return;
      }
      if (path === '/config.js') { response.setHeader('content-type','text/javascript'); response.end(browserConfig(origin)); return; }
      if (path === '/runtime' || path === '/static') {
        if (path === '/static') response.setHeader('content-security-policy','script-src \'none\'');
        response.setHeader('content-type','text/html'); response.end(browserFixture('/js/main.js', '/config.js')); return;
      }
      if (path.startsWith('/api/')) {
        const mode = path.split('/').at(-1);
        response.statusCode = mode === 'missing' ? 404 : mode === 'error' ? 503 : 200;
        response.setHeader('content-type','application/json');
        const body = JSON.stringify({ cover:origin+'/broken-cover',slots:[{name:'fixed-slot'}],rows: Array.from({ length: mode === 'empty' ? 0 : mode === 'one' ? 1 : 3 }, (_, index) => ({
          name: index === 0 ? '<b>literal</b>' : String(index), url: index === 0 ? 'javascript:void(0)' : origin+'/local',
        })) });
        if (mode === 'loading') setTimeout(() => response.end(body), 600);
        else response.end(body);
        return;
      }
      const variant = /^\/(pc|mobile|dual|same|different)\/(.+)$/.exec(path);
      const content = variant ? pages[variant[1]][variant[2]] : files[path.slice(1)];
      response.statusCode = content ? 200 : 404;
      response.setHeader('content-type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(content);
    });
    server.listen(0, '127.0.0.1');
    context.after(() => {
      server.close();
      server.closeAllConnections();
    });
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    const output = await callBrowser('const origin=' + JSON.stringify(origin) + ';\n' + browserAssertions.toString() + '\nawait browserAssertions(origin);');
    context.diagnostic(output.trim());
    const space = Number(/SPACE=(\d+)/.exec(output)?.[1]);
    assert.ok(space > 0 && output.includes('C2_BROWSER_PASS'), JSON.stringify(output));
    assert.equal(requests.filter((path) => path.startsWith('/api/multi?')).length, 1);
    assert.ok(requests.some((path) => /\/api\/multi\?_t=\d+/.test(path)));
    assert.ok(requests.indexOf('/pc-hero') < requests.indexOf('/broken-cover') && requests.indexOf('/broken-cover') < requests.indexOf('/fallback'));
    await callBrowser('const task=await taskSpace(' + space + ');await task.finish({keep:[]});');
  });

async function browserAssertions(origin) {
  const task = await taskSpace('One Page #175 C2 Runtime');
  const page = task.page('p1');
  console.log('SPACE=' + task.spaceId);
  const assert = (value, why) => { if (!value) throw new Error(why); };
  const viewport = (width,height = 760) => page.cdp('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
  await viewport(1025);
  await page.cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await page.goto(origin + '/cn.html');
  await page.waitForSelector('[aria-selected="true"]');
  assert(await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    const first = panels[0].hidden && !panels[1].hidden && tabs[0].getAttribute('aria-controls') === panels[1].id;
    tabs[1].click();
    return first && !panels[0].hidden && panels[1].hidden && panels[1].inert && tabs[1].getAttribute('aria-selected') === 'true';
  }), '反序的显式 TAB 目标行为不正确');
  for (const mode of ['same','different']) {
    await page.goto(origin + '/' + mode + '/cn.html');
    assert(await page.evaluate((mode) => {
      const [first,next] = document.querySelectorAll('[role="tab"]');
      const art = next.querySelector('[data-selected-art]');
      if (first.querySelector('[data-selected-art]').getAnimations().length) return false;
      next.click();
      const animations = art.getAnimations().length;
      next.click();
      return next.getAttribute('aria-selected') === 'true' && getComputedStyle(art).opacity === '1'
        && animations === (mode === 'same' ? 1 : 0) && art.getAnimations().length === animations;
    },mode), '同图滑动、异图换图或重复点击行为异常：' + mode);
  }
  for (const mode of ['same','different']) {
    await page.goto(origin + '/published-' + mode + '/cn.html');
    await page.waitForFunction(() => document.documentElement.dataset.dataState === 'ready');
    assert(await page.evaluate((mode) => {
      const [first,next] = document.querySelectorAll('[role="tab"]');
      const [original,other] = document.querySelectorAll('[role="tabpanel"]');
      const nextArt = next.querySelector('[data-selected-art]');
      const reverse = first.getAttribute('aria-controls')===other.id && next.getAttribute('aria-controls')===original.id && original.hidden;
      next.click();
      const target = [...document.querySelectorAll('.module')].find((node) => node.textContent === '<b>actual</b>');
      const trigger = document.querySelector('.menu-toggle');
      const overlay = document.getElementById(trigger.getAttribute('aria-controls'));
      trigger.click();
      const menu = trigger.getAttribute('aria-expanded') === 'true' && !overlay.hidden && document.activeElement === overlay;
      overlay.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      return reverse && !original.hidden && other.inert && nextArt.getAnimations().length === (mode==='same'?1:0)
        && !!target && !target.children.length && menu && overlay.inert && document.activeElement===trigger;
    },mode),'发布链 TAB / 素材 / 组件字段行为异常：'+mode);
  }
  await page.goto(origin + '/published-same/cn.html?bad=1');
  await page.waitForFunction(() => document.documentElement.dataset.dataState === 'unavailable');
  assert(await page.evaluate(() => !document.body.textContent.includes('[object Object]')), '坏形状不得投递到组件');
  await viewport(2560,720);
  await page.goto(origin + '/published-layout/cn.html');
  await page.waitForFunction(() => document.getAnimations().some((motion)=>motion.id==='c2-intro-flash'));
  assert(await page.evaluate(() => {
    const timing = Object.fromEntries(document.getAnimations().filter((motion)=>motion.id.startsWith('c2-intro-')).map((motion)=>[motion.id.slice(9),motion.effect.getTiming().delay]));
    return timing.background===0 && timing.navigation===320 && timing.crystal===440 && timing.social===480 && timing.slogan===600 && timing.flash===700;
  }), '首屏对象的相位与同一时间线不符');
  assert(await page.evaluate(() => {
    const current = document.querySelector('.is-current');
    const nav = document.querySelector('[data-fixed]:not([data-screen] [data-fixed])');
    const title = current.querySelector('h1');
    const copy = [...current.querySelectorAll('p')].find((node)=>node.textContent==='首页');
    const group = copy.parentElement;
    const [bottom,top] = [...group.children].filter((node)=>node!==copy);
    const layer = (node)=>Number(getComputedStyle(node).zIndex);
    const original = top.getBoundingClientRect().toJSON();
    copy.textContent = '首页'.repeat(300);
    const changed = top.getBoundingClientRect().toJSON();
    const later = document.querySelector('[data-fixed-from="2"]');
    const initial = later?.hidden && later.inert;
    nav.querySelector('button:nth-child(2)').click();
    return initial && !later.hidden && !later.inert && document.querySelector('.is-current')?.dataset.screen==='2'
      && nav.querySelector('button:nth-child(2)').getAttribute('aria-current')==='true'
      && !!title && document.querySelectorAll('h1').length===1 && document.querySelectorAll('h2').length===1
      && nav.querySelectorAll('button').length===2 && layer(bottom)<layer(copy) && layer(copy)<layer(top)
      && original.x===changed.x && original.y===changed.y && original.height===changed.height
      && getComputedStyle(copy).textOverflow==='ellipsis';
  }), '复杂稿标题、固定块、底图/盖层或长文定位不正确');
  assert(await page.evaluate(() => {
    const group = document.querySelector('[data-motion-unit="batches"]');
    const delays = [...group.children].map((child)=>child.getAnimations().find((animation)=>animation.id==='c2-content-travel')?.effect.getTiming().delay);
    return delays.join(',')==='0,60,0' && !document.getAnimations().some((motion)=>motion.id.startsWith('c2-intro-'));
  }), '明确分批顺序、同批延迟或切屏旧动效清理不正确');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve,450)));
  await page.evaluate(() => document.querySelectorAll('[data-intro-nav]')[0].querySelector('button').click());
  await page.waitForFunction(() => document.getAnimations().some((motion)=>motion.id==='c2-intro-flash'));
  assert(await page.evaluate(() => {
    const all = document.getAnimations();
    const delay = (name)=>all.find((motion)=>motion.id==='c2-intro-'+name)?.effect.getTiming().delay;
    return delay('slogan')===80 && delay('flash')===180 && delay('navigation')===undefined;
  }), '回首页只重播背景和主标语，且使用回程延迟');
  await viewport(1025);
  await page.goto(origin + '/runtime?mode=multi#stable');
  await page.waitForSelector('html[data-data-state="ready"]');
  assert(await page.evaluate(() => {
    const home = document.getElementById('pchome');
    const active = () => document.querySelector('[data-device="pc"] .is-current')?.dataset.screen;
    const wheel = (options) => home.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,...options}));
    wheel({deltaX:90,deltaY:32});
    wheel({deltaY:90,ctrlKey:true});
    wheel({deltaY:13});
    if (active()!=='1') return false;
    wheel({deltaY:14});
    if (active()!=='1') return false;
    wheel({deltaY:1});
    return active()==='2' && location.hash==='#stable';
  }), '横向/Ctrl 忽略、滚轮 28 阈值及 URL hash');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve,450)));
  assert(await page.evaluate(() => {
    const get = (id) => document.getElementById(id);
    const key = (name) => document.body.dispatchEvent(new KeyboardEvent('keydown', {key:name,bubbles:true}));
    get('pcnext').click();
    if (!get('pcsecond').classList.contains('is-current') || location.hash !== '#stable') return false;
    key('ArrowDown');
    if (!get('pcsecond').classList.contains('is-current')) return false;
    if (get('pcname-0').textContent !== '<b>literal</b>' || get('pcname-0').children.length) return false;
    get('pclink-0').click();
    if (get('site-status').textContent !== 'To be announced' || fixtureLinks.length) return false;
    get('pcadvance').click();
    if (!get('pcitem-0').inert || get('pcitem-1').inert || !get('pcsecond-card').inert) return false;
    get('pcadvance-panels').click();
    if (get('pcsecond-card').inert || get('pcitem-1').inert) return false;
    get('pcopen').click();
    if (get('pcmodal').hidden || !document.documentElement.classList.contains('is-locked') || document.activeElement !== get('pcclose')) return false;
    key('Escape');
    if (!get('pcmodal').hidden || document.activeElement !== get('pcopen')) return false;
    get('pcopen').click();
    get('pcmodal').click();
    if (!get('pcmodal').hidden) return false;
    const protection = (node, type) => !node.dispatchEvent(new Event(type, { bubbles:true, cancelable:true }));
    if (!['copy','cut','contextmenu','selectstart','dragstart'].every((type) => protection(get('pcsecond'), type)
      && [get('pcinput'),get('pcsecond').querySelector('textarea'),get('pcsecond').querySelector('[contenteditable] span'),get('pcsecond').querySelector('[data-copy]')]
        .every((node)=>!protection(node,type)))) return false;
    const button = get('pcoutside');
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, isPrimary:true, pointerId:1, clientX:200 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, isPrimary:true, pointerId:1, clientX:100 }));
    button.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true, detail:1 }));
    if (fixtureLinks.length) return false;
    button.click();
    get('pclanguage').click();
    get('pcsocial').click();
    return fixtureLinks.length === 3 && fixtureLinks[1][0].endsWith('/other-language') && fixtureLinks[2][0].endsWith('/social')
      && get('pcslot-text').textContent === 'fixed-slot';
  }), '切屏、数据、轮播、弹层、防误点、内容保护或外链行为异常');
  assert(await page.evaluate(() => {
    const get = (id) => document.getElementById(id);
    const track = () => get('pclist').querySelector('[data-moving-track]');
    const inspect = (direction, before, after) => {
      const moving = track();
      if (!moving || Number(moving.dataset.movingTrack) !== direction) return false;
      const motion = moving.getAnimations()[0];
      motion.pause();
      motion.currentTime = motion.effect.getTiming().duration / 2;
      const faces = [...moving.children];
      const left = faces[0].getBoundingClientRect();
      const right = faces[1].getBoundingClientRect();
      const viewport = moving.parentElement.getBoundingClientRect();
      const outgoing = faces[direction > 0 ? 0 : 1];
      const incoming = faces[direction > 0 ? 1 : 0];
      return outgoing.firstElementChild.id === before && incoming.firstElementChild.id === after && outgoing.inert && !incoming.inert
        && Math.abs(left.right-right.left) < 1 && left.left < viewport.left && right.right > viewport.right
        && left.width === viewport.width && right.width === viewport.width;
    };
    get('pcadvance').click();
    get('pcadvance').click();
    if (!inspect(1, 'pcitem-2','pcitem-0')) return false;
    get('pcprevious').click();
    if (!inspect(-1, 'pcitem-0','pcitem-2')) return false;
    get('pcprevious').click();
    return inspect(-1, 'pcitem-2','pcitem-1');
  }), '首尾双向轨道有跳位、空白、错误方向或旧页可交互');
  await viewport(1024);
  await page.waitForFunction(() => document.querySelector('[data-device="pc"]').inert);
  assert(await page.evaluate(() => document.getElementById('mobilesecond').classList.contains('is-current')
    && !document.getElementById('mobileitem-1').inert && !document.getElementById('mobilesecond-card').inert
    && document.getElementById('pcsecond').inert && new Set([...document.querySelectorAll('[id]')].map((node) => node.id)).size === document.querySelectorAll('[id]').length), '跨端未保留屏与列表内容锚点，或隐藏端仍可交互');
  await viewport(1025);
  await page.waitForFunction(() => document.querySelector('[data-device="mobile"]').inert);
  assert(await page.evaluate(() => !document.getElementById('pcitem-1').inert), '往返保留原卡片');
  for (const [mode,state] of [['empty','ready'],['one','ready'],['missing','unpublished'],['error','unavailable'],['','unpublished']]) {
    await page.goto(origin + '/runtime?mode=' + mode);
    await page.waitForSelector('html[data-data-state="' + state + '"]');
    assert(await page.evaluate(({ mode, state }) => {
      const get = (id) => document.getElementById(id);
      const empty = document.querySelector('[data-empty-for="pclist"]');
      const pager = document.querySelector('[data-pager-for="pccarousel"]');
      if (!get('pcadvance').hidden || !document.querySelector('[data-ind-for="pccarousel"]').hidden) return false;
      if (mode === 'empty') return !empty.hidden && pager.hidden;
      if (mode === 'one') return empty.hidden && !pager.hidden && pager.textContent === '01/01';
      return empty.hidden && document.documentElement.dataset.dataState === state;
    }, {mode,state}), '空、单页或回退异常：' + mode);
  }
  await page.waitForFunction(() => fixtureVideoCalls === 1);
  assert(await page.evaluate(() => document.querySelector('#pchome [data-slogan]').hidden), 'PC 视频实际播放后才隐藏标语');
  assert(await page.evaluate(() => {
    const home = document.getElementById('pchome');
    document.getElementById('pcnext').click();
    return !home.querySelector('[data-slogan]').hidden && home.querySelector('[data-hero-video]').hidden;
  }), '离开首屏立即恢复静态层');
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve,450)));
  await page.evaluate(() => document.getElementById('pchome-button').click());
  await page.waitForFunction(() => fixtureVideoPlays===2);
  assert(await page.evaluate(() => fixtureVideoCalls===1 && document.querySelector('#pchome [data-slogan]').hidden), '返回首屏复用视频组件');
  await page.goto(origin + '/runtime?video-fail=1');
  await page.waitForFunction(() => fixtureVideoPlays===1);
  assert(await page.evaluate(() => !document.querySelector('#pchome [data-slogan]').hidden && document.querySelector('#pchome [data-hero-video]').hidden), '视频失败必须保留静态层');
  await viewport(1024);
  await page.goto(origin + '/runtime');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((row)=>row.name.endsWith('/mobile-hero')));
  assert(await page.evaluate(() => fixtureVideoCalls === 0 && !performance.getEntriesByType('resource').some((row)=>/\/(pc-hero|movie|broken-cover)$/.test(row.name))),
    '手机只请求自己的首屏背景，不拉另一端、后屏或视频');
  await viewport(1025);
  await page.cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await page.goto(origin + '/runtime');
  assert(await page.evaluate(() => fixtureVideoCalls === 0), '减少动画不应调用背景视频组件');
  await page.goto(origin + '/static');
  assert(await page.evaluate(() => document.documentElement.classList.contains('no-js') && typeof window.OnePageConfig === 'undefined'
    && [...document.querySelectorAll('h1')].some((node)=>node.textContent==='Static' && node.getBoundingClientRect().width>0)), '无 JS 时静态标题应可读');
  await page.goto(origin + '/runtime?mode=loading');
  await page.waitForFunction(() => document.documentElement.dataset.dataState === 'loading');
  await page.waitForFunction(() => document.documentElement.dataset.dataState === 'ready');
  const viewports = [[1280,720],[1366,768],[1440,810],[1440,900],[1840,1000],[1920,1080],[2560,1440],[2560,1080],[2560,720],
    [320,568],[375,667],[375,812],[390,844],[812,375],[844,390],[690,829],[768,1024],[1024,768],[1025,768],[1024,768]];
  for (const mode of ['pc','mobile','dual']) {
    await page.goto(origin + '/' + mode + '/cn.html');
    for (const [width,height] of viewports) {
      await page.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await page.waitForFunction((width) => innerWidth === width && document.querySelector('.is-current')?.offsetWidth > 0, width);
      const result = await page.evaluate(({mode,width,height}) => {
        const panels = [...document.querySelectorAll('[data-device]')];
        const active = panels.filter((node)=>!node.inert);
        const expected = mode === 'dual' ? width <= 1024 ? 'mobile' : 'pc' : mode;
        const stage = active[0]?.querySelector('.screen-content');
        const unit = expected === 'pc' ? Math.min(width/19.2,height/10.8) : Math.min(width/3.75,height/7.15);
        const actual = parseFloat(getComputedStyle(document.documentElement).fontSize);
        return panels.length === (mode === 'dual' ? 2 : 1) && active.length === 1 && active[0].dataset.device === expected
          && Math.abs(actual-unit)<.05 && Math.abs(stage.getBoundingClientRect().width-unit*(expected==='pc'?19.2:3.75))<1;
      },{mode,width,height});
      assert(result,'视口基准或端别错误：'+mode+' '+width+'×'+height);
    }
  }
  await page.cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
  await viewport(1025);
  await page.goto(origin+'/dual/cn.html');
  assert(await page.evaluate(() => {
    const device = document.querySelector('[data-device="pc"]');
    const toggle = device.querySelector('.menu-toggle');
    const panel = device.querySelector('[data-menu]');
    toggle.click();
    const animation = panel.getAnimations()[0];
    animation.currentTime = 100;
    const openingOpacity = Number(getComputedStyle(panel).opacity);
    toggle.click();
    const closing = panel.getAnimations()[0];
    const immediatelyInert = panel.inert && Number(closing.effect.getKeyframes()[0].opacity)===openingOpacity;
    closing.currentTime = 40;
    const closingOpacity = Number(getComputedStyle(panel).opacity);
    toggle.click();
    const reopened = panel.getAnimations()[0];
    return immediatelyInert && !panel.hidden && !panel.inert && document.activeElement===panel
      && Number(reopened.effect.getKeyframes()[0].opacity)===closingOpacity && toggle.getAttribute('aria-expanded')==='true';
  }), '菜单连续反向应接续当前透明度，而不是跳回开始值');
  await viewport(1024);
  await page.waitForFunction(() => document.querySelector('[data-device="pc"]').inert);
  assert(await page.evaluate(() => {
    const previous=document.querySelector('[data-device="pc"]');
    const current=document.querySelector('[data-device="mobile"]');
    return previous.querySelector('[data-menu]').hidden && previous.querySelector('[data-menu]').getAnimations().length===0
      && previous.querySelector('.menu-toggle').getAttribute('aria-expanded')==='false' && current.querySelector('[data-menu]').hidden
      && !document.documentElement.classList.contains('is-locked') && !previous.contains(document.activeElement);
  }), '跨端切换应关闭旧菜单、清除动效和锁定且不把焦点留在隐藏端');
  await page.cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await viewport(1025);
  await page.goto(origin+'/published-layout/cn.html');
  assert(await page.evaluate(() => {
    const nav = document.querySelector('[data-intro-nav]');
    const first = document.getAnimations().length===0;
    nav.querySelector('button:nth-child(2)').click();
    const second = document.querySelector('.is-current')?.dataset.screen==='2' && document.getAnimations().length===0;
    nav.querySelector('button').click();
    return first && second && document.querySelector('.is-current')?.dataset.screen==='1' && document.getAnimations().length===0;
  }), '减少动画下首屏、批次和返回均无动画，屏仍可切换');
  await page.goto(origin+'/dual/cn.html');
  assert(await page.evaluate(() => {
    const device = document.querySelector('[data-device]:not([inert])');
    const toggle = device.querySelector('[aria-controls][aria-expanded]');
    const menu = device.querySelector('[data-menu]');
    toggle.click();
    const on = toggle.getAttribute('aria-expanded')==='true' && !menu.hidden && document.activeElement===menu;
    menu.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const off = menu.hidden && menu.inert && document.activeElement===toggle;
    const target = device.querySelector('[data-state]');
    device.querySelector('button[aria-label="切换"]').click();
    return on && off && target.dataset.state==='win' && target.querySelector('[data-variant-value="idle"]').inert
      && !target.querySelector('[data-variant-value="win"]').hidden && !menu.getAnimations().length;
  }), '源组件菜单焦点、减少动画或状态切换异常');
  console.log('C2_BROWSER_PASS');
}
