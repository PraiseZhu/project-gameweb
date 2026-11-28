import assert from 'node:assert/strict';
import { pillowPython } from './helpers/python.mjs';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runBDelta } from '../src/b-delta.mjs';
import { runCAssets } from '../src/c-assets.mjs';
import { runCGenerate } from '../src/c-page-generate.mjs';
import { runCCheck as checkPage } from '../src/c-check/index.mjs';
import { runCPatch as patchPage } from '../src/c-patch.mjs';
import { browserCaseMs, measureStage } from './browser-test-budget.mjs';
import { targetRegion } from '../src/c-check/pixel-scope.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';
import { checkDelta } from '../src/delta-check.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { sha256Hex } from '../src/canonical.mjs';
import { readDeltaInputs, requireSingleLanguageInputs } from '../src/c-patch-material.mjs';
import { sharedExpansion, verifySharedExpansion } from '../src/c-patch-expansion.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';

const tokenValue = 'c4-isolated-test-token';
const runCCheck = (...args) => measureStage('C4 baseline c-check',() => checkPage(...args));
const runCPatch = (...args) => measureStage('C4 c-patch',() => patchPage(...args));
const json = (path) => JSON.parse(readFileSync(path));
const frame = (id,name,children = [],extra = {}) => ({ id,name,type:'FRAME', children,
  absoluteBoundingBox:{ x:0,y:0,width:200,height:100 }, ...extra });
const colors = { '111':'white', '222':'red','333':'green' };

function checkedFixtureDirectory(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'C4 夹具路径必须是普通目录：' + path);
  assert.equal(realpathSync.native(path), path, 'C4 夹具路径不能通过链接离开 checkout');
  return stat;
}

