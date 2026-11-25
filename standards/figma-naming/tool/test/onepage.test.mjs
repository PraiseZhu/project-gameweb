import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOnePageName } from '../src/onepage/names.mjs';
import { parseDataPath, valuesAtPath } from '../src/onepage/paths.mjs';
import { compileOnePage, validateOnePageData, MOTIONS } from '../src/onepage/compile.mjs';
import { createOnePagePack, acceptOnePagePack } from '../src/onepage/handoff.mjs';
import { CONTRACT_VERSION, CAPABILITIES, PREFIX_NAMES } from '../../spec/onepage.mjs';
import { renderOnePageRules } from '../scripts/gen-onepage-rules.mjs';
import { buildInventory } from '../src/inventory.mjs';
import { validateHandoffPair } from '../src/handoff.mjs';

const node = (id,name,children=[],extra={}) => ({id,name,type:'FRAME',absoluteBoundingBox:{x:40,y:20,width:400,height:300},children,...extra});
const text = (id,name,characters='示例') => node(id,name,[],{type:'TEXT',characters});
const page = children => node('page','cn_pc',[node('s1','sec/1-首页'),node('s2','sec/2-奖励',children)]);
const compile = (children,config={},data) => compileOnePage(page(children),{requestedNodeId:'page',config,...(data === undefined ? {} : {data})});
const get = (inv,id) => inv.nodes.find(x=>x.id===id);
const has = (inv,code) => inv.issues.some(x=>x.code===code);
const good = inv => assert.equal(inv.ok,true,JSON.stringify(inv.issues));
const cards = () => node('list','list/奖励@data=list:rewards',[node('item','item/卡@template',[text('name','名称@field=name'),node('image','img/图片@field=image')])],{layoutMode:'HORIZONTAL'});
const carousel = () => node('switch','switch/轮播',[cards()]);
const pagination = {bindings:{'sec/2::switch/轮播':{pagination:{kind:'cards',list:'list/奖励',perPage:2}}}};

