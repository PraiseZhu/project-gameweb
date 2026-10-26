/**
 * Assemble an internal EWS page model from truth + copy + assets + config.
 * One draw tree is built first; screens/footer/modals reference those nodes.
 */
import { applyImageLanguage, imgLangVariantValue } from './image-language.mjs';

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
    clipsContent: node.clipsContent === true,
    interaction: node.status === 'determined' ? 'eligible' : 'draw-only',
    copy: copyOf(copy?.byPlatform, platform, node.id),
    sliceExport: node.sliceExport || null,
    assetKey: node.assetKey || null,
    replaceable: node.replaceable === true,
    componentId: node.componentId || null,
    componentProperties: node.componentProperties || null,
    orderKey: node.orderKey || '',
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
    for (const [triggerId, screenKey] of Object.entries(config?.navigation || {})) {
      if (!byId.has(String(triggerId))) continue;
      if (!screens.some((screen) => screen.key === screenKey)) {
        problems.push(`navigation ${triggerId} → 未知 screen ${screenKey}`);
      }
      const node = byId.get(String(triggerId));
      if (node.status !== 'determined') problems.push(`navigation ${triggerId} 是 unknown，不能强加点击`);
    }
    for (const [triggerId, modalId] of Object.entries(config?.modals || {})) {
      if (byId.has(String(triggerId)) && !byId.has(String(modalId)) && !raw.some((node) => node.id === String(modalId))) {
        problems.push(`${end} modal ${modalId} 不存在`);
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
    platforms[end] = {
      page: platformTruth.page,
      source: platformTruth.source,
      designWidth: design.w,
      designHeight: design.h,
      nodes: nodeList,
      screens: screenModels,
      footer: footerId ? { id: footerId, nodes: footerNodes } : null,
      imageSource,
      imageViews,
      modals: (pack.inventories?.[end]?.attachments?.modals || []).map((modal) => ({
        id: String(modal.id),
        nodes: descendantsOf(nodeList, modal.id),
      })),
      componentSets: pack.inventories?.[end]?.attachments?.componentSets || [],
      copyByNode: copy?.byPlatform?.[end]?.byNode || {},
      pageBackgrounds: nodeList.filter((node) => (
        String(node.parentId) === String(platformTruth.page?.id || pack.inventories?.[end]?.page?.id)
        && (node.role === 'bg' || node.role === 'kv')
      )),
      fixedOverlays: platformTruth.fixedOverlays || { nodes: [] },
    };
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
