import { readFileSync } from 'node:fs';
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

const isFixedRailRoot = (node) => String(node?.id || '') === '52:3263'
  || (node?.type === 'INSTANCE' && ownerIncludes(node, '1:180') && /导航|directory|nav/i.test(String(node?.name || '')) && Number(node?.box?.w || 0) >= 500 && Number(node?.box?.h || 0) >= 1000);

export function loadNavRailTruth(demoDir) {
  const resolvedDemoDir = resolve(demoDir);
  const truth = unwrap(JSON.parse(readFileSync(join(resolvedDemoDir, 'truth.json'), 'utf8')));
  const fixedNodes = list(truth.fixedOverlays?.nodes);
  const pageBackgroundNodes = list(truth.pageBackground?.nodes);
  const pagePaintOrder = Array.isArray(truth.pagePaintOrder) ? truth.pagePaintOrder.map(unwrap).map(String) : [];

  const fixedRoot = fixedNodes.find(isFixedRailRoot) || null;
  const fixedRootId = asPlainId(fixedRoot);
  const backgroundGroup = fixedNodes.find((node) => String(node?.id || '') === 'I52:3263;17:53006')
    || fixedNodes.find((node) => String(node?.name || '') === 'img/导航背景' && ownerIncludes(node, fixedRootId))
    || fixedNodes.find((node) => String(node?.name || '') === 'img/导航背景')
    || null;
  const buttonFrame = fixedNodes.find((node) => String(node?.id || '') === 'I52:3263;12:47248')
    || fixedNodes.find((node) => node?.type === 'FRAME'
      && String(node?.layout?.layoutMode || '').toUpperCase() === 'VERTICAL'
      && ownerIncludes(node, fixedRootId))
    || null;
  const buttons = fixedNodes.filter((node) => String(node?.name || '') === 'btn/导航按钮'
    && (ownerIncludes(node, fixedRootId) || ownerIncludes(node, asPlainId(buttonFrame))));
  const selectedItem = fixedNodes.find((node) => node?.name && /active|selected|current/i.test(String(node.name))
    && (ownerIncludes(node, fixedRootId) || ownerIncludes(node, asPlainId(buttonFrame)))) || null;
  const pageBackgroundRoot = pageBackgroundNodes.find((node) => String(node?.id || '') === '9:31452')
    || pageBackgroundNodes.find((node) => String(node?.name || '') === 'bg/pc')
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
      railAssetFile: join(resolvedDemoDir, 'assets/I52-3263-17-53006.png'),
      pageBackgroundRootId: asPlainId(pageBackgroundRoot),
      fixedRootId,
      backgroundGroupId: asPlainId(backgroundGroup),
      buttonFrameId: asPlainId(buttonFrame),
      buttonIds: buttons.map(asPlainId).filter(Boolean),
      selectedItemId: asPlainId(selectedItem),
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
    const background = byId(source.backgroundGroupId) || root;
    const asset = background?.querySelector?.('img.fx-img, img[data-asset-src]') || null;
    const buttonFrame = byId(source.buttonFrameId);
    const target = asset || background || buttonFrame || root;
    const targetRect = rect(target);
    const backgroundRect = rect(background);
    const rootRect = rect(root);
    const frame = document.querySelector('.frame');
    const frameRect = rect(frame);
    if (!targetRect || !rootRect || !frame) {
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
    const railScaleX = targetRect.width / 727;
    const railScaleY = targetRect.height / 2376;
    const lineTop = targetRect.top + 310 * railScaleY;
    const lineBottom = targetRect.top + 1976 * railScaleY;
    const lineLeft = targetRect.left + 42 * railScaleX;
    const lineRight = targetRect.left + 90 * railScaleX;
    const sourceColumns = [42, 50, 60, 70, 80, 90];
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
  const sourceColumns = geometry.dom.sourceColumns || [42, 50, 60, 70, 80, 90];
  const sourceYFor = (y) => {
    const f = (y - line.top) / Math.max(1, line.bottom - line.top);
    return Math.max(0, Math.min(railPng.height - 1, 310 + f * (1976 - 310)));
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
      const x = target.left + srcX * (target.width / 727);
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
      hitNode: sourcePaintHit ? String(source.backgroundGroupId || 'I52:3263;17:53006')
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