test('19词：title 注册，mix 只走旧链',()=>{
  assert.equal(PREFIX_NAMES.length,19); assert(!PREFIX_NAMES.includes('mix'));
  good(compile([node('title','title/标题')]));
  assert(has(compile([node('mix','mix/旧稿')]),'NAME'));
  const old=buildInventory(page([node('mix','mix/旧稿')]),{requestedNodeId:'page'});
  assert.equal(get(old,'mix').role,'mix'); assert.equal(old.schema,'inventory/v2');
});
test('参数重复、错挂、大小写枚举、未知参数与引号',()=>{
  for(const name of ['img/a@part=Foreground','img/a@show=x@show=y','img/a@template','img/a@script=x','list/a@data=LIST:a','scroll/a@x@y','btn/a@lang=cn,cn']) assert(parseOnePageName(name).problems.length,name);
  const path='["a@b"]';
  const p=parseOnePageName('img/图@field='+JSON.stringify(path));
  assert.deepEqual(p.problems,[]); assert.equal(p.params.field,path);
  assert(parseOnePageName('img/a@field="oops').problems.length);
});
test('自然正文、邮箱、日期与带前缀示例不误执行；明确用途名绑定可读',()=>{
  for(const value of ['mail@example.com','04/10','btn/示例@action=delete','正文@field=name']) assert.deepEqual(parseOnePageName(value,{type:'TEXT',characters:value}).params,{});
  good(compile([text('literal','btn/示例@action=delete','btn/示例@action=delete')]));
  const inv=compile([text('bound','名称@field=name')],{},{name:'新值'}); good(inv); assert.deepEqual(get(inv,'bound').bindings.field.path,['name']);
});
test('字段路径允许特殊键/固定下标，拒绝表达式与原型继承',()=>{
  assert.deepEqual(parseDataPath('$.List[2]["a.b@c"]').tokens,['List',2,'a.b@c']);
  for(const p of ['a..b','a[*]','a[?x]','a()','a.[0]','$.','a[-1]']) assert.throws(()=>parseDataPath(p),p);
  assert.deepEqual(valuesAtPath(Object.create({name:'inherited'}),['name']),[undefined]);
});
test('前景保留几何/遮挡顺序；bg/kv 内部不可绑定，img文字分离为消费要求',()=>{
  const inv=compile([node('fg','img/前景@part=foreground'),node('bg','bg/背景',[text('txt','背景文字','背景文字')]),node('img','img/卡',[text('caption','可编辑文字','可编辑文字')])]);
  good(inv); assert.equal(get(inv,'fg').displayScope.id,'s2'); assert.equal(get(inv,'fg').motion,undefined);
  assert.equal(get(inv,'txt').status,'skipped'); assert.equal(get(inv,'caption').role,'copy');
  assert.deepEqual(get(inv,'img').exportPolicy.excludeTextIds,['caption']); assert.equal(get(inv,'img').sliceExport,undefined);
  assert(has(compile([node('bg','bg/背景',[text('txt','金额@field=value')])]),'FIXED_ASSET_BINDING'));
});
test('对象上下文、数组条目与根路径分别解析；失效上下文不回退',()=>{
  const tree=node('obj','grp/对象@data=object:payload@show=enabled',[cards(),text('root','根标题@field=$.title')]);
  const inv=compile([tree],{},{payload:{enabled:true,rewards:[{name:'A',image:'a.png'}]},title:'首页'}); good(inv);
  assert.deepEqual(get(inv,'name').bindings.field.path,['payload','rewards',{itemOf:'list'},'name']);
  assert.deepEqual(get(inv,'root').bindings.field.path,['title']);
  assert.equal(validateOnePageData(inv,{payload:null,enabled:true,rewards:[],title:'x'}).ok,false);
  assert.equal(validateOnePageData(inv,{}, {state:'failure'}).empty,false);
});
test('模板唯一性、Auto Layout、错挂模板、数组和开关类型拒绝',()=>{
  const missing=cards(); missing.children[0].name='item/卡'; assert(has(compile([missing]),'TEMPLATE'));
  const duplicate=cards(); duplicate.children.push(node('item2','item/另一卡@template')); assert(has(compile([duplicate]),'TEMPLATE'));
  const layout=cards(); delete layout.layoutMode; assert(has(compile([layout]),'LIST_LAYOUT'));
  assert(has(compile([node('i','item/游离@template')]),'TEMPLATE_OWNER'));
  assert(has(compile([cards()],{},{rewards:{}}),'DATA_VALUE'));
  assert(has(compile([node('g','grp/可见@show=on')],{},{on:'false'}),'DATA_VALUE'));
  good(compile([cards()],{},{rewards:[]}));
});
test('固定槽位需要映射和缺省，超出不能截断',()=>{
  const slots=node('slots','list/槽@data=slots:rows',[node('a','item/左'),node('b','item/右')]);
  assert(has(compile([slots]),'SLOT_MAPPING'));
  const config={bindings:{'sec/2::list/槽':{slotMapping:{kind:'array-order'},missing:'design-default'}}};
  good(compile([slots],config,{rows:[1]})); assert(has(compile([slots],config,{rows:[1,2,3]}),'DATA_VALUE'));
});
test('页码与空状态关联分页对象，0/1状态规则进入清单',()=>{
  const inv=compile([carousel(),text('pager','dyn/页码@part=pager@for=switch/轮播','01/02'),node('empty','grp/空@part=empty@for=list/奖励')],pagination);
  good(inv); assert.equal(get(inv,'pager').pagerPolicy.total,'page-count'); assert.equal(get(inv,'empty').emptyPolicy.failureIsEmpty,false);
  assert.equal(inv.relations.find(r=>r.kind==='pager').to.id,'switch');
  assert(has(compile([carousel(),text('pager','dyn/页码@part=pager@for=switch/轮播')]),'PAGINATION'));
});
test('省略for只用明确祖先；显式冲突、多候选、跨屏不猜',()=>{
  const sw=carousel(); sw.children.push(node('ind','ind/指示')); good(compile([sw],pagination));
  const other=node('other','switch/另一轮播'); sw.children[1].name='ind/指示@for=switch/另一轮播';
  assert(has(compile([sw,other],pagination),'RELATION_CONFLICT'));
  assert(has(compile([node('a','switch/同名'),node('b','switch/同名'),node('tab','tab/页签@for=switch/同名')]),'TARGET'));
  const doc=page([node('tab','tab/页签@for=switch/外屏')]); doc.children[0].children.push(node('s','switch/外屏'));
  assert(has(compileOnePage(doc,{requestedNodeId:'page'}),'TARGET'));
  doc.children[1].children[0].name='tab/页签@for=sec/1::switch/外屏'; good(compileOnePage(doc,{requestedNodeId:'page'}));
});
test('next是可见屏相对动作，数字sec目标和冲突受校验',()=>{
  const inv=compile([node('next','btn/下一屏@sec=next')]); good(inv); assert.equal(get(inv,'next').action.navigation.last,'home');
  assert(has(compile([node('bad','btn/跳屏@sec=9')]),'SECTION_TARGET'));
  assert(has(compile([node('bad','btn/跳屏@sec=1@action=x')],{actions:{x:{type:'next-section'}}}),'ACTION_CONFLICT'));
  assert(has(compile([node('bad','btn/未知@action=missing')]),'ACTION_CONFIG'));
  assert(has(compile([node('bad','btn/脚本@action=x')],{actions:{x:{type:'eval',value:'evil'}}}),'ACTION_TYPE'));
});
test('bindings 支持 component/node 身份键；找不到对象不报 TARGET',()=>{
  const claim=node('comp-claim','领取',[],{type:'COMPONENT'});
  const set=node('set','grp/领取组件',[claim],{type:'COMPONENT_SET'});
  const a=node('a','btn/领取',[],{type:'INSTANCE',componentId:'comp-claim'});
  const b=node('b','btn/领取',[],{type:'INSTANCE',componentId:'comp-claim'});
  const doc=node('page','cn_pc',[node('s1','sec/1-首页'),node('s2','sec/2-奖励',[a,b]),set]);
  const inv=compileOnePage(doc,{requestedNodeId:'page',config:{bindings:{'component:comp-claim':{action:{type:'next-section'}}}}});
  good(inv);
  assert.equal(get(inv,'a').action.type,'next-section');
  assert.equal(get(inv,'b').action.type,'next-section');
  const one=compile([node('a','btn/领取'),node('b','btn/其它')],{bindings:{'node:a':{action:{type:'next-section'}}}});
  assert.equal(get(one,'a').action.type,'next-section');
  assert.equal(get(one,'b').action,null);
  assert(has(one,'ACTION_MISSING'));
  const missing=compile([node('title','title/标题')],{bindings:{'component:gone':{action:{type:'next-section'}},'node:missing':{action:{type:'next-section'}}}});
  good(missing);
  assert.equal(missing.issues.some((row)=>row.code==='TARGET'),false);
});
test('配置支持一对多，ref不能成为目标，for不生成动作',()=>{
  const inv=compile([node('a','grp/A'),node('b','grp/B'),node('button','btn/显示@action=both')],{actions:{both:{type:'show-target',targets:['grp/A','grp/B']}}}); good(inv);
  assert.equal(get(inv,'button').action.targets.length,2);
  assert(has(compile([node('r','ref/参考'),node('button','btn/显示@action=a')],{actions:{a:{type:'show-target',target:'ref/参考'}}}),'TARGET'));
  assert(has(compile([node('x','img/图@for=img/图')]),'FOR_PURPOSE'));
});
test('链接必须有配置，空值不伪造，链接field需要明确动作',()=>{
  good(compile([node('b','btn/官网@link=site@field=url')],{links:{site:{url:null}}},{url:''}));
  assert(has(compile([node('b','btn/官网@link=site')]),'LINK_CONFIG'));
  assert(has(compile([node('b','btn/官网@link=site')],{links:{site:{url:'javascript:alert(1)'}}}),'LINK_URL'));
});
test('状态映射必须指向稿中已有变体，不创造状态',()=>{
  const state=node('state','grp/状态@state=status',[],{type:'INSTANCE',componentId:'on'});
  const doc=node('shelf','货架',[page([state]),node('set','grp/状态',[node('on','value=on',[],{type:'COMPONENT'}),node('off','value=off',[],{type:'COMPONENT'})],{type:'COMPONENT_SET',componentPropertyDefinitions:{value:{type:'VARIANT',variantOptions:['on','off']}}})]);
  const config={bindings:{'sec/2::grp/状态':{state:{property:'value',values:{yes:'on',no:'off'}}}}};
  good(compileOnePage(doc,{requestedNodeId:'page',config,data:{status:'yes'}}));
  config.bindings['sec/2::grp/状态'].state.values.yes='invented';
  assert(has(compileOnePage(doc,{requestedNodeId:'page',config}),'STATE_DESIGN'));
});
test('动效引用已定规则；正文、缺参数、数值覆盖、父子重复被拒',()=>{
  const motion={rule:'section-title',unit:'whole',trigger:'section-enter',source:'最终标准9.2'};
  good(compile([node('title','title/标题@motion=title')],{motions:{title:motion}}));
  assert(has(compile([node('title','title/标题@motion=missing')]),'MOTION_RULE'));
  assert(has(compile([node('title','title/标题@motion=title')],{motions:{title:{...motion,duration:1}}}),'MOTION_PARAMETER'));
  assert(has(compile([text('txt','正文@motion=title')],{motions:{title:motion}}),'NAME'));
  const group=node('g','grp/组@motion=content',[node('title','title/标题@motion=title')]);
  assert(has(compile([group],{motions:{title:motion,content:{rule:'content-left',unit:'whole',trigger:'section-enter',source:'9.2'}}}),'MOTION_OVERLAP'));
  assert(has(compile([node('title','title/标题')],{bindings:{'sec/2::title/标题':{motionRequired:true}}}),'MOTION_MISSING'));
});
test('标准分层组合 nested-standard 通过编译；未定组合仍 COMPOSITION',()=>{
  const fade={rule:'section-fade',unit:'whole',trigger:'section-change',source:'8.1'};
  const title={rule:'section-title',unit:'whole',trigger:'section-enter',source:'9.2',composition:'nested-standard'};
  const content={rule:'content-left',unit:'whole',trigger:'section-enter',source:'9.2',composition:'nested-standard'};
  good(compile([
    node('title','title/标题@motion=title'),
    node('g','grp/说明@motion=content'),
  ],{motions:{fade,title,content},bindings:{
    'sec/2-奖励':{motion:'fade'},
    'sec/2::title/标题':{motion:'title'},
    'sec/2::grp/说明':{motion:'content'},
  }}));
  const inside=node('g','grp/组@motion=content',[node('title','title/标题@motion=title')]);
  assert(has(compile([inside],{motions:{title,content}}),'MOTION_COMPOSITION'));
});
test('新包与旧入口隔离，消费者缺能力或包被改写必须拒绝',()=>{
  const inv=compile([node('title','title/标题')]); good(inv); const pack=createOnePagePack(inv);
  const consumer={contract:CONTRACT_VERSION,capabilities:Object.values(CAPABILITIES)};
  assert.equal(acceptOnePagePack(pack,consumer).ok,true); assert.equal(acceptOnePagePack(pack,{}).ok,false);
  assert.equal(validateHandoffPair(inv,null).ok,false);
  pack.inventory.nodes[0].name='changed'; assert.equal(acceptOnePagePack(pack,consumer).ok,false);
  assert.equal(acceptOnePagePack({},{}).ok,false);
});
test('CLI薄路径写交接包；失败仅写报告；拒绝覆盖旧输出',()=>{
  const root=fileURLToPath(new URL('../../../../',import.meta.url));
  const base=resolve(root,'_tmp/naming-sync-20261119/cli-tests'); mkdirSync(base,{recursive:true});
  const dir=mkdtempSync(resolve(base,'case-')),input=resolve(dir,'source.json'),out=resolve(dir,'out');
  writeFileSync(input,JSON.stringify(page([node('title','title/标题')])));
  const args=[fileURLToPath(new URL('../bin/onepage.mjs',import.meta.url)),'--input',input,'--node','page','--out',out];
  const run=spawnSync(process.execPath,args,{encoding:'utf8'}); assert.equal(run.status,0,run.stderr);
  assert.equal(JSON.parse(readFileSync(resolve(out,'handoff.json'))).schema,'handoff/onepage-v1');
  assert.equal(spawnSync(process.execPath,args).status,1);
  writeFileSync(input,JSON.stringify(page([node('bad','btn/无动作')])));
  args[args.length-1]=resolve(dir,'blocked');
  assert.equal(spawnSync(process.execPath,args).status,1);
  assert.throws(()=>readFileSync(resolve(dir,'blocked/handoff.json')));
  assert.equal(JSON.parse(readFileSync(resolve(dir,'blocked/report.json'))).status,'blocked');
});
test('固定槽位按指定键读取，少值保留默认，不串到其它槽位',()=>{
  const slots=node('slots','list/槽@data=slots:rows',[node('a','item/左',[text('left','左值@field=left')]),node('b','item/右',[text('right','右值@field=right')])]);
  const config={bindings:{'sec/2::list/槽':{slotMapping:{kind:'key',field:'id',keys:['a','b']},missing:'design-default'}}};
  good(compile([slots],config,{rows:[{id:'b',right:'R'},{id:'a',left:'L'}]}));
  good(compile([slots],config,{rows:[{id:'a',left:'L'}]}));
  // R293：槽位缺该字段的值沿默认（不红）；有值但类型错仍拒绝，键未知/重复仍拒绝
  good(compile([slots],config,{rows:[{id:'a',right:'R'}]}));
  assert(has(compile([slots],config,{rows:[{id:'a',left:{no:1}}]}),'DATA_VALUE'));
  assert(has(compile([slots],config,{rows:[{id:'x',left:'L'}]}),'DATA_VALUE'));
});
test('恶意原型键和损坏包可报告，不抛出未处理异常',()=>{
  for(const s of ['img/a@part=constructor','constructor/a','img/a@part=__proto__']) assert(parseOnePageName(s).problems.length);
  assert(has(compile([node('n','grp/a@motion=x')],{motions:{x:{rule:'constructor'}}}),'MOTION_RULE'));
  assert.equal(acceptOnePagePack({requiredCapabilities:42},{capabilities:42}).ok,false);
});
test('隐藏目标、缺组件、错挂配置和from缺屏均阻断',()=>{
  assert(has(compile([node('a','grp/A',[],{visible:false}),node('b','btn/显示@action=a')],{actions:{a:{type:'show-target',target:'grp/A'}}}),'TARGET'));
  assert(has(compile([node('a','grp/A',[],{type:'INSTANCE',componentId:'missing'})]),'COMPONENT_DEFINITION'));
  assert(has(compile([node('a','grp/A')],{bindings:{'grp/A':{state:{property:'x',values:{a:'b'}}}}}),'STATE_DECLARATION'));
  assert(has(compile([node('f','fix/悬浮@from=9')]),'FROM_SECTION'));
});
test('正式词表和生成速查与机器表同源，动效均有明确出处',()=>{
  const spec=readFileSync(new URL('../../spec/onepage-naming.md',import.meta.url),'utf8');
  for(const name of PREFIX_NAMES) assert(spec.includes('| '+name+'/ |'),name);
  for(const [rule,value] of Object.entries(MOTIONS)) assert(spec.includes('| '+rule+' | '+value.standard+' |'),rule);
  assert.equal(readFileSync(new URL('../docs/ONEPAGE-RULES.md',import.meta.url),'utf8'),renderOnePageRules());
  assert(spec.includes('可选字典为 bindings、actions、links、motions、fonts、meta、dataContract'));
  assert(spec.includes('perPage 为正整数，或只含 pc/mobile'));
  assert(spec.includes('devTodo'));
  assert(spec.includes('figma:name:@link'));
});

