import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runCAssets } from '../src/c-assets.mjs';
import { runCCheck } from '../src/c-check/index.mjs';
import { runCGenerate } from '../src/c-page-generate.mjs';
import { approve } from '../src/d-accept.mjs';
import { inspectAcceptance } from '../src/d-proof.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { buildStageRecord, checkEntry } from '../src/stage-record.mjs';
import { sha256Hex } from '../src/canonical.mjs';
import { runtime } from '../src/c-page-runtime.mjs';
import { isolatedOutputRoot, planAdjustments, runEBuild, verifyLocaleImage } from '../src/e-multilang/e-build.mjs';
import { fileHashes, languageFilterCases, measureLocale } from '../src/e-multilang/e-check.mjs';
import { indexVisualFingerprints } from '../src/visual-fingerprint.mjs';
import { auditCopy, checkedLocale, translationIndex } from '../src/e-multilang/locale-copy-audit.mjs';
import { fitGroup, fitGroups, localeSelector, readLocaleLocks } from '../src/e-multilang/locale-css-fit.mjs';
import { localeConfig, localeHtml, localeRuntime, regionalActions } from '../src/e-multilang/locale-html.mjs';
import { browserCaseMs, measureStage } from './browser-test-budget.mjs';

test('E：译文、缺字、占位符、RTL 和独立排版组失败闭锁', async () => {
  const font = readFileSync(new URL('./fixtures/fonts/one-page-variable.otf', import.meta.url));
  assert.equal(auditCopy({ source:'首页', translation:'A', font, target:'pc:1' }).text, 'A');
  assert.deepEqual(auditCopy({ source:'首页', target:'pc:1' }), { text:'—', untranslated:true, warnings:[] });
  assert.equal(auditCopy({ source:'首页', translation:' A ', font, target:'pc:1' }).warnings.length, 1);
  assert.throws(() => auditCopy({ source:'{count}', translation:'A', font, target:'pc:1' }), /占位符/);
  assert.throws(() => auditCopy({ source:'首页', translation:'Z', font, target:'pc:1' }), /缺字/);
  assert.throws(() => checkedLocale('ar'), /RTL/);
  const row = { end:'pc', screen:'first', parent:'cluster', role:'copy', fontPx:15, overflow:true, id:'first' };
  const grouped = fitGroups([row, { ...row, id:'same', overflow:false }, { ...row, id:'different', screen:'second', overflow:false }]);
  assert.deepEqual(grouped.map((group) => group.map(({ id }) => id)), [['first','same'],['different']]);
  assert.deepEqual(fitGroup(grouped[0]).map(({ scale }) => scale), [.8,.8]);
  assert.deepEqual(fitGroup(grouped[1]), []);
  assert.throws(() => fitGroup([{ ...row, locked:true }]), /锁定/);
  assert.throws(() => fitGroup([{ ...row, fontPx:11 }]), /底线/);
  assert.equal(localeSelector('zh-TW','copy-1'), 'html:lang(zh-TW) #copy-1');
  assert.throws(() => localeSelector('en','broken input'), /锚点/);
  const translation = { end:'pc', nodeId:'1', characters:'首页', byLang:{ en:'A' } };
  assert.equal(translationIndex({ matched:[translation], pending:[translation] }, 'en').size, 1);
  assert.throws(() => translationIndex({ matched:[translation], pending:[{ ...translation, byLang:{ en:'B' } }] }, 'en'), /冲突/);
  assert.match((await runEBuild({})).reason, /D 验包失败/);
});

