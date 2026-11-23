import { MOTIONS } from '../../figma-naming/tool/src/onepage/compile.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
  ancestorsOf,
  identityBindingKey,
} from './inventory-walk.mjs';

/** 标准已定的分层组合：父规则 → 可嵌套的子规则。与编译器 MOTION_COMPOSITION 白名单保持一致。 */
export const NESTED_STANDARD = Object.freeze({
  'section-fade': Object.freeze(['section-title', 'content-left', 'cards-center', 'foreground-crystal', 'carousel-track', 'menu-fade']),
  'first-screen': Object.freeze(['foreground-crystal', 'content-left', 'cards-center', 'carousel-track', 'menu-fade']),
  'carousel-track': Object.freeze(['content-left', 'cards-center']),
});

function motionEntry(rule, extra = {}) {
  const spec = MOTIONS[rule];
  return {
    rule,
    unit: extra.unit ?? (spec.units.includes('whole') ? 'whole' : spec.units[0]),
    trigger: extra.trigger ?? spec.triggers[0],
    source: `one-page MOTIONS ${spec.standard}`,
    ...extra,
  };
}

function uniqueMotionKey(rule, node) {
  return `${rule}-${node.role}-${String(node.label || node.id).replace(/\s+/g, '')}`.slice(0, 80);
}

function childItems(node, inv) {
  return productNodes(inv).filter((child) => child.parentId === node.id && child.role === 'item');
}

function skipCoveredItem(node, byId, chosen) {
  if (node.role !== 'item') return false;
  return ancestorsOf(node, byId).some((anc) => {
    const hit = chosen.get(anc.id);
    return hit && (hit.rule === 'content-left' || hit.rule === 'cards-center');
  });
}

function candidatesOf(node, end, byId, inv) {
  const secNum = sectionNumberOf(node, byId);
  const found = [];
  if (node.role === 'sec') {
    found.push({ rule: 'section-fade', unit: 'whole', trigger: 'section-change' });
    if (secNum === 1) found.push({ rule: 'first-screen', unit: 'whole', trigger: 'first-enter' });
  }
  if (node.role === 'title' && secNum !== 1) {
    const insideModule = ancestorsOf(node, byId).some((anc) => ['grp', 'list', 'item'].includes(anc.role));
    if (!insideModule) found.push({ rule: 'section-title', unit: 'whole', trigger: 'section-enter' });
  }
  if (node.role === 'grp' && secNum === 1 && node.part !== 'foreground') {
    found.push({ rule: 'first-screen', unit: 'whole', trigger: 'first-enter' });
  }
  if (['grp', 'list', 'item'].includes(node.role) && node.part !== 'foreground') {
    const trigger = ancestorsOf(node, byId).some((anc) => anc.role === 'switch') ? 'page-change' : 'section-enter';
    found.push({ rule: 'content-left', unit: 'whole', trigger });
  }
  if (node.role === 'list') {
    const items = childItems(node, inv);
    if (items.length >= 1 && items.length <= 4 && (end === 'pc' || end === 'mobile')) {
      const trigger = ancestorsOf(node, byId).some((anc) => anc.role === 'switch') ? 'page-change' : 'section-enter';
      found.push({
        rule: 'cards-center', unit: 'items', trigger, device: end, count: items.length,
      });
    }
  }
  if (['img', 'grp', 'kv'].includes(node.role) && node.part === 'foreground') {
    found.push({ rule: 'foreground-crystal', unit: 'whole', trigger: 'section-enter' });
  }
  if (node.role === 'switch') found.push({ rule: 'carousel-track', unit: 'whole', trigger: 'page-change' });
  if (node.role === 'modal' || node.role === 'dropmenu') {
    found.push({ rule: 'menu-fade', unit: 'whole', trigger: 'open-close' });
  }
  return found.filter((row) => MOTIONS[row.rule]?.roles.includes(node.role));
}

