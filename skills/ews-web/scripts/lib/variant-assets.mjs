/**
 * Register already-exported PNGs for cloned variant-switch trees.
 * Does not invent files; only maps sourceNodeId → existing season PNG.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngSize } from './asset-contract.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(id) {
  return String(id).replace(/[:;]/g, '-');
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function collectVariantSourceIds(model) {
  const byEnd = { pc: new Set(), mobile: new Set() };
  for (const end of ['pc', 'mobile']) {
    for (const item of asArray(model?.platforms?.[end]?.variantSwitches)) {
      for (const layer of asArray(item.layers)) {
        for (const node of asArray(layer.nodes)) {
          const id = node.sourceNodeId || node.id;
          if (id) byEnd[end].add(String(id));
          if (node.id) byEnd[end].add(String(node.id));
        }
      }
    }
  }
  return byEnd;
}

export function enrichVariantAssets(assets, model, assetRoot) {
  if (!assets?.assets || !assetRoot) return assets;
  const needed = collectVariantSourceIds(model);
  for (const end of ['pc', 'mobile']) {
    const bag = assets.assets[end] || (assets.assets[end] = {});
    for (const id of needed[end]) {
      if (bag[id]) continue;
      const file = `${compact(id)}.png`;
      const abs = join(assetRoot, end, file);
      const alt = join(assetRoot, file);
      const path = existsSync(abs) ? abs : (existsSync(alt) ? alt : null);
      if (!path) continue;
      const buf = readFileSync(path);
      const size = pngSize(buf);
      if (!size) continue;
      bag[id] = {
        path,
        sha256: sha256(buf),
        width: size.width,
        height: size.height,
      };
    }
  }
  return assets;
}