test('E Chromium：独立 HTML 同源骨架、纯文案替换、模板与精确缺译标记',
  { skip:process.env.ONEPAGE_E_BROWSER !== '1', timeout:browserCaseMs }, async () => {
    const { browser } = await launchChromium();
    try {
      const context = await browser.newContext({ serviceWorkers:'block' });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      const source = '<!doctype html><html lang="zh-CN"><head><title>首页</title><script src="js/config.js" defer></script></head>'
        + '<body><h1 id="title"><span data-slogan-ink>首页</span></h1><p id="pending">金币</p><template><p id="pending">金币</p></template></body></html>';
      const locale = { lang:'en', tag:'en', images:[], rows:[{ id:'title', source:'首页', text:'<b>Home</b>' },
        { id:'pending', source:'金币', text:'—', untranslated:true }] };
      const html = await localeHtml(page, source, locale, 'zh-CN');
      await page.setContent(html);
      assert.equal(await page.locator('html').getAttribute('lang'), 'en');
      assert.equal(await page.title(), '<b>Home</b>');
      assert.equal(await page.locator('h1 span').textContent(), '<b>Home</b>');
      assert.equal(await page.locator('h1 b').count(), 0);
      assert.equal(await page.locator('[data-untranslated]').count(), 1);
      assert.equal(await page.locator('template').evaluate((node) => node.content.querySelector('[data-untranslated]').textContent), '—');
      assert.equal(await page.locator('script').getAttribute('src'), 'js/config-en.js');
      assert.equal(await page.evaluate((script) => JSON.parse(JSON.parse(script.match(/JSON.parse\((.*)\);/)[1])).language,
        localeConfig('window.OnePageConfig = JSON.parse("{\\"language\\":\\"zh-CN\\"}");', 'en')), 'en');
      await assert.rejects(localeHtml(page, source, { ...locale, rows:[{ ...locale.rows[0], source:'wrong' }] }, 'zh-CN'), /漂移/);
    } finally { await browser.close(); }
  });

const frame = (id, name, width, height, children, extra) => ({ id, name, type:'FRAME', children,
  absoluteBoundingBox:{ x:0,y:0,width,height }, ...extra });
const jsonFile = (path) => JSON.parse(readFileSync(path));

test('E：拒绝重叠路径和悬空输出别名，不创建目录', (context) => {
  const root = repairFixture(context);
  const input = join(root,'input');
  mkdirSync(input);
  const alias = join(root,'alias');
  symlinkSync(input,alias,'junction');
  const dangling = join(root,'dangling');
  symlinkSync(join(root,'absent'),dangling,'junction');
  for (const output of [input,root,join(input,'new','out'),join(alias,'new','out')]) {
    assert.throws(() => isolatedOutputRoot(output,[input]),/物理分离/);
  }
  assert.throws(() => isolatedOutputRoot(join(dangling,'out'),[input]),/ENOENT/);
  const sibling = join(root,'input-sibling','out');
  assert.equal(isolatedOutputRoot(sibling,[alias]),sibling);
  for (const path of [sibling,join(input,'new'),join(root,'absent')]) assert.equal(existsSync(path),false);
});

function repairFixture(context) {
  const temp = join(realpathSync(fileURLToPath(new URL('../../..', import.meta.url))), '_tmp');
  mkdirSync(temp,{ recursive:true });
  assert.equal(realpathSync(temp),temp);
  const root = mkdtempSync(join(temp,'e-repair-'));
  context.after(() => rmSync(root,{ recursive:true,force:true }));
  return root;
}