function createFixture(context, checkout = fileURLToPath(new URL('../../..',import.meta.url))) {
  assert.ok(lstatSync(checkout).isDirectory(), 'C4 checkout 必须是普通目录');
  const root = realpathSync.native(checkout);
  const parents = [join(root,'_tmp'),join(root,'_tmp','c4-fixtures')];
  for (const path of parents) {
    try { mkdirSync(path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    checkedFixtureDirectory(path);
  }
  const fixture = mkdtempSync(join(parents.at(-1),'run-'));
  const created = checkedFixtureDirectory(fixture);
  context.after(() => {
    for (const path of parents) checkedFixtureDirectory(path);
    const current = checkedFixtureDirectory(fixture);
    assert.deepEqual([current.dev,current.ino],[created.dev,created.ino], 'C4 清理必须限于本次夹具');
    rmSync(fixture,{ recursive:true,force:true });
  });
  return fixture;
}

test('C4：拒绝隔离 checkout 的链接及非目录夹具父路径，不写目标', (context) => {
  const sandbox = createFixture(context);
  const target = join(sandbox,'untouched');
  mkdirSync(target);
  for (const component of ['_tmp','c4-fixtures']) {
    for (const type of ['link','file']) {
      const checkout = join(sandbox,component + '-' + type);
      mkdirSync(checkout);
      const temp = join(checkout,'_tmp');
      const path = component === '_tmp' ? temp : join(temp,'c4-fixtures');
      if (path !== temp) mkdirSync(temp);
      if (type === 'link') symlinkSync(target,path,process.platform === 'win32' ? 'junction' : 'dir');
      else writeFileSync(path,'untouched');
      assert.throws(() => createFixture(context,checkout),/夹具路径必须是普通目录/);
      assert.deepEqual(readdirSync(target),[]);
      if (type === 'file') assert.equal(readFileSync(path,'utf8'),'untouched');
    }
  }
});

async function setup(context,{ bitmap = false, design = false, link = false, leaf = false, font = false, translation = false, footprint = false,
  end = 'pc' } = {}) {
  leaf ||= font || translation;
  const root = createFixture(context);
  const fills = (changed) => bitmap ? [{ type:'IMAGE', imageRef:changed ? 'red' : 'white' }]
    : [{ type:'SOLID', color:{ r:1,g:changed ? 0 : 1,b:changed ? 0 : 1 } }];
  const art = (id, x) => frame(id,'img/背景' + id.slice(-1),[],{ type:bitmap ? 'FRAME' : 'VECTOR', fills:fills(false),
    absoluteBoundingBox:{ x,y:0,width:design || link ? 100 : 200,height:100 } });
  const asset = art('10:3',0);
  const copy = frame('10:7','文案',[],{ type:'TEXT',characters:'首页',style:{ fontFamily:'One Page Fixture',fontWeight:400,fontSize:16 },
    absoluteBoundingBox:{ x:footprint ? 210 : 300,y:30,width:end === 'mobile' ? 400 : 450,height:300 } });
  const document = { id:'1:2',name:'C4 fixture',type:'CANVAS',children:[frame('10:1','cn_' + end,[frame('10:2','sec/1-首页',
    design ? [asset,art('10:4',90)] : link ? [asset,frame('10:4','btn/X@link=event',[],{
      absoluteBoundingBox:{ x:150,y:0,width:600,height:400 },
    })] : leaf ? [asset,copy] : [asset],link || leaf ? { absoluteBoundingBox:{ x:0,y:0,width:end === 'pc' ? 800 : 750,height:400 } } : {})])] };
  let current = '111';
  const calls = [];
  const fetchImpl = async (address, request) => {
    const url = new URL(address);
    if (url.hostname === 'c4.fixture') {
      assert.equal(request.headers,undefined);
      const color = design ? (url.searchParams.get('node') === '10:3' ? 'red' : (current === '111' ? 'blue' : 'green')) : colors[url.pathname.slice(1)];
      if (bitmap) return new Response(execFileSync(pillowPython(),['-B','-c',
        'from PIL import Image; import sys; Image.new("RGB",(200,100),sys.argv[1]).save(sys.stdout.buffer,"PNG")',color]));
      const width = design || link ? 100 : 200;
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="100" viewBox="0 0 ' + width + ' 100"><path fill="' + color + '" d="M0 0H' + width + 'V100H0Z"/></svg>');
    }
    assert.equal(url.hostname,'api.figma.com');
    const version = url.searchParams.get('version');
    if (version) assert.equal(version,current);
    if (url.pathname.endsWith('/nodes')) return Response.json({ version:current,nodes:{ '1:2':{ document } } });
    assert.equal(url.pathname,'/v1/images/C4TEST');
    assert.equal(url.searchParams.get('format'),bitmap ? 'png' : 'svg');
    const node = url.searchParams.get('ids');
    calls.push([current,node]);
    return Response.json({ images:{ [node]:'https://c4.fixture/' + current + '?node=' + node } });
  };
  const a = { url:'https://www.figma.com/design/C4TEST/fixture?node-id=1-2',languages:translation ? 'cn,en' : 'cn',baseLanguage:'cn',platform:end,
    runRoot:join(root,'producer'),tokenValue,fetchImpl };
  const draft = await runAScope(a);
  assert.ok(draft.ok,JSON.stringify(draft));
  const { runDir } = draft;
  const l10nSnapshot = translation ? join(root,'translations.json') : undefined;
  if (translation) writeFileSync(l10nSnapshot,JSON.stringify({ values:[['简中','英语'],['首页','首页']] }));
  if (leaf) {
    const path = projectConfigPath(a.runRoot,'C4TEST','1:2');
    const bytes = readFileSync(new URL('./fixtures/fonts/one-page-static.otf',import.meta.url));
    writeProjectConfigAtomic(path,{ fonts:{ faces:{ 'One Page Fixture/400':{ cn:'base',...(translation ? { en:'base' } : {}) } },resources:{ base:{ file:'base.otf',format:'otf',
      weights:[400],source:'fixture',license:'fixture license',digest:'sha256:' + byteDigest(bytes) } } } });
    writeFileSync(join(path,'..','base.otf'),bytes);
  }
  async function collect(shown) {
    const confirmed = await runAScope({ ...a,runDir,shownFp:shown.fingerprintPrefix,confirmQuote:'确认范围',confirmSource:'test' });
    assert.ok(confirmed.ok,JSON.stringify(confirmed));
    const b1 = await runBExtract({ ...a,runDir });
    assert.ok(b1.ok,JSON.stringify(b1));
    const b2 = await runBSupplement({ ...a,runDir,l10nSnapshot,fontDiscovery:{ directories:[] } });
    assert.equal(b2.result,'pass',JSON.stringify(b2));
    return b2;
  }
  const b2 = await collect(draft);
  const b3 = runBHandoff({ runDir,b2Version:json(b2.supplementPath).version });
  assert.ok(b3.ok,JSON.stringify(b3));
  const upstream = { pack:b3.pack,expectVersion:b3.version,scopeVersion:b3.scopeVersion,consumerContract:HANDOFF_CONSUMER };
  const c1 = await runCAssets({ ...upstream,runDir:join(root,'c1'),fetchImpl,tokenValue,python:pillowPython() });
  assert.ok(c1.ok,JSON.stringify(c1));
  const c2 = runCGenerate({ ...upstream,runDir:join(root,'c2'),assetsPack:c1.pack,assetsVersion:c1.version,assetsSha256:c1.manifestSha256 });
  assert.ok(c2.ok,JSON.stringify(c2));
  const meta = json(join(c2.pack,'c2-build-meta.json'));
  async function delta({ noPosition = false, differentObject = false, mixed = false, version = '222' } = {}) {
    if (translation) {
      writeFileSync(l10nSnapshot,JSON.stringify({ values:[['简中','英语'],['首页','首页首页']] }));
      const updated = await runBSupplement({ ...a,runDir,l10nSnapshot,fontDiscovery:{ directories:[] } });
      assert.equal(updated.result,'pass',JSON.stringify(updated));
    } else if (link || font) {
      const path = projectConfigPath(a.runRoot,'C4TEST','1:2');
      const config = json(path);
      if (link) config.links.event.url = 'https://updated.example.invalid/';
      else {
        const bytes = readFileSync(new URL('./fixtures/fonts/one-page-variable.otf',import.meta.url));
        Object.assign(config.fonts.resources.base,{ file:'replacement.otf',format:'otf',digest:'sha256:' + byteDigest(bytes),license:'new fixture license',
          axes:{ wght:{ min:100,max:900 } } });
        writeFileSync(join(path,'..','replacement.otf'),bytes);
      }
      writeProjectConfigAtomic(path,config);
      const extracted = await runBExtract({ ...a,runDir });
      assert.ok(extracted.ok,JSON.stringify(extracted));
      const updated = await runBSupplement({ ...a,runDir,fontDiscovery:{ directories:[] } });
      assert.equal(updated.result,'pass',JSON.stringify(updated));
    } else {
      current = version;
      if (leaf) {
        copy.characters = '首页首页';
        if (!noPosition) copy.absoluteBoundingBox.x = footprint ? 190 : 318;
        if (mixed) asset.fills = fills(true);
      } else if (differentObject) document.children[0].children[0].children[1].fills = fills(true);
      else asset.fills = version === '333' ? [{ type:'SOLID',color:{ r:0,g:0.5,b:0 } }] : fills(true);
      const next = await runAScope({ ...a,runDir });
      assert.ok(next.ok,JSON.stringify(next));
      await collect(next);
    }
    const change = runBDelta({ runDir,basePack:b3.pack,expectVersion:b3.version,scopeVersion:b3.scopeVersion,
      consumerContract:HANDOFF_CONSUMER,fontDiscovery:{ directories:[] } });
    assert.ok(change.ok,JSON.stringify(change));
    assert.equal(change.changeKind,link || font || translation || (leaf && noPosition) ? 'non-figma-config-or-copy' : leaf ? 'layout-impacted' : 'asset-visual-only');
    return change;
  }
  return { root,b3,c2,meta,delta,fetchImpl,calls,producer:a.runRoot };
}

function rawReference(root,meta,color,deltaDigest,{ local = true, designDigest, neighbor, link, leaf } = {}) {
  const ref = mkdtempSync(join(root,'reference-'));
  const screen = meta.nodes.find((item) => item.role === 'sec');
  const viewport = screen.end === 'mobile' ? { width:375,height:715 } : { width:1280,height:720 };
  const asset = meta.nodes.find((item) => item.nodeId === '10:3');
  const { region } = targetRegion(meta,screen,asset,viewport);
  const adjacent = (neighbor || link || leaf) && meta.nodes.find((item) => item.nodeId === (leaf ? '10:7' : '10:4'));
  const adjacentRegion = adjacent && targetRegion(meta,screen,adjacent,viewport).region;
  const rectangles = [[color,region],...(neighbor && adjacent ? [[neighbor,adjacentRegion]] : [])];
  const reference = execFileSync(pillowPython(),['-B','-c',
    'from PIL import Image, ImageDraw; import json,sys; image=Image.new("RGB",tuple(json.loads(sys.argv[2])),"white"); [(ImageDraw.Draw(image).rectangle((left,top,left+width-1,top+height-1),fill=color)) for color,(left,top,width,height) in json.loads(sys.argv[1])]; image.save(sys.stdout.buffer,"PNG")',
    JSON.stringify(rectangles),JSON.stringify([viewport.width,viewport.height])]);
  writeFileSync(join(ref,'reference.png'),reference);
  const bytes = Buffer.from(JSON.stringify({ schema:'onepage-pixel-reference/v1',baseLanguage:meta.baseLanguage,scopeVersion:meta.scopeVersion,
    b3Digest:meta.b3.digest,b4Digest:deltaDigest,c4DesignDigest:designDigest,screens:[{ end:screen.end,nodeId:screen.nodeId,viewport,path:'reference.png',sha256:byteDigest(reference),
      local:local ? [{ domId:asset.domId,region },...(adjacent ? [{ domId:adjacent.domId,region:adjacentRegion }] : [])] : [] }] }));
  const references = join(ref,'index.json');
  writeFileSync(references,bytes);
  return { references,referencesSha256:byteDigest(bytes) };
}

test('C4：B4 只导目标版本素材，C3 实跑，H23 保留且断源可核验',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl,calls } = await setup(context);
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const inputs = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...inputs, pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white') });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta();
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const request = { ...inputs,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,fetchImpl,tokenValue,runDir };
    const reference = rawReference(root,meta,'red',proof.manifestSha256);
    const wrongVersion = await runCPatch({ ...request,...reference,deltaVersion:'0'.repeat(64) });
    assert.equal(wrongVersion.ok,false);
    const wrongSource = await runCPatch({ ...request,...reference,fetchImpl:async (address, init) => {
      const response = await fetchImpl(address,init);
      if (!new URL(address).pathname.endsWith('/nodes')) return response;
      return Response.json({ ...await response.json(),version:'111' });
    } });
    assert.match(wrongSource.message,/快照版本/);
    const wrongNode = await runCPatch({ ...request,...reference,fetchImpl:async (address, init) => {
      const response = await fetchImpl(address,init);
      if (!new URL(address).pathname.endsWith('/nodes')) return response;
      const snapshot = await response.json();
      snapshot.nodes['1:2'].document.children[0].children[0].children[0].fills = [{ type:'SOLID', color:{ r:0,g:0,b:1 } }];
      return Response.json(snapshot);
    } });
    assert.match(wrongNode.message,/视觉指纹/);
    assert.deepEqual(calls,[['111','10:3']]);
    const missingLocal = await runCPatch({ ...request,...rawReference(root,meta,'red',proof.manifestSha256,{ local:false }) });
    assert.match(missingLocal.message,/完整局部参考框/);
    const wrongImage = await runCPatch({ ...request,...rawReference(root,meta,'white',proof.manifestSha256) });
    assert.match(wrongImage.message,/D04/);
    assert.deepEqual(readdirSync(runDir),[]);
    const result = await runCPatch({ ...request,...reference });
    assert.ok(result.ok,JSON.stringify(result));
    assert.deepEqual(calls,[['111','10:3'],['222','10:3'],['222','10:3'],['222','10:3']]);
    const source = json(join(c2.pack,'page/assets/manifest.json'));
    const patched = json(join(result.pagePack,'page/assets/manifest.json'));
    assert.notEqual(patched.assets[0].sha256,source.assets[0].sha256);
    assert.ok(patched.retained.some((asset) => asset.kind === 'history' && asset.sha256 === source.assets[0].sha256));
    assert.deepEqual(readdirSync(runDir),['c4.r1']);
    const isolated = join(root,'isolated');
    cpSync(result.pack,isolated,{ recursive:true });
    for (const [name,path] of [['old-production',b3.pack],['old-page',c2.pack],['old-evidence',out],['old-delta',change.pack]]) renameSync(path,join(root,name));
    const receipt = { expectedStage:'C',expectedOutputKind:'c-single-page',expectedOutputVersion:result.version,
      pagePack:join(isolated,'build'),pageVersion:result.pageVersion,scopeVersion:b3.scopeVersion };
    assert.ok(checkEntry(join(isolated,'check/stage-record.json'),receipt).ok);
    writeFileSync(join(isolated,'check/c4-patch-meta.json'),'{}');
    assert.equal(checkEntry(join(isolated,'check/stage-record.json'),receipt).ok,false);
  });

