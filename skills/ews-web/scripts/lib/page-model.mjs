import { renderOutsetOf } from './render-geometry.mjs';
/**
 * Assemble an internal EWS page model from truth + copy + assets + config.
 * One draw tree is built first; screens/footer/modals reference those nodes.
 */
import { applyImageLanguage, imgLangVariantValue } from './image-language.mjs';
import { resolvePagedSwitches } from './paged-switch.mjs';
import { resolveDropmenus, resolveLanguageModalOptions } from './dropmenu.mjs';
import { resolveVariantSwitches } from './variant-switch.mjs';
import { resolveNavigation } from './nav-map.mjs';
import { resolveModalTriggers } from './modal-triggers.mjs';
import { resolveCommentShare } from './comment-share.mjs';
import { validateLocaleFontPlan } from '../../assets/runtime/locale-fonts.mjs';
import { bindPaintedCloneCopy } from './copy-bind-clones.mjs';
import { applyLineBreakHints } from './line-break-hints.mjs';
import { applyFontGroups } from './font-groups.mjs';

const CONFIG_SCHEMA = 'ews-config/v1';
const LEGAL_PAGE_LOCALES = new Set(['zh-CN', 'zh-TW', 'zh-HK', 'en', 'ja', 'ko']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function copyOf(byPlatform, platform, nodeId) {
  return byPlatform?.[platform]?.byNode?.[nodeId] || null;
}

function inventoryNodes(truth, pack, end) {
  const doc = pack?.inventories?.[end];
  const extra = [];
  for (const modal of doc?.attachments?.modals || []) {
    extra.push({
      ...modal,
      id: String(modal.id),
      parentId: modal.parentId ?? null,
      bucket: `modal:${modal.id}`,
      nodes: undefined,
    });
    for (const node of modal.nodes || []) {
      if (!node?.id || String(node.id) === String(modal.id)) continue;
      extra.push({
        ...node,
        id: String(node.id),
        parentId: node.parentId ?? String(modal.id),
        bucket: `modal:${modal.id}`,
      });
    }
  }
  const page = doc?.nodes || [];
  const fromTruth = [];
  const take = (list, bucket) => {
    for (const node of asArray(list)) fromTruth.push({ ...node, bucket });
  };
  const platformTruth = truth?.platforms?.[end];
  take(platformTruth?.pageChrome?.nodes, 'pageChrome');
  take(platformTruth?.fixedOverlays?.nodes, 'fixedOverlays');
  for (const [sectionId, section] of Object.entries(platformTruth?.sections || {})) {
    if (section?.meta?.id) {
      take([{
        id: section.meta.id,
        name: section.meta.name || sectionId,
        type: 'FRAME',
        role: 'sec',
        status: 'determined',
        pageBox: section.meta.pageBox || section.meta,
        parentId: null,
      }], `section:${sectionId}`);
    }
    take(section?.nodes, `section:${sectionId}`);
  }
  const byId = new Map();
  for (const node of [...page, ...extra, ...fromTruth]) {
    if (!node?.id) continue;
    const current = byId.get(String(node.id)) || {};
    byId.set(String(node.id), { ...current, ...node, id: String(node.id) });
  }
  return [...byId.values()];
}

// Figma style.effects (DROP_SHADOW / INNER_SHADOW / LAYER_BLUR) drawn by render; hidden effects dropped.
function visibleEffectsOf(node) {
  const list = Array.isArray(node?.style?.effects) ? node.style.effects : (Array.isArray(node?.effects) ? node.effects : []);
  const kept = list.filter((effect) => effect && effect.visible !== false);
  return kept.length ? kept : null;
}

function drawNode(node, copy, platform) {
  return {
    id: node.id,
    sourceNodeId: node.id,
    parentId: node.parentId ?? null,
    name: node.name,
    type: node.type,
    role: node.role,
    status: node.status,
    bucket: node.bucket,
    pageBox: node.pageBox,
    parentBox: node.parentBox,
    rotation: node.rotation ?? 0,
    text: node.text || null,
    fills: node.style?.fills || node.fills || null,
    effects: visibleEffectsOf(node),
    why: node.why || null,
    visible: node.visible !== false,
    isMask: node.isMask === true,
    clipsContent: node.clipsContent === true,
    interaction: node.status === 'determined' ? 'eligible' : 'draw-only',
    copy: copyOf(copy?.byPlatform, platform, node.id),
    sliceExport: node.sliceExport || null,
    renderOutset: renderOutsetOf(node),
    assetKey: node.assetKey || null,
    replaceable: node.replaceable === true,
    componentId: node.componentId || null,
    componentProperties: node.componentProperties || null,
    orderKey: node.orderKey || '',
    layout: node.layout || null,
    pin: node.pin || null,
    pinEdges: node.pinEdges || null,
    constraints: node.constraints || node.layout?.constraints || null,
  };
}

function descendantsOf(nodes, rootId) {
  const byParent = new Map();
  for (const node of nodes) {
    const pid = String(node.parentId || '');
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(node);
  }
  const out = [];
  const walk = (id) => {
    for (const child of byParent.get(String(id)) || []) {
      out.push(child);
      walk(child.id);
    }
  };
  const root = nodes.find((node) => String(node.id) === String(rootId));
  if (root) out.push(root);
  walk(rootId);
  return out;
}

export function buildPageModel({ truth, copy, assets, config, pack } = {}) {
  const problems = [];
  if (!config || config.schema !== CONFIG_SCHEMA) problems.push('ews-config schema 必须是 ews-config/v1');
  const locales = asArray(config?.locales);
  if (!locales.length) problems.push('ews-config.locales 必须显式列出页面语言');
  for (const locale of locales) {
    if (!LEGAL_PAGE_LOCALES.has(locale) || !imgLangVariantValue(locale)) {
      problems.push(`locale ${locale} 不是页面合法语言`);
    }
  }
  const defaultLocale = config?.defaultLocale;
  if (!defaultLocale || !locales.includes(defaultLocale)) problems.push('defaultLocale 必须属于 locales');
  const ends = pack?.ends || Object.keys(truth?.platforms || {});
  const screens = asArray(config?.screens);
  if (!screens.length) problems.push('ews-config.screens 不能为空');
  const commentShare = resolveCommentShare(config);
  problems.push(...commentShare.problems);
  problems.push(...validateLocaleFontPlan(config?.localeFonts, assets?.fonts || []));
  config = {
    ...(config || {}),
    commentApi: commentShare.commentApi,
    commentPageId: commentShare.commentPageId,
  };

  const platforms = {};
  for (const end of ends) {
    const platformTruth = truth?.platforms?.[end];
    if (!platformTruth) {
      problems.push(`${end} 运行时不可用：包未提供该端，禁止用另一端坐标伪造`);
      continue;
    }
    const raw = inventoryNodes(truth, pack, end);
    const nodeList = raw.map((node) => drawNode(node, copy, end));
    const byId = new Map(nodeList.map((node) => [String(node.id), node]));

    const screenModels = screens.map((screen) => {
      const sectionId = screen?.[end] || screen?.sectionId;
      if (!sectionId) {
        problems.push(`screen ${screen.key} 缺 ${end} sectionId`);
        return null;
      }
      if (!byId.has(String(sectionId))) {
        problems.push(`screen ${screen.key} ${end} section ${sectionId} 不存在`);
        return null;
      }
      const nodes = descendantsOf(nodeList, sectionId);
      return { key: screen.key, sectionId, nodes };
    }).filter(Boolean);

    const footerId = config?.footer?.[end];
    if (footerId && !byId.has(String(footerId))) problems.push(`${end} footer node ${footerId} 不在 truth 树`);
    const footerNodes = footerId ? descendantsOf(nodeList, footerId) : [];

    for (const carousel of asArray(config?.carousels)) {
      const ownerId = carousel.ownerId?.[end] || carousel.ownerId;
      if (ownerId && !byId.has(String(ownerId))) problems.push(`${end} carousel owner ${ownerId} 不在 truth 树`);
      for (const slideId of asArray(carousel.slides?.[end] || carousel.slides)) {
        if (!byId.has(String(slideId))) problems.push(`${end} carousel slide ${slideId} 不在 truth 树`);
      }
    }
    const paged = resolvePagedSwitches({
      nodes: nodeList,
      componentSets: pack.inventories?.[end]?.attachments?.componentSets || platformTruth.componentVariantGraph?.componentSets || [],
      config,
      end,
    });
    if (!paged.ok) problems.push(...paged.problems.map((item) => `${end} ${item}`));
    const dropmenus = resolveDropmenus({
      nodes: nodeList,
      componentSets: pack.inventories?.[end]?.attachments?.componentSets || platformTruth.componentVariantGraph?.componentSets || [],
    });
    if (!dropmenus.ok) problems.push(...dropmenus.problems.map((item) => `${end} ${item}`));
    const variantSwitches = resolveVariantSwitches({
      nodes: nodeList,
      componentSets: pack.inventories?.[end]?.attachments?.componentSets || platformTruth.componentVariantGraph?.componentSets || [],
      pagedSwitchIds: (paged.ok ? paged.items : []).map((item) => item.switchId),
    });
    if (!variantSwitches.ok) problems.push(...variantSwitches.problems.map((item) => `${end} ${item}`));
    const navigation = resolveNavigation({
      nodes: nodeList,
      screens: screenModels,
      config,
    });
    if (!navigation.ok) problems.push(...navigation.problems.map((item) => `${end} ${item}`));
    const modalTriggers = resolveModalTriggers({
      relations: pack.inventories?.[end]?.relations,
      nodes: nodeList,
      configModals: config?.modals,
    });
    for (const [triggerId, modalId] of Object.entries(modalTriggers)) {
      if (!raw.some((node) => String(node.id) === String(modalId)) && !byId.has(String(modalId))) {
        problems.push(`${end} modal-trigger ${triggerId} → ${modalId} 不存在`);
      }
    }

    const instances = [];
    for (const node of nodeList) {
      if (String(node.type || '').toUpperCase() === 'INSTANCE' && node.componentId) {
        instances.push({
          id: node.id,
          componentId: node.componentId,
          assetRef: null,
          sourceNodeId: node.id,
          componentProperties: node.componentProperties || null,
        });
      }
    }
    const imageSource = { instances };
    const imageViews = {};
    for (const locale of locales) {
      const applied = applyImageLanguage(imageSource, {
        language: locale,
        device: end,
        componentSetsByDevice: { [end]: platformTruth.componentVariantGraph?.componentSets || pack.inventories?.[end]?.attachments?.componentSets || [] },
        assetsByDevice: { [end]: assets?.assets?.[end] || assets?.[end] || {} },
      });
      imageViews[locale] = applied;
      if (!applied.ok) problems.push(...applied.failVisible.map((item) => `${end}/${locale}: ${item.reason}`));
    }

    const design = platformTruth.page?.pageBox || platformTruth.page?.box || { w: end === 'mobile' ? 750 : 1920, h: 1080 };
    const copyByNode = copy?.byPlatform?.[end]?.byNode || {};
    const paintedCopy = bindPaintedCloneCopy({
      variantSwitches: variantSwitches.ok ? variantSwitches.items : [],
      pagedSwitches: paged.ok ? paged.items : [],
      byNode: copyByNode,
      cloneDesignations: copy?.cloneDesignations?.[end] || {},
      larkSnap: copy?.larkSnap || null,
      larkSource: copy?.larkSource || 'lark-copy.json',
      larkBytes: copy?.larkBytes || null,
      locales,
    });
    problems.push(...(paintedCopy.problems || []).map((item) => `${end} ${item}`));
    const broken = applyLineBreakHints({
      nodes: nodeList,
      variantSwitches: paintedCopy.variantSwitches,
      pagedSwitches: paintedCopy.pagedSwitches,
      hints: copy?.lineBreaks?.[end] || {},
    });
    problems.push(...broken.problems.map((item) => `${end} ${item}`));
    platforms[end] = {
      page: platformTruth.page,
      source: platformTruth.source,
      designWidth: design.w,
      designHeight: design.h,
      nodes: broken.nodes,
      screens: screenModels,
      footer: footerId ? { id: footerId, nodes: footerNodes } : null,
      imageSource,
      imageViews,
      modals: (pack.inventories?.[end]?.attachments?.modals || []).map((modal) => ({
        id: String(modal.id),
        nodes: descendantsOf(nodeList, modal.id),
      })),
      componentSets: pack.inventories?.[end]?.attachments?.componentSets || [],
      copyByNode,
      pagedSwitches: broken.pagedSwitches,
      dropmenus: dropmenus.ok ? dropmenus.items : [],
      languageOptions: resolveLanguageModalOptions({
        nodes: nodeList,
        modals: pack.inventories?.[end]?.attachments?.modals || [],
      }).items,
      variantSwitches: broken.variantSwitches,
      cloneCopyUnmatched: paintedCopy.unmatched,
      navigation: navigation.map,
      navPending: navigation.pending,
      modalTriggers,
      pageBackgrounds: nodeList.filter((node) => (
        String(node.parentId) === String(platformTruth.page?.id || pack.inventories?.[end]?.page?.id)
        && (node.role === 'bg' || node.role === 'kv')
      )),
      fixedOverlays: platformTruth.fixedOverlays || { nodes: [] },
    };
    problems.push(...applyFontGroups(platforms[end], copy?.fontGroups?.[end]).map(problem => `${end} ${problem}`));
  }

  return {
    ok: problems.length === 0,
    schema: 'ews-page-model/v1',
    fingerprint: pack?.fingerprint || truth?.fingerprint || null,
    defaultLocale,
    locales,
    screens: screens.map((screen) => screen.key),
    config,
    platforms,
    problems,
  };
}