test('E CLI：隔离 .env 认证外语图快照及渲染，父进程 token 优先', (context) => {
  const root = repairFixture(context);
  const standards = fileURLToPath(new URL('../..',import.meta.url));
  const mirror = join(root,'standards');
  cpSync(standards,mirror,{ recursive:true,filter: (source) => !/^(?:\.env(?:\..*)?|node_modules|_tmp|\.cache)$/.test(basename(source)) });
  const envToken = 'e-cli-test-env-token';
  const inherited = 'e-cli-test-inherited-token';
  writeFileSync(join(mirror,'figma-naming/tool/.env'),'FIGMA_ACCESS_TOKEN='+envToken+'\n');
  const input = join(root,'input');
  mkdirSync(join(input,'page/assets'),{ recursive:true });
  mkdirSync(join(input,'page/css'));
  mkdirSync(join(input,'page/js'));
  const files = { 'page/assets/manifest.json':'{"assets":[]}', 'page/css/locales.css':'/* fixture */', 'page/js/main.js':'/* fixture */' };
  for (const [name,bytes] of Object.entries(files)) writeFileSync(join(input,name),bytes);
  const shape = { id:'1:3',type:'RECTANGLE',fills:[{ type:'SOLID' }] };
  const document = { id:'1:2',type:'CANVAS',children:[shape] };
  const plan = { end:'pc',nodeId:shape.id,scope:'page',fileKey:'ETEST',visualFingerprint:indexVisualFingerprints(document).get(shape.id) };
  const dir = join(mirror,'one-page/src/e-multilang');
  const checker = join(dir,'e-check.mjs');
  const locale = join(dir,'locale-html.mjs');
  writeFileSync(checker,readFileSync(checker,'utf8').replace('export function checkInputs(options)', 'function realCheckInputs(options)')
    + '\nexport function checkInputs() { return '+JSON.stringify({ targets:['en'],meta:{ baseLanguage:'cn',files:Object.fromEntries(Object.entries(files)
      .map(([name,bytes]) => [name,{ bytes:Buffer.byteLength(bytes),sha256:byteDigest(bytes) }])) }, b3:{ manifest:{ scope:{ fileKey:'ETEST',fileVersion:'1',nodeId:'1:2' } } } })+'; }\n');
  writeFileSync(locale,readFileSync(locale,'utf8').replace('export function prepareLocale(', 'function realPrepareLocale(')
    + '\nexport function prepareLocale() { return { lang:"en", lists:{}, images:[{ plan:'+JSON.stringify(plan)+' }], byEnd:{ pc:new Map([["1:3",{ role:"img",box:{ x:0,y:0,w:8,h:8 } }]]) } }; }\n');
  const preload = join(root,'fetch.mjs');
  writeFileSync(preload, 'import { writeFileSync } from "node:fs";\n'
    + 'const requests = []; globalThis.fetch = async (address, options) => {\n'
    + ' const url = new URL(address); if (url.origin !== "https://api.figma.com") throw Error("unexpected fixture URL");\n'
    + ' const authorized = new Headers(options.headers).get("X-Figma-Token") === process.env.TEST_EXPECTED_TOKEN;\n'
    + ' requests.push({ path:url.pathname, authorized }); writeFileSync(process.env.TEST_REQUESTS,JSON.stringify(requests));\n'
    + ' if (!authorized || url.pathname === "/v1/images/ETEST") return new Response(null,{status:403});\n'
    + ' return Response.json({version:"1",nodes:{"1:2":{document:'+JSON.stringify(document)+'}}});\n};\n');
  for (const [name,token] of [['dotenv',envToken],['inherited',inherited]]) {
    const requests = join(root,name+'.json');
    const env = { ...process.env,TEST_EXPECTED_TOKEN:token,TEST_REQUESTS:requests };
    delete env.FIGMA_ACCESS_TOKEN;
    delete env.NODE_OPTIONS;
    if (name==='inherited') env.FIGMA_ACCESS_TOKEN = inherited;
    const child = spawnSync(process.execPath,['--import',preload,join(mirror,'one-page/bin/e-build.mjs'),
      '--page-pack',input,'--handoff-pack',input,'--assets-pack',input,'--approval',join(input,'approval.json'),
      '--check',join(input,'check.json'),'--run-dir',join(root,name)],{ cwd:root,env,encoding:'utf8',timeout:10000 });
    assert.equal((child.stdout+child.stderr).includes(token),false);
    assert.equal(child.status,1,child.error?.message);
    assert.match(JSON.parse(child.stdout).reason,/没有权限/);
    assert.deepEqual(jsonFile(requests),[{ path:'/v1/files/ETEST/nodes',authorized:true },{ path:'/v1/images/ETEST',authorized:true }]);
  }
});