test('C4：位图重导保留旧交付 WebP 及原 PNG，同时绑定新版无损源',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl,calls } = await setup(context,{ bitmap:true });
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const inputs = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...inputs, pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white') });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta();
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const result = await runCPatch({ ...inputs,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,fetchImpl,tokenValue,runDir,
      ...rawReference(root,meta,'red',proof.manifestSha256) });
    assert.ok(result.ok,JSON.stringify(result));
    assert.deepEqual(calls,[['111','10:3'],['222','10:3']]);
    const previous = json(join(c2.pack,'page/assets/manifest.json')).assets[0];
    const patched = json(join(result.pagePack,'page/assets/manifest.json'));
    assert.notEqual(patched.assets[0].original.sha256,previous.original.sha256);
    for (const old of [previous,previous.original]) {
      const retained = patched.retained.find((item) => item.sha256 === old.sha256 && item.kind === 'history');
      assert.ok(retained);
      assert.equal(retained.referenced,false);
      assert.equal(retained.visualFingerprint,previous.visualFingerprint);
      assert.deepEqual(readFileSync(join(result.pagePack,'page',retained.path)),readFileSync(join(c2.pack,'page',old.path)));
    }
  });

test('C4：应用 B4 已绑定的当前外链并扩大共用配置复验',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,calls } = await setup(context,{ link:true });
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white',undefined,{ link:true }) });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta();
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const result = await runCPatch({ ...upstream,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,runDir,fontDiscovery:{ directories:[] },
      ...rawReference(root,meta,'white',proof.manifestSha256,{ link:true }) });
    assert.ok(result.ok,JSON.stringify({ result, deps:proof.manifest.affectedSharedDeps,changes:proof.manifest.evidence.nodeChanges,
      source:proof.manifest.changeSources,kind:proof.manifest.changeKind,assets:proof.manifest.affectedAssets }));
    assert.deepEqual(calls,[['111','10:3']]);
    const patch = json(join(result.pack,'check/c4-patch-meta.json'));
    assert.equal(patch.expansion.path,'js/config.js');
    assert.deepEqual(patch.material.links.changes,[{ key:'event',before:null,after:'https://updated.example.invalid/' }]);
    assert.ok(json(join(result.pack,'check/check-report.json')).findings.some((row) => row.check === 'D10' && row.detail.count === 1 && row.status === 'pass'));
  });

