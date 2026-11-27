import { requireAssets } from './assets-manifest.mjs';
import { sha256Hex } from './canonical.mjs';
import { pageFiles } from './c-page-check.mjs';
import { runtime } from './c-page-runtime.mjs';
import { c2NodeView } from './c2-contract.mjs';
import { variantPropertyName, variantPropertyPairs, variantPropertyRaw } from '../../figma-naming/tool/src/lang-axis.mjs';

const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const attr = (name, value) => value == null ? '' : ' ' + name + '="' + escape(value) + '"';
const ref = (node) => JSON.stringify([node?.scope, node?.id]);
const langTag = (lang) => ({ cn: 'zh-CN', tw: 'zh-TW', jp: 'ja', kr: 'ko' }[lang] ?? lang);

function variantValues(variant) {
  return new Map([...variantPropertyPairs(variant.name).map(({key,value}) => [key,value]),
    ...Object.entries(variant.componentProperties ?? {}).map(([key,value]) => [variantPropertyName(key), String(variantPropertyRaw(value))])]);
}

function variantPlan(inventory, node, property, wanted, end) {
  const matches = inventory.relations.filter((relation) => relation.status === 'determined' && relation.kind === 'instance-uses-variant' && ref(relation.from) === ref(node));
  const set = (inventory.attachments?.componentSets ?? []).find((item) => item.id === matches[0]?.to.componentSetId);
  const initial = set?.variants.find((variant) => variant.id === matches[0].to.id);
  const context = end + ' / ' + node.id + ' / ' + (property ?? 'on/off');
  requireAssets(matches.length === 1 && initial, '缺可核验组件集与实例变体：' + context);
  const axes = Object.entries(set.componentPropertyDefinitions ?? {}).filter(([,definition]) => definition.type === 'VARIANT');
  const values = variantValues(initial);
  const axis = axes.filter(([key,definition]) => property ? variantPropertyName(key) === variantPropertyName(property)
    : definition.variantOptions?.length === 2 && wanted.every((value) => definition.variantOptions.includes(value)));
  requireAssets(axis.length === 1, '组件状态轴缺失或不唯一：' + context);
  const key = variantPropertyName(axis[0][0]);
  const mapped = new Map();
  for (const value of new Set([...wanted, values.get(key)])) {
    requireAssets(typeof value === 'string' && axis[0][1].variantOptions?.includes(value), '组件状态不在声明集合：' + context);
    const candidates = set.variants.filter((variant) => {
      const properties = variantValues(variant);
      return properties.get(key) === value && axes.every(([other]) => variantPropertyName(other) === key
        || properties.has(variantPropertyName(other)) && properties.get(variantPropertyName(other)) === values.get(variantPropertyName(other)));
    });
    requireAssets(candidates.length === 1, '组件对应变体缺失或歧义：' + context + ' / ' + value);
    mapped.set(value, candidates[0]);
  }
  return { initial: values.get(key), variants: mapped };
}

export function resolveTabBindings(inventories, declarations = [], baseLanguage) {
  const result = [];
  const consumed = new Set();
  for (const [end, inventory] of Object.entries(inventories)) {
    const { tabGroups } = c2NodeView(inventory, baseLanguage);
    for (const { relation, panels } of tabGroups()) {
      const matching = declarations.filter((item) => item.end === end && ref(item.tab) === ref(relation.from));
      const context = [end, relation.from.id, relation.to.id, panels.map(({ id }) => id).join(', ')].join(' / ');
      requireAssets(matching.length === 1, 'H29 缺失或歧义，请向设计来源补齐 TAB → 面板：' + context);
      const [binding] = matching;
      requireAssets(typeof binding.source === 'string' && binding.source.trim()
        && ref(binding.switch) === ref(relation.to)
        && panels.some((panel) => ref(panel) === ref(binding.panel)),
      'H29 跨组、跨端或缺来源：' + context);
      requireAssets(!result.some((item) => item.end === end && ref(item.switch) === ref(binding.switch)
        && ref(item.panel) === ref(binding.panel)), 'H29 同组面板绑定冲突：' + context);
      result.push(binding);
      consumed.add(binding);
    }
  }
  requireAssets(consumed.size === declarations.length, 'H29 含未消费、跨端或冲突声明');
  return result;
}