test('E：素材尺寸、人工锁、地区动作及 H31 路径边界', () => {
  const image = { width:200,height:100,box:{ w:200,h:100 },path:'assets/en.png' };
  assert.equal(verifyLocaleImage(image,image,'hero'),'assets/en.png');
  for (const next of [{ ...image,width:400,height:200 },{ ...image,height:90 },{ ...image,box:{ w:200,h:110 } },undefined]) {
    assert.throws(() => verifyLocaleImage(image,next,'hero'), /尺寸或比例.*hero/);
  }
  const css = '/* localeOverrides:start */\nhtml:lang(en) #copy{font-size:16px}\n/* localeOverrides:end */';
  const row = { id:'copy', end:'pc', screen:'one', parent:'block', role:'text', fontPx:16,fontLoaded:true,overflow:true };
  assert.deepEqual(readLocaleLocks(css,'en',[row]),['copy']);
  assert.throws(() => readLocaleLocks(css,'en',[]), /未知/);
  const locale = { tag:'en',rules:new Set(),lists:{ adjustments:[] } };
  for (const round of [0,1]) {
    assert.throws(() => planAdjustments(locale,[{ rows:[{ ...row,locked:true }] }],round), /锁定/);
    assert.equal(locale.rules.size,0);
    assert.deepEqual(locale.lists.adjustments,[]);
  }
  assert.throws(() => planAdjustments(locale,[{ rows:[row] }],2), /两轮/);
  const config = { actions:{ social:{ type:'open-link',key:'we' },ordinary:{ type:'open-link',key:'plain' } },
    social:{ we:{ platform:'wechat',regions:['zh-CN'] } } };
  assert.deepEqual(regionalActions(configScript(config),'en'),['social']);
  assert.deepEqual(regionalActions(configScript(config),'zh-CN'),[]);
  assert.throws(() => localeRuntime('different runtime',[{ owner:'list',path:['rows'] }]), /插入点/);
});

const configScript = (config) => 'window.OnePageConfig = JSON.parse(' + JSON.stringify(JSON.stringify(config)) + ');\n';

test('E Chromium：双端九档遍历两 TAB 与弹层，定位遮挡、溢出并实测非空数据过滤归零',
  { skip:process.env.ONEPAGE_E_BROWSER !== '1', timeout:browserCaseMs }, async (context) => {
    const temp = join(realpathSync(fileURLToPath(new URL('../../..', import.meta.url))), '_tmp');
    mkdirSync(temp,{ recursive:true });
    assert.equal(realpathSync(temp),temp);
    const root = mkdtempSync(join(temp,'e-layout-'));
    context.after(() => rmSync(root,{ recursive:true,force:true }));
    const ends = ['pc','mobile'];
    const config = { language:'en', bindings:{},actions:{},social:{} };
    const meta = { ends,nodes:[] };
    const fields = [{ language:'by-language',languageMissing:'hide-item',locations:[] }];
    const rows = [];
    const html = ends.map((end) => {
      config.actions[end+'-open'] = { type:'open-modal',targets:[end+'-modal'] };
      config.bindings[end+'-list'] = { data:{ kind:'list',path:['cards'] } };
      config.bindings[end+'-field'] = { fields:{ field:{ target:'text',path:['cards',{ itemOf:'list' },'title'] } } };
      config.bindings[end+'-paging'] = { pagination:{ list:end+'-list',perPage:1 } };
      meta.nodes.push({ end,nodeId:'list',domId:end+'-list' },{ end,nodeId:'field',domId:end+'-field' });
      fields[0].locations.push({ end,nodeId:'field' });
      for (const suffix of ['first','second','modal-copy']) rows.push({ end,id:end+'-'+suffix,untranslated:true });
      return '<div data-device="'+end+'"><section class="screen" data-screen="one" id="'+end+'-screen">'
        + '<button data-tab-group="'+end+'-tabs" data-tab-target="'+end+'-panel-a" data-content-key="a" id="'+end+'-tab-a">One</button>'
        + '<button data-tab-group="'+end+'-tabs" data-tab-target="'+end+'-panel-b" data-content-key="b" id="'+end+'-tab-b">Two</button>'
        + '<div id="'+end+'-panel-a"><p id="'+end+'-first">First</p></div>'
        + '<div id="'+end+'-panel-b" hidden inert><p id="'+end+'-second">Second</p><span id="'+end+'-cover"></span><button data-action id="'+end+'-open">Open</button></div>'
        + '<div data-carousel="'+end+'-carousel" id="'+end+'-paging"><div id="'+end+'-list" data-node-key="list"><template data-item-template><div data-carousel-item><span id="'+end+'-field">Card</span></div></template></div>'
        + '<div data-empty-for="'+end+'-list" hidden inert>Empty</div></div></section>'
        + '<section data-overlay id="'+end+'-modal" hidden inert><p id="'+end+'-modal-copy">Details</p></section></div>';
    }).join('');
    const samples = [{ id:'success-full',testData:true,data:{ cards:[{ title:{ zh_CN:'卡片',en_US:'Card' } }] } }];
    const filterCases = languageFilterCases({ fields,samples,config,meta,lang:'en' });
    const baseRuntime = '(' + runtime.toString() + ')();\n';
    const css = 'html{font:16px sans-serif}[hidden]{display:none!important}p{width:max-content}';
    const render = (script, styles = '') => {
      writeFileSync(join(root,'en.html'), '<!doctype html><html lang="en"><head><style>'
        + css + styles + '</style><script src="config.js" defer></script><script src="runtime.js" defer></script></head><body>'
        + html + '<output id="site-status"></output></body></html>');
      writeFileSync(join(root,'runtime.js'),script);
    };
    writeFileSync(join(root,'config.js'),configScript(config));
    render(localeRuntime(baseRuntime,filterCases));
    const { browser } = await launchChromium();
    const locale = { lang:'en',tag:'en',rows,filterCases };
    try {
      const measured = await measureStage('E dual viewport and H31',() => measureLocale(browser,root,locale,meta));
      for (const end of ends) for (const state of ['-screen','-screen:'+end+'-tab-a','-screen:'+end+'-tab-b','-screen:'+end+'-tab-b:'+end+'-open']) {
        assert.equal(measured.filter((record) => record.end===end && record.state===end+state).length,9);
      }
      assert.equal(measured.filter((record) => record.state.startsWith('H31:') && record.empty && record.items===0).length,2);
      assert.equal(measured.flatMap((record) => record.rows).some((row) => row.overflow || row.occluded),false);
      render(baseRuntime);
      await assert.rejects(measureLocale(browser,root,{ ...locale,rows:[] },{ ends:['pc'] }), /H31.*"items":1.*"empty":false/);
      render(localeRuntime(baseRuntime,filterCases),'#pc-modal-copy{transform:translateX(-100vw)}#mobile-panel-b{position:relative}#mobile-cover{position:absolute;top:0;left:0;width:100px;height:18px;background:black}');
      const negative = await measureLocale(browser,root,{ ...locale,filterCases:[] },meta);
      assert.ok(negative.some((record) => record.state.endsWith('pc-open') && record.rows.some((row) => row.id==='pc-modal-copy' && row.overflow)));
      assert.ok(negative.some((record) => record.state.endsWith('mobile-tab-b') && record.rows.some((row) => row.id==='mobile-second' && row.occluded)));
      assert.throws(() => planAdjustments({ tag:'en' },negative,0),/遮挡/);
    } finally { await browser.close(); }
  });

