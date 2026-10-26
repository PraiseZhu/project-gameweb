import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { stampReadyFields } from '../../lib/inventory-ready-fields.mjs';
import { buildManifest } from '../../lib/handoff-contract.mjs';
import { rebuildInventoryIndexes } from '../../lib/rebuild-indexes.mjs';

export const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_BLUE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADBwIAMFbG0QAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_GREEN = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
  'base64',
);
export const PNG_YELLOW = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

export const PAGE_BOX = Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 });
export const MOBILE_BOX = Object.freeze({ x: 0, y: 0, w: 750, h: 1624 });
export const HASH_PC = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const HASH_MO = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
export const FONT_BYTES = readFileSync(new URL('../fixtures/media/source-han-sans.woff2', import.meta.url));
export const VIDEO_BYTES = readFileSync(new URL('../fixtures/media/demo.webm', import.meta.url));

function pngChunk(type, bytes) {
  const body = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(bytes.length, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return chunk;
}

function syntheticPng(width, height, color) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const offset = row * (width * 4 + 1) + 1 + column * 4;
      pixels.set(color, offset);
    }
  }
  return Buffer.concat([PNG_1x1.subarray(0, 8), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

function deep(value) {
  return JSON.parse(JSON.stringify(value));
}

function stampAll(nodes) {
  return nodes.map((node) => stampReadyFields(deep(node)));
}

function sliceOf(id, box) {
  return { bounds: 'render', scale: 1, format: 'png', file: `${id.replace(':', '-')}.png`, box };
}

export function makeInventory({
  pageId,
  platform = 'pc',
  pageBox = PAGE_BOX,
  snapshotHash = HASH_PC,
  nodes = [],
  componentSets = [],
  modals = [],
  relations = [],
  extra = {},
} = {}) {
  const pageNode = stampReadyFields({
    id: pageId,
    scope: 'page',
    type: 'FRAME',
    name: platform === 'pc' ? 'cn_pc' : 'cn_mobile',
    parentId: null,
    orderKey: '0',
    status: 'unknown',
    box: pageBox,
    pageBox,
    parentBox: pageBox,
  });
  const allNodes = stampAll([pageNode, ...nodes]);
  const inv = {
    schema: 'inventory/v2',
    specVersion: '1.0',
    ok: true,
    status: 'ready',
    fileKey: 'synthetic-ews-file',
    requestedNodeId: pageId,
    snapshot: { hash: snapshotHash, lastModified: '2026-10-26T00:00:00Z' },
    page: { id: pageId, name: pageNode.name, box: pageBox, pageBox },
    sections: [],
    overlays: [],
    backgrounds: [],
    modules: [],
    nodes: allNodes,
    attachments: { modals, componentSets, components: [] },
    relations,
    counts: { determined: 0, unknown: 0, skipped: 0 },
    ...extra,
  };
  return rebuildInventoryIndexes(inv);
}

export function pcInventory(overrides = {}) {
  const pageId = '100:1';
  const hero = '100:2';
  const footer = '100:12';
  const gallery = '100:50';
  const langSet = {
    id: '100:30',
    type: 'COMPONENT_SET',
    name: 'img/海报',
    componentPropertyDefinitions: {
      lang: { type: 'VARIANT', variantOptions: ['cn', 'en'] },
    },
    variants: stampAll([
      {
        id: '100:31', type: 'COMPONENT', name: 'lang=cn', order: 0,
        status: 'determined', role: 'img', behavior: 'slice',
        componentProperties: { lang: 'cn' },
        box: { x: 0, y: 0, w: 240, h: 48 }, pageBox: { x: 120, y: 240, w: 240, h: 48 }, parentBox: PAGE_BOX,
        sliceExport: sliceOf('100:31', { x: 120, y: 240, w: 240, h: 48 }),
        nodes: stampAll([{
          id: '100:35', type: 'TEXT', name: 'copy/badge', status: 'determined', role: 'copy',
          characters: '徽章中文',
          text: { characters: '徽章中文', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 12 },
          box: { x: 0, y: 0, w: 80, h: 16 }, pageBox: { x: 120, y: 240, w: 80, h: 16 }, parentBox: { x: 120, y: 240, w: 240, h: 48 },
        }]),
      },
      {
        id: '100:32', type: 'COMPONENT', name: 'lang=en', order: 1,
        status: 'determined', role: 'img', behavior: 'slice',
        componentProperties: { lang: 'en' },
        box: { x: 0, y: 0, w: 240, h: 48 }, pageBox: { x: 120, y: 240, w: 240, h: 48 }, parentBox: PAGE_BOX,
        sliceExport: sliceOf('100:32', { x: 120, y: 240, w: 240, h: 48 }),
        nodes: stampAll([{
          id: '100:36', type: 'TEXT', name: 'copy/badge', status: 'determined', role: 'copy',
          characters: 'Badge EN',
          text: { characters: 'Badge EN', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 12 },
          box: { x: 0, y: 0, w: 80, h: 16 }, pageBox: { x: 120, y: 240, w: 80, h: 16 }, parentBox: { x: 120, y: 240, w: 240, h: 48 },
        }]),
      },
    ]),
  };
  const plainSet = {
    id: '100:40',
    type: 'COMPONENT_SET',
    name: 'img/装饰',
    componentPropertyDefinitions: {
      'Property 1': { type: 'VARIANT', variantOptions: ['a'] },
    },
    variants: stampAll([{
      id: '100:41', type: 'COMPONENT', name: 'Property 1=a',
      status: 'determined', role: 'img', behavior: 'slice',
      componentProperties: { 'Property 1': 'a' },
      box: { x: 0, y: 0, w: 40, h: 40 }, pageBox: { x: 10, y: 10, w: 40, h: 40 }, parentBox: PAGE_BOX,
      sliceExport: sliceOf('100:41', { x: 10, y: 10, w: 40, h: 40 }),
    }]),
  };
  const modal = stampReadyFields({
    id: '100:20',
    type: 'FRAME',
    name: 'modal/subscribe',
    status: 'determined',
    role: 'modal',
    box: { x: 0, y: 0, w: 400, h: 240 },
    pageBox: { x: 760, y: 420, w: 400, h: 240 },
    parentBox: PAGE_BOX,
    nodes: stampAll([
      {
        id: '100:20', type: 'FRAME', name: 'modal/subscribe', status: 'determined', role: 'modal',
        box: { x: 0, y: 0, w: 400, h: 240 }, pageBox: { x: 760, y: 420, w: 400, h: 240 }, parentBox: PAGE_BOX,
      },
      {
        id: '100:25', type: 'TEXT', name: 'copy/modal', status: 'determined', role: 'copy',
        characters: '弹窗文案',
        text: { characters: '弹窗文案', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 20 },
        box: { x: 20, y: 20, w: 200, h: 32 }, pageBox: { x: 780, y: 440, w: 200, h: 32 }, parentBox: { x: 760, y: 420, w: 400, h: 240 },
      },
      {
        id: '100:26', type: 'FRAME', name: 'btn/close', status: 'determined', role: 'btn',
        box: { x: 360, y: 8, w: 32, h: 32 }, pageBox: { x: 1120, y: 428, w: 32, h: 32 }, parentBox: { x: 760, y: 420, w: 400, h: 240 },
      },
    ]),
  });
  return makeInventory({
    pageId,
    platform: 'pc',
    snapshotHash: HASH_PC,
    nodes: [
      { id: hero, scope: 'page', type: 'FRAME', name: 'sec/1', label: '1', parentId: pageId, orderKey: '0.0', status: 'determined', role: 'sec', ancestorIds: [pageId], box: PAGE_BOX, pageBox: PAGE_BOX, parentBox: PAGE_BOX },
      { id: '100:3', scope: 'page', type: 'RECTANGLE', name: 'bg/page', label: 'page', parentId: pageId, orderKey: '0.1', status: 'determined', role: 'bg', behavior: 'slice', ancestorIds: [pageId], box: PAGE_BOX, pageBox: PAGE_BOX, parentBox: PAGE_BOX, sliceExport: sliceOf('100:3', PAGE_BOX) },
      { id: '100:4', scope: 'page', type: 'FRAME', name: 'fix/nav', label: 'nav', parentId: pageId, orderKey: '0.2', status: 'determined', role: 'fix', behavior: 'overlay', pin: 'viewport', ancestorIds: [pageId], box: { x: 0, y: 0, w: 1920, h: 80 }, pageBox: { x: 0, y: 0, w: 1920, h: 80 }, parentBox: PAGE_BOX, viewportBox: { x: 0, y: 0, w: 1920, h: 80 } },
      { id: '100:5', scope: 'page', type: 'TEXT', name: 'copy/title', parentId: hero, orderKey: '0.0.0', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '标题甲', text: { characters: '标题甲', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 28 }, box: { x: 120, y: 80, w: 240, h: 48 }, pageBox: { x: 120, y: 80, w: 240, h: 48 }, parentBox: PAGE_BOX },
      { id: '100:6', scope: 'page', type: 'TEXT', name: 'copy/mid', parentId: hero, orderKey: '0.0.1', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '重复词', text: { characters: '重复词', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 18 }, box: { x: 120, y: 140, w: 240, h: 32 }, pageBox: { x: 120, y: 140, w: 240, h: 32 }, parentBox: PAGE_BOX },
      { id: '100:7', scope: 'page', type: 'TEXT', name: 'copy/tail', parentId: hero, orderKey: '0.0.2', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '标题丙', text: { characters: '标题丙', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 28 }, box: { x: 120, y: 180, w: 240, h: 48 }, pageBox: { x: 120, y: 180, w: 240, h: 48 }, parentBox: PAGE_BOX },
      { id: '100:8', scope: 'page', type: 'INSTANCE', name: 'img/海报', parentId: hero, orderKey: '0.0.3', status: 'determined', role: 'img', behavior: 'slice', componentId: '100:31', ancestorIds: [pageId, hero], box: { x: 120, y: 240, w: 240, h: 48 }, pageBox: { x: 120, y: 240, w: 240, h: 48 }, parentBox: PAGE_BOX, sliceExport: sliceOf('100:8', { x: 120, y: 240, w: 240, h: 48 }) },
      { id: '100:9', scope: 'page', type: 'INSTANCE', name: 'img/装饰', parentId: hero, orderKey: '0.0.4', status: 'determined', role: 'img', behavior: 'slice', componentId: '100:41', ancestorIds: [pageId, hero], box: { x: 10, y: 10, w: 40, h: 40 }, pageBox: { x: 10, y: 10, w: 40, h: 40 }, parentBox: PAGE_BOX, sliceExport: sliceOf('100:9', { x: 10, y: 10, w: 40, h: 40 }) },
      { id: '100:10', scope: 'page', type: 'TEXT', name: 'copy/split', parentId: hero, orderKey: '0.0.5', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '第一句', text: { characters: '第一句', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 }, box: { x: 120, y: 300, w: 240, h: 24 }, pageBox: { x: 120, y: 300, w: 240, h: 24 }, parentBox: PAGE_BOX },
      { id: '100:11', scope: 'page', type: 'TEXT', name: 'copy/split2', parentId: hero, orderKey: '0.0.6', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '第二句', text: { characters: '第二句', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 16 }, box: { x: 120, y: 330, w: 240, h: 24 }, pageBox: { x: 120, y: 330, w: 240, h: 24 }, parentBox: PAGE_BOX },
      { id: '100:13', scope: 'page', type: 'FRAME', name: 'btn/cta', label: 'cta', parentId: hero, orderKey: '0.0.7', status: 'determined', role: 'btn', ancestorIds: [pageId, hero], box: { x: 120, y: 380, w: 160, h: 40 }, pageBox: { x: 120, y: 380, w: 160, h: 40 }, parentBox: PAGE_BOX },
      { id: '100:17', scope: 'page', type: 'FRAME', name: 'btn/modal', label: 'modal', parentId: hero, orderKey: '0.0.8', status: 'determined', role: 'btn', ancestorIds: [pageId, hero], box: { x: 300, y: 380, w: 160, h: 40 }, pageBox: { x: 300, y: 380, w: 160, h: 40 }, parentBox: PAGE_BOX },
      { id: gallery, scope: 'page', type: 'FRAME', name: 'sec/3', label: '3', parentId: pageId, orderKey: '0.4', status: 'determined', role: 'sec', ancestorIds: [pageId], box: { x: 0, y: 1080, w: 1920, h: 800 }, pageBox: { x: 0, y: 1080, w: 1920, h: 800 }, parentBox: PAGE_BOX },
      { id: '100:22', scope: 'page', type: 'FRAME', name: 'switch/gallery', label: 'gallery', parentId: gallery, orderKey: '0.4.0', status: 'determined', role: 'switch', ancestorIds: [pageId, gallery], box: { x: 120, y: 1120, w: 800, h: 400 }, pageBox: { x: 120, y: 1120, w: 800, h: 400 }, parentBox: { x: 0, y: 1080, w: 1920, h: 800 } },
      { id: '100:23', scope: 'page', type: 'FRAME', name: 'img/slide-a', parentId: '100:22', orderKey: '0.4.0.0', status: 'determined', role: 'img', behavior: 'slice', ancestorIds: [pageId, gallery, '100:22'], box: { x: 120, y: 1120, w: 800, h: 400 }, pageBox: { x: 120, y: 1120, w: 800, h: 400 }, parentBox: { x: 120, y: 1120, w: 800, h: 400 }, sliceExport: sliceOf('100:23', { x: 120, y: 1120, w: 800, h: 400 }) },
      { id: '100:24', scope: 'page', type: 'FRAME', name: 'img/slide-b', parentId: '100:22', orderKey: '0.4.0.1', status: 'determined', role: 'img', behavior: 'slice', ancestorIds: [pageId, gallery, '100:22'], box: { x: 920, y: 1120, w: 800, h: 400 }, pageBox: { x: 920, y: 1120, w: 800, h: 400 }, parentBox: { x: 120, y: 1120, w: 800, h: 400 }, sliceExport: sliceOf('100:24', { x: 920, y: 1120, w: 800, h: 400 }) },
      { id: '100:18', scope: 'page', type: 'FRAME', name: 'dyn/video', label: 'video', parentId: gallery, orderKey: '0.4.1', status: 'determined', role: 'dyn', ancestorIds: [pageId, gallery], box: { x: 120, y: 1560, w: 320, h: 180 }, pageBox: { x: 120, y: 1560, w: 320, h: 180 }, parentBox: { x: 0, y: 1080, w: 1920, h: 800 } },
      { id: footer, scope: 'page', type: 'FRAME', name: 'sec/2', label: '2', parentId: pageId, orderKey: '0.5', status: 'determined', role: 'sec', ancestorIds: [pageId], box: { x: 0, y: 1880, w: 1920, h: 80 }, pageBox: { x: 0, y: 1880, w: 1920, h: 80 }, parentBox: PAGE_BOX },
      { id: '100:21', scope: 'page', type: 'TEXT', name: 'copy/footer', parentId: footer, orderKey: '0.5.0', status: 'determined', role: 'copy', ancestorIds: [pageId, footer], characters: '页脚', text: { characters: '页脚', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 14 }, box: { x: 120, y: 1900, w: 120, h: 24 }, pageBox: { x: 120, y: 1900, w: 120, h: 24 }, parentBox: { x: 0, y: 1880, w: 1920, h: 80 } },
    ],
    componentSets: [langSet, plainSet],
    modals: [modal],
    relations: [
      { kind: 'instance-uses-variant', status: 'determined', evidence: 'figma:componentId', from: { id: '100:8', scope: 'page' }, to: { id: '100:31', scope: 'component-set:100:30', componentSetId: '100:30', componentId: '100:31' } },
      { kind: 'instance-uses-variant', status: 'determined', evidence: 'figma:componentId', from: { id: '100:9', scope: 'page' }, to: { id: '100:41', scope: 'component-set:100:40', componentSetId: '100:40', componentId: '100:41' } },
      { kind: 'modal-trigger', status: 'determined', evidence: 'figma-prototype', from: { id: '100:17', scope: 'page' }, to: { id: '100:20', scope: 'modal:100:20' } },
    ],
    ...overrides,
  });
}

export function mobileInventory() {
  const pageId = '200:1';
  const hero = '200:2';
  const footer = '200:12';
  const gallery = '200:50';
  const langSet = {
    id: '200:30',
    type: 'COMPONENT_SET',
    name: 'img/海报',
    componentPropertyDefinitions: { lang: { type: 'VARIANT', variantOptions: ['cn', 'en'] } },
    variants: stampAll([
      {
        id: '200:31', type: 'COMPONENT', name: 'lang=cn', status: 'determined', role: 'img', behavior: 'slice',
        componentProperties: { lang: 'cn' },
        box: { x: 0, y: 0, w: 200, h: 40 }, pageBox: { x: 40, y: 200, w: 200, h: 40 }, parentBox: MOBILE_BOX,
        sliceExport: sliceOf('200:31', { x: 40, y: 200, w: 200, h: 40 }),
      },
      {
        id: '200:32', type: 'COMPONENT', name: 'lang=en', status: 'determined', role: 'img', behavior: 'slice',
        componentProperties: { lang: 'en' },
        box: { x: 0, y: 0, w: 200, h: 40 }, pageBox: { x: 40, y: 200, w: 200, h: 40 }, parentBox: MOBILE_BOX,
        sliceExport: sliceOf('200:32', { x: 40, y: 200, w: 200, h: 40 }),
      },
    ]),
  };
  const modal = stampReadyFields({
    id: '200:20',
    type: 'FRAME',
    name: 'modal/subscribe',
    status: 'determined',
    role: 'modal',
    box: { x: 0, y: 0, w: 300, h: 200 },
    pageBox: { x: 40, y: 200, w: 300, h: 200 },
    parentBox: MOBILE_BOX,
    nodes: stampAll([
      {
        id: '200:20', type: 'FRAME', name: 'modal/subscribe', status: 'determined', role: 'modal',
        box: { x: 0, y: 0, w: 300, h: 200 }, pageBox: { x: 40, y: 200, w: 300, h: 200 }, parentBox: MOBILE_BOX,
      },
      {
        id: '200:25', type: 'TEXT', name: 'copy/modal', status: 'determined', role: 'copy',
        characters: '弹窗文案',
        text: { characters: '弹窗文案', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 18 },
        box: { x: 16, y: 16, w: 200, h: 28 }, pageBox: { x: 56, y: 216, w: 200, h: 28 }, parentBox: { x: 40, y: 200, w: 300, h: 200 },
      },
      {
        id: '200:26', type: 'FRAME', name: 'btn/close', status: 'determined', role: 'btn',
        box: { x: 260, y: 8, w: 28, h: 28 }, pageBox: { x: 300, y: 208, w: 28, h: 28 }, parentBox: { x: 40, y: 200, w: 300, h: 200 },
      },
    ]),
  });
  return makeInventory({
    pageId,
    platform: 'mobile',
    pageBox: MOBILE_BOX,
    snapshotHash: HASH_MO,
    nodes: [
      { id: hero, scope: 'page', type: 'FRAME', name: 'sec/1', label: '1', parentId: pageId, orderKey: '0.0', status: 'determined', role: 'sec', ancestorIds: [pageId], box: MOBILE_BOX, pageBox: MOBILE_BOX, parentBox: MOBILE_BOX },
      { id: '200:3', scope: 'page', type: 'RECTANGLE', name: 'bg/page', label: 'page', parentId: pageId, orderKey: '0.1', status: 'determined', role: 'bg', behavior: 'slice', ancestorIds: [pageId], box: MOBILE_BOX, pageBox: MOBILE_BOX, parentBox: MOBILE_BOX, sliceExport: sliceOf('200:3', MOBILE_BOX) },
      { id: '200:5', scope: 'page', type: 'TEXT', name: 'copy/title', parentId: hero, orderKey: '0.0.0', status: 'determined', role: 'copy', ancestorIds: [pageId, hero], characters: '标题甲', text: { characters: '标题甲', fontFamily: 'Source Han Sans', fontWeight: 500, fontSize: 24 }, box: { x: 40, y: 80, w: 200, h: 40 }, pageBox: { x: 40, y: 80, w: 200, h: 40 }, parentBox: MOBILE_BOX },
      { id: '200:8', scope: 'page', type: 'INSTANCE', name: 'img/海报', parentId: hero, orderKey: '0.0.1', status: 'determined', role: 'img', behavior: 'slice', componentId: '200:31', ancestorIds: [pageId, hero], box: { x: 40, y: 200, w: 200, h: 40 }, pageBox: { x: 40, y: 200, w: 200, h: 40 }, parentBox: MOBILE_BOX, sliceExport: sliceOf('200:8', { x: 40, y: 200, w: 200, h: 40 }) },
      { id: '200:13', scope: 'page', type: 'FRAME', name: 'btn/cta', label: 'cta', parentId: hero, orderKey: '0.0.2', status: 'determined', role: 'btn', ancestorIds: [pageId, hero], box: { x: 40, y: 280, w: 160, h: 40 }, pageBox: { x: 40, y: 280, w: 160, h: 40 }, parentBox: MOBILE_BOX },
      { id: '200:17', scope: 'page', type: 'FRAME', name: 'btn/modal', label: 'modal', parentId: hero, orderKey: '0.0.3', status: 'determined', role: 'btn', ancestorIds: [pageId, hero], box: { x: 40, y: 330, w: 160, h: 40 }, pageBox: { x: 40, y: 330, w: 160, h: 40 }, parentBox: MOBILE_BOX },
      { id: gallery, scope: 'page', type: 'FRAME', name: 'sec/3', label: '3', parentId: pageId, orderKey: '0.3', status: 'determined', role: 'sec', ancestorIds: [pageId], box: { x: 0, y: 1624, w: 750, h: 700 }, pageBox: { x: 0, y: 1624, w: 750, h: 700 }, parentBox: MOBILE_BOX },
      { id: '200:22', scope: 'page', type: 'FRAME', name: 'switch/gallery', label: 'gallery', parentId: gallery, orderKey: '0.3.0', status: 'determined', role: 'switch', ancestorIds: [pageId, gallery], box: { x: 24, y: 1660, w: 700, h: 280 }, pageBox: { x: 24, y: 1660, w: 700, h: 280 }, parentBox: { x: 0, y: 1624, w: 750, h: 700 } },
      { id: '200:23', scope: 'page', type: 'FRAME', name: 'img/slide-a', parentId: '200:22', orderKey: '0.3.0.0', status: 'determined', role: 'img', behavior: 'slice', ancestorIds: [pageId, gallery, '200:22'], box: { x: 24, y: 1660, w: 700, h: 280 }, pageBox: { x: 24, y: 1660, w: 700, h: 280 }, parentBox: { x: 24, y: 1660, w: 700, h: 280 }, sliceExport: sliceOf('200:23', { x: 24, y: 1660, w: 700, h: 280 }) },
      { id: '200:24', scope: 'page', type: 'FRAME', name: 'img/slide-b', parentId: '200:22', orderKey: '0.3.0.1', status: 'determined', role: 'img', behavior: 'slice', ancestorIds: [pageId, gallery, '200:22'], box: { x: 24, y: 1660, w: 700, h: 280 }, pageBox: { x: 24, y: 1660, w: 700, h: 280 }, parentBox: { x: 24, y: 1660, w: 700, h: 280 }, sliceExport: sliceOf('200:24', { x: 24, y: 1660, w: 700, h: 280 }) },
      { id: '200:18', scope: 'page', type: 'FRAME', name: 'dyn/video', label: 'video', parentId: gallery, orderKey: '0.3.1', status: 'determined', role: 'dyn', ancestorIds: [pageId, gallery], box: { x: 24, y: 1960, w: 280, h: 160 }, pageBox: { x: 24, y: 1960, w: 280, h: 160 }, parentBox: { x: 0, y: 1624, w: 750, h: 700 } },
      { id: footer, scope: 'page', type: 'FRAME', name: 'sec/2', label: '2', parentId: pageId, orderKey: '0.4', status: 'determined', role: 'sec', ancestorIds: [pageId], box: { x: 0, y: 2324, w: 750, h: 80 }, pageBox: { x: 0, y: 2324, w: 750, h: 80 }, parentBox: MOBILE_BOX },
      { id: '200:21', scope: 'page', type: 'TEXT', name: 'copy/footer', parentId: footer, orderKey: '0.4.0', status: 'determined', role: 'copy', ancestorIds: [pageId, footer], characters: '页脚', text: { characters: '页脚', fontFamily: 'Source Han Sans', fontWeight: 400, fontSize: 14 }, box: { x: 40, y: 2344, w: 80, h: 20 }, pageBox: { x: 40, y: 2344, w: 80, h: 20 }, parentBox: { x: 0, y: 2324, w: 750, h: 80 } },
    ],
    componentSets: [langSet],
    modals: [modal],
    relations: [
      { kind: 'instance-uses-variant', status: 'determined', from: { id: '200:8', scope: 'page' }, to: { id: '200:31', scope: 'component-set:200:30', componentSetId: '200:30', componentId: '200:31' } },
      { kind: 'modal-trigger', status: 'determined', evidence: 'figma-prototype', from: { id: '200:17', scope: 'page' }, to: { id: '200:20', scope: 'modal:200:20' } },
    ],
  });
}

export function makeLark() {
  return {
    _meta: {
      langCols: { A: 'zh-CN', B: 'en' },
      phaseRows: [10, 11, 12, 21, 40, 41, 42],
    },
    rows: {
      10: { 'zh-CN': '标题甲', en: 'Title A' },
      11: { 'zh-CN': '重复词', en: 'Word-One' },
      12: { 'zh-CN': '标题丙', en: 'Title C' },
      21: { 'zh-CN': '第一句\n第二句\n第三句', en: 'Line1\nLine2\nLine3' },
      40: { 'zh-CN': '页脚', en: 'Footer' },
      41: { 'zh-CN': '弹窗文案', en: 'Modal copy' },
      42: { 'zh-CN': '徽章中文', en: 'Badge' },
      99: { 'zh-CN': '范围外', en: 'Out of range' },
      15: { 'zh-CN': '重复词', en: 'Word-Two' },
    },
  };
}

export function writeReadyPack(dir, { pc = pcInventory(), mobile = mobileInventory() } = {}) {
  mkdirSync(dir, { recursive: true });
  const pcPath = join(dir, 'inventory-pc.json');
  const mobilePath = join(dir, 'inventory-mobile.json');
  writeFileSync(pcPath, `${JSON.stringify(pc, null, 2)}\n`);
  writeFileSync(mobilePath, `${JSON.stringify(mobile, null, 2)}\n`);
  const manifest = buildManifest({
    pcPath: 'inventory-pc.json',
    mobilePath: 'inventory-mobile.json',
    pcDoc: pc,
    mobileDoc: mobile,
    kind: 'ready',
  });
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return { pc, mobile, manifest };
}

function pngSize(buf) {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function writeAssets(dir, packDocs) {
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'fonts'), { recursive: true });
  mkdirSync(join(dir, 'media'), { recursive: true });
  const files = {};
  const pick = (end, id) => {
    if (String(id).includes('32')) return end === 'pc' ? PNG_BLUE : PNG_YELLOW;
    if (String(id).includes('31')) return end === 'pc' ? PNG_RED : PNG_GREEN;
    return PNG_1x1;
  };
  for (const [end, doc] of [['pc', packDocs.pc], ['mobile', packDocs.mobile]]) {
    files[end] = {};
    const seen = new Set();
    const add = (id, colorSample, box = { w: 1, h: 1 }) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const colors = colorSample === PNG_BLUE ? [0, 0, 255, 255] : colorSample === PNG_RED ? [255, 0, 0, 255] : [0, 160, 80, 255];
      const buf = syntheticPng(Math.round(box.w), Math.round(box.h), colors);
      const name = `${end}-${id.replace(':', '-')}.png`;
      const file = join(dir, name);
      writeFileSync(file, buf);
      const size = pngSize(buf);
      files[end][id] = {
        path: name,
        sha256: createHash('sha256').update(buf).digest('hex'),
        width: size.width,
        height: size.height,
      };
    };
    for (const set of doc.attachments.componentSets || []) {
      add(set.id, PNG_1x1);
      for (const variant of set.variants || []) add(variant.id, pick(end, variant.id), variant.sliceExport?.box);
    }
    for (const node of doc.nodes || []) {
      if (node.sliceExport?.file) add(node.id, pick(end, node.id), node.sliceExport.box);
    }
  }
  const fontFile = join(dir, 'fonts', 'source-han-sans.woff2');
  writeFileSync(fontFile, FONT_BYTES);
  const videoFile = join(dir, 'media', 'demo.webm');
  writeFileSync(videoFile, VIDEO_BYTES);
  const map = {
    schema: 'ews-assets/v1',
    fingerprint: packDocs.manifest.fingerprint,
    fonts: [400, 500].map((weight) => ({ family: 'Source Han Sans', weight, path: 'fonts/source-han-sans.woff2', sha256: createHash('sha256').update(FONT_BYTES).digest('hex') })),
    media: { 'demo.webm': { path: 'media/demo.webm', sha256: createHash('sha256').update(VIDEO_BYTES).digest('hex') } },
    ...files,
  };
  writeFileSync(join(dir, 'asset-map.json'), `${JSON.stringify(map, null, 2)}\n`);
  return map;
}

