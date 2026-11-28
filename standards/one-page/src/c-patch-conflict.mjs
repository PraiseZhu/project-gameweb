import { canonicalJson, sha256Hex } from './canonical.mjs';

const same = (left,right) => canonicalJson(left) === canonicalJson(right);
const nodeKey = ({ end,nodeId }) => JSON.stringify([end,nodeId]);
const validBox = (box) => box && ['x','y','w','h'].every((name) => Number.isFinite(box[name])) && box.w > 0 && box.h > 0;

function intersect(one,two) {
  const x = Math.max(one.x,two.x), y = Math.max(one.y,two.y);
  const w = Math.min(one.x + one.w,two.x + two.w) - x, h = Math.min(one.y + one.h,two.y + two.h) - y;
  return w > 0 && h > 0 ? { x,y,w,h } : null;
}

export function planDeltaConflicts({ prior, page, pageVersion, checkVersion, delta, decision, leaves = [], assetBase = [] }) {
  const overlaps = [];
  for (const anchor of prior) {
    for (const asset of delta.affectedAssets.filter((row) => row.end === anchor.target.end)) {
      const targets = page.nodes.filter((row) => nodeKey(row) === nodeKey(asset));
      if (targets.length !== 1 || !targets[0].module || !validBox(targets[0].designBox) || !validBox(anchor.region)) {
        throw new Error('不能定位 B4 目标与手调的物理范围，请走完整生成链');
      }
      const incoming = targets[0];
      if (incoming.module !== anchor.target.module) continue;
      const region = intersect(anchor.region,incoming.designBox);
      if (region) overlaps.push({ target:anchor.target, incoming:{ end:incoming.end,nodeId:incoming.nodeId,domId:incoming.domId,module:incoming.module },
        region, manual:anchor.fingerprint, from:assetBase.find((item) => nodeKey(item) === nodeKey(asset))?.visualFingerprint
          ?? asset.previousVisualFingerprint, to:asset.visualFingerprint });
    }
    for (const edit of leaves.filter((row) => row.end === anchor.target.end)) {
      const incoming = page.nodes.find((row) => row.domId === edit.domId && nodeKey(row) === nodeKey(edit));
      if (!incoming || !validBox(edit.fromBox) || !validBox(edit.toBox) || !validBox(anchor.region)) throw new Error('不能定位局部布局与手调范围');
      if (incoming.module !== anchor.target.module) continue;
      const regions = [intersect(anchor.region,edit.fromBox),intersect(anchor.region,edit.toBox)];
      if (regions.some(Boolean)) overlaps.push({ target:anchor.target,incoming:{ end:incoming.end,nodeId:incoming.nodeId,domId:incoming.domId,module:incoming.module },
        regions, manual:anchor.fingerprint, from:sha256Hex([edit.fromBox,edit.fromText]), to:sha256Hex([edit.toBox,edit.toText]), kind:'leaf' });
    }
  }
  const conflict = overlaps.length ? { overlaps, fingerprint:sha256Hex({ pageVersion,checkVersion,deltaVersion:delta.version,overlaps }) } : null;
  if (conflict && !decision) return { conflict };
  if ((conflict && (decision?.fingerprint !== conflict.fingerprint || !['overwrite','keep-manual'].includes(decision.choice)))
    || (!conflict && decision)) throw new Error('B4 裁决过期或未绑定跨来源冲突');
  const overlapsTarget = (row) => overlaps.some(({ target }) => nodeKey(target) === nodeKey(row));
  const result = { manualTweaks:prior.filter((anchor) => decision?.choice !== 'overwrite' || !overlapsTarget(anchor.target))
    .map(({ confirmation, ...anchor }) => anchor), kept:decision?.choice === 'keep-manual'
    ? [...new Set(overlaps.filter((row) => row.kind !== 'leaf').map(({ incoming }) => nodeKey(incoming)))].sort() : [],
    keptLeaves:decision?.choice === 'keep-manual' ? [...new Set(overlaps.filter((row) => row.kind === 'leaf').map(({ incoming }) => incoming.domId))].sort() : [] };
  return { ...result, ...(decision ? { conflict,decision } : {}) };
}

export function verifyDeltaConflicts(page, delta, material, manifest) {
  const manual = material.manual;
  if (!manual) return { manualTweaks:[], revised:material.assets, retained:[] };
  const { prior, plan, leaves = [], assetBase = [] } = manual;
  const expected = planDeltaConflicts({ prior,page,pageVersion:material.base.pageVersion,checkVersion:material.base.checkVersion,
    delta,decision:plan.decision,leaves,assetBase });
  if (!same(plan,expected) || !plan.manualTweaks.every((row) => page.nodes.some((node) => node.domId === row.target.domId
    && node.module === row.target.module && nodeKey(node) === nodeKey(row.target) && same(node.designBox,row.region)))) {
    throw new Error('B4 跨来源冲突追溯不符');
  }
  if (!same(material.leaves ?? [],leaves.filter((row) => !plan.keptLeaves.includes(row.domId)))
    || !leaves.filter((row) => plan.keptLeaves.includes(row.domId)).every((retained) => page.nodes.some((row) => row.domId === retained.domId
      && row.text === retained.fromText && same(row.designBox,retained.fromBox)))) throw new Error('B4 保留微调未保留旧版文案或布局');
  for (const key of plan.kept) {
    const existing = manifest.assets.filter((row) => nodeKey(row) === key);
    const old = assetBase.find((asset) => nodeKey(asset) === key);
    if (existing.length !== 1 || existing[0].visualFingerprint !== old?.visualFingerprint || existing[0].sha256 !== old?.sha256) {
      throw new Error('保留微调未保留当前基线素材');
    }
  }
  return { manualTweaks:plan.manualTweaks, revised:material.assets.filter((asset) => !plan.kept.includes(nodeKey(asset))),
    retained:manifest.assets.filter((asset) => plan.kept.includes(nodeKey(asset))) };
}
