import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import { applyTestBrowserEnv, browserTestOptions } from './helpers/browser-env.mjs';
import {buildSyntheticDemo} from './helpers/build-demo.mjs';
import {openBrowserSession} from '../lib/browser-session.mjs';
applyTestBrowserEnv();
test('locale relayout preserves viewport bars and section-local edge art', browserTestOptions({timeout:60000}), async()=>{
 const {out}=buildSyntheticDemo('ews-edge-layout-');
 const session=await openBrowserSession({skillRoot:fileURLToPath(new URL('../..',import.meta.url)),demoDir:out});
 assert.equal(session.ok,true);
 try{
  const page=await session.browser.newPage();await page.goto(session.base+'/index.html?product=1');
  const result=await page.evaluate(async()=>{
   const {applyTranslationLayout}=await import('./runtime/text-style.mjs');
   const root=document.createElement('div');root.style.cssText='position:absolute;left:0;top:0;width:2232px;height:1080px';
   root.innerHTML='<div data-pin="viewport" style="position:absolute;width:100%"><div class="ews-node" data-figma-type="FRAME" data-designed-w="1920" data-designed-left="0" style="position:absolute;left:0;right:0;width:auto;height:69px"></div></div><div class="ews-screen-foreground"><div class="ews-node" data-role="img" data-designed-top="11020" style="position:absolute;top:110px;left:0;width:200px;height:200px"></div></div>';
   document.body.append(root);const samples=[];
   for(const locale of ['zh-CN','en','zh-CN']){
    applyTranslationLayout(root,locale,'zh-CN');samples.push({width:root.querySelector('[data-pin] .ews-node').getBoundingClientRect().width,top:root.querySelector('[data-role="img"]').style.top});
   }
   root.remove();return samples;
  });
  assert.deepEqual(result,Array.from({length:3},()=>({width:2232,top:'110px'})));
 }finally{await session.close();}
});
