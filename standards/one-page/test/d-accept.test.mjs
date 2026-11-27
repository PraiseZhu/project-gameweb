import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runAScope } from '../src/a-scope.mjs';
import { runBExtract } from '../src/b-extract.mjs';
import { runBSupplement } from '../src/b-supplement.mjs';
import { runBHandoff } from '../src/b-handoff.mjs';
import { runCAssets } from '../src/c-assets.mjs';
import { runCGenerate } from '../src/c-page-generate.mjs';
import { runCCheck } from '../src/c-check/index.mjs';
import { runCPatch } from '../src/c-patch.mjs';
import { checkEntry } from '../src/stage-record.mjs';
import { targetRegion } from '../src/c-check/pixel-scope.mjs';
import { byteDigest, HANDOFF_CONSUMER } from '../src/handoff-check.mjs';
import { projectConfigPath, writeProjectConfigAtomic } from '../src/project-config.mjs';
import { designInstruction } from '../src/d-accept.mjs';
import { inspectAcceptance, validateConfirmation, verifyPixels } from '../src/d-proof.mjs';
import { qaFitScale } from '../qa-shell/qa-chrome.mjs';
import { framePoint } from '../qa-shell/qa-comments.mjs';
import { launchChromium } from '../../stop1-figma-pixel/tool/src/resolve-playwright.mjs';
import { browserCaseMs, measureStage } from './browser-test-budget.mjs';

const json = (path) => JSON.parse(readFileSync(path));
const write = (path, value) => writeFileSync(path, JSON.stringify(value));
const digest = (path) => byteDigest(readFileSync(path));
const cli = fileURLToPath(new URL('../bin/d-accept.mjs', import.meta.url));
const viewport = { width:1280, height:720 };
const run = (mode, args) => JSON.parse(execFileSync(process.execPath, [cli, mode, ...args], { encoding:'utf8', timeout:10_000 }));

