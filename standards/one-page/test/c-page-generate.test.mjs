import assert from 'node:assert/strict';
import { pillowPython } from './helpers/python.mjs';
import { execFileSync, spawn } from 'node:child_process';
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

async function inputs(context, settings) {
  const { root, options } = await golden(context, settings);
  const assets = await runCAssets(options);
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
  { skip: process.env.ONEPAGE_C2_BROWSER !== '1' && '使用 ONEPAGE_C2_BROWSER=1 与已安装的 ego-browser 运行', timeout:90000 }, async (context) => {
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