const fontResource = (name, extra = {}) => ({
  file: `${name}.otf`, weights: [400, 700], format: 'otf',
  source: 'foundry', license: 'OFL', digest: `sha256:${name}`, ...extra,
});
const validFonts = () => ({
  faces: { 'Sans/700': { cn: 'Sans', en: 'Sans' }, 'Digit/700': { cn: 'Digit' } },
  resources: { Sans: fontResource('Sans', { axes: { wght: { min: 100, max: 900 } } }), Digit: fontResource('Digit', { weights: [700] }) },
});

test('合法 fonts 写入清单和交接包；不写 fonts 时没有该字段', () => {
  const fonts = validFonts();
  const withFonts = compile([node('title', 'title/标题')], { fonts });
  good(withFonts);
  assert.deepEqual(withFonts.fonts, fonts);
  assert.deepEqual(createOnePagePack(withFonts).inventory.fonts, fonts);
  const without = compile([node('title', 'title/标题')]);
  good(without);
  assert.equal(without.fonts, undefined);
});

test('fonts 缺必填字段、错误类型、未知键均阻断', () => {
  const missingDigest = validFonts();
  delete missingDigest.resources.Sans.digest;
  assert(has(compile([node('title', 'title/标题')], { fonts: missingDigest }), 'FONT_CONFIG'));
  const missingRoles = { resources: validFonts().resources };
  assert(has(compile([node('title', 'title/标题')], { fonts: missingRoles }), 'FONT_CONFIG'));
  assert(has(compile([node('title', 'title/标题')], { fonts: [] }), 'CONFIG_TYPE'));
  const badWeights = validFonts();
  badWeights.resources.Sans.weights = '400';
  assert(has(compile([node('title', 'title/标题')], { fonts: badWeights }), 'FONT_CONFIG'));
  const unknownTop = { ...validFonts(), extra: {} };
  assert(has(compile([node('title', 'title/标题')], { fonts: unknownTop }), 'FONT_CONFIG'));
  const unknownFace = validFonts();
  unknownFace.faces.heading = { cn: 'Sans' };
  assert(has(compile([node('title', 'title/标题')], { fonts: unknownFace }), 'FONT_CONFIG'));
  const unknownField = validFonts();
  unknownField.resources.Sans.path = 'x';
  assert(has(compile([node('title', 'title/标题')], { fonts: unknownField }), 'FONT_CONFIG'));
  const missingResource = validFonts();
  missingResource.faces['Sans/700'].en = 'Missing';
  assert(has(compile([node('title', 'title/标题')], { fonts: missingResource }), 'FONT_CONFIG'));
  const badLang = validFonts();
  badLang.faces['Sans/700'] = { 'zh-CN': 'Sans' };
  assert(has(compile([node('title', 'title/标题')], { fonts: badLang }), 'FONT_CONFIG'));
  assert(has(compile([node('title', 'title/标题')], { fonts: validFonts(), extra: {} }), 'CONFIG_KEY'));
});

