import { isDeepStrictEqual } from 'node:util';
import { buildInventory, allNodesOf, rebuildInventoryIndexes } from '../inventory.mjs';
import { parseOnePageName } from './names.mjs';
import { parseDataPath, joinDataPath, valuesAtPath } from './paths.mjs';
import { CONTRACT_VERSION, INVENTORY_SCHEMA, CAPABILITIES, ACTION_TYPES, ROLE_BEHAVIOR, diagnostic, nodeSectionNumber, CONFIG_KEYS, FONT_RESOURCE_REQUIRED, LANG_CODES, PAGINATION_ENDS } from '../../../spec/onepage.mjs';

const own = (obj, key) => obj != null && Object.hasOwn(obj, key) ? obj[key] : undefined;
const object = x => x != null && typeof x === 'object' && !Array.isArray(x);
const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const product = n => n?.status === 'determined' && n.role !== 'ref';
const refOf = n => ({ id: n.id, scope: n.scope });
const keyOf = n => `${n.role}/${n.label}`;
const BINDING_KEYS = ['state', 'fieldTarget', 'slotMapping', 'missing', 'layout', 'pagination', 'motionRequired', 'motion', 'for', 'action', 'functionContract'];
const LANG_CODE_SET = new Set(LANG_CODES);
const FONT_RESOURCE_KEYS = [...FONT_RESOURCE_REQUIRED, 'axes'];

