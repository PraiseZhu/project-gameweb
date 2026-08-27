import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const unwrap = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value && value.provenance) return value.value;
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  return value;
};

const list = (value) => Array.isArray(value) ? value : Object.values(value || {});

const asPlainId = (node) => {
  if (!node) return null;
  return String(node.id && typeof node.id === 'object' && 'value' in node.id ? node.id.value : node.id);
};

const ownerIncludes = (node, id) => Array.isArray(node?.ownerPath) && node.ownerPath.some((entry) => String(entry) === String(id));

const nameOf = (node) => String(node?.name || '');
const ownedBy = (node, ownerId) => !ownerId || asPlainId(node) === ownerId || ownerIncludes(node, ownerId);
const boxOf = (node) => {
  const box = node?.box || {};
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w ?? box.width);
  const h = Number(box.h ?? box.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
};

const collectTruthNodes = (truth) => {
  const nodes = [];
  const pushList = (value) => {
    for (const node of list(value)) if (node && typeof node === 'object') nodes.push(node);
  };
  const pushScope = (scope) => {
    if (!scope || typeof scope !== 'object') return;
    pushList(scope.fixedOverlays?.nodes);
    pushList(scope.pageChrome?.nodes);
    pushList(scope.pageBackground?.nodes);
    for (const section of list(scope.sections)) pushList(section?.nodes);
  };
  pushScope(truth);
  for (const platform of Object.values(truth.platforms || {})) pushScope(platform);
  return nodes;
};

const isDirectoryRoot = (node) => {
  const name = nameOf(node);
  return /^(?:fix|nav|navigation|footer)\//.test(name) && /导航|directory|nav/i.test(name);
};

const assetFileForNode = (demoDir, node) => {
  const recFile = node?.asset?.file || node?.file || node?.src;
  if (typeof recFile === 'string' && recFile) {
    const relative = recFile.replace(/^[.][/\\]/, '');
    const path = /[/\\]/.test(relative) || relative.startsWith('assets')
      ? join(demoDir, relative)
      : join(demoDir, 'assets', relative);
    if (existsSync(path)) return path;
  }
  const id = asPlainId(node);
  if (!id) return null;
  const stem = id.replace(/[:;]/g, '-');
  for (const ext of ['png', 'webp', 'jpg', 'jpeg']) {
    const path = join(demoDir, 'assets', `${stem}.${ext}`);
    if (existsSync(path)) return path;
  }
  return null;
};

const unionBoxes = (nodes) => nodes.reduce((acc, node) => {
  const box = boxOf(node);
  if (!box) return acc;
  if (!acc) return { ...box };
  const left = Math.min(acc.x, box.x);
  const top = Math.min(acc.y, box.y);
  const right = Math.max(acc.x + acc.w, box.x + box.w);
  const bottom = Math.max(acc.y + acc.h, box.y + box.h);
  return { x: left, y: top, w: right - left, h: bottom - top };
}, null);