test('卡片分页 perPage 支持单值和分端，非法分端值阻断；旧配置回归', () => {
  good(compile([carousel()], pagination));
  assert.equal(get(compile([carousel()], pagination), 'switch').pagination.perPage, 2);
  const dual = { bindings: { 'sec/2::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励', perPage: { pc: 4, mobile: 2 } } } } };
  const dualInv = compile([carousel()], dual);
  good(dualInv);
  assert.deepEqual(get(dualInv, 'switch').pagination.perPage, { pc: 4, mobile: 2 });
  const onlyPc = { bindings: { 'sec/2::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励', perPage: { pc: 3 } } } } };
  good(compile([carousel()], onlyPc));
  const illegal = (perPage) => ({ bindings: { 'sec/2::switch/轮播': { pagination: { kind: 'cards', list: 'list/奖励', perPage } } } });
  assert(has(compile([carousel()], illegal({ pc: 0 })), 'PAGINATION'));
  assert(has(compile([carousel()], illegal({ tablet: 2 })), 'PAGINATION'));
  assert(has(compile([carousel()], illegal({ pc: 1.5 })), 'PAGINATION'));
  assert(has(compile([carousel()], illegal({ pc: '2' })), 'PAGINATION'));
  assert(has(compile([carousel()], illegal([])), 'PAGINATION'));
});