const common = [
  '/* Global */',
  ':root{--screen-duration:400ms;--panel-duration:200ms;--hero-duration:1300ms;--slide-duration:320ms;--footer-duration:450ms;--title-duration:560ms;--content-duration:560ms;--cards-duration:650ms;--foreground-duration:720ms;--intro-duration:600ms;--stagger:60ms;--foreground-stagger:120ms;--focus-color:currentColor;--nav-unit:min(calc(100vw / 19.2),1.08rem);--social-unit:calc(100vw / 19.2);--safe-bottom:env(safe-area-inset-bottom,0px);--overlay-layer:10000;--status-layer:10001;font-size:calc(100vw / 19.2)}',
  '@media (min-aspect-ratio:16/9){:root{font-size:calc(100vh / 10.8);font-size:calc(100dvh / 10.8)}}',
  '*,*::before,*::after{box-sizing:border-box}body{margin:0;font-size:.16rem;user-select:none}input,textarea,[contenteditable],[data-copy]{user-select:text}button{color:inherit;font:inherit}img{display:block;max-width:100%;-webkit-user-drag:none}button:focus-visible,a:focus-visible{outline:.03rem solid var(--focus-color);outline-offset:.05rem}[hidden]{display:none!important}',
  '/* Skeleton */',
  '.stage{position:relative;min-height:100vh;min-height:100dvh}.screen{position:relative;display:grid;place-items:center;isolation:isolate;min-height:100dvh}.screen-content{position:relative;display:grid;width:var(--stage-width);min-height:var(--stage-height)}.module{position:relative;min-width:0}.art{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.cover{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-1}.copy{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.is-enhanced img:not([src]){visibility:hidden}',
  '/* Screens */',
  '.is-enhanced{overflow:hidden}.is-enhanced .screen{position:absolute;inset:0;opacity:0;transition:opacity var(--screen-duration) ease;pointer-events:none}.is-enhanced .screen.is-current{opacity:1;pointer-events:auto}.is-aligning .screen{transition:none}.is-locked{overflow:hidden}.hero-video{position:absolute;inset:0;z-index:-1}.hero-video video{width:100%;height:100%;object-fit:cover}',
  '/* Modules */',
  '[data-fixed-from]{position:fixed;padding-block-end:var(--safe-bottom)}.overlay:popover-open{display:grid;position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;border:0;padding:0;background:none;color:inherit}.menu-panel,.overlay-content,.page-footer-mount{padding-block-end:var(--safe-bottom)}[data-nav-control]{font-size:var(--nav-unit)}',
  ':root{--track-duration:420ms}.carousel-viewport{position:relative;overflow:clip;min-width:0;width:100%;grid-area:1/1}.carousel-track{display:flex;width:100%}.carousel-page{flex:0 0 100%;min-width:0;justify-content:center;box-sizing:border-box}',
  '.menu-toggle,.variant-face,.menu-panel{display:grid;position:relative;width:100%;min-height:inherit}.menu-toggle{padding:0;border:0;background:none}.menu-panel{position:absolute;inset:0;z-index:2;max-height:var(--viewport-height,100dvh);overflow:auto}.menu-panel[inert]{pointer-events:none}[data-selected-art]{opacity:0}[aria-selected=true] [data-selected-art]{opacity:1}.tab-indicator{position:absolute;inset:auto 0 0;border-block-end:.03rem solid currentColor;pointer-events:none}',
  '[data-carousel-items]{justify-content:center}[data-carousel]{touch-action:pan-y}.overlay{position:fixed;inset:0;margin:0;width:auto;min-height:0;display:grid;place-items:center;z-index:2;animation:overlay-in var(--panel-duration) ease}.overlay-content{position:relative;max-height:var(--viewport-height,100dvh);overflow:auto}.status{position:fixed;z-index:3;bottom:env(safe-area-inset-bottom);inset-inline:0;text-align:center;pointer-events:none}.page-footer-mount{max-height:var(--viewport-height,100dvh);overflow:auto;position:absolute;inset:auto 0 0;z-index:2}.is-footer-open [data-fixed],.is-footer-open [data-foreground]{visibility:hidden}@keyframes overlay-in{from{opacity:0}}',
  '@media (prefers-reduced-motion:reduce){:root{--screen-duration:0ms;--panel-duration:0ms}}',
  ':root{--intro-nav-delay:320ms;--intro-crystal-delay:440ms;--intro-social-delay:480ms;--intro-slogan-delay:600ms;--intro-flash-delay:700ms;--return-slogan-delay:80ms;--return-flash-delay:180ms;--intro-chrome-duration:500ms;--intro-slogan-duration:650ms;--intro-flash-duration:200ms;--intro-crystal-duration:600ms;--intro-shift:.18rem;--intro-flash-floor:.5}',
].join('\n');