function fixtureRoot(context) {
  const checkout = realpathSync.native(fileURLToPath(new URL('../../..', import.meta.url)));
  const temp = join(checkout, '_tmp');
  try { mkdirSync(temp); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  assert.ok(lstatSync(temp).isDirectory() && realpathSync.native(temp) === temp);
  const root = mkdtempSync(join(temp, 'd-fixture-'));
  const original = lstatSync(root);
  context.after(() => {
    const current = lstatSync(root);
    assert.ok(realpathSync.native(root) === root && current.dev === original.dev && current.ino === original.ino);
    rmSync(root, { recursive:true });
  });
  return root;
}

test('D：fitScale、iframe 坐标及确认指纹拒绝边界', () => {
  assert.equal(qaFitScale(700, 300, 1600, 900), 1 / 3);
  assert.equal(qaFitScale(0, 300, 1600, 900), null);
  const frame = { contentWindow:{ innerWidth:1280, innerHeight:720 }, getBoundingClientRect:() => ({ left:200, top:50, width:640, height:360 }) };
  assert.deepEqual(framePoint(frame, 360, 140), { x:320, y:180 });
  assert.equal(framePoint(frame, 840, 50), null);
  assert.throws(() => validateConfirmation({ schema:'onepage-d-dialogue-confirmation/v1', basis:'合成', designer:'合成', fingerprint:'old' }, 'new'), /未绑定/);
  assert.throws(() => verifyPixels({ pixels:[{ engine:{ name:'pixelmatch', version:'1' }, parameters:{ threshold:1 } }] }, '/unused'), /规则或指纹/);
  assert.throws(() => inspectAcceptance({}), /C3 验包失败/);
});

function node(id, name, x, y, width, height, children = [], extra = {}) {
  return { id, name, type:'FRAME', children, absoluteBoundingBox:{ x,y,width,height }, ...extra };
}

async function produce(context) {
  const root = fixtureRoot(context);
  const text = node('10:8','名称@field=name',160,500,250,80,[],{ type:'TEXT', characters:'首页',
    style:{ fontFamily:'One Page Fixture', fontWeight:400, fontSize:32 } });
  const art = node('10:3','img/方块',100,100,540,240,[],{ type:'VECTOR', fills:[{ type:'SOLID',color:{r:1,g:0,b:0} }] });
  const modal = node('11:1','modal/详情',200,200,1200,500,[node('11:2','grp/正文',200,200,400,180)]);
  const list = node('10:7','list/奖励@data=list:rewards',160,500,900,200,[node('10:9','item/条目@template',160,500,300,170,[text])],{ layoutMode:'HORIZONTAL' });
  const first = node('10:2','sec/1-首页',0,0,3840,2160,[art,node('10:4','btn/详情@action=details',1600,160,1000,300),
    node('10:6','switch/轮播',160,500,900,200,[list]), node('10:10','btn/下一页@action=nextCard',1150,500,240,80),
    node('10:11','btn/上一页@action=previousCard',1150,620,240,80)]);
  const second = node('10:5','sec/2-后页',0,2200,3840,2160);
  const document = { id:'1:2',name:'D fixture',type:'CANVAS',children:[node('10:1','cn_pc',0,0,3840,4360,[first,second]),modal] };
  const fetchImpl = async (address) => {
    const url = new URL(address);
    if (url.hostname === 'd.fixture') return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="540" height="240" viewBox="0 0 540 240"><path fill="red" d="M0 0H540V240H0Z"/></svg>');
    assert.equal(url.hostname, 'api.figma.com');
    if (url.pathname.endsWith('/nodes')) return Response.json({ version:'123',nodes:{ '1:2':{ document } } });
    assert.equal(url.pathname, '/v1/images/DTEST');
    assert.equal(url.searchParams.get('ids'), art.id);
    return Response.json({ images:{ [art.id]:'https://d.fixture/art.svg' } });
  };
  const scope = { url:'https://www.figma.com/design/DTEST/fixture?node-id=1-2', languages:'cn', baseLanguage:'cn', platform:'pc',
    runRoot:join(root,'producer'), tokenValue:'d-fixture-token', fetchImpl };
  const draft = await runAScope(scope);
  assert.ok(draft.ok, JSON.stringify(draft));
  const args = { ...scope, runDir:draft.runDir };
  const font = readFileSync(new URL('./fixtures/fonts/one-page-static.otf', import.meta.url));
  const configPath = projectConfigPath(scope.runRoot,'DTEST','1:2');
  writeProjectConfigAtomic(configPath, { actions:{ details:{ type:'open-modal', targets:['modal/详情'] },
    nextCard:{ type:'next-page', targets:['switch/轮播'] }, previousCard:{ type:'previous-page', targets:['switch/轮播'] } },
    bindings:{ 'sec/1::switch/轮播':{ pagination:{ kind:'cards', list:'list/奖励', perPage:2 } } },
    fonts:{ faces:{ 'One Page Fixture/400':{ cn:'base' } }, resources:{ base:{ file:'base.otf', format:'otf', weights:[400], source:'fixture', license:'fixture license', digest:'sha256:' + byteDigest(font) } } } });
  writeFileSync(join(configPath,'..','base.otf'),font);
  const confirmed = await runAScope({ ...args, shownFp:draft.fingerprintPrefix, confirmQuote:'合成测试确认', confirmSource:'test' });
  assert.ok(confirmed.ok, JSON.stringify(confirmed));
  const b1 = await runBExtract(args);
  assert.ok(b1.ok, JSON.stringify(b1));
  const b2 = await runBSupplement({ ...args, fontDiscovery:{ directories:[] } });
  assert.equal(b2.result, 'pass', JSON.stringify(b2));
  const b3 = runBHandoff({ runDir:args.runDir, b2Version:json(b2.supplementPath).version });
  assert.ok(b3.ok, JSON.stringify(b3));
  const upstream = { pack:b3.pack, expectVersion:b3.version, scopeVersion:b3.scopeVersion, consumerContract:HANDOFF_CONSUMER };
  const c1 = await runCAssets({ ...upstream, runDir:join(root,'c1'), fetchImpl, tokenValue:scope.tokenValue });
  assert.ok(c1.ok, JSON.stringify(c1));
  const c2 = runCGenerate({ ...upstream, runDir:join(root,'c2'), assetsPack:c1.pack, assetsVersion:c1.version, assetsSha256:c1.manifestSha256 });
  assert.ok(c2.ok, JSON.stringify(c2));
  const meta = json(join(c2.pack,'c2-build-meta.json'));
  return { root, b3, c2, meta, art:meta.nodes.find((item) => item.nodeId === art.id), open:meta.nodes.find((item) => item.nodeId === '10:4') };
}

function references(root, meta, art, designDigest) {
  const dir = mkdtempSync(join(root,'ref-'));
  const screens = meta.nodes.filter((item) => item.role === 'sec').map((screen, index) => {
    const region = index === 0 ? targetRegion(meta, screen, art, viewport).region : null;
    const actions = meta.nodes.filter((item) => item.module === screen.nodeId && item.nodeId === '10:4');
    const rectangles = [...(region ? [['red',region]] : []), ...actions.map((action) => ['#efefef',targetRegion(meta,screen,action,viewport).region])];
    const bytes = execFileSync('python3',['-B','-c','from PIL import Image, ImageDraw; import json,sys; image=Image.new("RGB",(1280,720),"white"); [(ImageDraw.Draw(image).rectangle((x,y,x+w-1,y+h-1),fill=color)) for color,(x,y,w,h) in json.loads(sys.argv[1])]; image.save(sys.stdout.buffer,"PNG")',JSON.stringify(rectangles)]);
    const path = 'screen-' + index + '.png';
    writeFileSync(join(dir,path),bytes);
    return { end:screen.end, nodeId:screen.nodeId, viewport, path, sha256:byteDigest(bytes), local:[
      ...(region ? [{ domId:art.domId, region }] : []),
      ...actions.map((action) => ({ domId:action.domId,region:targetRegion(meta,screen,action,viewport).region })) ] };
  });
  const index = join(dir,'index.json');
  write(index,{ schema:'onepage-pixel-reference/v1',baseLanguage:meta.baseLanguage,scopeVersion:meta.scopeVersion,b3Digest:meta.b3.digest,c4DesignDigest:designDigest,screens });
  return { references:index, referencesSha256:digest(index) };
}

function cliArgs({ check, pagePack, pageVersion, checkVersion, scopeVersion }) {
  return ['--check',check,'--page-pack',pagePack,'--page-version',pageVersion,'--check-version',checkVersion,'--scope-version',scopeVersion];
}

test('D Chromium：同版 C3、外置 QA 样例/定位/焦点、C4 局部确认、CLI 签发及漂移阻断',
  { skip:process.env.ONEPAGE_D_BROWSER !== '1', timeout:browserCaseMs }, async (context) => {
    const { root,b3,c2,meta,art,open } = await produce(context);
    const out = join(root,'check');
    mkdirSync(out);
    const inputs = { scopeVersion:b3.scopeVersion, handoffPack:b3.pack, consumerContract:HANDOFF_CONSUMER };
    const checked = await measureStage('D C3 signed input',() => runCCheck({ ...inputs, pack:c2.pack, expectVersion:c2.version, out, ...references(root,meta,art) }));
    assert.equal(checked.status,'pass',JSON.stringify(checked.rounds[0].problems));
    const options = { check:join(checked.rounds[0].root,'stage-record.json'), pagePack:c2.pack, pageVersion:c2.version,
      checkVersion:checked.rounds[0].version, scopeVersion:b3.scopeVersion };
    const accepted = run('accept',cliArgs(options));
    assert.equal(accepted.binding.stage,'C3');
    const { startPreview } = await import('../src/d-preview.mjs');
    const preview = await startPreview({ ...options, ...inputs });
    const { browser } = await launchChromium();
    try {
      await measureStage('D Chromium preview',async () => {
        const page = await browser.newPage({ viewport, reducedMotion:'reduce', acceptDownloads:true });
        await page.goto(preview.url);
        const frame = () => page.frames().find((item) => item.url().includes('/product/'));
        await page.waitForFunction(() => document.querySelector('iframe').contentDocument?.documentElement.dataset.dataState === 'unpublished');
        assert.equal(await page.locator('#simulation').isVisible(),false);
        assert.equal(new URL(frame().url()).search,'');
        await frame().locator('#' + open.domId).click();
        await frame().locator('[role=dialog]').waitFor({ state:'visible' });
        await page.locator('#next').click();
        assert.equal(await frame().locator('[role=dialog]').isVisible(),false);
        await frame().locator('[data-screen="2"].is-current').waitFor();
        await page.locator('#previous').click();
        await frame().locator('#' + open.domId).click();
        await page.locator('#comment').focus();
        await page.keyboard.press('Escape');
        assert.equal(await frame().locator('[role=dialog]').isVisible(),false);
        assert.equal(await frame().evaluate(() => document.activeElement.id),open.domId);
        assert.equal(await frame().evaluate(() => document.querySelector('[data-screen]').dispatchEvent(new Event('copy',{ bubbles:true,cancelable:true }))),false);
        assert.equal(await page.locator('#comment').evaluate((textarea) => textarea.dispatchEvent(new Event('copy',{ bubbles:true,cancelable:true }))),true);
        const box = await frame().locator('#' + art.domId).boundingBox();
        await page.locator('#locate').click();
        await page.mouse.click(box.x + box.width / 2,box.y + box.height / 2);
        await page.locator('#comment').fill('调低不透明度');
        await page.locator('[type=submit]').click();
        await page.locator('#comment').fill('未定位意见');
        await page.locator('[type=submit]').click();
        const download = page.waitForEvent('download');
        await page.locator('#export').click();
        const exported = join(root,'comments.json');
        await (await download).saveAs(exported);
        const comments = json(exported);
        assert.equal(comments.fingerprint,accepted.fingerprint);
        assert.equal(comments.located[0].location.target.domId,art.domId);
        assert.deepEqual(comments.unlocated,[{ text:'未定位意见', location:null }]);
        assert.equal(comments.located[0].location.caseId,'default');
        for (const [name,state] of [['empty-list','ready'],['request-failure','unavailable'],['request-missing','unpublished'],['list-many','ready'],['success-full','ready']]) {
          const labels = await page.locator('#states option').allTextContents();
          assert.ok(labels.includes(name), name + ' 不在已核验 B3 样例：' + labels.join(', '));
          const old = frame().url();
          await page.locator('#states').selectOption({ label:name });
          await page.waitForFunction(({ name,state,old }) => {
            const iframe = document.querySelector('iframe');
            return iframe.src !== old && document.querySelector('#simulation').textContent.includes(name)
              && iframe.contentDocument?.URL === iframe.src && iframe.contentDocument.documentElement?.dataset.dataState === state;
          },{ name,state,old });
          const next = meta.nodes.find((node) => node.nodeId === '10:10');
          if (name === 'list-many') await frame().locator('#' + next.domId).waitFor({ state:'visible' });
          if (name === 'empty-list') assert.equal(await frame().locator('#' + next.domId).isVisible(),false);
          assert.equal(await page.locator('#simulation').isVisible(),true);
        }
        assert.equal((await fetch(new URL('/qa-preview/approve',preview.url),{ method:'POST' })).status,405);
        assert.equal((await fetch(new URL('/product/real/cn.html?product=1',preview.url))).status,404);
        await page.goto(new URL('../qa-shell/index.html',import.meta.url).href);
        assert.equal(await page.locator('#review').isVisible(),false);
        assert.match(await page.locator('#status').textContent(),/file:\/\//);
      });
    } finally { await browser.close(); await preview.close(); }
    assert.deepEqual(run('accept',cliArgs(options)),accepted);
    const current = inspectAcceptance(options);
    const { end,module,nodeId,domId } = art;
    const request = { target:{ end,module,nodeId,domId }, property:'opacity', value:0.55, caseId:'default', basis:'合成设计确认区域', fingerprint:accepted.fingerprint };
    assert.throws(() => designInstruction(current,{ ...request, caseId:'other' }),/未|必须/);
    const design = join(root,'design.json');
    write(design,designInstruction(current,request));
    const designSha256 = digest(design);
    const patchRoot = join(root,'patch');
    mkdirSync(patchRoot);
    const patched = await measureStage('D C4 designer-confirmed area',() => runCPatch({ ...inputs, ...options, baseCheck:options.check, baseCheckVersion:options.checkVersion,
      runDir:patchRoot,designPath:design,designSha256,...references(root,meta,art,designSha256) }));
    assert.equal(patched.result,'pass',JSON.stringify(patched));
    const after = { ...options, pagePack:join(patched.pack,'build'), check:join(patched.pack,'check/stage-record.json'),
      pageVersion:patched.pageVersion, checkVersion:patched.version };
    const repass = run('accept',cliArgs(after));
    assert.equal(repass.binding.stage,'C4');
    const confirmation = join(root,'confirmation.json');
    write(confirmation,{ schema:'onepage-d-dialogue-confirmation/v1',designer:'合成设计师',basis:'隔离测试对话确认',fingerprint:repass.fingerprint });
    const approvalRoot = join(root,'approval');
    mkdirSync(approvalRoot);
    const approveArgs = ['--confirmation',confirmation,'--confirmation-sha256',digest(confirmation),'--output',join(approvalRoot,'d1')];
    assert.throws(() => run('approve',[...cliArgs(options),...approveArgs]),/未绑定/);
    const approval = run('approve',[...cliArgs(after),...approveArgs]);
    const gate = { ...after,expectedStage:'D',expectedOutputKind:'d-design-approved',expectedOutputVersion:approval.version };
    assert.equal(checkEntry(approval.record,gate).ok,true);
    const report = json(join(patched.pack,'check/check-report.json'));
    const actual = join(patched.pack,'check',report.pixels.find((pixel) => pixel.designMasks?.length).artifacts.actual);
    const shot = readFileSync(actual);
    writeFileSync(actual,Buffer.alloc(0));
    assert.equal(checkEntry(approval.record,gate).ok,false);
    writeFileSync(actual,shot);
    const html = join(after.pagePack,'page/cn.html');
    writeFileSync(html,Buffer.concat([readFileSync(html),Buffer.from(' ')]));
    assert.equal(checkEntry(approval.record,gate).ok,false);
  });