test('C4：只用当前 B1 定位局部文案与布局，缺生产旁证拒绝',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl,calls } = await setup(context,{ leaf:true });
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white',undefined,{ leaf:true }) });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta({ mixed:true });
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const updated = structuredClone(meta);
    const target = updated.nodes.find((row) => row.nodeId === '10:7');
    target.designBox.x = 318;
    const request = { ...upstream,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,runDir,fontDiscovery:{ directories:[] },fetchImpl,tokenValue,
      ...rawReference(root,updated,'red',proof.manifestSha256,{ leaf:true }) };
    const disconnected = join(root,'detached','b4.r1');
    mkdirSync(join(root,'detached'));
    cpSync(change.pack,disconnected,{ recursive:true });
    const rejected = await runCPatch({ ...request,deltaPack:disconnected });
    assert.match(rejected.message,/B1/);
    assert.deepEqual(readdirSync(runDir),[]);
    const result = await runCPatch(request);
    assert.ok(result.ok,JSON.stringify(result));
    const patch = json(join(result.pack,'check/c4-patch-meta.json'));
    assert.deepEqual(patch.expansion.paths,['css/styles.css']);
    assert.deepEqual(patch.sharedAudit.changed,['page/css/styles.css']);
    assert.deepEqual(patch.sharedAudit.states,[{ end:'pc',screen:meta.nodes.find((row) => row.role === 'sec').domId,caseId:'default' }]);
    assert.equal(patch.material.leaves[0].toText,'首页首页');
    assert.deepEqual(patch.material.leaves[0].toBox,target.designBox);
    assert.deepEqual(calls,[['111','10:3'],['222','10:3']]);
    for (const path of ['css/mobile.css','css/locales.css','js/config.js','js/main.js']) {
      assert.deepEqual(readFileSync(join(result.pagePack,'page',path)),readFileSync(join(c2.pack,'page',path)));
    }
  });