export function loadNavRailTruth(demoDir) {
  const resolvedDemoDir = resolve(demoDir);
  const truth = unwrap(JSON.parse(readFileSync(join(resolvedDemoDir, 'truth.json'), 'utf8')));
  const nodes = collectTruthNodes(truth);
  const pageBackgroundNodes = list(truth.pageBackground?.nodes);
  const pagePaintOrder = Array.isArray(truth.pagePaintOrder) ? truth.pagePaintOrder.map(unwrap).map(String) : [];

  const directoryRoots = nodes.filter(isDirectoryRoot)
    .sort((a, b) => Number(b?.box?.h || 0) - Number(a?.box?.h || 0));
  const fixedRoot = directoryRoots[0] || null;
  const fixedRootId = asPlainId(fixedRoot);
  const findNamed = (re) => nodes.find((node) => re.test(nameOf(node)) && ownedBy(node, fixedRootId))
    || nodes.find((node) => re.test(nameOf(node)))
    || null;
  const backgroundGroup = findNamed(/导航背景|nav.*(?:bg|background)|rail/i);
  const buttonFrame = findNamed(/导航按钮|nav.*(?:button|item)|btn\/导航/)
    || nodes.find((node) => node?.type === 'FRAME'
      && String(node?.layout?.layoutMode || '').toUpperCase() === 'VERTICAL'
      && ownedBy(node, fixedRootId))
    || null;
  const buttons = nodes.filter((node) => /btn\/导航|导航按钮/.test(nameOf(node))
    && (ownedBy(node, fixedRootId) || ownedBy(node, asPlainId(buttonFrame))));
  const selectedItem = nodes.find((node) => /active|selected|current/i.test(nameOf(node))
    && (ownedBy(node, fixedRootId) || ownedBy(node, asPlainId(buttonFrame)))) || null;
  const lineNodes = nodes.filter((node) => /导航长线|nav.*line|rail.*line/i.test(nameOf(node)) && ownedBy(node, fixedRootId));
  const pageBackgroundRoot = pageBackgroundNodes.find((node) => /^bg\/(?:pc|desktop)$/i.test(nameOf(node)))
    || pageBackgroundNodes.find((node) => /^bg\//.test(nameOf(node)))
    || null;

  return {
    truth,
    pageBackgroundRoot,
    pagePaintOrder,
    fixedRoot,
    backgroundGroup,
    buttonFrame,
    buttons,
    selectedItem,
    source: {
      demoDir: resolvedDemoDir,
      railAssetFile: assetFileForNode(resolvedDemoDir, backgroundGroup),
      pageBackgroundRootId: asPlainId(pageBackgroundRoot),
      fixedRootId,
      backgroundGroupId: asPlainId(backgroundGroup),
      buttonFrameId: asPlainId(buttonFrame),
      buttonIds: buttons.map(asPlainId).filter(Boolean),
      selectedItemId: asPlainId(selectedItem),
      rootBox: boxOf(fixedRoot),
      backgroundBox: boxOf(backgroundGroup),
      lineBox: unionBoxes(lineNodes),
    },
  };
}

const channelOn = (data, idx) => {
  const alpha = data[idx + 3];
  const sum = data[idx] + data[idx + 1] + data[idx + 2];
  return alpha > 20 && sum > 60;
};

const colorClose = (a, b, tolerance = 48) => Math.abs(a[0] - b[0]) <= tolerance
  && Math.abs(a[1] - b[1]) <= tolerance
  && Math.abs(a[2] - b[2]) <= tolerance
  && a[3] > 20
  && b[3] > 20;

const pixelAt = (png, x, y) => {
  const px = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const idx = (py * png.width + px) * 4;
  return {
    px,
    py,
    rgba: [png.data[idx], png.data[idx + 1], png.data[idx + 2], png.data[idx + 3]],
    on: channelOn(png.data, idx),
  };
};

export async function probeNavRailContinuity(page, source, { sampleCount = 18 } = {}) {
  const geometry = await page.evaluate(({ source, sampleCount }) => {
    const byId = (id) => id ? document.querySelector('.frame [data-node="' + CSS.escape(String(id)) + '"]') : null;
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      };
    };
    const root = byId(source.fixedRootId);
    const background = byId(source.backgroundGroupId);
    const asset = background?.querySelector?.('img.fx-img, img[data-asset-src]') || null;
    const buttonFrame = byId(source.buttonFrameId);
    const target = asset || background;
    const targetRect = rect(target);
    const backgroundRect = rect(background);
    const rootRect = rect(root);
    const frame = document.querySelector('.frame');
    const frameRect = rect(frame);
    if (!source.backgroundGroupId || !source.backgroundBox || !background || !targetRect) {
      return {
        ok: false,
        reason: 'missing-rail-background',
        source,
        dom: { root: !!root, background: !!background, buttonFrame: !!buttonFrame, target: !!target },
      };
    }
    if (!source.lineBox) {
      return {
        ok: false,
        reason: 'missing-rail-line',
        source,
        dom: { root: !!root, background: !!background, buttonFrame: !!buttonFrame, target: !!target },
      };
    }
    if (!rootRect || !frame) {
      return {
        ok: false,
        reason: 'missing-rail-dom',
        source,
        dom: {
          root: !!root,
          background: !!background,
          buttonFrame: !!buttonFrame,
          target: !!target,
        },
      };
    }
    const sourceBox = source.backgroundBox;
    const lineBox = source.lineBox;
    const railScaleX = sourceBox.w > 0 ? targetRect.width / sourceBox.w : 1;
    const railScaleY = sourceBox.h > 0 ? targetRect.height / sourceBox.h : 1;
    const lineTop = targetRect.top + (lineBox.y - sourceBox.y) * railScaleY;
    const lineBottom = targetRect.top + (lineBox.y - sourceBox.y + lineBox.h) * railScaleY;
    const lineLeft = targetRect.left + (lineBox.x - sourceBox.x) * railScaleX;
    const lineRight = targetRect.left + (lineBox.x - sourceBox.x + lineBox.w) * railScaleX;
    const sourceColumns = [0.15, 0.25, 0.4, 0.55, 0.7, 0.85].map((t) => lineBox.x - sourceBox.x + lineBox.w * t);
    const columns = sourceColumns.map((x) => targetRect.left + x * railScaleX);
    const top = Math.max(lineTop + 4, rootRect.top + 4);
    const bottom = Math.min(lineBottom - 4, rootRect.bottom - 4);
    const ys = [];
    for (let i = 0; i < sampleCount; i++) ys.push(top + ((bottom - top) * (i + 0.5)) / sampleCount);
    const samples = [];
    const rowNodes = [...document.querySelectorAll('.frame [data-motion-role="navigationFooter"] [data-nav-item]')];
    const rows = rowNodes.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, center: r.top + r.height / 2 };
    });
    const rowCenters = rows.map((row) => row.center);
    const gapMidpoints = rows.slice(1).map((row, i) => (rows[i].bottom + row.top) / 2);
    for (const y of ys) {
      samples.push({
        y: Number(y.toFixed(2)),
        pass: y >= lineTop - 1 && y <= lineBottom + 1,
        hitNode: null,
      });
    }
    const geometryOk = Math.abs(lineTop - rootRect.top) <= 4
      && Math.abs(lineBottom - rootRect.bottom) <= 4
      && rows.length >= 3
      && rowCenters.every((y) => y >= lineTop - 1 && y <= lineBottom + 1)
      && gapMidpoints.every((y) => y >= lineTop - 1 && y <= lineBottom + 1);
    const misses = geometryOk ? [] : samples.filter((sample) => !sample.pass).map((sample) => sample.y);
    const btnFrame = buttonFrame?.getBoundingClientRect();
    const labelNodes = [...document.querySelectorAll('.frame [data-motion-role="navigationFooter"] [data-nav-item] .fx-t')];
    const markerNodes = [
      ...document.querySelectorAll('.frame [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-slot"], .frame [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="item-ornament-media"], .frame [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art"], .frame [data-motion-role="navigationFooter"] [data-hero-entry-nav-kind="active-item-art-media"]'),
    ];
    return {
      ok: geometryOk,
      source,
      dom: {
        root: {
          left: Number(rootRect.left.toFixed(2)),
          top: Number(rootRect.top.toFixed(2)),
          width: Number(rootRect.width.toFixed(2)),
          height: Number(rootRect.height.toFixed(2)),
        },
        background: backgroundRect ? {
          left: Number(backgroundRect.left.toFixed(2)),
          top: Number(backgroundRect.top.toFixed(2)),
          width: Number(backgroundRect.width.toFixed(2)),
          height: Number(backgroundRect.height.toFixed(2)),
        } : null,
        target: {
          left: Number(targetRect.left.toFixed(2)),
          top: Number(targetRect.top.toFixed(2)),
          width: Number(targetRect.width.toFixed(2)),
          height: Number(targetRect.height.toFixed(2)),
        },
        railLine: {
          left: Number(lineLeft.toFixed(2)),
          right: Number(lineRight.toFixed(2)),
          top: Number(lineTop.toFixed(2)),
          bottom: Number(lineBottom.toFixed(2)),
          scaleY: Number(railScaleY.toFixed(6)),
          geometryOk,
        },
        frameOffset: frameRect ? {
          left: Number(frameRect.left.toFixed(2)),
          top: Number(frameRect.top.toFixed(2)),
        } : null,
        dpr: Number((window.devicePixelRatio || 1).toFixed(4)),
        buttonFrame: btnFrame ? {
          left: Number(btnFrame.left.toFixed(2)),
          top: Number(btnFrame.top.toFixed(2)),
          width: Number(btnFrame.width.toFixed(2)),
          height: Number(btnFrame.height.toFixed(2)),
        } : null,
        sourceColumns,
        columns: columns.map((value) => Number(value.toFixed(2))),
        samples,
        misses,
        rowCenters: rowCenters.map((value) => Number(value.toFixed(2))),
        gapMidpoints: gapMidpoints.map((value) => Number(value.toFixed(2))),
        labelCount: labelNodes.length,
        markerCount: markerNodes.length,
      },
    };
  }, { source, sampleCount });

  if (!geometry.ok && geometry.reason) return geometry;
  if (!geometry.dom?.target || !geometry.dom?.railLine) return geometry;

  const screenshot = PNG.sync.read(await page.screenshot({ fullPage: false }));
  let railPng = null;
  try {
    railPng = PNG.sync.read(readFileSync(source.railAssetFile));
  } catch (e) {
    return {
      ...geometry,
      ok: false,
      reason: 'missing-source-rail-asset',
      error: String(e && e.message || e),
    };
  }

  const dpr = geometry.dom.dpr || 1;
  const line = geometry.dom.railLine;
  const target = geometry.dom.target;
  const sourceColumns = geometry.dom.sourceColumns || [];
  const sourceYFor = (y) => {
    const f = (y - line.top) / Math.max(1, line.bottom - line.top);
    return Math.max(0, Math.min(railPng.height - 1, f * (railPng.height - 1)));
  };
  const rows = (geometry.dom.rowCenters || []).map((center, i) => {
    const rowTop = i === 0 ? null : null;
    return { center, rowTop };
  });
  const rowCenters = geometry.dom.rowCenters || [];
  const rowHalfHeight = geometry.dom.buttonFrame?.height && rowCenters.length
    ? Math.max(18, Math.min(56, geometry.dom.buttonFrame.height / rowCenters.length / 2))
    : 28;
  const rowOccludes = (y) => rowCenters.some((center) => Math.abs(center - y) <= rowHalfHeight);

  const paintedSamples = geometry.dom.samples.map((sample) => {
    const y = sample.y;
    const srcY = sourceYFor(y);
    const columns = sourceColumns.map((srcX) => {
      const x = target.left + srcX * (target.width / Math.max(1, source.backgroundBox?.w || target.width));
      const actual = pixelAt(screenshot, x * dpr, y * dpr);
      const expected = pixelAt(railPng, srcX, srcY);
      return {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        srcX,
        srcY: Number(srcY.toFixed(2)),
        px: actual.px,
        py: actual.py,
        on: actual.on,
        sourcePaint: colorClose(actual.rgba, expected.rgba),
      };
    });
    const sourcePaintHit = columns.some((col) => col.sourcePaint);
    const anyPaintHit = columns.some((col) => col.on);
    const occludedByNavRow = !sourcePaintHit && anyPaintHit && rowOccludes(y);
    const pass = sourcePaintHit || occludedByNavRow;
    return {
      ...sample,
      pass: sample.pass && pass,
      hitNode: sourcePaintHit ? String(source.backgroundGroupId || source.fixedRootId || 'rail')
        : (occludedByNavRow ? 'nav-row-over-rail' : null),
      sourcePaintHit,
      occludedByNavRow,
      columns,
    };
  });
  const paintMisses = paintedSamples.filter((sample) => !sample.pass).map((sample) => sample.y);
  const geometryOk = !!geometry.dom.railLine.geometryOk;
  return {
    ...geometry,
    ok: geometryOk && paintMisses.length === 0,
    dom: {
      ...geometry.dom,
      samples: paintedSamples,
      misses: paintMisses,
      paint: {
        screenshot: { width: screenshot.width, height: screenshot.height, dpr },
        sourceAsset: { width: railPng.width, height: railPng.height, file: source.railAssetFile },
        paintMisses,
      },
    },
  };
}