function rule(node, parent, key, index, family, asset) {
  const box = node.role === 'sec' ? null : node.parentBox;
  const layout = node.layout ?? {};
  const edge = { MIN: 'start', MAX: 'end', CENTER: 'center', SPACE_BETWEEN: 'space-between', BASELINE: 'baseline' };
  const size = (property, value) => Number.isFinite(value) ? '--' + property + ':' + value / 200 + 'rem;' + property + ':var(--' + property + ');' : '';
  let css = size('width', box?.w) + size('height', box?.h) + '--layer:' + index + ';z-index:var(--layer);';
  const mode = layout.layoutMode ?? ({ row:'HORIZONTAL', column:'VERTICAL', grid:'GRID' }[node.dataBinding?.layout?.mode]);
  if (['HORIZONTAL','VERTICAL'].includes(mode)) {
    css += 'display:flex;flex-direction:' + (mode === 'HORIZONTAL' ? 'row' : 'column') + ';';
    if (layout.layoutWrap === 'WRAP') css += 'flex-wrap:wrap;';
    if (edge[layout.primaryAxisAlignItems]) css += 'justify-content:' + edge[layout.primaryAxisAlignItems] + ';';
    if (edge[layout.counterAxisAlignItems]) css += 'align-items:' + edge[layout.counterAxisAlignItems] + ';';
  } else css += 'display:grid;';
  if (layout.itemSpacing >= 0) css += size('gap', layout.itemSpacing);
  if (node.clipsContent && node.role !== 'scroll') css += 'overflow:clip;';
  if (node.role === 'scroll') css += 'overflow:auto;overscroll-behavior:contain;';
  for (const side of ['Top','Right','Bottom','Left']) css += size('padding-' + side.toLowerCase(), layout['padding' + side]);
  if (node.role === 'sec') {
    if (Number.isFinite(node.box?.w)) css += '--stage-width:' + node.box.w / 200 + 'rem;';
    if (Number.isFinite(node.box?.h)) css += '--stage-height:' + node.box.h / 200 + 'rem;';
  } else if (node.role === 'bg') css += 'position:absolute;inset:0;width:100%;height:100%;z-index:-1;';
  else if (box && node.role === 'fix' && !parent) css += 'position:fixed;' + size('left', box.x) + size('top', box.y);
  else if (box && (node.part === 'foreground' || layout.layoutPositioning === 'ABSOLUTE')) css += 'position:absolute;' + size('left', box.x) + size('top', box.y);
  else if (box && !['HORIZONTAL', 'VERTICAL','GRID'].includes(parent?.layout?.layoutMode) && !parent?.dataBinding?.layout) {
    css += 'grid-area:1/1;align-self:start;justify-self:start;' + size('margin-left', box.x) + size('margin-top', box.y);
  }
  if (node.text) {
    css += size('font-size', node.text.fontSize) + size('line-height', node.text.lineHeight) + size('letter-spacing', node.text.letterSpacing);
    if (Number.isFinite(node.text.lineHeightPercent)) css += '--leading:' + node.text.lineHeightPercent + '%;line-height:var(--leading);';
    if (family) css += 'font-family:var(--' + family + ');';
    if (Number.isFinite(node.text.fontWeight)) css += 'font-weight:' + node.text.fontWeight + ';';
    const align = { LEFT:'left', RIGHT:'right', CENTER:'center', JUSTIFIED:'justify' }[node.text.align];
    if (align) css += 'text-align:' + align + ';';
    const color = node.text.color;
    if ([color?.r, color?.g, color?.b].every(Number.isFinite)) css += '--ink:rgb(' + [color.r, color.g, color.b].map((value) => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(' ')
      + ' / ' + (Number.isFinite(color.a) ? Math.max(0, Math.min(1, color.a)) : 1) + ');color:var(--ink);';
    if (node.text.truncation === 'ENDING') css += 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  }
  const localArt = asset?.box && node.pageBox && node.role !== 'bg' ? '.' + key + '>.art{inset:auto;' + size('left', asset.box.x - node.pageBox.x)
    + size('top', asset.box.y - node.pageBox.y) + size('width', asset.box.w) + size('height', asset.box.h) + 'max-width:none;}\n' : '';
  return '.' + key + '{' + css + '}\n' + localArt;
}

export function buildPage({ baseLanguage, ends, inventories, manifest, pairing, tabDeclarations = [], componentInputs = [] }) {
  const tabBindings = resolveTabBindings(Object.fromEntries(ends.map((end) => [end, inventories[end]])), tabDeclarations, baseLanguage);
  const shared = new Map();
  for (const { pcId, mobileId, key } of pairing.paired ?? []) {
    shared.set('pc:' + pcId, 'paired-' + sha256Hex(key).slice(0, 16));
    shared.set('mobile:' + mobileId, 'paired-' + sha256Hex(key).slice(0, 16));
  }
  const slug = (end, node) => node.role + '-' + sha256Hex([end, node.scope, node.id]).slice(0, 16);
  const faces = new Map();
  const fontCss = [];
  for (const font of manifest.fonts) {
    const alias = 'type-' + font.sha256.slice(0, 16);
    const extension = font.path.split('.').at(-1);
    for (const face of font.faces) {
      const weight = Number(face.split('/').at(-1));
      requireAssets(Number.isInteger(weight) && weight >= 1 && weight <= 1000 && /^css\/font\/[a-f0-9]{64}\.(otf|ttf|woff2?)$/.test(font.path), '字体字重或路径无效');
      faces.set(face, alias);
      fontCss.push('@font-face{font-family:' + alias + ';src:url("' + font.path.slice(4) + '") format("'
        + ({ otf:'opentype', ttf:'truetype' }[extension] ?? extension) + '");font-weight:' + weight + ';font-display:swap}');
    }
  }
  const config = { language: langTag(baseLanguage), links: Object.create(null), dataUrl: null, languageUrls: {}, social: {},
    components: { footer: {}, backgroundVideo: { src: null, options: {} }, tracking: {} }, bindings: {}, actions: {} };
  const nodesTrace = [];
  const layouts = { pc: [], mobile: [] };
  const titles = [];
  const preloads = [];
  const markup = ends.map((end) => {
    const inventory = inventories[end];
    const { visible: available, resolve: resolveNode } = c2NodeView(inventory, baseLanguage);
    const assets = new Map(manifest.assets.filter((item) => item.end === end).map((item) => [item.nodeId, item]));
    const productNodes = [...inventory.nodes, ...(inventory.attachments?.modals ?? []).flatMap((part) => part.nodes)];
    const nodes = [...productNodes, ...(inventory.attachments?.componentSets ?? []).flatMap((part) => part.nodes)];
    const byRef = new Map(nodes.map((node) => [ref(node), node]));
    const renderRef = (target) => {
      const resolved = byRef.get(ref(target));
      requireAssets(available(resolved), '找不到本语已声明的动作目标：' + end + ' / ' + target.id);
      return slug(end, resolved);
    };
    const groupKey = (node) => shared.get(end + ':' + node.id) ?? slug(end, node);
    const sections = inventory.nodes.filter((node) => node.role === 'sec' && available(node));
    const sectionNumber = (node) => String(Number.parseInt(node.label,10) || /^sec\/([0-9]+)/.exec(node.name)?.[1] || groupKey(node));
    sections.sort((left,right)=>Number(sectionNumber(left))-Number(sectionNumber(right)));
    requireAssets(sections.length > 0, '缺可生成屏：' + end);
    const requests = new Map();
    const need = (node, property, wanted) => {
      const old = requests.get(ref(node));
      requireAssets(node && (!old || old.property === property), '组件同时声明不同状态轴：' + end + ' / ' + node?.id);
      requests.set(ref(node), { property, wanted: [...(old?.wanted ?? []), ...wanted] });
    };
    for (const node of productNodes.filter(available)) {
      if (node.bindings?.state) need(node, node.bindings.state.mapping.property, Object.values(node.bindings.state.mapping.values));
      if (node.action?.type === 'set-state') for (const target of node.action.targets ?? [node.action.target]) need(byRef.get(ref(target)), node.action.property, [node.action.value]);
    }
    let heading;
    function render(node, parent, index, section, projection = '') {
      if (!available(node)) return '';
      const componentInput = componentInputs.find((item) => item.end === end && item.nodeId === node.id);
      requireAssets(node.bindings?.field?.target !== 'component-input' || componentInput, 'H25 缺组件输入接收器：' + end + ' / ' + node.id + ' / ' + node.bindings?.field?.raw);
      const asset = assets.get(node.id);
      const id = slug(end, node) + projection;
      const targeted = (target) => renderRef(target) + (projection && target.scope === node.scope ? projection : '');
      const sectionIndex = sections.indexOf(section);
      const family = node.text && faces.get(node.text.fontFamily + '/' + (node.text.fontWeight ?? 400));
      if (node.text?.characters?.trim()) requireAssets(family, 'C1 缺本语正文核验字体：' + node.text.fontFamily);
      layouts[end].push(rule(node, parent, id, index, family, asset));
      nodesTrace.push({ end, scope: node.scope, nodeId: node.id, role: node.role ?? null, module: section?.id ?? null, domId: id,
        asset: asset?.path ?? null, text: node.text?.characters ?? null, designBox: node.pageBox ?? null, ancestors: node.ancestorIds ?? [] });
      const children = nodes.filter((item) => item.parentId === node.id && item.scope === node.scope);
      const overlay = node.role === 'modal';
      let tag = node.role === 'sec' ? 'section' : node.role === 'nav' ? 'nav' : node.text ? 'p' : 'div';
      let attrs = attr('id', id) + attr('class', [node.role === 'sec' ? 'screen' : 'module', id,
        node.text ? 'copy' : '', overlay ? 'overlay' : ''].filter(Boolean).join(' '));
      if (node.action) {
        const { type, value, key, url, targets, target, property } = node.action;
        config.actions[id] = { type, value, property, targets: (targets ?? (target ? [target] : [])).map(targeted) };
        if (type === 'open-link') {
          if (url != null) {
            let address;
            try { address = new URL(url); } catch { requireAssets(false, '外链格式无效'); }
            requireAssets(['http:','https:'].includes(address.protocol) && !address.username && !address.password, '外链必须是无凭据的 HTTP(S)');
          }
          config.links[key ?? id] = url ?? null;
          config.actions[id].key = key ?? id;
        }
        tag = 'button';
        attrs += ' type="button" data-action' + attr('aria-label', node.label || type) + (type === 'copy-text' ? ' data-copy' : '');
        if (type === 'go-section') attrs += ' data-nav-control';
      }
      const tab = tabBindings.find((item) => item.end === end && ref(item.tab) === ref(node));
      let selectedArt;
      if (tab) {
        tag = 'button';
        attrs += ' type="button" role="tab" aria-selected="false"' + attr('data-tab-group', groupKey(byRef.get(ref(tab.switch))))
          + attr('data-tab-target', renderRef(tab.panel)) + attr('data-content-key', groupKey(byRef.get(ref(tab.panel)))) + attr('aria-controls', renderRef(tab.panel));
        if (tab.selectedArt) {
          const artwork = byRef.get(ref(tab.selectedArt));
          selectedArt = artwork && assets.get(artwork.id);
          requireAssets(selectedArt && artwork.ancestorIds?.includes(node.id) && artwork.scope === node.scope,
            'H29 选中图无本端 TAB 内已核验素材：' + end + ' / ' + node.id);
          attrs += attr('data-selected-image', selectedArt.sha256);
        } else if (tab.selection === 'sliding-indicator') attrs += attr('data-selected-image', 'sliding-indicator');
      }
      if (tabBindings.some((item) => item.end === end && ref(item.panel) === ref(node))) attrs += ' role="tabpanel"';
      if (node.pagination) {
        const { kind, panels, list, perPage } = node.pagination;
        attrs += attr('data-carousel', groupKey(node));
        config.bindings[id] = { pagination: { kind, panels: panels?.filter((panel) => available(resolveNode(panel))).map(renderRef), list: list && renderRef(list),
          perPage: typeof perPage === 'object' ? perPage[end] : perPage } };
      }
      for (const relation of inventory.relations.filter((item) => ['pager','empty','ind'].includes(item.kind) && ref(item.from) === ref(node))) attrs += attr('data-' + relation.kind + '-for', renderRef(relation.to));
      if (['page-current','page-total'].includes(node.part)) attrs += attr('data-page-value', node.part);
      if (Object.keys(node.bindings ?? {}).length || node.dataBinding) config.bindings[id] = { ...config.bindings[id], fields: node.bindings,
        data: node.dataBinding?.slots ? { ...node.dataBinding, slots: node.dataBinding.slots.map(targeted) } : node.dataBinding };
      if (componentInput) {
        const { receiver, valueShape, valueTypes } = componentInput;
        config.bindings[id].fields = { ...node.bindings, field: { ...node.bindings.field, receiver, valueShape, valueTypes } };
      }
      if (node.dataBinding) attrs += attr('data-node-key', node.id);
      if (node.role === 'item') attrs += ' data-carousel-item' + attr('data-item-key', groupKey(node));
      if (overlay) attrs += ' data-overlay data-dismiss-backdrop hidden inert role="dialog" aria-modal="true" tabindex="-1"';
      if (node.role === 'sec') attrs += ' tabindex="-1"' + attr('data-screen', sectionNumber(node));
      if (node.role === 'fix') attrs += ' data-fixed' + (!section ? attr('data-fixed-from', node.params?.from ?? 1) + (Number(node.params?.from) > 1 ? ' hidden inert' : '') : '');
      if (node.part === 'foreground') attrs += ' data-foreground';
      if (node.role === 'scroll') attrs += ' data-scrollable';
      if (node.motion) attrs += attr('data-motion', node.motion.rule) + attr('data-motion-trigger', node.motion.trigger) + attr('data-motion-unit', node.motion.unit)
        + attr('data-motion-direction', node.motion.direction);
      if (node.motion?.unit === 'batches') {
        const assigned = new Set();
        const batches = node.motion.batches.map((batch) => batch.map((reference) => {
          const [qualified, local] = reference.split('::');
          const hits = children.filter((child) => child.status === 'determined' && (reference.startsWith('node:')
            ? child.id === reference.slice(5)
            : child.role + '/' + child.label === (local ?? qualified) && (!local || qualified === 'sec/' + sectionNumber(section))));
          requireAssets(hits.length === 1 && !assigned.has(hits[0]), 'C2 无法唯一定位已声明的动效批次：' + end + ' / ' + node.id + ' / ' + reference);
          const [child] = hits;
          assigned.add(child);
          return available(child) ? slug(end,child) + projection : null;
        }).filter(Boolean)).filter((batch) => batch.length);
        attrs += attr('data-motion-batches', JSON.stringify(batches));
      }
      if (node.role === 'fix' && children.some((child)=>child.action?.type==='go-section')) attrs += ' data-intro-nav';
      if (node === heading && sectionIndex === 0) attrs += ' data-slogan';
      if (node === heading) {
        if (sectionIndex === 0) { tag = 'h1'; titles.push(node.text.characters); }
        else tag = 'h2';
      }
      if (node.pagination?.panels) for (const panel of node.pagination.panels) requireAssets(byRef.has(ref(panel)), '轮播面板不存在');
      if (parent?.pagination?.panels?.some((panel) => ref(panel) === ref(node))) attrs += attr('data-item-key', groupKey(node));
      const whole = ['bg','kv'].includes(node.role);
      const cover = node.role === 'bg';
      if (cover && asset && sectionIndex === 0 && !preloads.some((item)=>item.end===end)) preloads.push({ end, path:asset.path });
      const img = asset ? '<img class="' + (cover ? 'cover' : 'art') + '" alt="" draggable="false"'
        + attr('width', asset.width) + attr('height', asset.height) + (cover && sectionIndex === 0 ? ' data-hero-background' : '')
        + ' data-src="' + escape(asset.path) + '"><noscript><img class="' + (cover ? 'cover' : 'art') + '" alt="" src="' + escape(asset.path) + '"></noscript>'
        : node.bindings?.field?.target === 'image' ? '<img class="art" alt="" draggable="false" data-src="">' : '';
      const renderChildren = (items) => items.map((child) => render(child, node, children.indexOf(child), section, projection)).join('');
      const inside = whole || node.role === 'sec' ? '' : renderChildren(children.filter((child) => !tab?.selectedArt || ref(child) !== ref(tab.selectedArt)));
      const selection = selectedArt ? '<img class="art" data-selected-art alt="" data-src="' + escape(selectedArt.path) + '">'
        : tab?.selection === 'sliding-indicator' ? '<span class="tab-indicator" data-selected-art aria-hidden="true"></span>' : '';
      let copy = escape(node.text?.characters ?? (tag === 'button' && !inside && !asset ? node.label : '') ?? '');
      if (node === heading && sectionIndex === 0) copy = '<span data-slogan-ink>' + copy + '</span>';
      let inner = img + selection + copy + inside;
      if (node.role === 'sec') {
        inner = renderChildren(children.filter((child) => child.role === 'bg'))
          + (sectionIndex === 0 ? '<div class="hero-video" data-hero-video data-src="" aria-hidden="true" hidden></div>' : '')
          + '<div class="screen-content">' + renderChildren(children.filter((child) => child.role !== 'bg')) + '</div>';
      } else if (!projection && (node.role === 'dropmenu' || requests.has(ref(node)))) {
        const menu = node.role === 'dropmenu';
        requireAssets(!node.instanceOverrides?.length, '组件实例覆盖无法对应替换变体：' + end + ' / ' + node.id);
        requireAssets(!node.bindings?.field, '缺状态变体上字段对应关系：' + end + ' / ' + node.id);
        const request = menu ? { wanted:['off','on'] } : requests.get(ref(node));
        const plan = variantPlan(inventory, node, request.property, request.wanted, end);
        const draw = (variant) => {
          const root = variant.nodes.find((item) => item.id === variant.id);
          const suffix = '-' + id;
          const art = assets.get(variant.id);
          const children = variant.nodes.filter((item) => item.parentId === root?.id);
          const body = children.map((item, order) => render(item, root, order, section, suffix)).join('');
          requireAssets(body || art, '组件变体缺可发布素材或内容：' + end + ' / ' + node.id + ' / ' + variant.id);
          return (art ? '<img class="art" alt="" data-src="' + escape(art.path) + '">' : '') + body;
        };
        if (menu) {
          const panel = id + '-expanded';
          const closed = draw(plan.variants.get('off'));
          requireAssets(!/<(?:button|a|input|select|textarea)\b/i.test(closed), '菜单关闭态含独立交互，缺触发器对应关系：' + end + ' / ' + node.id);
          config.actions[id + '-toggle'] = { type:'toggle-menu', targets:[panel] };
          inner = '<button class="menu-toggle" type="button" data-action id="' + id + '-toggle" aria-expanded="false" aria-controls="' + panel + '"' + attr('aria-label', node.label) + '>' + closed + '</button>'
            + '<div class="menu-panel" data-overlay data-menu data-dismiss-outside hidden inert tabindex="-1" id="' + panel + '">' + draw(plan.variants.get('on')) + '</div>';
        } else {
          attrs += attr('data-state', plan.initial);
          inner = [...plan.variants].map(([value,variant]) => '<div class="variant-face"' + attr('data-variant-value', value)
            + (value !== plan.initial ? ' hidden inert' : '') + '>' + draw(variant) + '</div>').join('');
        }
      } else if (overlay) inner = '<div class="overlay-content" data-overlay-content>' + inner + '</div>';
      else if (node.template || node.params?.template) return '<template data-item-template>' + '<' + tag + attrs + '>' + inner + '</' + tag + '></template>';
      return '<' + tag + attrs + '>' + inner + '</' + tag + '>';
    }
    const screens = sections.map((section, index) => {
      const text = nodes.filter((node) => available(node) && node.text?.characters?.trim() && node.ancestorIds?.includes(section.id));
      heading = text.find((node) => node.role === 'title' || node.ancestorIds.some((id) => nodes.some((owner) => owner.id === id && owner.role === 'title')))
        ?? (index === 0 ? text.filter((node) => node.parentId === section.id).find((node, _, list) => list.length === 1) : null);
      return render(section, null, index, section);
    }).join('');
    const fixed = productNodes.filter((node) => node.role !== 'sec' && available(node) && !node.ancestorIds?.some((parent) => sections.some(({ id }) => id === parent))
      && !available(byRef.get(ref({ id: node.parentId, scope: node.scope })))).map((node, index) => render(node, null, index, null)).join('');
    return '<div class="device" data-device="' + end + '">' + fixed + screens + '</div>';
  }).join('\n');
  const fontVariables = [...new Set(faces.values())].map((alias) => '--' + alias + ':' + alias + ',sans-serif;').join('');
  const dual = ends.length === 2;
  const base = pageFiles(baseLanguage);
  const footer = { cn:'版权与法律信息', tw:'版權與法律資訊' }[baseLanguage] ?? 'Copyright and legal information';
  const html = '<!doctype html>\n<html lang="' + escape(config.language) + '" class="no-js"' + attr('data-page-platform', dual ? 'dual' : ends[0]) + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>'
    + escape(titles[0] ?? inventories[ends[0]].page?.name ?? baseLanguage) + '</title><!-- js/tracking.js; js/tracking-boot.js; fx-bg-video: js/background-video.umd.js -->'
    + preloads.map((item)=>'<link rel="preload" as="image" fetchpriority="high"' + attr('href',item.path)
      + (dual ? attr('media',item.end==='mobile' ? '(max-width: 1024px)' : '(width > 1024px)') : '') + '>').join('')
    + '<link rel="stylesheet" href="css/styles.css"><link rel="stylesheet" href="css/mobile.css"><link rel="stylesheet" href="css/locales.css">'
    + '<script src="js/config.js" defer></script><script src="js/main.js" defer></script></head><body><main class="stage" data-stage>'
    + markup + '<div id="page-footer" class="page-footer-mount" tabindex="-1" inert aria-hidden="true" aria-label="' + escape(footer) + '" hidden></div></main>'
    + '<output class="status" id="site-status" role="status" aria-live="polite"></output></body></html>\n';
  const styles = common + '\n' + fontCss.join('\n') + ':root{' + fontVariables + '}\n'
    + '.no-js img:not([src]){visibility:hidden}\n'
    + (dual ? '[data-device="mobile"]{display:none}\n' : '') + layouts.pc.join('');
  const mobile = 'html[data-page-platform="mobile"]{font-size:calc(100vw / 3.75)}@media (min-aspect-ratio:750/1430){html[data-page-platform="mobile"]{font-size:calc(100vh / 7.15);font-size:calc(100dvh / 7.15)}}\n'
    + '@media (max-width:1024px){:root:not([data-page-platform="pc"]){font-size:calc(100vw / 3.75)}'
    + (dual ? '[data-device="pc"]{display:none}[data-device="mobile"]{display:block}' : '') + '}\n'
    + '@media (max-width:1024px) and (min-aspect-ratio:750/1430){:root:not([data-page-platform="pc"]){font-size:calc(100vh / 7.15);font-size:calc(100dvh / 7.15)}}\n' + layouts.mobile.join('');
  return { files: { [base[0]]: html, [base[1]]: styles, [base[2]]: mobile, [base[3]]: '/* Base-language overrides */\n',
    [base[4]]: 'window.OnePageConfig = JSON.parse(' + JSON.stringify(JSON.stringify(config)) + ');\n',
    [base[5]]: '(' + runtime.toString() + ')();\n', [base[6]]: '# One-page\n\nServe this directory as static files. Configure developer integrations in js/config.js.\n' },
  trace: { nodes: nodesTrace, tabBindings, componentInputs } };
}
