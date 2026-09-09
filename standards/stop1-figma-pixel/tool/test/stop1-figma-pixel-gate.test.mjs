/**
 * Unit tests for the shared stop-1 Figma pixel gate.
 * Callers: npm test in standards/stop1-figma-pixel/tool; nightly-health.
 * Imports: ../src/stop1-figma-pixel-gate.mjs
 * Schema: stop1-figma-pixel-gate/v1. No production data files.
 * User: 「按照选项优化，优化完告诉我能提速多少」
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  assertExportNotFlattened,
  blitPng,
  clearRectPng,
  punchOpaquePng,
  compareSectionPngs,
  cropPng,
  inkCropOrigin,
  cropRectForSection,
  DEFAULT_STOP1_PIXEL_THRESHOLD,
  failClosedSkipPreviewProbe,
  figmaCachePath,
  figmaCacheRel,
  handoffSnapshotToken,
  analoguePaintNode,
  langAxisOverlaysForSection,
  sectionFixOverlays,
  sectionLiveCopyMasks,
  sectionPaintExports,
  isStop1PixelSkippedSection,
  loadPngApi,
  pickExportScale,
  runStop1FigmaPixelGate,
  STOP1_PIXEL_DIR,
} from '../src/stop1-figma-pixel-gate.mjs';
import { parseStop1SkipJson, productProbeViewport, tryReadCachePng, writeCachePng } from '../src/stop1-figma-pixel-probe.mjs';
import { trustedSkillRoot } from '../src/resolve-playwright.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = join(ROOT, 'src/stop1-figma-pixel-probe.mjs');

function solidPng(PNGApi, { w, h, r, g, b }) {
  const png = new PNGApi({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
  return PNGApi.sync.write(png);
}

test('identical small PNGs pass at 0.005', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-same-'));
  const raw = solidPng(PNGApi, { w: 16, h: 16, r: 20, g: 40, b: 60 });
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: raw,
    actualRaw: raw,
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'pc',
    secId: '1:1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.status, 'PASS');
  assert.equal(existsSync(join(demoDir, STOP1_PIXEL_DIR, 'pc.1-1.diff.png')), true);
});

test('one-pixel change over 0.005 fails and writes a diff', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-diff-'));
  const baseline = solidPng(PNGApi, { w: 8, h: 8, r: 10, g: 10, b: 10 });
  const actualPng = PNG.sync.read(baseline);
  actualPng.data[0] = 255;
  actualPng.data[1] = 0;
  actualPng.data[2] = 0;
  const actual = PNG.sync.write(actualPng);
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: baseline,
    actualRaw: actual,
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'mobile',
    secId: '2:2',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'FAIL');
  assert.ok(result.diffRatio > DEFAULT_STOP1_PIXEL_THRESHOLD);
  assert.equal(existsSync(join(demoDir, result.artifacts.diff)), true);
  assert.equal(existsSync(join(demoDir, result.artifacts.baseline)), true);
  assert.equal(existsSync(join(demoDir, result.artifacts.demo)), true);
});

test('missing baseline is fail-closed, not skipped', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-missing-'));
  mkdirSync(join(demoDir, STOP1_PIXEL_DIR), { recursive: true });
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: null,
    actualRaw: solidPng(PNGApi, { w: 4, h: 4, r: 1, g: 1, b: 1 }),
    demoDir,
    platform: 'pc',
    secId: '3:3',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'MISSING');
});

test('skipPreview probe refuses to mark green', () => {
  assert.throws(
    () => failClosedSkipPreviewProbe()(),
    /refusing to mark green from skipPreview/,
  );
  const gate = runStop1FigmaPixelGate({
    handoffDir: '/tmp',
    demoDir: '/tmp',
    skipPreview: true,
  });
  assert.equal(gate.ok, false);
  assert.notEqual(gate.skipped, true);
});

test('injected over-threshold probe stays red', () => {
  const gate = runStop1FigmaPixelGate({
    handoffDir: '/tmp',
    demoDir: '/tmp',
    pixelGateProbe: () => ({ ok: false, problems: ['pc 1:1: diffRatio 12.00% > 0.50%'] }),
  });
  assert.equal(gate.ok, false);
  assert.match(gate.problems.join('\n'), /diffRatio/);
});

test('probe CLI missing args exits non-zero', () => {
  const res = spawnSync(process.execPath, [PROBE], { encoding: 'utf8' });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /--demo|--handoff|usage/);
});

test('crop origin uses pageBox × scale and refuses half pixels', () => {
  const crop = cropRectForSection(
    { x: 0, y: 0, w: 3840, h: 6429 },
    { x: 0, y: 2144, w: 3840, h: 2144 },
    0.5,
  );
  assert.deepEqual(crop, { x: 0, y: 1072, w: 1920, h: 1072 });
  assert.throws(
    () => cropRectForSection({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 1, w: 100, h: 10 }, 0.5),
    /not integer/,
  );
});

test('export scale never chooses 2x and 3840×2143 is 1x', () => {
  assert.equal(pickExportScale({ x: 0, y: 0, w: 100, h: 100 }), 1);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 3840, h: 6429 }), 0.5);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 3840, h: 2143 }), 1);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 750, h: 1334 }), 1);
  assert.equal(pickExportScale({ x: 0, y: 0, w: 8000, h: 5000 }), 0.5);
});

test('shared default skip keeps 949:6041 for re-export consumers', () => {
  assert.equal(isStop1PixelSkippedSection('mobile', '949:6041'), true);
  assert.equal(isStop1PixelSkippedSection('mobile', '949:5968'), false);
  assert.equal(isStop1PixelSkippedSection('pc', '949:5151'), false);
  assert.equal(isStop1PixelSkippedSection('mobile', '949:6041', { mobile: '949:6041' }), false);
  assert.equal(isStop1PixelSkippedSection('mobile', '949:6041', { mobile: ['949:6041'] }), true);
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /isStop1PixelSkippedSection\(platform, section\.id/);
  assert.match(src, /status: 'SKIPPED'/);
});

test('invalid STOP1_PIXEL_SKIP_JSON fail-closes instead of skipping silently', () => {
  assert.equal(parseStop1SkipJson(undefined), undefined);
  assert.deepEqual(parseStop1SkipJson('{"mobile":["949:6041"]}'), { mobile: ['949:6041'] });
  assert.throws(() => parseStop1SkipJson('{not-json'), /STOP1_PIXEL_SKIP_JSON is not valid JSON/);
  assert.throws(() => parseStop1SkipJson('{"mobile":"949:6041"}'), /must be an array of strings/);
  assert.throws(() => parseStop1SkipJson('["949:6041"]'), /must be an object of platform/);
  assert.throws(() => parseStop1SkipJson('{"mobile":[949]}'), /must be an array of strings/);
});

test('Playwright skill root is the current skill, not both page-making skills', () => {
  const repo = join(ROOT, '../../..');
  const torch = join(repo, 'skills/torchlight-web');
  const yise = join(repo, 'skills/yise-web-ui');
  assert.equal(trustedSkillRoot(join(torch, 'scripts/lib')), torch);
  assert.equal(trustedSkillRoot(join(yise, 'scripts/lib')), yise);
  assert.equal(trustedSkillRoot(ROOT), null);
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /launchChromium\(absDemo/);
  assert.doesNotMatch(src, /launchChromium\(TOOL_ROOT/);
  const resolver = readFileSync(join(ROOT, 'src/resolve-playwright.mjs'), 'utf8');
  assert.doesNotMatch(resolver, /\['torchlight-web', 'yise-web-ui'\]/);
});

test('stop-1 assembles node exports and product=1', () => {
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /index\.html\?product=1/);
  assert.match(src, /sectionPaintExports/);
  assert.match(src, /use_absolute_bounds/);
  assert.match(src, /pickExportScale/);
  assert.match(src, /figma-cache/);
  assert.match(src, /--refresh-figma-cache/);
  assert.match(src, /writeCachePng/);
  assert.match(src, /renameSync\(tmp, cacheFile\)/);
  assert.match(src, /return null;/);
  assert.match(src, /analogueIds/);
  assert.match(src, /analogueOf/);
  assert.match(src, /fetchTimed/);
  assert.match(src, /assembled Figma snapshot/);
  assert.match(src, /sectionLiveCopyMasks/);
  assert.match(src, /dropmenu-off-icon/);
  assert.match(src, /deviceScaleFactor:\s*dsf/);
  assert.match(src, /size mismatch/);
  assert.match(src, /page\.screenshot\(\{ type: 'png', clip/);
  assert.match(src, /omitBackground: false/);
  assert.match(src, /allowOverflow: true/);
  assert.match(src, /cropPng/);
  assert.match(src, /extraX \/ 2/);
  assert.doesNotMatch(src, /punchOpaquePng/);
  assert.doesNotMatch(src, /overlayCnMasters/);
  assert.doesNotMatch(src, /overlay.instanceId/);
  assert.doesNotMatch(src, /clearRectPng\(out/);
  assert.match(src, /fx-fixed-overlays/);
  assert.match(src, /data-stop1-pixel-chrome-hidden/);
  assert.match(src, /opacity', '0'/);
  assert.match(src, /Number\(section\.pageBox\?\.y\) > Number\(pageBox\.y\) \+ 1/);
  assert.match(src, /width: r\.width/);
  assert.doesNotMatch(src, /r\.width \* s/);
  assert.doesNotMatch(src, /el\.screenshot/);
  assert.doesNotMatch(src, /inventory-static-gate=1/);
  assert.doesNotMatch(src, /const frameId = page.id/);
  assert.doesNotMatch(src, /alignDemoToBaseline/);
});

test('product probe uses section column width instead of mobile shelf width', () => {
  const mobile = productProbeViewport('mobile', { w: 2430, h: 2668 }, [{ pageBox: { w: 750, h: 1334 } }]);
  assert.equal(mobile.w, 750);
  assert.notEqual(mobile.w, 2430);
  assert.throws(
    () => productProbeViewport('mobile', { w: 2430, h: 2668 }, [{ pageBox: { w: 2430, h: 1334 } }]),
    /invalid product probe viewport width/,
  );
  const pc = productProbeViewport('pc', { w: 2430, h: 2668 }, [{ pageBox: { w: 3840, h: 2143 } }]);
  assert.ok(pc.w > 1126);
});

test('Figma cache key is fileKey + frameId + scale + snapshot hash', () => {
  assert.equal(
    figmaCacheRel('FMGPo4jDRp5ZaqljrDff7G', '721:7867', 1, 'sha256:95ad7171248aed0ae3c9531ba351f4131d33f33fb25e497c3fd598ca9f529c25'),
    'artifacts/stop1-pixel/figma-cache/FMGPo4jDRp5ZaqljrDff7G.721-7867.s1.95ad7171248aed0ae3c9531ba351f413.png',
  );
  assert.equal(
    handoffSnapshotToken({
      inventories: [{ snapshot: { hash: 'sha256:95ad7171248aed0ae3c9531ba351f4131d33f33fb25e497c3fd598ca9f529c25' } }],
    }),
    '95ad7171248aed0ae3c9531ba351f413',
  );
  assert.equal(
    handoffSnapshotToken({
      inventories: [{ snapshot: { fingerprint: 'should-not-key-cache', lastModified: '2026-09-06T06:43:29Z' } }],
    }),
    '2026-09-06T06_43_29Z',
  );
  assert.notEqual(
    figmaCacheRel('FMGPo4jDRp5ZaqljrDff7G', '721:7867', 1, 'aaa'),
    figmaCacheRel('FMGPo4jDRp5ZaqljrDff7G', '721:7867', 1, 'bbb'),
  );
});

test('corrupt Figma cache PNG is a miss, not a thrown error', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-corrupt-'));
  const fileKey = 'FileKey';
  const frameId = '1:1';
  const scale = 1;
  const snapshotToken = 'snap';
  const cacheFile = figmaCachePath(demoDir, fileKey, frameId, scale, snapshotToken);
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, Buffer.from('not-a-png'));
  const miss = tryReadCachePng({ demoDir, fileKey, frameId, scale, snapshotToken, PNG: PNGApi });
  assert.equal(miss, null);
});

test('cache miss contract returns null from the read catch path', () => {
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /function tryReadCachePng[\s\S]*catch[\s\S]*return null/);
});

test('Figma cache write is atomic rename and a valid PNG reads back', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-atomic-'));
  const fileKey = 'FileKey';
  const frameId = '2:2';
  const scale = 1;
  const snapshotToken = 'snap';
  const cacheFile = figmaCachePath(demoDir, fileKey, frameId, scale, snapshotToken);
  const raw = solidPng(PNGApi, { w: 4, h: 4, r: 9, g: 8, b: 7 });
  writeCachePng(cacheFile, raw);
  assert.equal(existsSync(cacheFile), true);
  const hit = tryReadCachePng({ demoDir, fileKey, frameId, scale, snapshotToken, PNG: PNGApi });
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.png.width, 4);
  assert.equal(hit.png.height, 4);
  assert.deepEqual([...hit.buf], [...raw]);
});

test('cache writes never write directly to the final cache path', () => {
  const src = readFileSync(PROBE, 'utf8');
  assert.match(src, /renameSync\(tmp, cacheFile\)/);
  assert.doesNotMatch(src, /writeFileSync\(cacheFile/);
  assert.match(src, /writeFileSync\(tmp/);
});

test('section paint exports blit CN master into kr img/ instance box', () => {
  const inventory = {
    nodes: [
      {
        id: '814:12006',
        name: 'img/标题slg',
        parentId: '814:11942',
        componentId: '785:806',
        pageBox: { x: 0, y: 788, w: 750, h: 239 },
        componentProperties: { lang: { value: 'kr', type: 'VARIANT' } },
      },
    ],
    attachments: {
      componentSets: [{
        id: '785:801',
        name: 'img/标题slg',
        variants: [
          { id: '785:800', name: 'lang=cn', pageBox: { x: 7746, y: 1647, w: 750, h: 239 } },
          { id: '785:806', name: 'lang=kr', pageBox: { x: 7746, y: 2424, w: 750, h: 239 } },
        ],
      }],
    },
  };
  const paints = sectionPaintExports(inventory, {
    id: '814:11942',
    pageBox: { x: 0, y: 0, w: 750, h: 1334 },
  });
  assert.equal(paints.length, 1);
  assert.equal(paints[0].kind, 'cn-master');
  assert.equal(paints[0].frameId, '785:800');
  assert.deepEqual(paints[0].destBox, { x: 0, y: 788, w: 750, h: 239 });
  assert.deepEqual(paints[0].masterBox, { x: 7746, y: 1647, w: 750, h: 239 });
});

test('closed dropmenu paints img/icon, not the 370-high instance box', () => {
  const inventory = {
    nodes: [
      {
        id: '814:12017',
        name: 'dropmenu/多语言',
        role: 'dropmenu',
        parentId: '814:11942',
        pageBox: { x: 506, y: 31, w: 230, h: 370 },
        componentProperties: { 'Property 1': { value: 'off', type: 'VARIANT' } },
      },
      {
        id: 'I814:12017;784:7491',
        name: 'img/icon',
        role: 'img',
        parentId: '814:12017',
        pageBox: { x: 651, y: 31, w: 85, h: 85 },
      },
    ],
  };
  const paints = sectionPaintExports(inventory, {
    id: '814:11942',
    pageBox: { x: 0, y: 0, w: 750, h: 1334 },
  });
  assert.equal(paints.length, 1);
  assert.equal(paints[0].kind, 'dropmenu-off-icon');
  assert.equal(paints[0].frameId, 'I814:12017;784:7491');
  assert.deepEqual(paints[0].destBox, { x: 651, y: 31, w: 85, h: 85 });
});

test('live TEXT boxes are masked out of the pixel compare', () => {
  const inventory = {
    nodes: [
      { id: '814:12005', name: 'SS13守夜人', type: 'TEXT', role: 'copy', parentId: '814:11942', pageBox: { x: 185, y: 768, w: 380, h: 39 }, text: { characters: 'SS13守夜人' } },
      { id: '814:12016', name: 'btn/按钮', role: 'btn', parentId: '814:11942', pageBox: { x: 370, y: 27, w: 310, h: 90 } },
    ],
  };
  const masks = sectionLiveCopyMasks(inventory, {
    id: '814:11942',
    pageBox: { x: 0, y: 0, w: 750, h: 1334 },
  });
  assert.deepEqual(masks, [{ x: 185, y: 768, w: 380, h: 39 }]);
});

test('later-section clone lists earlier same-component analogue', () => {
  const inventory = {
    nodes: [
      {
        id: '758:484',
        name: 'img/logo',
        parentId: '758:1780',
        componentId: '758:458',
        pageBox: { x: 0, y: 0, w: 1020, h: 360 },
        componentProperties: { lang: { value: 'cn', type: 'VARIANT' } },
      },
      {
        id: '758:1856',
        name: 'img/logo',
        parentId: '758:1855',
        componentId: '758:458',
        pageBox: { x: 0, y: 4286, w: 1020, h: 360 },
        componentProperties: { lang: { value: 'cn', type: 'VARIANT' } },
      },
    ],
  };
  const analogue = analoguePaintNode(inventory, inventory.nodes[1]);
  assert.equal(analogue.id, '758:484');
  const paints = sectionPaintExports({
    nodes: [
      { id: '758:1855', name: 'fix/顶部信息', parentId: '721:8327', pageBox: { x: 0, y: 4286, w: 3793, h: 493 } },
      ...inventory.nodes,
    ],
  }, { id: '721:8327', pageBox: { x: 0, y: 4286, w: 3840, h: 2143 } });
  const logo = paints.find((row) => row.frameId === '758:1856');
  assert.ok(logo);
  assert.deepEqual(logo.analogueIds, ['758:458', '758:484']);
});

test('section fix overlays stay on their own later-section parent', () => {
  const inventory = {
    nodes: [
      { id: '758:1780', name: 'fix/顶部信息', parentId: '721:7867', pageBox: { x: 0, y: 0, w: 3793, h: 493 } },
      { id: '758:1815', name: 'fix/顶部信息', parentId: '721:8243', pageBox: { x: 0, y: 2143, w: 3793, h: 493 } },
      { id: '721:8200', name: 'btn/查看更多', parentId: '721:8243', pageBox: { x: 10, y: 2200, w: 100, h: 40 } },
    ],
  };
  const first = sectionFixOverlays(inventory, { id: '721:7867', pageBox: { x: 0, y: 0, w: 3840, h: 2143 } });
  const later = sectionFixOverlays(inventory, { id: '721:8243', pageBox: { x: 0, y: 2143, w: 3840, h: 2143 } });
  assert.deepEqual(first.map((row) => row.id), ['758:1780']);
  assert.deepEqual(later.map((row) => row.id), ['758:1815']);
});

test('section paint exports drop untagged later fix clones and descendants', () => {
  const inventory = {
    overlays: [
      { id: 'fix-first', role: 'fix', label: '顶部信息' },
      { id: 'fix-clone', role: 'fix', label: '顶部信息' },
    ],
    nodes: [
      { id: 'fix-first', name: 'fix/顶部信息', parentId: 'sec-1', pageBox: { x: 0, y: 0, w: 900, h: 100 } },
      { id: 'logo-first', name: 'img/logo', parentId: 'fix-first', ancestorIds: ['fix-first'], pageBox: { x: 0, y: 0, w: 100, h: 40 } },
      { id: 'fix-clone', name: 'fix/顶部信息', parentId: 'sec-2', pageBox: { x: 0, y: 1200, w: 900, h: 100 } },
      { id: 'logo-clone', name: 'img/logo', parentId: 'fix-clone', ancestorIds: ['fix-clone'], pageBox: { x: 0, y: 1200, w: 100, h: 40 } },
      { id: 'hero-2', name: 'kv/hero', parentId: 'sec-2', pageBox: { x: 0, y: 1200, w: 750, h: 500 } },
    ],
  };
  const first = sectionPaintExports(inventory, { id: 'sec-1', pageBox: { x: 0, y: 0, w: 750, h: 1000 } });
  const later = sectionPaintExports(inventory, { id: 'sec-2', pageBox: { x: 0, y: 1000, w: 750, h: 1000 } });
  assert.deepEqual(first.map((row) => row.frameId), ['fix-first']);
  assert.deepEqual(later.map((row) => row.frameId), ['hero-2']);
});

test('lang-axis overlay maps kr instance onto cn master', () => {
  const inventory = {
    nodes: [{
      id: '814:12006',
      name: 'img/标题slg',
      componentId: '785:806',
      pageBox: { x: 0, y: 788, w: 750, h: 239 },
      componentProperties: { lang: { value: 'kr', type: 'VARIANT' } },
    }],
    attachments: {
      componentSets: [{
        id: '785:801',
        name: 'img/标题slg',
        variants: [
          { id: '785:800', name: 'lang=cn' },
          { id: '785:806', name: 'lang=kr' },
        ],
      }],
    },
  };
  const overlays = langAxisOverlaysForSection(inventory, {
    id: '814:11942',
    pageBox: { x: 0, y: 0, w: 750, h: 1334 },
  });
  assert.equal(overlays.length, 1);
  assert.equal(overlays[0].cnMasterId, '785:800');
  assert.equal(overlays[0].instanceId, '814:12006');
  assert.equal(overlays[0].pageBox.w, 750);
  assert.equal(overlays[0].masterBox, null);
});

test('lang-axis overlay keeps instance box and master box separate', () => {
  const inventory = {
    nodes: [{
      id: '814:12006',
      name: 'img/标题slg',
      componentId: '785:806',
      pageBox: { x: 0, y: 788, w: 750, h: 239 },
      componentProperties: { lang: { value: 'kr', type: 'VARIANT' } },
    }],
    attachments: {
      componentSets: [{
        id: '785:801',
        name: 'img/标题slg',
        variants: [
          { id: '785:800', name: 'lang=cn', pageBox: { x: 7746, y: 1647, w: 750, h: 239 } },
          { id: '785:806', name: 'lang=kr', pageBox: { x: 7746, y: 2424, w: 750, h: 239 } },
        ],
      }],
    },
  };
  const overlays = langAxisOverlaysForSection(inventory, {
    id: '814:11942',
    pageBox: { x: 0, y: 0, w: 750, h: 1334 },
  });
  assert.equal(overlays[0].cnMasterId, '785:800');
  assert.deepEqual(overlays[0].pageBox, { x: 0, y: 788, w: 750, h: 239 });
  assert.deepEqual(overlays[0].masterBox, { x: 7746, y: 1647, w: 750, h: 239 });
});

test('overlay flatten check allows effect overflow, not a smaller export', () => {
  const box = { x: 0, y: 0, w: 750, h: 239 };
  assert.doesNotThrow(() => assertExportNotFlattened({
    png: { width: 800, height: 239 },
    frameBox: box,
    scale: 1,
    allowOverflow: true,
  }));
  assert.throws(
    () => assertExportNotFlattened({
      png: { width: 800, height: 239 },
      frameBox: box,
      scale: 1,
    }),
    /flattened Figma export refused/,
  );
  assert.throws(
    () => assertExportNotFlattened({
      png: { width: 700, height: 239 },
      frameBox: box,
      scale: 1,
      allowOverflow: true,
    }),
    /flattened Figma export refused/,
  );
});

test('punchOpaquePng only clears opaque mask pixels', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const dest = PNGApi.sync.read(solidPng(PNGApi, { w: 2, h: 1, r: 9, g: 8, b: 7 }));
  const mask = PNGApi.sync.read(solidPng(PNGApi, { w: 2, h: 1, r: 1, g: 1, b: 1 }));
  mask.data[3] = 255;
  mask.data[7] = 0;
  punchOpaquePng(dest, mask, 0, 0);
  assert.equal(dest.data[0], 0);
  assert.equal(dest.data[3], 0);
  assert.equal(dest.data[4], 9);
  assert.equal(dest.data[7], 255);
});

test('clearRectPng punches a transparent hole', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const dest = PNGApi.sync.read(solidPng(PNGApi, { w: 4, h: 2, r: 9, g: 8, b: 7 }));
  clearRectPng(dest, { x: 1, y: 0, w: 2, h: 1 });
  assert.equal(dest.data[4], 0);
  assert.equal(dest.data[7], 0);
  assert.equal(dest.data[0], 9);
  assert.equal(dest.data[12], 9);
});

test('blit writes source pixels at integer origin', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const dest = PNGApi.sync.read(solidPng(PNGApi, { w: 4, h: 4, r: 0, g: 0, b: 0 }));
  const src = PNGApi.sync.read(solidPng(PNGApi, { w: 2, h: 2, r: 9, g: 8, b: 7 }));
  blitPng(dest, src, 1, 1);
  const i = ((1 * 4) + 1) * 4;
  assert.equal(dest.data[i], 9);
  assert.equal(dest.data[i + 1], 8);
  assert.equal(dest.data[i + 2], 7);
});

test('blit composites translucent source over destination instead of replacing it', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const dest = PNGApi.sync.read(solidPng(PNGApi, { w: 2, h: 1, r: 200, g: 0, b: 0 }));
  const src = PNGApi.sync.read(solidPng(PNGApi, { w: 1, h: 1, r: 0, g: 0, b: 0 }));
  src.data[3] = 128;
  blitPng(dest, src, 0, 0);
  assert.equal(dest.data[0], 100);
  assert.equal(dest.data[1], 0);
  assert.equal(dest.data[2], 0);
  assert.equal(dest.data[3], 255);
  assert.equal(dest.data[4], 200);
});

test('inkCropOrigin keeps the ink, not the geometric center, of overflowing masters', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const src = PNGApi.sync.read(solidPng(PNGApi, { w: 8, h: 4, r: 0, g: 0, b: 0 }));
  for (let i = 0; i < src.data.length; i += 4) src.data[i + 3] = 0;
  for (let x = 0; x < 3; x += 1) {
    const i = x * 4;
    src.data[i] = 9;
    src.data[i + 3] = 255;
  }
  assert.deepEqual(inkCropOrigin(src, 4, 4), { x: 0, y: 0, w: 4, h: 4 });
});

test('cropPng keeps the center of an overflowing master export', async () => {
  const { PNG: PNGApi } = await loadPngApi(ROOT);
  const src = PNGApi.sync.read(solidPng(PNGApi, { w: 8, h: 4, r: 1, g: 2, b: 3 }));
  src.data[0] = 9;
  src.data[4] = 8;
  const cropped = cropPng(PNGApi, src, { x: 2, y: 0, w: 4, h: 4 });
  assert.equal(cropped.width, 4);
  assert.equal(cropped.height, 4);
  assert.equal(cropped.data[0], 1);
});

test('size mismatch is ERROR, not silently scaled', async () => {
  const { PNG: PNGApi, pixelmatch, odiff } = await loadPngApi(ROOT);
  const demoDir = mkdtempSync(join(tmpdir(), 'stop1-pixel-size-'));
  const result = await compareSectionPngs({
    PNG: PNGApi,
    pixelmatch,
    odiff,
    baselineRaw: solidPng(PNGApi, { w: 16, h: 8, r: 10, g: 10, b: 10 }),
    actualRaw: solidPng(PNGApi, { w: 8, h: 8, r: 10, g: 10, b: 10 }),
    threshold: DEFAULT_STOP1_PIXEL_THRESHOLD,
    demoDir,
    platform: 'pc',
    secId: '4:4',
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 'ERROR');
  assert.match(result.problems.join('\n'), /size mismatch 16x8 vs 8x8/);
});

test('probe-only CLI does not import torchlightweb machine', () => {
  const src = readFileSync(PROBE, 'utf8');
  assert.doesNotMatch(src, /torchlightweb-machine/);
  assert.doesNotMatch(src, /figma-html-from-handoff/);
});