test('C4：现行字体原件与许可证随共用样式升级，并拒原件漂移',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,producer } = await setup(context,{ font:true });
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white',undefined,{ leaf:true }) });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta();
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const request = { ...upstream,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,runDir,fontDiscovery:{ directories:[] },
      ...rawReference(root,meta,'white',proof.manifestSha256,{ leaf:true }) };
    const original = join(projectConfigPath(producer,'C4TEST','1:2'),'..','replacement.otf');
    const bytes = readFileSync(original);
    writeFileSync(original,'bad current source');
    assert.equal((await runCPatch(request)).ok,false);
    assert.deepEqual(readdirSync(runDir),[]);
    writeFileSync(original,bytes);
    const result = await runCPatch(request);
    assert.ok(result.ok,JSON.stringify(result));
    const patch = json(join(result.pack,'check/c4-patch-meta.json'));
    assert.deepEqual(patch.expansion.paths,['css/font/','css/styles.css']);
    const [{ previous,next }] = patch.material.fonts.changes;
    assert.notEqual(next.sha256,previous.sha256);
    assert.deepEqual(readFileSync(join(result.pagePack,'page',next.path)),bytes);
    assert.equal(readFileSync(join(result.pagePack,'page',next.license.path),'utf8'),'new fixture license');
  });

test('C4：真实 B4 目标语译文不能写入基础语言成品', async (context) => {
    const { c2,meta,delta } = await setup(context,{ translation:true });
    const change = await delta();
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    assert.deepEqual(proof.manifest.affectedLanguages,['en']);
    assert.ok(proof.manifest.affectedSharedDeps.some((dep) => dep.kind === 'translations'));
    const input = readDeltaInputs(proof,dirname(change.pack),{ directories:[] });
    assert.throws(() => requireSingleLanguageInputs(proof,input,meta.baseLanguage),/未声明基础语言译文接收位置/);
    assert.equal(json(join(c2.pack,'c2-build-meta.json')).nodes.find((row) => row.nodeId === '10:7').text,'首页');
  });