function pickUnique(node, matches) {
  if (node.part === 'foreground') {
    const crystal = matches.filter((row) => row.rule === 'foreground-crystal');
    if (crystal.length === 1 && matches.length > 1) {
      return { skip: { reason: `同一对象匹配多类：${matches.map((row) => row.rule).join(', ')}` } };
    }
    if (crystal.length === 1) return { pick: crystal[0], needDirection: true };
  }
  if (matches.length === 1) return { pick: matches[0] };
  const listCenter = matches.find((row) => row.rule === 'cards-center');
  const content = matches.find((row) => row.rule === 'content-left');
  if (node.role === 'list' && listCenter && content && matches.length === 2) {
    return { pick: listCenter };
  }
  const first = matches.find((row) => row.rule === 'first-screen');
  const fade = matches.find((row) => row.rule === 'section-fade');
  if (node.role === 'sec' && first && fade && matches.length === 2) {
    return { pick: first };
  }
  if (matches.length === 0) return { pick: null };
  return { skip: { reason: `同一对象匹配多类：${matches.map((row) => row.rule).join(', ')}` } };
}

function nestedOk(parentRule, childRule) {
  return (NESTED_STANDARD[parentRule] || []).includes(childRule);
}

/** 按 MOTIONS 对象类型自动套用。识别不唯一或组合未定的进 skipped，不硬套。 */
export function autoMotions(inventories, existing = {}) {
  const motions = { ...(existing.motions || {}) };
  const bindings = { ...(existing.bindings || {}) };
  const applied = [];
  const skipped = [];
  const chosen = new Map();

  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      if (node.motion || node.params?.motion) continue;
      const matches = candidatesOf(node, end, byId, inv);
      if (!matches.length) continue;
      const decided = pickUnique(node, matches);
      const section = sectionNumberOf(node, byId);
      const object = `${node.role}/${node.label}`;
      if (decided.skip) {
        skipped.push({
          kind: 'motion-skipped',
          blocking: false,
          end,
          section,
          nodeId: node.id,
          object,
          reason: decided.skip.reason,
          message: `动效未套用：${object}；${decided.skip.reason}；屏 ${section ?? '无'}`,
        });
        continue;
      }
      if (!decided.pick) continue;
      if (decided.needDirection) {
        skipped.push({
          kind: 'motion-skipped',
          blocking: false,
          end,
          section,
          nodeId: node.id,
          object,
          reason: '前景缺 direction',
          message: `动效未套用：${object}；前景缺 direction；屏 ${section ?? '无'}`,
        });
        continue;
      }
      if (skipCoveredItem(node, byId, chosen)) continue;
      chosen.set(node.id, {
        ...decided.pick, end, node, section, object, byId,
      });
    }
  }

  for (const [id, row] of chosen) {
    const parentChosen = ancestorsOf(row.node, row.byId)
      .map((anc) => chosen.get(anc.id))
      .filter(Boolean);
    const extra = { unit: row.unit, trigger: row.trigger };
    if (row.device) extra.device = row.device;
    if (row.count) extra.count = row.count;
    if (parentChosen.length) {
      const bad = parentChosen.find((parent) => !nestedOk(parent.rule, row.rule));
      if (bad) {
        skipped.push({
          kind: 'motion-skipped',
          blocking: false,
          end: row.end,
          section: row.section,
          nodeId: id,
          object: row.object,
          reason: `未定组合 ${bad.rule}+${row.rule}`,
          message: `动效未套用：${row.object}；未定组合 ${bad.rule}+${row.rule}；屏 ${row.section ?? '无'}`,
        });
        chosen.delete(id);
        continue;
      }
      extra.composition = 'nested-standard';
    }
    const ref = identityBindingKey(row.node, { split: true }) || identityBindingKey(row.node);
    if (bindings[ref]?.motion) continue;
    const key = uniqueMotionKey(row.rule, row.node);
    if (!motions[key]) motions[key] = motionEntry(row.rule, extra);
    bindings[ref] = { ...(bindings[ref] || {}), motion: key };
    applied.push({ end: row.end, ref, rule: row.rule, key, composition: extra.composition ?? null });
  }

  return { motions, bindings, applied, skipped };
}
