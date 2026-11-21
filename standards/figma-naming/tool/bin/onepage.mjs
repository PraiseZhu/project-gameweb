#!/usr/bin/env node
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { parseArgs } from 'node:util';
import { compileOnePage } from '../src/onepage/compile.mjs';
import { createOnePagePack,acceptOnePagePack } from '../src/onepage/handoff.mjs';

try {
  const {values} = parseArgs({ options:{ input:{type:'string'},node:{type:'string'},config:{type:'string'},out:{type:'string'},data:{type:'string'},pack:{type:'string'},consumer:{type:'string'} } });
  const read = file => JSON.parse(readFileSync(resolve(file),'utf8'));
  if (values.pack) {
    if (!values.consumer || values.input || values.out) throw new Error('验包使用 --pack 文件 --consumer 能力声明');
    const result = acceptOnePagePack(read(values.pack),read(values.consumer));
    console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1;
  } else {
    if (!values.input || !values.node || !values.out) throw new Error('用法：--input Figma快照.json --node 页面ID --out 新输出目录 [--config 项目配置.json] [--data 接口样本.json]');
    const input = read(values.input);
    const inventory = compileOnePage(input.document || input,{ requestedNodeId:values.node,config:values.config ? read(values.config) : {},...(values.data ? {data:read(values.data)} : {}) });
    // Refuse overwrite: an earlier ready pack cannot survive a failed rerun unnoticed.
    const dir = resolve(values.out); mkdirSync(dir,{recursive:false});
    writeFileSync(join(dir,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
    writeFileSync(join(dir,'report.json'),JSON.stringify({ok:inventory.ok,status:inventory.status,issues:inventory.issues},null,2)+'\n');
    if (inventory.ok) writeFileSync(join(dir,'handoff.json'),JSON.stringify(createOnePagePack(inventory),null,2)+'\n');
    console.log(JSON.stringify({ok:inventory.ok,status:inventory.status,path:join(dir,inventory.ok ? 'handoff.json' : 'report.json')}));
    process.exitCode = inventory.ok ? 0 : 1;
  }
} catch(error) { console.error(error.message); process.exitCode = 1; }
