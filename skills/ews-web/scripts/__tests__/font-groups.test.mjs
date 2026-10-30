import test from 'node:test';
import assert from 'node:assert/strict';
import {applyFontGroups} from '../lib/font-groups.mjs';
import {unifyLocaleGroupFonts} from '../../assets/runtime/text-style.mjs';

test('agent groups reach page nodes and hidden clones; unknown members fail', () => {
  const a={id:'a',type:'TEXT',text:{}},b={id:'clone-b',sourceNodeId:'b',type:'TEXT',text:{}};
  const platform={nodes:[a],variantSwitches:[{layers:[{nodes:[b]}]}]};
  assert.deepEqual(applyFontGroups(platform,[{id:'titles',why:'Parallel card headings',members:['a','b']}]),[]);
  assert.equal(a.fontGroup,'titles');assert.equal(b.fontGroup,'titles');
  assert.match(applyFontGroups(platform,[{id:'bad',why:'Test',members:['a','missing']}]).join(),/text-node-missing/);
});

function node(font, group='titles', extra={}) {
  const attrs={'data-font-size':'80','data-agent-font-group':group,...extra};
  return {style:{fontSize:font+'px',whiteSpace:'pre-wrap'},getAttribute:k=>attrs[k]??null,setAttribute:(k,v)=>attrs[k]=v,removeAttribute:k=>delete attrs[k],closest:()=>null};
}
test('semantic groups unify independent components to minimum, protect source and unbound',()=>{
  const a=node(80),b=node(64),other=node(72,'other'),kept=node(80,'titles',{'data-copy-unbound':'1'});
  const root={querySelectorAll:()=>[a,b,other,kept]};
  unifyLocaleGroupFonts(root,'en','zh-CN');
  assert.equal(a.style.fontSize,'64px');assert.equal(b.style.fontSize,'64px');assert.equal(other.style.fontSize,'72px');assert.equal(kept.style.fontSize,'80px');
  a.style.fontSize='80px';unifyLocaleGroupFonts(root,'zh-CN','zh-CN');assert.equal(a.style.fontSize,'80px');
});
test('semantic grouping never crosses the allowed font floor',()=>{
  const a=node(80),b=node(1);const root={querySelectorAll:()=>[a,b]};
  const result=unifyLocaleGroupFonts(root,'en','zh-CN');
  assert.equal(a.style.fontSize,'80px');assert.equal(result[0].problem,'font-group-min-below-floor');
});