test('open-link url 为 null 写入 devTodo；已填 url 不收；无动作仍阻断', () => {
  const named = compile([node('b', 'btn/官网@link=site')], { links: { site: { url: null } } });
  good(named);
  assert.deepEqual(named.devTodo, [{
    kind: 'link-url-pending',
    node: { id: 'b', scope: 'page' },
    key: 'site',
    section: 2,
    source: 'figma:name:@link',
  }]);
  assert.deepEqual(createOnePagePack(named).inventory.devTodo, named.devTodo);
  const bound = compile([node('b', 'btn/官网')], { bindings: { 'sec/2::btn/官网': { action: { type: 'open-link', url: null } } } });
  good(bound);
  assert.deepEqual(bound.devTodo, [{
    kind: 'link-url-pending',
    node: { id: 'b', scope: 'page' },
    key: null,
    section: 2,
    source: 'config.bindings:action',
  }]);
  const filled = compile([node('b', 'btn/官网@link=site')], { links: { site: { url: 'https://example.com' } } });
  good(filled);
  assert.deepEqual(filled.devTodo, []);
  const none = compile([node('title', 'title/标题')]);
  good(none);
  assert.deepEqual(none.devTodo, []);
  assert(has(compile([node('none', 'btn/无动作')]), 'ACTION_MISSING'));
});

