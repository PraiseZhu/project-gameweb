import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {applyTestBrowserEnv} from './helpers/browser-env.mjs';
import {buildSyntheticDemo} from './helpers/build-demo.mjs';
import {openBrowserSession} from '../lib/browser-session.mjs';
applyTestBrowserEnv();
test('localized repeated card text shares the smallest fitted size without shrinking source or another slot', {timeout:60000},async()=>{
 const {out}=buildSyntheticDemo('ews-font-groups-');
 const session=await openBrowserSession({skillRoot:fileURLToPath(new URL('../..',import.meta.url)),demoDir:out});
 assert.equal(session.ok,true);
 try{
  const page=await session.browser.newPage();await page.goto(session.base+'/index.html?product=1');
  const result=await page.evaluate(async()=>{
   const {applyTranslationLayout}=await import('./runtime/text-style.mjs');
   const root=document.createElement('div');root.className='ews-root';root.dataset.sourceLocale='zh-CN';root.dataset.locale='en';
   root.style.cssText='position:absolute;left:0;top:0;width:600px;font-family:Arial;';
   root.innerHTML='<section class="ews-screen" data-section-id="group-test">'+['I','II','LONG'].map((text,i)=>'<div class="ews-node" data-component-id="card" style="position:absolute;left:'+i*160+'px;top:0;width:140px;height:100px"><div class="ews-node" data-figma-type="TEXT" data-font-size="40" data-line-height="40" data-autoresize="HEIGHT" data-max-width="100" data-max-height="40" data-designed-lines="1" style="position:absolute;left:0;top:0;width:100px;height:40px;font-size:40px;line-height:40px">'+text+'</div><div class="ews-node" data-figma-type="TEXT" data-font-size="18" data-line-height="22" data-autoresize="HEIGHT" data-max-width="100" data-max-height="22" data-designed-lines="1" style="position:absolute;left:0;top:50px;width:100px;height:22px;font-size:18px;line-height:22px">Detail</div></div>').join('')+'</section>';
   document.body.append(root);
   const read=()=>[...root.querySelectorAll('[data-figma-type="TEXT"]')].map(e=>parseFloat(e.style.fontSize));
   applyTranslationLayout(root,'en','zh-CN');const first=read();
   applyTranslationLayout(root,'en','zh-CN');const repeat=read();
   applyTranslationLayout(root,'zh-CN','zh-CN');const source=read();root.remove();return {first,repeat,source};
  });
  assert.ok(result.first[0]<40 && result.first[0]>=30,JSON.stringify(result));
  assert.equal(result.first[0],result.first[2]);assert.equal(result.first[2],result.first[4]);
  assert.equal(result.first[1],18);assert.deepEqual(result.repeat,result.first);
  assert.deepEqual(result.source,[40,18,40,18,40,18]);
 }finally{await session.close();}
});