export function defaultConfig() {
  return {
    schema: 'ews-config/v1',
    locales: ['zh-CN', 'en'],
    defaultLocale: 'zh-CN',
    screens: [
      { key: 'hero', pc: '100:2', mobile: '200:2' },
      { key: 'gallery', pc: '100:50', mobile: '200:50' },
    ],
    footer: { pc: '100:12', mobile: '200:12' },
    carousels: [{
      ownerId: { pc: '100:22', mobile: '200:22' },
      slides: { pc: ['100:23', '100:24'], mobile: ['200:23', '200:24'] },
    }],
    navigation: { '100:13': 'gallery', '200:13': 'gallery' },
    videos: { '100:18': 'media/demo.webm', '200:18': 'media/demo.webm' },
    modals: { '100:17': '100:20', '200:17': '200:20' },
    fonts: [400, 500].map((weight) => ({ family: 'Source Han Sans', weight, file: 'fonts/source-han-sans.woff2', sha256: createHash('sha256').update(FONT_BYTES).digest('hex') })),
  };
}

export function defaultDesignations() {
  return {
    pc: {
      designations: {
        '100:5': { row: 10, why: 'user' },
        '100:7': { row: 12, why: 'user' },
        '100:10': { row: 21, lineIndex: 0, takeCount: 1, why: 'user' },
        '100:11': { row: 21, lineIndex: 1, takeCount: 2, why: 'user' },
        '100:21': { row: 40, why: 'user' },
        '100:25': { row: 41, why: 'user' },
      },
    },
    mobile: {
      designations: {
        '200:5': { row: 10, why: 'user' },
        '200:21': { row: 40, why: 'user' },
        '200:25': { row: 41, why: 'user' },
      },
    },
  };
}