test('links 缺 url 字段阻断且不进 devTodo', () => {
  const inv = compile([node('b', 'btn/官网@link=site')], { links: { site: {} } });
  assert(has(inv, 'LINK_CONFIG'));
  assert.equal((inv.devTodo || []).some((row) => row.key === 'site'), false);
  assert.equal(inv.ok, false);
});

test('config.actions 不能经 @action/@go 产生 open-link', () => {
  const viaAction = compile([node('b', 'btn/官网@action=site')], { actions: { site: { type: 'open-link', url: null } } });
  assert(has(viaAction, 'ACTION_LINK_SOURCE'));
  assert.equal((viaAction.devTodo || []).length, 0);
  const viaGo = compile([node('b', 'btn/官网@go=site')], { actions: { site: { type: 'open-link', url: 'https://example.com' } } });
  assert(has(viaGo, 'ACTION_LINK_SOURCE'));
  assert.equal((viaGo.devTodo || []).length, 0);
});

test('节点诊断带所属 sec 编号，无所属屏为 null，配置级诊断省略 section', () => {
  const missing = compile([node('none', 'btn/无动作')]);
  const nodeIssue = missing.issues.find((row) => row.code === 'ACTION_MISSING');
  assert.equal(nodeIssue.section, 2);
  assert.equal(nodeIssue.nodeId, 'none');
  const rootBtn = compileOnePage(node('page', 'cn_pc', [node('s1', 'sec/1-首页'), node('loose', 'btn/无动作')]), { requestedNodeId: 'page' });
  const loose = rootBtn.issues.find((row) => row.code === 'ACTION_MISSING');
  assert.equal(loose.section, null);
  const configIssue = compile([node('title', 'title/标题')], { extra: {} }).issues.find((row) => row.code === 'CONFIG_KEY');
  assert.equal(Object.hasOwn(configIssue, 'section'), false);
});