test('C4：设计指令与 B4 换图分别绑定冲突，精确豁免且邻区仍验',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl,producer } = await setup(context,{ design:true });
    const out = join(root,'evidence');
    const runDir = join(root,'patches');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const audit = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'red',undefined,{ neighbor:'blue' }) });
    assert.equal(audit.status,'pass',JSON.stringify(audit.rounds[0].problems));
    const base = { stagePath:join(audit.rounds[0].root,'stage-record.json'),version:audit.rounds[0].version,pagePack:c2.pack,pageVersion:c2.version };
    const { domId,end,module,nodeId } = meta.nodes.find((row) => row.nodeId === '10:3');
    const target = { domId,end,module,nodeId };
    const property = 'opacity';
    const viewport = { width:1280,height:720 };
    const rect = targetRegion(meta,meta.nodes.find((row) => row.role === 'sec'),meta.nodes.find((row) => row.domId === domId),viewport).region;
    const options = (from,value,decision,{ neighbor = 'blue', offset = 0, confirm = true, approvalVersion = from.pageVersion } = {}) => {
      const base = { scopeVersion:b3.scopeVersion,pageVersion:from.pageVersion,checkVersion:from.version,checkDigest:json(from.stagePath).output.digest };
      const confirmation = confirm ? { caseId:'default',viewport,rect:[rect[0] + offset,...rect.slice(1)],basis:'review-fixture-42',
        pageVersion:approvalVersion,fingerprint:sha256Hex({ target,property,value:decision?.choice === 'keep-manual' ? 0.5 : value }) } : undefined;
      const bytes = Buffer.from(JSON.stringify({ schema:'onepage-c4-design/v1',base,target,property,value,confirmation,decision }));
      const designPath = join(mkdtempSync(join(root,'design-')),'instruction.json');
      writeFileSync(designPath,bytes);
      const designSha256 = byteDigest(bytes);
      return { ...upstream,baseCheck:from.stagePath,baseCheckVersion:from.version,pagePack:from.pagePack,pageVersion:from.pageVersion,
        runDir,designPath,designSha256,...rawReference(root,meta,'red',undefined,{ designDigest:designSha256,neighbor }) };
    };
    assert.match((await runCPatch(options(base,0.5,undefined,{ offset:1 }))).message,/确认区域/);
    assert.match((await runCPatch(options(base,0.5,undefined,{ confirm:false }))).message,/D04/);
    assert.match((await runCPatch(options(base,0.5,undefined,{ neighbor:'green' }))).message,/D04/);
    assert.deepEqual(readdirSync(runDir),[]);
    const initial = await runCPatch(options(base,0.5));
    assert.ok(initial.ok,JSON.stringify(initial));
    const denied = await runCPatch(options(initial,0.8));
    assert.equal(denied.result,'needs-human-decision');
    assert.deepEqual(readdirSync(runDir),['c4.r1']);
    assert.match((await runCPatch(options(initial,0.8,{ fingerprint:'0'.repeat(64),choice:'overwrite' }))).message,/裁决/);
    const preserve = { fingerprint:denied.conflict.fingerprint,choice:'keep-manual' };
    assert.match((await runCPatch(options(initial,0.8,preserve,{ approvalVersion:base.pageVersion }))).message,/确认区域/);
    assert.match((await runCPatch(options(initial,0.8,preserve,{ confirm:false }))).message,/D04/);
    let prior;
    for (const [choice,expected] of [['keep-manual',0.5],['overwrite',0.8]]) {
      const published = await runCPatch(options(initial,0.8,{ fingerprint:denied.conflict.fingerprint,choice }));
      assert.ok(published.ok,JSON.stringify(published));
      const patch = json(join(published.pack,'check/c4-patch-meta.json'));
      assert.equal(patch.manualTweaks[0].value,expected);
      assert.equal(patch.design.plan.decision.choice,choice);
      const report = json(join(published.pack,'check/check-report.json'));
      assert.ok(report.findings.some((row) => row.id.endsWith(':designer-confirmed') && row.detail.value === expected && row.status === 'pass'));
      assert.deepEqual(report.pixels.find((row) => !row.region).designMasks.map((row) => row.rect),[rect]);
      assert.ok(report.pixels.some((row) => row.domId === meta.nodes.find((node) => node.nodeId === '10:4').domId && row.status === 'pass'));
      if (choice === 'keep-manual') prior = published;
    }
    const change = await delta({ differentObject:true });
    const proof = checkDelta({ pack:change.pack,expectVersion:change.version });
    const request = { ...upstream,baseCheck:prior.stagePath,baseCheckVersion:prior.version,
      pagePack:prior.pagePack,pageVersion:prior.pageVersion,deltaPack:change.pack,deltaVersion:change.version,
      runDir,fetchImpl,tokenValue };
    const cross = await runCPatch(request);
    assert.equal(cross.result,'needs-human-decision',JSON.stringify(cross));
    assert.deepEqual(readdirSync(runDir).sort(),['c4.r1','c4.r2','c4.r3']);
    assert.match((await runCPatch({ ...request,decisionChoice:'overwrite',decisionFingerprint:denied.conflict.fingerprint })).message,/跨来源冲突/);
    assert.equal(cross.conflict.overlaps[0].target.nodeId,nodeId);
    assert.equal(cross.conflict.overlaps[0].incoming.nodeId,'10:4');
    assert.equal(cross.conflict.overlaps[0].region.w,10);
    const oldAssets = json(join(prior.pagePack,'page/assets/manifest.json')).assets;
    const previous = oldAssets.find((row) => row.nodeId === '10:4');
    const migrated = [];
    for (const [choice,color,neighbor] of [['keep-manual','#ff8080','blue'],['overwrite','red','green']]) {
      const published = await runCPatch({ ...request,decisionChoice:choice,decisionFingerprint:cross.conflict.fingerprint,
        ...rawReference(root,meta,color,proof.manifestSha256,{ neighbor }) });
      assert.ok(published.ok,JSON.stringify(published));
      const patch = json(join(published.pack,'check/c4-patch-meta.json'));
      assert.equal(patch.material.manual.plan.decision.choice,choice);
      const assets = json(join(published.pagePack,'page/assets/manifest.json')).assets;
      const asset = assets.find((row) => row.nodeId === '10:4');
      assert.equal(asset.sha256 === previous.sha256,choice === 'keep-manual');
      assert.deepEqual(assets.find((row) => row.nodeId === nodeId),oldAssets.find((row) => row.nodeId === nodeId));
      assert.equal(patch.manualTweaks.length,choice === 'keep-manual' ? 1 : 0);
      const report = json(join(published.pack,'check/check-report.json'));
      assert.ok(report.pixels.every((row) => !row.designMasks?.length));
      const isolated = mkdtempSync(join(root,'migrated-'));
      cpSync(published.pack,isolated,{ recursive:true });
      migrated.push({ isolated,published });
    }
    for (const path of [runDir,out,c2.pack,producer]) renameSync(path,mkdtempSync(join(root,'away-')) + '.moved');
    for (const { isolated,published } of migrated) {
      assert.ok(checkEntry(join(isolated,'check/stage-record.json'),{ expectedStage:'C',expectedOutputKind:'c-single-page',
        expectedOutputVersion:published.version,pagePack:join(isolated,'build'),pageVersion:published.pageVersion,scopeVersion:b3.scopeVersion }).ok);
    }
  });

