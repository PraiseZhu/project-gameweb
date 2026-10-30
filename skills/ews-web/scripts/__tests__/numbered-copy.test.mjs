import test from 'node:test';
import assert from 'node:assert/strict';
import { completeNumberedCopies } from '../lib/numbered-copy.mjs';
const locales=['zh-CN','en','ja','ko','zh-TW'];
const values=n=>['对阵'+n,'Match '+n,'マッチ'+n,'매치 '+n,'對陣'+n];
const sample=(n,row)=>({characters:'对阵'+n,row,matchKind:'designated',translations:Object.fromEntries(locales.map((l,i)=>[l,{value:values(n)[i],locator:'/rows/'+row+'/'+l,hash:'same-snapshot'}]))});
const unbound=n=>({characters:'对阵'+n,matchKind:'deliberately-unbound',translations:{}});
test('numbered labels derive all locales from two rows and retain exact provenance',()=>{
 const nodes={a:sample(1,29),b:sample(2,30),c:unbound(12)};
 assert.deepEqual(completeNumberedCopies(nodes),['c']);
 for(const [i,l] of locales.entries())assert.equal(nodes.c.translations[l].value,values(12)[i]);
 assert.deepEqual(nodes.c.translations.en.derived.rows,[29,30]);
 assert.equal(nodes.a.translations.en.value,'Match 1');
});
test('numbered labels reject one sample, conflicting formats and incomplete locales',()=>{
 for(const mode of ['single','conflict','missing']){
  const nodes={a:sample(1,29),b:sample(2,30),c:unbound(3)};
  if(mode==='single')delete nodes.b;
  if(mode==='conflict')nodes.b.translations.en.value='Round 2';
  if(mode==='missing')delete nodes.b.translations.ja;
  assert.deepEqual(completeNumberedCopies(nodes),[]);assert.equal(nodes.c.matchKind,'deliberately-unbound');
 }
});
test('numbered labels cannot consume dates, unrelated text or duplicate copies of one row',()=>{
 const nodes={a:sample(1,29),b:sample(2,29),c:unbound(3),d:{...unbound(4),characters:'2026/12/12'}};
 assert.deepEqual(completeNumberedCopies(nodes),[]);
});