test('E Chromium：同版 A→D 合成凭证生成英语页，基础文件不变且漂移拒跑',
  { skip:process.env.ONEPAGE_E_BROWSER !== '1', timeout:browserCaseMs }, async (context) => {
    const temp = join(realpathSync(fileURLToPath(new URL('../../..', import.meta.url))), '_tmp');
    mkdirSync(temp, { recursive:true });
    assert.equal(realpathSync(temp), temp);
    const root = mkdtempSync(join(temp, 'e-fixture-'));
    context.after(() => rmSync(root, { recursive:true, force:true }));
    const word = frame('10:3','标题',600,130,[],{ type:'TEXT', characters:'首页', style:{ fontFamily:'One Page Fixture',fontWeight:400,fontSize:44 } });
    const section = frame('10:2','sec/1-首页',3840,2160,[word]);
    const document = { id:'1:2',name:'E fixture',type:'CANVAS',children:[frame('10:1','cn_pc',3840,2160,[section])] };
    const fetchImpl = async (address) => {
      assert.equal(new URL(address).hostname, 'api.figma.com');
      return Response.json({ version:'1', nodes:{ '1:2':{ document } } });
    };
    const options = { url:'https://www.figma.com/design/ETEST/fixture?node-id=1-2', languages:'cn,en', baseLanguage:'cn', platform:'pc',
      runRoot:join(root,'producer'), tokenValue:'e-offline-synthetic-token', fetchImpl };
    const draft = await runAScope(options);
    assert.ok(draft.ok, JSON.stringify(draft));
    const sourceOptions = { ...options, runDir:draft.runDir };
    const configPath = projectConfigPath(options.runRoot,'ETEST','1:2');
    const base = readFileSync(new URL('./fixtures/fonts/one-page-variable.otf', import.meta.url));
    const english = Buffer.from(readFileSync(new URL('./fixtures/fonts/e-copy-fixture.otf.base64', import.meta.url), 'utf8'), 'base64');
    const font = (file, bytes) => ({ file, format:'otf', weights:[400], source:'fixture', license:'fixture license', digest:'sha256:' + byteDigest(bytes) });
    writeProjectConfigAtomic(configPath, { fonts:{ faces:{ 'One Page Fixture/400':{ cn:'cn',en:'en' } },
      resources:{ cn:font('cn.otf',base), en:font('en.otf',english) } } });
    writeFileSync(join(dirname(configPath),'cn.otf'),base);
    writeFileSync(join(dirname(configPath),'en.otf'),english);
    const l10nSnapshot = join(root,'translations.json');
    writeFileSync(l10nSnapshot, JSON.stringify({ values:[['简中','英语'],['首页','Home']] }));
    const confirmed = await runAScope({ ...sourceOptions, shownFp:draft.fingerprintPrefix, confirmQuote:'合成测试确认', confirmSource:'test' });
    assert.ok(confirmed.ok, JSON.stringify(confirmed));
    const extracted = await runBExtract(sourceOptions);
    assert.ok(extracted.ok, JSON.stringify(extracted));
    const supplemented = await runBSupplement({ ...sourceOptions, l10nSnapshot, fontDiscovery:{ directories:[] } });
    assert.equal(supplemented.result,'pass',JSON.stringify(supplemented));
    const b3 = runBHandoff({ runDir:draft.runDir, b2Version:jsonFile(supplemented.supplementPath).version });
    assert.ok(b3.ok, JSON.stringify(b3));
    const upstream = { pack:b3.pack, expectVersion:b3.version, scopeVersion:b3.scopeVersion, consumerContract:HANDOFF_CONSUMER };
    const c1 = await runCAssets({ ...upstream, runDir:join(root,'c1'), fetchImpl, tokenValue:options.tokenValue });
    assert.ok(c1.ok, JSON.stringify(c1));
    const assets = { assetsPack:c1.pack, assetsVersion:c1.version, assetsSha256:c1.manifestSha256 };
    const c2 = runCGenerate({ ...upstream, ...assets, runDir:join(root,'c2') });
    assert.ok(c2.ok, JSON.stringify(c2));
    const metaPath = join(c2.pack,'c2-build-meta.json');
    const stagePath = join(c2.pack,'stage-record.json');
    const { version:initialVersion,...pageBody } = jsonFile(metaPath);
    assert.equal(initialVersion,c2.version);
    const title = pageBody.nodes.find((node) => node.nodeId===word.id);
    const lockCss = '/* localeOverrides:start */\nhtml:lang(en) #' + title.domId + '{letter-spacing:1px}\n/* localeOverrides:end */\n';
    const cssPath = 'page/css/locales.css';
    writeFileSync(join(c2.pack,cssPath),lockCss);
    pageBody.files[cssPath] = { bytes:Buffer.byteLength(lockCss),sha256:byteDigest(lockCss) };
    const meta = { ...pageBody,version:sha256Hex(pageBody) };
    const metaBytes = JSON.stringify(meta);
    const { version:initialStageVersion,...stageBody } = jsonFile(stagePath);
    assert.equal(initialStageVersion,sha256Hex(stageBody));
    writeFileSync(metaPath,metaBytes);
    writeFileSync(stagePath,JSON.stringify(buildStageRecord({ ...stageBody,output:{ ...stageBody.output,version:meta.version,digest:byteDigest(metaBytes) } })));
    const viewport = { width:1280,height:720 };
    const png = execFileSync('python3',['-B','-c','from PIL import Image; import sys; Image.new("RGB",(1280,720),"white").save(sys.stdout.buffer,"PNG")']);
    const refs = join(root,'refs');
    mkdirSync(refs);
    writeFileSync(join(refs,'screen.png'),png);
    const index = Buffer.from(JSON.stringify({ schema:'onepage-pixel-reference/v1',baseLanguage:meta.baseLanguage,scopeVersion:meta.scopeVersion,
      b3Digest:meta.b3.digest,screens:[{ end:'pc',nodeId:section.id,viewport,path:'screen.png',sha256:byteDigest(png),local:[] }] }));
    const references = join(refs,'index.json');
    writeFileSync(references,index);
    const out = join(root,'c3');
    mkdirSync(out);
    const checked = await measureStage('E approved fixture C3',() => runCCheck({ ...upstream, handoffPack:b3.pack,
      pack:c2.pack, expectVersion:meta.version, out, references, referencesSha256:byteDigest(index) }));
    assert.equal(checked.status,'pass',JSON.stringify(checked.rounds?.[0]?.problems ?? checked));
    const approvalInput = { check:join(checked.rounds[0].root,'stage-record.json'), pagePack:c2.pack, pageVersion:meta.version,
      checkVersion:checked.rounds[0].version, scopeVersion:b3.scopeVersion };
    const acceptance = inspectAcceptance(approvalInput);
    const confirmation = join(root,'confirmation.json');
    const confirmationBytes = Buffer.from(JSON.stringify({ schema:'onepage-d-dialogue-confirmation/v1', designer:'合成夹具', basis:'仅用于测试', fingerprint:acceptance.fingerprint }));
    writeFileSync(confirmation,confirmationBytes);
    const approvalRoot = join(root,'approval');
    mkdirSync(approvalRoot);
    const approved = approve({ ...approvalInput, output:join(approvalRoot,'approved'), confirmation, confirmationSha256:byteDigest(confirmationBytes) });
    const eInputs = { ...approvalInput, ...assets, approval:approved.record, approvalVersion:approved.version, handoffPack:b3.pack, handoffVersion:b3.version,
      consumerContract:HANDOFF_CONSUMER, runDir:join(root,'e') };
    const approvalDir = dirname(approved.record);
    const checkDir = dirname(approvalInput.check);
    const forbiddenAlias = join(root,'c2-alias');
    symlinkSync(c2.pack,forbiddenAlias,'junction');
    for (const source of [c2.pack,b3.pack,c1.pack,approvalDir,checkDir,forbiddenAlias]) {
      const physical = realpathSync(source);
      const before = fileHashes(physical);
      const forbidden = join(source,'never-created','e');
      const rejected = await runEBuild({ ...eInputs,runDir:forbidden });
      assert.equal(rejected.result,'stopped');
      assert.match(rejected.reason,/物理分离/);
      assert.deepEqual(fileHashes(physical),before);
      assert.equal(existsSync(dirname(forbidden)),false);
    }
    const built = await measureStage('E Chromium build',() => runEBuild(eInputs));
    assert.equal(built.result,'pass',JSON.stringify(built));
    const verified = checkEntry(built.stagePath, { expectedStage:'E', expectedOutputKind:'e-multilang', expectedOutputVersion:built.version, scopeVersion:b3.scopeVersion });
    assert.ok(verified.ok, verified.reason);
    for (const file of ['cn.html','css/styles.css','css/mobile.css','js/main.js']) {
      assert.deepEqual(readFileSync(join(built.pack,'page',file)),readFileSync(join(c2.pack,'page',file)));
    }
    assert.match(readFileSync(join(built.pack,'page/en.html'),'utf8'), /Home/);
    assert.match(readFileSync(join(built.pack,'page/css/locales.css'),'utf8'), /html:lang\(en\)/);
    const rebuilt = await measureStage('E same D input, next round',() => runEBuild(eInputs));
    assert.equal(rebuilt.result,'pass',JSON.stringify(rebuilt));
    assert.notEqual(rebuilt.pack,built.pack);
    for (const output of [built,rebuilt]) {
      const css = readFileSync(join(output.pack,'page/css/locales.css'),'utf8');
      assert.equal(css.slice(css.indexOf('/* localeOverrides:start */')),lockCss);
      assert.deepEqual(jsonFile(join(output.pack,'locale-adjustments.json')).en,{ locks:[title.domId],adjustments:[] });
    }
    assert.equal((await runEBuild({ ...eInputs, assetsSha256:'0'.repeat(64) })).result, 'stopped');
    const changed = join(c2.pack,'page/cn.html');
    writeFileSync(changed,'\n',{ flag:'a' });
    assert.equal((await runEBuild(eInputs)).result,'stopped');
  });
