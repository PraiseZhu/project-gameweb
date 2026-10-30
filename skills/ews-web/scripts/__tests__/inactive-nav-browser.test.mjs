import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {applyTestBrowserEnv} from './helpers/browser-env.mjs';
import {buildSyntheticDemo} from './helpers/build-demo.mjs';
import {openBrowserSession} from '../lib/browser-session.mjs';
applyTestBrowserEnv();
test('invisible nav descendants cannot intercept clicks even with explicit pointer events', async()=>{
 const {out}=buildSyntheticDemo('ews-inactive-nav-');
 const session=await openBrowserSession({skillRoot:fileURLToPath(new URL('../..',import.meta.url)),demoDir:out});
 assert.equal(session.ok,true,JSON.stringify(session.problems));
 try{
  const page=await session.browser.newPage({viewport:{width:400,height:300}});
  await page.setContent('<nav class="ews-nav"><div id="first" class="ews-nav-layer" data-nav-active="1"><button id="a" data-nav-screen="a" style="position:absolute;left:10px;top:10px;width:100px;height:50px;pointer-events:auto">A</button></div><div id="second" class="ews-nav-layer" data-nav-active="0"><button id="b" data-nav-screen="b" style="position:absolute;left:10px;top:10px;width:100px;height:50px;pointer-events:auto">B</button></div></nav>');
  await page.addStyleTag({content:readFileSync(new URL('../../assets/runtime/ews.css',import.meta.url),'utf8')});
  await page.evaluate(()=>{document.documentElement.dataset.pageInteraction='live';window.hits=[];document.querySelectorAll('button').forEach(b=>b.onclick=()=>window.hits.push(b.id));});
  await page.mouse.click(30,30);
  assert.deepEqual(await page.evaluate(()=>window.hits),['a']);
  await page.evaluate(()=>{document.querySelector('#first').dataset.navActive='0';document.querySelector('#second').dataset.navActive='1';});
  await page.mouse.click(30,30);
  assert.deepEqual(await page.evaluate(()=>window.hits),['a','b']);
  await page.evaluate(()=>{
   document.body.innerHTML='<button id="arrow" style="position:absolute;left:10px;top:100px;width:100px;height:50px">Next</button><div class="ews-paged-page" data-paged-active="0" style="position:absolute;left:10px;top:100px;width:100px;height:50px"><div style="width:100%;height:100%;pointer-events:auto">Invisible card</div></div>';
   document.querySelector('#arrow').onclick=()=>window.hits.push('arrow');
  });
  await page.mouse.click(30,120);
  assert.deepEqual(await page.evaluate(()=>window.hits),['a','b','arrow']);
 }finally{await session.close();}
});