test('C4：B4→D→B4 核对每代并迁移断源',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl,calls,producer } = await setup(context);
    const out = join(root,'checks');
    const runDir = join(root,'rounds');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const result = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white') });
    assert.equal(result.status,'pass',JSON.stringify(result.rounds[0].problems));
    const base = { ...c2,pagePack:c2.pack,version:result.rounds[0].version,pageVersion:c2.version,stagePath:join(result.rounds[0].root,'stage-record.json') };
    const args = (from) => ({ ...upstream,baseCheck:from.stagePath,baseCheckVersion:from.version,pagePack:from.pagePack,pageVersion:from.pageVersion,runDir });
    const firstDelta = await delta();
    const firstDigest = checkDelta({ pack:firstDelta.pack,expectVersion:firstDelta.version }).manifestSha256;
    const incoming = (from,change) => ({ ...args(from),deltaPack:change.pack,deltaVersion:change.version,fetchImpl,tokenValue });
    const first = await runCPatch({ ...incoming(base,firstDelta),...rawReference(root,meta,'red',firstDigest) });
    assert.ok(first.ok,JSON.stringify(first));
    const { domId,end,module,nodeId } = meta.nodes.find((row) => row.nodeId === '10:3');
    const target = { domId,end,module,nodeId };
    const design = (from, unsupported = {}) => {
      const bytes = Buffer.from(JSON.stringify({ schema:'onepage-c4-design/v1', target, property:'opacity',value:0.5,
        base:{ pageVersion:from.pageVersion,checkVersion:from.version,checkDigest:json(from.stagePath).output.digest,scopeVersion:b3.scopeVersion },...unsupported }));
      const designPath = join(mkdtempSync(join(root,'directive-')),'instruction.json');
      writeFileSync(designPath,bytes);
      return { designPath,designSha256:byteDigest(bytes) };
    };
    assert.match((await runCPatch({ ...args(first),...design(base) })).message,/当前已验单页/);
    for (const key of ['mainJs','localesCss']) assert.match((await runCPatch({ ...args(first),...design(first,{ [key]:'unsupported' }) })).message,/不接受任意 CSS 或 JS/);
    const instruction = design(first);
    const adjusted = await runCPatch({ ...args(first),...instruction,...rawReference(root,meta,'#ff8080',firstDigest,{ designDigest:instruction.designSha256 }) });
    assert.ok(adjusted.ok,JSON.stringify(adjusted));
    assert.match((await runCPatch(incoming(first,firstDelta))).message,/上一稿件版本/);
    const next = await delta({ version:'333' });
    const digest = checkDelta({ pack:next.pack,expectVersion:next.version }).manifestSha256;
    const direct = await runCPatch({ ...incoming(first,next),...rawReference(root,meta,'green',digest) });
    assert.ok(direct.ok,JSON.stringify(direct));
    const conflict = await runCPatch(incoming(adjusted,next));
    assert.equal(conflict.result,'needs-human-decision');
    assert.match((await runCPatch({ ...incoming(adjusted,next),decisionChoice:'overwrite',decisionFingerprint:'0'.repeat(64) })).message,/裁决过期/);
    const kept = await runCPatch({ ...incoming(adjusted,next),decisionChoice:'keep-manual',decisionFingerprint:conflict.conflict.fingerprint,
      ...rawReference(root,meta,'#ff8080',digest) });
    assert.ok(kept.ok,JSON.stringify(kept));
    const assets = (run) => json(join(run.pagePack,'page/assets/manifest.json')).assets;
    assert.deepEqual(assets(kept),assets(adjusted));
    const final = await runCPatch({ ...incoming(adjusted,next),decisionChoice:'overwrite',decisionFingerprint:conflict.conflict.fingerprint,
      ...rawReference(root,meta,'green',digest) });
    assert.ok(final.ok,JSON.stringify(final));
    const patch = json(join(final.pack,'check/c4-patch-meta.json'));
    assert.equal(patch.material.parentDelta,firstDelta.version);
    assert.deepEqual(patch.manualTweaks,[]);
    assert.deepEqual(calls,[['111','10:3'],['222','10:3'],['333','10:3'],['333','10:3'],['333','10:3']]);
    for (const file of ['css/mobile.css','css/locales.css','js/main.js','js/config.js']) {
      assert.deepEqual(readFileSync(join(final.pagePack,'page',file)),readFileSync(join(c2.pack,'page',file)));
    }
    const migration = mkdtempSync(join(root,'detached-'));
    const migrated = [first,adjusted,direct,kept,final].map((run,index) => {
      const path = join(migration,String(index));
      cpSync(run.pack,path,{ recursive:true });
      return { run,path };
    });
    for (const source of [runDir,out,c2.pack,producer]) renameSync(source,mkdtempSync(join(root,'removed-')) + '.moved');
    for (const { run,path } of migrated) {
      const checked = checkEntry(join(path,'check/stage-record.json'),{ expectedStage:'C',expectedOutputKind:'c-single-page',
        expectedOutputVersion:run.version,pagePack:join(path,'build'),pageVersion:run.pageVersion,scopeVersion:b3.scopeVersion });
      assert.ok(checked.ok,JSON.stringify(checked));
    }
  });

