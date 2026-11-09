import test from 'node:test';
import assert from 'node:assert/strict';
import { detachedLabelWidth } from '../../assets/runtime/render.mjs';
import { translationSlotWidth } from '../../assets/runtime/text-style.mjs';
function fixture() {
 const label = {id:'text',name:'Label',parentId:'texts',text:{autoResize:'WIDTH_AND_HEIGHT'},layout:{constraints:{horizontal:'SCALE'}},pageBox:{x:296,y:59,w:60,h:28}};
 const frame = {id:'frame',type:'FRAME',name:'Label',parentId:'frames',pageBox:{x:100,y:50,w:274,h:41}};
 const nodes = new Map([['text',label],['frame',frame],['texts',{type:'GROUP',parentId:'common'}],['frames',{type:'GROUP',parentId:'common'}]]);
 return {label,frame,nodes};
}
test('detached auto label uses containing named frame even when frame is baked into an image',()=>{
 const {label,nodes}=fixture();
 assert.equal(detachedLabelWidth(label,nodes),119);
 const attrs={'data-detached-label-width':'119','data-page-w':'60','data-max-width':'90'};
 const el={getAttribute:k=>attrs[k],style:{}};
 assert.equal(translationSlotWidth(el),90);
 delete attrs['data-max-width'];
 assert.equal(translationSlotWidth(el),119);
});
test('ambiguous, unrelated, outside and non-auto labels never gain width',()=>{
 for(const mutate of [
 f=>{f.frame.name='Other';},
 f=>{f.nodes.set('duplicate',{...f.frame,id:'duplicate'});},
 f=>{f.label.pageBox.y=90;},
 f=>{f.label.text.autoResize='HEIGHT';},
 f=>{f.label.layout.constraints.horizontal='LEFT';},
 f=>{f.label.pageBox.x=110;},
 f=>{f.nodes.get('frames').parentId='otherScope';},
 f=>{f.frame.visible=false;},
 ]) { const f=fixture();mutate(f);assert.equal(detachedLabelWidth(f.label,f.nodes),0); }
});