function positiveInt(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function parsePerPage(value) {
  if (positiveInt(value)) return value;
  if (!object(value)) return null;
  const keys = Object.keys(value);
  if (!keys.length || keys.some((key) => !PAGINATION_ENDS.includes(key) || !positiveInt(value[key]))) return null;
  return value;
}

function httpUrl(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function declaredOpenLink(config, key) {
  const link = own(config.links, key);
  if (!object(link) || !Object.hasOwn(link, 'url')) return { error: 'LINK_CONFIG', message: `缺链接配置 ${key}` };
  if (link.url === null) return { action: { type: 'open-link', key, url: null } };
  if (typeof link.url === 'string' && httpUrl(link.url)) return { action: { type: 'open-link', key, url: link.url } };
  return { error: 'LINK_URL', message: 'open-link 需要 http(s) URL 或显式 null' };
}

function validateFonts(fonts, fail) {
  if (!object(fonts)) {
    fail('CONFIG_TYPE', null, 'fonts 必须是对象');
    return;
  }
  for (const key of Object.keys(fonts)) {
    if (!['faces', 'resources'].includes(key)) fail('FONT_CONFIG', null, `未知配置 fonts.${key}`);
  }
  if (!object(fonts.faces)) fail('FONT_CONFIG', null, 'fonts.faces 必须是对象');
  if (!object(fonts.resources)) fail('FONT_CONFIG', null, 'fonts.resources 必须是对象');
  if (!object(fonts.faces) || !object(fonts.resources)) return;
  const resourceIds = new Set(Object.keys(fonts.resources));
  if (!Object.keys(fonts.faces).length) fail('FONT_CONFIG', null, 'fonts.faces 不能为空');
  if (!resourceIds.size) fail('FONT_CONFIG', null, 'fonts.resources 不能为空');
  for (const [face, mapping] of Object.entries(fonts.faces)) {
    const slash = String(face).lastIndexOf('/');
    const weight = Number(String(face).slice(slash + 1));
    if (slash <= 0 || !Number.isSafeInteger(weight) || weight < 1) {
      fail('FONT_CONFIG', null, 'fonts.faces 键须为字体名/字重');
      continue;
    }
    if (!object(mapping) || !Object.keys(mapping).length) {
      fail('FONT_CONFIG', null, 'fonts.faces 映射必须是按语言的对象');
      continue;
    }
    for (const [lang, ref] of Object.entries(mapping)) {
      if (!LANG_CODE_SET.has(lang)) fail('FONT_CONFIG', null, 'fonts.faces 语言码非法');
      else if (!nonempty(ref)) fail('FONT_CONFIG', null, 'fonts.faces 语言映射必须是字体资源名');
      else if (!resourceIds.has(ref)) fail('FONT_CONFIG', null, 'fonts.faces 引用了未登记资源');
    }
    continue;
    const refs = [];
    if (nonempty(mapping)) refs.push(mapping);
    else if (object(mapping)) {
      const langs = Object.keys(mapping);
      if (!langs.length) fail('FONT_CONFIG', null, `fonts.roles.${role} 按语言声明不能为空`);
      for (const lang of langs) {
        if (!LANG_CODE_SET.has(lang)) fail('FONT_CONFIG', null, `fonts.roles.${role} 语言码非法 ${lang}`);
        else if (!nonempty(mapping[lang])) fail('FONT_CONFIG', null, `fonts.roles.${role}.${lang} 必须是字体资源名`);
        else refs.push(mapping[lang]);
      }
    } else fail('FONT_CONFIG', null, `fonts.roles.${role} 必须是资源名或按语言的对象`);
    for (const ref of refs) {
      if (!resourceIds.has(ref)) fail('FONT_CONFIG', null, `fonts.roles.${role} 引用了未登记资源 ${ref}`);
    }
  }
  for (const [id, resource] of Object.entries(fonts.resources)) {
    if (!object(resource)) {
      fail('FONT_CONFIG', null, `fonts.resources.${id} 必须是对象`);
      continue;
    }
    for (const key of Object.keys(resource)) {
      if (!FONT_RESOURCE_KEYS.includes(key)) fail('FONT_CONFIG', null, `fonts.resources.${id} 未知字段 ${key}`);
    }
    for (const field of FONT_RESOURCE_REQUIRED) {
      if (field === 'weights') {
        if (!Array.isArray(resource.weights) || !resource.weights.length || resource.weights.some((weight) => !positiveInt(weight))) {
          fail('FONT_CONFIG', null, `fonts.resources.${id}.weights 必须是正整数数组`);
        }
      } else if (!nonempty(resource[field])) {
        fail('FONT_CONFIG', null, `fonts.resources.${id} 缺 ${field}`);
      }
    }
    if (resource.axes !== undefined) {
      if (!object(resource.axes) || !Object.keys(resource.axes).length) {
        fail('FONT_CONFIG', null, `fonts.resources.${id}.axes 必须是非空对象`);
        continue;
      }
      for (const [axis, range] of Object.entries(resource.axes)) {
        if (!nonempty(axis) || !object(range) || !Number.isFinite(range.min) || !Number.isFinite(range.max) || range.min > range.max) {
          fail('FONT_CONFIG', null, `fonts.resources.${id}.axes.${axis} 需要 min/max`);
        }
        if (object(range)) {
          for (const key of Object.keys(range)) {
            if (!['min', 'max'].includes(key)) fail('FONT_CONFIG', null, `fonts.resources.${id}.axes.${axis} 未知字段 ${key}`);
          }
        }
      }
    }
  }
}
export const MOTIONS = {
  'section-fade': { standard: '8.1', roles: ['sec'], units: ['whole'], triggers: ['section-change'] },
  'section-title': { standard: '9.2', roles: ['title'], units: ['whole'], triggers: ['section-enter'] },
  'content-left': { standard: '9.2', roles: ['grp', 'list', 'item'], units: ['whole', 'items', 'batches'], triggers: ['section-enter', 'page-change', 'tab-change'] },
  'cards-center': { standard: '9.2', roles: ['list'], units: ['items'], triggers: ['section-enter', 'page-change', 'tab-change'] },
  'foreground-crystal': { standard: '9.2', roles: ['img', 'grp', 'kv'], units: ['whole', 'items'], triggers: ['section-enter'] },
  'first-screen': { standard: '9.3', roles: ['grp', 'sec'], units: ['whole'], triggers: ['first-enter', 'home-return'] },
  'carousel-track': { standard: '8.2', roles: ['switch'], units: ['whole'], triggers: ['page-change'] },
  'menu-fade': { standard: '8.2', roles: ['modal', 'dropmenu'], units: ['whole'], triggers: ['open-close'] },
};

/** Pure compiler. Reuses geometry extraction, never contacts Figma or changes the input. */
export function compileOnePage(document, options = {}) {
  const config = options.config ?? {};
  const issues = [];
  let byId = new Map();
  const fail = (code, n, message) => issues.push(diagnostic(code, n, message, n ? nodeSectionNumber(n, byId) : undefined));
  if (!object(config)) return { ok: false, schema: INVENTORY_SCHEMA, status: 'blocked', issues: [diagnostic('CONFIG', null, '配置必须是对象')] };
  for (const k of Object.keys(config)) if (!CONFIG_KEYS.includes(k)) fail('CONFIG_KEY', null, `未知配置 ${k}`);
  for (const k of CONFIG_KEYS) if (config[k] !== undefined && !object(config[k])) fail('CONFIG_TYPE', null, `${k} 必须是对象`);
  if (object(config.fonts)) validateFonts(config.fonts, fail);
  const raw = new Map(), parsed = new Map(), seen = new Set();
  const safeTree = source => {
    if (!source || !nonempty(source.id) || seen.has(source.id)) throw new Error('快照节点必须有唯一字符串 id');
    seen.add(source.id); raw.set(source.id, source);
    const p = parseOnePageName(source.name, source); parsed.set(source.id, p);
    const role = p.prefix === 'title' ? 'grp' : p.prefix;
    const name = role ? `${role}/${p.label}` : source.type === 'TEXT' ? '文字' : source.name?.split('@')[0];
    return { ...source, name, children: (source.children || []).map(safeTree) };
  };
  let inv;
  try { inv = buildInventory(safeTree(document), options); }
  catch (error) { return { ok: false, schema: INVENTORY_SCHEMA, status: 'blocked', issues: [diagnostic('SNAPSHOT', null, error.message)] }; }
  if (!inv.ok) return { ...inv, schema: INVENTORY_SCHEMA, status: 'blocked', issues: [diagnostic('SNAPSHOT', null, inv.error)] };
  inv.schema = INVENTORY_SCHEMA; inv.contract = CONTRACT_VERSION;
  inv.requiredCapabilities = Object.values(CAPABILITIES); inv.specVersion = CONTRACT_VERSION;
  const nodes = allNodesOf(inv);
  byId = new Map(nodes.map(n => [n.id, n]));
  const ancestors = n => (n.ancestorIds || []).map(id => byId.get(id)).filter(Boolean);
  const children = n => nodes.filter(c => c.parentId === n.id && c.scope === n.scope && product(c));
  const descendants = n => nodes.filter(c => c.scope === n.scope && c.ancestorIds?.includes(n.id));
  for (const n of nodes) {
    const src = raw.get(n.id), p = parsed.get(n.id);
    if (!src || !p) continue;
    n.name = src.name ?? ''; n.declaration = { raw: n.name, params: p.params, source: 'figma:name' };
    const chain = [...ancestors(n), n];
    if (chain.some(a => parsed.get(a.id)?.prefix === 'ref')) { n.status = 'skipped'; n.role = null; n.behavior = 'none'; n.why = 'ref'; continue; }
    if (chain.some(a => raw.get(a.id)?.visible === false)) { n.status = 'skipped'; n.role = null; n.behavior = 'none'; n.why = 'invisible'; continue; }
    for (const problem of p.problems) fail('NAME', n, problem);
    if (ancestors(n).some(a => ['bg','kv'].includes(parsed.get(a.id)?.prefix))) {
      if (Object.keys(p.params).length) fail('FIXED_ASSET_BINDING', n, 'bg/kv 内部不能独立声明参数');
      n.status = 'skipped'; n.role = null; n.behavior = 'none'; n.why = 'fixed-asset-child'; delete n.sliceExport; continue;
    }
    const role = p.prefix || (src.type === 'TEXT' ? 'copy' : n.role);
    if (role) {
      n.status = 'determined'; delete n.why; n.role = role;
      n.label = p.prefix || Object.keys(p.params).length ? p.label : src.type === 'TEXT' ? n.name : n.label;
      n.params = p.params; n.behavior = ROLE_BEHAVIOR[role]; n.part = p.params.part ?? null; n.designVisible = src.visible !== false;
      if (p.params.lang) n.langs=p.params.lang.split(',');
      if (role === 'title' && src.type !== 'FRAME') fail('TITLE_FRAME', n, 'title 只标外层 Frame');
      if (['modal','dropmenu'].includes(role)) n.initialState = 'closed';
      if (['bg','kv'].includes(role)) n.exportPolicy = { mode: 'fixed-whole-image', includeText: true };
      if (role === 'img') {
        const textIds = descendants(n).filter(c => raw.get(c.id)?.type === 'TEXT').map(c => c.id);
        n.exportPolicy = { mode: 'image-with-separate-text', excludeTextIds: textIds };
        if (textIds.length) { delete n.sliceExport; n.requiredExportCapability = CAPABILITIES.textLayers; }
      }
    } else { n.role = null; n.behavior = 'none'; }
  }
  const section = n => [...ancestors(n), n].reverse().find(a => a.role === 'sec');
  const scopeKey = n => section(n)?.id ?? n.scope;
  const resolve = (reference, origin, roles = null) => {
    if (!nonempty(reference)) { fail('TARGET', origin, '目标引用必须是非空字符串'); return null; }
    if (reference.startsWith('node:')) {
      const node = byId.get(reference.slice(5));
      if (!product(node) || (roles && !roles.includes(node.role))) {
        fail('TARGET', origin, `${reference} 需要唯一且类型正确的对象，命中 ${product(node) ? 1 : 0}`);
        return null;
      }
      return node;
    }
    let candidates = nodes.filter(product), local = reference;
    const split = reference.split('::');
    if (split.length === 2) {
      const match = /^sec[/]([1-9][0-9]*)$/.exec(split[0]);
      const secs = candidates.filter(n => n.role === 'sec' && n.scope === 'page' && String(n.label).match(/^[0-9]+/)?.[0] === match?.[1]);
      if (!match || secs.length !== 1) { fail('TARGET_SCOPE', origin, `跨屏范围不唯一 ${split[0]}`); return null; }
      candidates = candidates.filter(n => scopeKey(n) === secs[0].id); local = split[1];
    } else if (split.length > 2) { fail('TARGET_SCOPE', origin, `无效引用 ${reference}`); return null; }
    else if (!origin) candidates = candidates.filter(n => n.scope === 'page' || n.role === 'modal');
    else if (/^(modal|fix)[/]/.test(reference)) candidates = candidates.filter(n => ['modal','fix'].includes(n.role));
    else candidates = candidates.filter(n => n.scope === origin.scope && scopeKey(n) === scopeKey(origin));
    candidates = candidates.filter(n => keyOf(n) === local);
    if (candidates.length !== 1 || (roles && !roles.includes(candidates[0]?.role))) { fail('TARGET', origin, `${reference} 需要唯一且类型正确的对象，命中 ${candidates.length}`); return null; }
    return candidates[0];
  };
  const resolveBindingTargets = (reference) => {
    if (!nonempty(reference)) return [];
    if (reference.startsWith('node:')) {
      const node = byId.get(reference.slice(5));
      return product(node) ? [node] : [];
    }
    if (reference.startsWith('component:')) {
      const id = reference.slice(10);
      return nodes.filter((n) => product(n) && n.componentId === id);
    }
    const one = resolve(reference, null);
    return one ? [one] : [];
  };
  const settings = new Map();
  for (const [ref, value] of Object.entries(config.bindings || {})) {
    const targets = resolveBindingTargets(ref);
    if (!targets.length) continue;
    if (!object(value)) { fail('BINDING_CONFIG', targets[0], '对象配置必须是对象'); continue; }
    for (const k of Object.keys(value)) if (!BINDING_KEYS.includes(k)) fail('BINDING_KEY', targets[0], `未知对象配置 ${k}`);
    for (const target of targets) {
      if (settings.has(target.id)) fail('BINDING_DUPLICATE', target, '多个配置引用同一对象');
      settings.set(target.id, value);
    }
  }
  const cfg = n => settings.get(n.id) || {};
  const merge = (a,b,n,what) => {
    if (a !== undefined && b !== undefined && !isDeepStrictEqual(a,b)) fail('CONFLICT', n, `${what} 的命名和配置冲突`);
    return a ?? b;
  };
  const sectionNodes = nodes.filter(n => product(n) && n.role === 'sec' && n.scope === 'page');
  const sectionNumber = n => Number(String(n?.label).match(/^[0-9]+/)?.[0]);
  const numbers = sectionNodes.map(sectionNumber);
  if (!numbers.length || numbers.some(x => !Number.isSafeInteger(x) || x < 1) || new Set(numbers).size !== numbers.length) fail('SECTIONS', null, '需要明确且编号唯一的 sec 分屏');
  const stateOptions = (n, property) => {
    const def = raw.get(n.componentId) || raw.get(n.id);
    const owner = [...raw.values()].find(x => x.type === 'COMPONENT_SET' && x.children?.some(y => y.id === def?.id));
    return owner?.componentPropertyDefinitions?.[property]?.variantOptions || def?.componentPropertyDefinitions?.[property]?.variantOptions || [];
  };
  const env = { inv, nodes, byId, raw, ancestors, children, descendants, section, sectionNumber, sectionNodes, resolve, cfg, merge, fail, stateOptions };
  compileData(env); compileRelations(env, config); compileMotion(env, config);
  for (const n of nodes.filter(product)) {
    const c=cfg(n);
    if (n.params?.from && !numbers.includes(Number(n.params.from))) fail('FROM_SECTION',n,'fix 的 from 指向不存在的屏');
    if (c.state && !n.params?.state) fail('STATE_DECLARATION',n,'状态字段必须在设计稿声明');
    if (c.fieldTarget && !n.params?.field) fail('FIELD_DECLARATION',n,'字段必须在设计稿声明');
    if ((c.slotMapping || c.missing) && n.dataBinding?.kind !== 'slots') fail('SLOT_DECLARATION',n,'槽位配置缺稿上 slots 声明');
    if (c.layout && n.dataBinding?.kind !== 'list') fail('LAYOUT_DECLARATION',n,'等价排布配置缺可变列表声明');
    if (!n.pageBox || ![n.pageBox.x,n.pageBox.y,n.pageBox.w,n.pageBox.h].every(Number.isFinite)) fail('GEOMETRY',n,'缺实际页面几何数据');
  }
  for (const r of inv.relations) if (r.status !== 'determined') fail('COMPONENT_DEFINITION',byId.get(r.from?.id),'组件关系未闭合，不能交接');
  inv.runtimePolicy = { fetchWithoutEndpoint: false, polling: false, retries: false, dataFailure: 'preserve-design-defaults', showOpensModal: false, sectionGateHidesNavigation: true };
  if (object(config.fonts)) inv.fonts = structuredClone(config.fonts);
  rebuildInventoryIndexes(inv);
  if (options.data !== undefined) issues.push(...validateOnePageData(inv, options.data, { state: options.dataState || 'success' }).issues);
  inv.issues = issues; inv.ok = issues.length === 0; inv.status = inv.ok ? 'ready' : 'blocked';
  return inv;
}

function compileData({ inv, nodes, byId, raw, ancestors, children, cfg, merge, fail, stateOptions }) {
  const contexts = new Map(); inv.bindings = [];
  for (const n of nodes) {
    const parent = byId.get(n.parentId);
    let incoming = contexts.get(n.parentId) || [];
    if (n.role === 'item' && parent?.dataBinding?.kind === 'list') incoming = [...parent.dataBinding.path || [], {itemOf:parent.id}];
    if (n.role === 'item' && parent?.dataBinding?.kind === 'slots') {
      const d=parent.dataBinding, index=d.slots.findIndex(x=>x.id===n.id);
      let token={slotOf:parent.id,index};
      if(d.mapping?.kind==='key') {
        try { token={slotOf:parent.id,field:parseDataPath(d.mapping.field).tokens,key:d.mapping.keys[index]}; } catch { fail('SLOT_MAPPING',n,'槽位键映射无效'); }
      }
      incoming=[...d.path || [],token];
    }
    contexts.set(n.id, incoming);
    if (!product(n)) continue;
    const p = n.params || {}, c = cfg(n);
    let context = incoming;
    const path = (value, base) => { try { return joinDataPath(base, parseDataPath(value)); } catch (e) { fail('DATA_PATH', n, e.message); return null; } };
    if (p.data) {
      const pos = p.data.indexOf(':'), kind = p.data.slice(0,pos), resolved = path(p.data.slice(pos+1), incoming);
      n.dataBinding = { kind, path: resolved, raw: p.data, source: 'figma:name', failure: 'preserve-design-defaults', emptyOnlyOn: 'successful-array' };
      if (resolved && kind === 'object') context = resolved;
      const items = children(n).filter(x => x.role === 'item');
      if (kind === 'list') {
        const templates = items.filter(x => x.params?.template);
        if (templates.length !== 1) fail('TEMPLATE', n, '可变列表需要唯一直属 item@template');
        else n.dataBinding.template = refOf(templates[0]);
        if (!['HORIZONTAL','VERTICAL','GRID'].includes(raw.get(n.id)?.layoutMode)) {
          const layout = c.layout;
          if (!object(layout) || layout.kind !== 'equivalent' || !nonempty(layout.source) || !['row','column','grid'].includes(layout.mode)) fail('LIST_LAYOUT', n, '可变列表缺 Auto Layout 或有来源的等价排布');
          else n.dataBinding.layout = layout;
        }
      }
      if (kind === 'slots') {
        if (!items.length || !['array-order','key'].includes(c.slotMapping?.kind)) fail('SLOT_MAPPING', n, '固定槽位需要明确数组顺序或键映射');
        if (!['design-default','pending'].includes(c.missing)) fail('SLOT_DEFAULT', n, '固定槽位需要缺值规则');
        n.dataBinding.slots = items.map(refOf); n.dataBinding.mapping = c.slotMapping; n.dataBinding.missing = c.missing;
        if (c.slotMapping?.kind === 'key') {
          const keys = c.slotMapping.keys;
          if (!Array.isArray(keys) || keys.length !== items.length || keys.some(x => !nonempty(x)) || new Set(keys).size !== keys.length || !nonempty(c.slotMapping.field)) fail('SLOT_MAPPING', n, '键映射需要字段和逐槽唯一键');
          else { try { parseDataPath(c.slotMapping.field); } catch(e) { fail('SLOT_MAPPING', n, e.message); } }
        }
      }
      inv.bindings.push({ node: refOf(n), type: 'data', ...n.dataBinding });
    }
    contexts.set(n.id, context);
    if (p.template && !(n.role === 'item' && parent?.dataBinding?.kind === 'list')) fail('TEMPLATE_OWNER', n, 'template 只能标在可变列表直属 item');
    if (n.role === 'item' && parent?.role !== 'list') fail('ITEM_OWNER', n, 'item 必须属于明确 list');
    n.bindings = {};
    for (const kind of ['show','field','state']) {
      if (!p[kind]) continue;
      const b = { path: path(p[kind],context), raw: p[kind], source: 'figma:name' };
      if (kind === 'show') b.policy = 'visibility-gate-only';
      if (kind === 'field') {
        const implied = n.type === 'TEXT' ? 'text' : n.role === 'img' ? 'image' : ['btn','hot'].includes(n.role) && (p.link || c.action?.type === 'open-link') ? 'link' : undefined;
        b.target = merge(implied,c.fieldTarget,n,'字段去向');
        if (!['text','image','link','component-input'].includes(b.target)) fail('FIELD_TARGET', n, 'field 缺明确的文字/图片/链接/组件输入去向');
        if (b.target === 'component-input' && (n.role !== 'dyn' || !nonempty(c.functionContract))) fail('FUNCTION_CONTRACT', n, '组件输入需要 dyn 与既有功能合同');
      }
      if (kind === 'state') {
        const m = c.state;
        if (!object(m) || !nonempty(m.property) || !object(m.values) || !Object.keys(m.values).length) fail('STATE_MAPPING', n, 'state 缺属性与值映射');
        else {
          const choices = stateOptions(n,m.property);
          if (!choices.length || Object.values(m.values).some(v => !choices.includes(v))) fail('STATE_DESIGN', n, '映射引用了未画出的状态');
          if (['lang','language','open'].includes(m.property) || ['dropmenu','modal','switch'].includes(n.role)) fail('STATE_CONTROL', n, '数据 state 不能绕过语言、弹层或轮播控制');
          b.mapping = m;
        }
      }
      n.bindings[kind] = b; inv.bindings.push({ node: refOf(n), type: kind, ...b });
    }
    if (n.part === 'foreground') {
      const display = [...ancestors(n),n].reverse().find(a => ['sec','fix','modal'].includes(a.role));
      if (!display || !['sec','fix'].includes(display.role)) fail('FOREGROUND_SCOPE', n, '前景缺明确 sec/fix 显示范围');
      else n.displayScope = refOf(display);
    }
  }
}

export function validateOnePageData(inv, data, { state = 'success' } = {}) {
  const byId = new Map(allNodesOf(inv).map((n) => [n.id, n]));
  const issues = [], fail = (n,message) => issues.push(diagnostic('DATA_VALUE',n,message, nodeSectionNumber(n, byId)));
  if (!['success','missing','failure'].includes(state)) return { ok: false, issues: [diagnostic('DATA_STATE',null,'未知数据状态')] };
  if (state !== 'success') return { ok: true, issues, useDesignDefaults: true, empty: false };
  for (const n of allNodesOf(inv).filter(product)) {
    const d = n.dataBinding;
    if (d?.path) for (const value of valuesAtPath(data,d.path)) {
      if (d.kind === 'object' && !object(value)) fail(n,'object 字段必须是对象');
      if (['list','slots'].includes(d.kind) && !Array.isArray(value)) fail(n,`${d.kind} 字段必须是数组`);
      if (d.kind === 'slots' && Array.isArray(value)) {
        if (value.length > d.slots.length) fail(n,'数据超过固定槽位，不能截断');
        if (d.mapping?.kind === 'key') {
          let keys = [];
          try { keys = value.map(x => valuesAtPath(x,parseDataPath(d.mapping.field).tokens)[0]); } catch { fail(n,'键映射路径无效'); }
          if (keys.some(k => !d.mapping.keys.includes(k)) || new Set(keys).size !== keys.length) fail(n,'槽位数据有未知或重复键');
        }
      }
    }
    for (const [kind,b] of Object.entries(n.bindings || {})) {
      if (!b.path) continue;
      for (const value of valuesAtPath(data,b.path)) {
        if (kind === 'show' && typeof value !== 'boolean') fail(n,'show 字段必须是布尔值');
        if (kind === 'field' && b.target === 'text' && !['string','number'].includes(typeof value)) fail(n,'文字字段必须是文字或数字');
        if (kind === 'field' && ['image','link'].includes(b.target) && typeof value !== 'string') fail(n,'图片/链接字段必须是字符串');
        if (kind === 'state' && !Object.hasOwn(b.mapping?.values || {},String(value))) fail(n,'数据状态没有映射');
      }
    }
  }
  return { ok: !issues.length, issues, useDesignDefaults: false };
}

function compileRelations({ inv,nodes,ancestors,descendants,sectionNodes,sectionNumber,resolve,cfg,merge,fail,stateOptions }, config) {
  const relations = inv.relations.filter(r => ['instance-uses-variant','component-set-has-variant'].includes(r.kind));
  const add = (n,t,kind,source) => { if(t) relations.push({ from:refOf(n),to:refOf(t),kind,source,status:'determined' }); };
  const devTodo = [];
  for (const n of nodes.filter(product)) {
    const p = n.params || {}, c = cfg(n), candidates = [];
    if (p.link) {
      const declared = declaredOpenLink(config, p.link);
      if (declared.error) fail(declared.error, n, declared.message);
      else candidates.push(declared.action);
    }
    if (p.sec) candidates.push(p.sec === 'next' ? { type:'next-section' } : { type:'go-section',section:Number(p.sec) });
    if (p.go) {
      if (/^modal[/]/.test(p.go)) candidates.push({ type:'open-modal',target:p.go });
      else {
        const action = own(config.actions, p.go);
        if (object(action) && action.type === 'open-link') fail('ACTION_LINK_SOURCE', n, '外链请用 @link 或 bindings 动作');
        else candidates.push(action);
      }
    }
    if (p.action) {
      const action = own(config.actions, p.action);
      if (object(action) && action.type === 'open-link') fail('ACTION_LINK_SOURCE', n, '外链请用 @link 或 bindings 动作');
      else candidates.push(action);
    }
    if (c.action) candidates.push(c.action);
    if (candidates.some(x => !object(x))) fail('ACTION_CONFIG',n,'动作配置键不存在或不是动作对象');
    const actions = candidates.filter(object), a = actions[0];
    if (actions.some(x => !isDeepStrictEqual(x,a))) fail('ACTION_CONFLICT',n,'多个动作来源冲突');
    n.action = null;
    if (a) {
      if (!['btn','hot'].includes(n.role)) fail('ACTION_ROLE',n,'动作只允许 btn/hot');
      if (!ACTION_TYPES.includes(a.type)) fail('ACTION_TYPE',n,'不支持的动作类型');
      const actionKeys = {
        'open-link':['key','url'], 'go-section':['section'], 'next-section':[],
        'copy-text':['value'], 'set-state':['target','targets','property','value'],
      };
      const allowed = ['type',...(actionKeys[a.type] || ['target','targets'])];
      for (const k of Object.keys(a)) if (!allowed.includes(k)) fail('ACTION_PARAMETER',n,`动作不支持参数 ${k}`);
      const out = { ...a, source: p.link ? 'figma:name:@link' : p.action ? `config.actions:${p.action}` : p.go ? 'figma:name:@go' : c.action ? 'config.bindings:action' : 'figma:name' };
      if (a.type === 'go-section') {
        const targets = sectionNodes.filter(x => sectionNumber(x) === a.section);
        if (targets.length !== 1) fail('SECTION_TARGET',n,'分屏目标不存在/不唯一');
        else { out.target = refOf(targets[0]); add(n,targets[0],'section-trigger',out.source); }
      }
      if (a.type === 'next-section') out.navigation = { order:sectionNodes.slice().sort((x,y) => sectionNumber(x)-sectionNumber(y)).map(refOf),visibleOnly:true,last:'home' };
      if (a.type === 'open-link' && a.url !== null) {
        try { if (!['http:','https:'].includes(new URL(a.url).protocol)) throw new Error(); } catch { fail('LINK_URL',n,'open-link 需要 http(s) URL 或显式 null'); }
      }
      if (a.type === 'copy-text' && typeof a.value !== 'string') fail('ACTION_VALUE',n,'copy-text 缺文字值');
      if (['open-modal','close-modal','set-state','next-page','previous-page','show-target','hide-target'].includes(a.type)) {
        if (a.targets && a.target) fail('ACTION_TARGETS',n,'target 与 targets 不得同时声明');
        const refs = a.targets ?? [a.target ?? p.for ?? c.for];
        if (!Array.isArray(refs) || !refs.length || new Set(refs).size !== refs.length) fail('ACTION_TARGETS',n,'targets 必须是非空、无重复引用数组');
        else {
          const roles = ['open-modal','close-modal'].includes(a.type) ? ['modal'] : ['next-page','previous-page'].includes(a.type) ? ['switch'] : null;
          out.targets = refs.map(r => resolve(r,n,roles)).filter(Boolean).map(t => {
            if (['show-target','hide-target'].includes(a.type) && ['modal','dropmenu','switch','sec'].includes(t.role)) fail('ACTION_CONTROL',n,'显隐动作不能绕过弹层、菜单、分页或切屏控制');
            if (['next-page','previous-page'].includes(a.type) && !cfg(t).pagination) fail('PAGINATION',n,'翻页目标未声明分页合同');
            if (a.type === 'set-state' && (!stateOptions(t,a.property).includes(a.value) || ['lang','language','open'].includes(a.property) || ['switch','modal','dropmenu'].includes(t.role))) fail('ACTION_STATE',n,'动作须引用已画出且不绕过语言/开合/分页控制的状态');
            add(n,t,'action-target',out.source); return refOf(t);
          });
        }
      }
      if (p.for || c.for) {
        const t = resolve(merge(p.for,c.for,n,'for'),n);
        const ids = [...(out.targets || []),...(out.target?.id ? [out.target] : [])].map(x => x.id);
        if (t && !ids.includes(t.id)) fail('ACTION_TARGET_CONFLICT',n,'for 与动作目标不一致或动作不使用目标');
      }
      n.action = out;
    }
    if (n.action?.type === 'open-link' && n.action.url === null) {
      const sec = [...ancestors(n), n].reverse().find((item) => item.role === 'sec');
      const number = sectionNumber(sec);
      devTodo.push({
        kind: 'link-url-pending',
        node: refOf(n),
        key: n.action.key ?? p.link ?? null,
        section: Number.isSafeInteger(number) ? number : null,
        source: n.action.source === 'config.bindings:action' ? 'config.bindings:action' : 'figma:name:@link',
      });
    }
    if (['btn','hot'].includes(n.role) && !n.action) fail('ACTION_MISSING',n,'点击入口缺明确动作');
    if (n.bindings?.field?.target === 'link' && n.action?.type !== 'open-link') fail('FIELD_ACTION',n,'链接字段须有明确 open-link 动作');
    const role = n.part === 'pager' ? 'pager' : n.part === 'empty' ? 'empty' : ['tab','ind'].includes(n.role) ? n.role : null;
    if (role) {
      const allowed = role === 'empty' ? ['list','switch'] : ['switch'];
      const structural = ancestors(n).reverse().find(x => product(x) && allowed.includes(x.role));
      const reference = merge(p.for,c.for,n,'for');
      const target = reference ? resolve(reference,n,allowed) : structural;
      if (!target) fail('RELATION_MISSING',n,`${role} 缺唯一目标`);
      else {
        if (structural && structural.id !== target.id) fail('RELATION_CONFLICT',n,'显式目标与结构目标矛盾');
        if (['pager','ind'].includes(role) && !cfg(target).pagination) fail('PAGINATION',n,'页码/指示必须绑定明确分页 switch');
        add(n,target,role,reference ? 'name-or-config:for' : 'figma:ancestor');
        if (role === 'pager') {
          n.pagerPolicy = { digits:2,zero:'hidden',one:'01/01',total:'page-count' };
          if (n.type !== 'TEXT') for (const part of ['page-current','page-total']) {
            const matches = descendants(n).filter(x => product(x) && x.part === part);
            if (matches.length !== 1 || matches[0].type !== 'TEXT') fail('PAGER_VALUES',n,`组合页码需要唯一 TEXT @part=${part}`);
          }
        }
        if (role === 'empty') n.emptyPolicy = { visibleOn:'successful-zero-items',failureIsEmpty:false };
      }
    } else if ((p.for || c.for) && !n.action) fail('FOR_PURPOSE',n,'for 缺明确关联用途');
    if (['page-current','page-total'].includes(n.part) && !ancestors(n).some(a => a.part === 'pager')) fail('PAGER_OWNER',n,'页码值缺 pager 外层');
    if (c.pagination !== undefined) {
      const paging = c.pagination;
      if (n.role !== 'switch' || !object(paging) || !['cards','panels'].includes(paging.kind)) fail('PAGINATION',n,'分页合同须属于 switch，kind 为 cards/panels');
      else if (paging.kind === 'cards') {
        const list = resolve(paging.list,n,['list']);
        const perPage = parsePerPage(paging.perPage);
        if (!list?.ancestorIds?.includes(n.id) || perPage == null) fail('PAGINATION',n,'卡片分页需要内部 list 与正整数 perPage 或 {pc,mobile}');
        else n.pagination = { ...paging, perPage, list:refOf(list) };
      } else {
        const panels = Array.isArray(paging.panels) ? paging.panels.map(r => resolve(r,n)) : [];
        if (!panels.length || panels.some(x => !x?.ancestorIds?.includes(n.id)) || new Set(panels.map(x => x?.id)).size !== panels.length) fail('PAGINATION',n,'独立页面分页需要明确无重复的内部面板');
        else n.pagination = { kind:'panels',panels:panels.map(refOf) };
      }
    }
  }
  inv.relations = relations;
  inv.devTodo = devTodo;
}

const NESTED_STANDARD = {
  'section-fade': ['section-title', 'content-left', 'cards-center', 'foreground-crystal', 'carousel-track', 'menu-fade'],
  'first-screen': ['foreground-crystal', 'content-left', 'cards-center', 'carousel-track', 'menu-fade'],
  'carousel-track': ['content-left', 'cards-center'],
};

function nestedStandardAllowed(outers, childRule) {
  return outers.every((parent) => (NESTED_STANDARD[parent.motion.rule] || []).includes(childRule));
}

function compileMotion({ nodes,ancestors,children,section,sectionNumber,resolve,cfg,merge,fail },config) {
  for (const n of nodes.filter(product)) {
    const c = cfg(n), key = merge(n.params?.motion,c.motion,n,'motion');
    if (c.motionRequired && !key) fail('MOTION_MISSING',n,'应有动效却未明确选择');
    if (!key) continue;
    const m = own(config.motions,key), rule = own(MOTIONS,m?.rule);
    if (!object(m) || !rule) { fail('MOTION_RULE',n,`未知动效配置/规则 ${key}`); continue; }
    for (const k of Object.keys(m)) if (!['rule','unit','trigger','source','composition','device','count','batches','direction'].includes(k)) fail('MOTION_PARAMETER',n,`不能自定义动效参数 ${k}`);
    if (!rule.roles.includes(n.role) || !rule.units.includes(m.unit) || !rule.triggers.includes(m.trigger) || !nonempty(m.source)) fail('MOTION_CONTRACT',n,'动效对象/作用单元/触发或已定来源不完整');
    if (m.rule === 'section-title' && sectionNumber(section(n)) === 1) fail('MOTION_FIRST_SCREEN',n,'首屏标题不能自动套普通分区标题');
    if (m.rule === 'first-screen' && sectionNumber(section(n)) !== 1) fail('MOTION_FIRST_SCREEN',n,'首屏组合只适用于明确的首屏');
    if (m.rule === 'foreground-crystal' && (n.part !== 'foreground' || !nonempty(m.direction))) fail('MOTION_DIRECTION',n,'前景动效须有明确前景身份与已定方向');
    if (m.rule === 'cards-center' && (!['pc','mobile'].includes(m.device) || ![1,2,3,4].includes(m.count))) fail('MOTION_LAYOUT',n,'中心展开仅支持已覆盖端与1～4项排布');
    if (m.unit === 'items' && !children(n).length) fail('MOTION_ITEMS',n,'逐项动效缺明确子项');
    if (m.unit === 'batches') {
      const refs = Array.isArray(m.batches) && m.batches.every(b => Array.isArray(b) && b.length) ? m.batches.flat() : [];
      const ids = refs.map(r => resolve(r,n)?.id), itemIds = children(n).map(x => x.id);
      if (!ids.length || new Set(ids).size !== ids.length || !isDeepStrictEqual(ids.slice().sort(),itemIds.slice().sort())) fail('MOTION_BATCHES',n,'分批需要完整且不重复的明确子项分组');
    }
    n.motion = { key,...m,standard:rule.standard,reducedMotion:'standard-9.1',hidden:'exclude',sourceType:'config:motions' };
  }
  for (const n of nodes.filter(n => n.motion)) {
    const outer = ancestors(n).filter(a => a.motion);
    if (outer.length && n.motion.composition !== 'nested-standard') fail('MOTION_OVERLAP',n,'父子动效重复作用，缺明确组合规则');
    if (outer.length && !nestedStandardAllowed(outer, n.motion.rule)) fail('MOTION_COMPOSITION',n,'当前标准未覆盖此父子动效组合');
  }
}