test('C4：B4 混合布局进入已手调范围时，按前后范围裁决',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta,fetchImpl } = await setup(context,{ leaf:true,footprint:true });
    const out = join(root,'checks');
    const runDir = join(root,'rounds');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white',undefined,{ leaf:true }) });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const stage = join(base.rounds[0].root,'stage-record.json');
    const { domId,end,module,nodeId } = meta.nodes.find((row) => row.nodeId === '10:3');
    const bytes = Buffer.from(JSON.stringify({ schema:'onepage-c4-design/v1',target:{ domId,end,module,nodeId },property:'opacity',value:0.5,
      base:{ pageVersion:c2.version,checkVersion:base.rounds[0].version,checkDigest:json(stage).output.digest,scopeVersion:b3.scopeVersion } }));
    const designPath = join(root,'design.json');
    writeFileSync(designPath,bytes);
    const designSha256 = byteDigest(bytes);
    const design = await runCPatch({ ...upstream,baseCheck:stage,baseCheckVersion:base.rounds[0].version,pagePack:c2.pack,pageVersion:c2.version,
      runDir,designPath,designSha256,...rawReference(root,meta,'white',undefined,{ designDigest:designSha256,leaf:true }) });
    assert.ok(design.ok,JSON.stringify(design));
    const changed = await delta({ mixed:true });
    const digest = checkDelta({ pack:changed.pack,expectVersion:changed.version }).manifestSha256;
    const request = { ...upstream,baseCheck:design.stagePath,baseCheckVersion:design.version,pagePack:design.pagePack,pageVersion:design.pageVersion,
      runDir,deltaPack:changed.pack,deltaVersion:changed.version,fetchImpl,tokenValue };
    const conflict = await runCPatch(request);
    assert.equal(conflict.result,'needs-human-decision',JSON.stringify(conflict));
    const leafOverlap = conflict.conflict.overlaps.find((row) => row.kind === 'leaf');
    assert.equal(leafOverlap.incoming.nodeId,'10:7');
    assert.deepEqual(leafOverlap.regions,[null,{ x:190,y:30,w:10,h:70 }]);
    for (const choice of ['keep-manual','overwrite']) {
      const revised = structuredClone(meta);
      if (choice === 'overwrite') revised.nodes.find((row) => row.nodeId === '10:7').designBox.x = 190;
      const patched = await runCPatch({ ...request,decisionChoice:choice,decisionFingerprint:conflict.conflict.fingerprint,
        ...rawReference(root,revised,choice === 'keep-manual' ? 'white' : 'red',digest,{ leaf:true }) });
      assert.ok(patched.ok,JSON.stringify(patched));
      const next = json(join(patched.pagePack,'c2-build-meta.json')).nodes.find((row) => row.nodeId === '10:7');
      assert.equal(next.text,choice === 'keep-manual' ? '首页' : '首页首页');
      assert.equal(next.designBox.x,choice === 'keep-manual' ? 210 : 190);
    }
  });

test('C4：手机端原生叶节点移动只更新 mobile.css 的布局规则，并扩验真实屏',
  { skip:process.env.ONEPAGE_C4_BROWSER !== '1',timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,delta } = await setup(context,{ leaf:true,end:'mobile' });
    const out = join(root,'checks');
    const runDir = join(root,'rounds');
    mkdirSync(out);
    mkdirSync(runDir);
    const upstream = { scopeVersion:b3.scopeVersion,handoffPack:b3.pack,consumerContract:HANDOFF_CONSUMER };
    const base = await runCCheck({ ...upstream,pack:c2.pack,expectVersion:c2.version,out,...rawReference(root,meta,'white',undefined,{ leaf:true }) });
    assert.equal(base.status,'pass',JSON.stringify(base.rounds[0].problems));
    const change = await delta();
    const digest = checkDelta({ pack:change.pack,expectVersion:change.version }).manifestSha256;
    const revised = structuredClone(meta);
    revised.nodes.find((row) => row.nodeId === '10:7').designBox.x = 318;
    const patched = await runCPatch({ ...upstream,baseCheck:join(base.rounds[0].root,'stage-record.json'),baseCheckVersion:base.rounds[0].version,
      pagePack:c2.pack,pageVersion:c2.version,deltaPack:change.pack,deltaVersion:change.version,runDir,
      ...rawReference(root,revised,'white',digest,{ leaf:true }) });
    assert.ok(patched.ok,JSON.stringify(patched));
    const proof = json(join(patched.pack,'check/c4-patch-meta.json'));
    assert.deepEqual(proof.sharedAudit.changed,['page/css/mobile.css']);
    assert.ok(proof.sharedAudit.states.every((row) => row.end === 'mobile'));
    for (const path of ['css/styles.css','css/locales.css','js/config.js','js/main.js']) {
      assert.deepEqual(readFileSync(join(patched.pagePack,'page',path)),readFileSync(join(c2.pack,'page',path)));
    }
  });

test('C4：共享脚本或跨端共用样式的字节差异必须覆盖全部屏状态', () => {
  const files = { 'page/js/main.js':{ sha256:'before' }, 'page/css/mobile.css':{ sha256:'before' },
    'page/css/locales.css':{ sha256:'before' }, 'page/cn.html':{ sha256:'unrelated' } };
  const page = { nodes:[{ domId:'pc-home',nodeId:'pc',role:'sec',end:'pc'},{ domId:'mobile-home',nodeId:'mobile',role:'sec',end:'mobile' },
    { domId:'mobile-tab',nodeId:'tab',scope:'page',role:'tab',end:'mobile',module:'mobile' },
    { domId:'mobile-panel',nodeId:'panel',scope:'page',end:'mobile',module:'mobile' }],
  tabBindings:[{ end:'mobile',tab:{ id:'tab',scope:'page' },switch:{ id:'switch',scope:'page' },panel:{ id:'panel',scope:'page' } }],
  files:Object.fromEntries(Object.keys(files).map((path) => [path,{ sha256:'after' }])) };
  const expansion = sharedExpansion(page,files);
  assert.deepEqual(expansion.changed,['page/css/locales.css','page/css/mobile.css','page/js/main.js']);
  const pixels = expansion.states.map(({ screen,caseId }) => ({ screenId:screen,domId:screen,caseId,region:null,status:'pass' }));
  assert.ok(expansion.states.some((row) => row.caseId === 'mobile-tab'));
  assert.throws(() => verifySharedExpansion(page,{ pixels:pixels.filter((row) => row.caseId !== 'mobile-tab') },expansion),/缺同版整屏证据/);
  assert.doesNotThrow(() => verifySharedExpansion(page,{ pixels },expansion));
});
