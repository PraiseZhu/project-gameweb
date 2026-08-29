/**
 * Generic interaction bridge derived from Figma truth.
 *
 * This module intentionally contains no page IDs, CSS selectors, or product
 * labels. It only consumes source-backed node names/properties and owner
 * ancestry, returning evidence attributes for a renderer to attach.
 */
import { deriveRole, parseLayerName } from './figma-name-semantics.mjs';
import { attachButtonPressAttrs } from './figma-button-press-contract.mjs';

const STRUCTURAL = new Set(['sec', 'fix', 'switch', 'swpage', 'switch-page', 'tab', 'ind', 'scroll', 'mix']);
const SWITCH_PAGE_CONTAINER_TYPES = new Set(['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT', 'COMPONENT_SET']);
const SWITCH_CONTROL_ROLES = new Set(['tab', 'ind', 'btn', 'hot']);
const SWITCH_PAGE_ROLES = new Set(['switch-page', 'swpage']);
const asId = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
const idOf = (n) => asId(n?.id == null ? null : n.id);
const str = (v) => (v == null ? '' : String(asId(v)));
const plain = (value) => {
  if (value && typeof value === 'object' && 'value' in value && 'provenance' in value) return value.value;
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, plain(v)]));
  return value;
};
const plainNode = (n) => ({ ...plain(n), id: asId(n?.id), type: asId(n?.type), name: asId(n?.name), clipsContent: asId(n?.clipsContent) });

function ancestorsOf(node) {
  const names = Array.isArray(node?.ancestorNames) ? node.ancestorNames.map(str) : [];
  return names;
}

function hasAncestorRole(node, role, byId) {
  if (ancestorsOf(node).some((name) => parseLayerName(name).role === role)) return true;
  const path = Array.isArray(node?.ownerPath) ? node.ownerPath.map(asId) : [];
  for (let i = path.length - 2; i >= 0; i--) {
    if (deriveRole(byId?.get(String(path[i])) || {}).role === role) return true;
  }
  let current = node;
  for (let guard = 0; guard < 12 && current; guard++) {
    current = byId?.get(String(asId(current.parentId)));
    if (deriveRole(current || {}).role === role) return true;
  }
  return false;
}

function dropmenuAxisValues(node) {
  return Object.values(dropmenuPropertyMap(node));
}

function parseVariantPairs(name) {
  const pairs = {};
  for (const part of String(name || '').split(',')) {
    const cut = part.indexOf('=');
    if (cut <= 0) continue;
    const key = part.slice(0, cut).trim();
    const val = part.slice(cut + 1).trim();
    if (key) pairs[key] = val;
  }
  return pairs;
}

function dropmenuPropertyMap(node) {
  const props = plain(node?.componentProperties || node?.properties || {});
  const out = {};
  for (const [key, item] of Object.entries(props || {})) {
    const value = item && typeof item === 'object' && item && 'value' in item ? item.value : item;
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/* A9: axis name is unlocked. Only the axis whose unique values are exactly
   {on,off} counts. Lang=en and other axes must not make the menu invalid. */
function dropmenuAxisName(variants, nameOf = (variant) => variant?.name) {
  const byAxis = new Map();
  for (const variant of variants || []) {
    const pairs = parseVariantPairs(nameOf(variant));
    for (const [key, val] of Object.entries(pairs)) {
      if (!byAxis.has(key)) byAxis.set(key, new Set());
      byAxis.get(key).add(val);
    }
  }
  const matches = [];
  for (const [key, values] of byAxis) {
    if (values.size === 2 && values.has('on') && values.has('off')) matches.push(key);
  }
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  const tokens = (variants || []).map((variant) => {
    const raw = String(nameOf(variant) || '').trim();
    const values = Object.values(parseVariantPairs(raw));
    if (values.length === 1) return values[0];
    if (raw === 'on' || raw === 'off') return raw;
    return null;
  });
  const unique = [...new Set(tokens)];
  return unique.length === 2 && unique.includes('on') && unique.includes('off') && !unique.includes(null)
    ? '*'
    : null;
}

function dropmenuCurrentState(node) {
  const graph = plain(node?.componentVariantGraph);
  const variants = Array.isArray(graph?.variants) ? graph.variants : [];
  const axis = dropmenuAxisName(variants);
  if (!axis) return 'invalid';
  const props = dropmenuPropertyMap(node);
  if (axis !== '*' && Object.prototype.hasOwnProperty.call(props, axis)) {
    const current = props[axis];
    return current === 'on' || current === 'off' ? current : 'invalid';
  }
  if (axis === '*') {
    const onOff = Object.entries(props).filter(([, value]) => value === 'on' || value === 'off');
    if (onOff.length === 1) return onOff[0][1];
  }
  return 'invalid';
}

function componentState(node) {
  const rawValues = dropmenuAxisValues(node);
  if (interactionRole(node) === 'dropmenu') return dropmenuCurrentState(node);
  const values = rawValues.map((value) => value.toLowerCase());
  if (!values.length) return null;
  if (values.some((value) => /^(disabled?|disable|unavailable|off)$/.test(value))) return 'disabled';
  if (values.some((value) => /^(active|highlight|selected|on)$/.test(value))) return 'active';
  if (values.some((value) => /^(normal|default|inactive)$/.test(value))) return 'normal';
  return 'other';
}

function variantGraph(node) {
  const graph = plain(node?.componentVariantGraph);
  const variants = Array.isArray(graph?.variants) ? graph.variants.filter((variant) => variant?.componentId) : [];
  if (variants.length < 2) return null;
  const variantInteractions = variants.map((variant) => variant?.interactions).filter((x) => x !== undefined);
  const hasExplicitEmptyMotion = variantInteractions.length === variants.length
    && variantInteractions.every((interactions) => Array.isArray(interactions) && interactions.length === 0);
  return {
    componentSetId: graph.componentSetId,
    variants,
    transition: 'immediate',
    motionEvidence: hasExplicitEmptyMotion ? 'explicit-empty' : 'unavailable',
  };
}

function interactionRole(node) {
  const derived = deriveRole(node, { legacy: true });
  return derived.role;
}

function explicitTarget(node, parsed) {
  const props = node?.componentProperties || node?.properties || {};
  const candidates = [
    parsed?.params?.target, parsed?.params?.sec, parsed?.params?.section,
    parsed?.params?.to, parsed?.params?.dest,
    props.target, props.sec, props.section, props.destination, props.to,
  ];
  for (const value of candidates) {
    const v = typeof value === 'object' && value && 'value' in value ? value.value : value;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function ownerSwitch(node, byId) {
  const path = Array.isArray(node?.ownerPath) ? node.ownerPath.map(asId) : [];
  for (let i = path.length - 2; i >= 0; i--) {
    const owner = byId.get(String(path[i]));
    if (owner && interactionRole(owner) === 'switch') return owner;
  }
  let current = node;
  for (let guard = 0; guard < 12 && current; guard++) {
    const pid = asId(current.parentId);
    if (pid == null) break;
    const sibling = [...byId.values()].find((candidate) => String(asId(candidate.parentId)) === String(pid)
      && interactionRole(candidate) === 'switch');
    if (sibling) return sibling;
    current = byId.get(String(pid));
  }
  const names = ancestorsOf(node);
  for (let i = names.length - 1; i >= 0; i--) {
    const parsed = parseLayerName(names[i]);
    if (parsed.role === 'switch') return { id: names[i], name: names[i] };
  }
  /* Directional arrows sometimes sit beside a switch below a shared section
     owner instead of below the switch itself. They may use the closest unique
     component-set graph only when source owner paths share a region. A tie
     stays unresolved; this is not a section-name or page-selector fallback. */
  if (/\b(prev|previous|next|left|right)\b/i.test(str(node?.name))) {
    const currentPath = Array.isArray(node?.ownerPath) ? node.ownerPath.map(asId).map(String) : [];
    const candidates = [...byId.values()]
      .filter((candidate) => interactionRole(candidate) === 'switch' && variantGraph(candidate))
      .map((candidate) => {
        const candidatePath = Array.isArray(candidate?.ownerPath) ? candidate.ownerPath.map(asId).map(String) : [];
        let common = 0;
        while (common < currentPath.length && common < candidatePath.length && currentPath[common] === candidatePath[common]) common++;
        return { candidate, common };
      })
      .filter(({ common }) => common > 0);
    const maxCommon = Math.max(0, ...candidates.map(({ common }) => common));
    const best = candidates.filter(({ common }) => common === maxCommon);
    if (best.length === 1) return best[0].candidate;
  }
  return null;
}

function groupedIndex(node, siblings) {
  const role = deriveRole(node, { legacy: true }).role;
  const same = siblings.filter((n) => deriveRole(n, { legacy: true }).role === role);
  const index = same.findIndex((n) => String(idOf(n)) === String(idOf(node)));
  return index >= 0 ? index : null;
}

function nearestAncestorId(node, role, byId) {
  const path = Array.isArray(node?.ownerPath) ? node.ownerPath.map(asId) : [];
  for (let i = path.length - 2; i >= 0; i--) {
    const owner = byId.get(String(path[i]));
    if (owner && interactionRole(owner) === role) return String(idOf(owner));
  }
  let current = node;
  for (let guard = 0; guard < 12 && current; guard++) {
    const parent = byId.get(String(asId(current.parentId)));
    if (!parent) break;
    if (interactionRole(parent) === role) return String(idOf(parent));
    current = parent;
  }
  return null;
}

function variantControlFamily(node, entry, byId) {
  if (!['active', 'normal'].includes(entry.controlState)) return null;
  if (entry.role === 'ind') return `ind:${String(asId(node.parentId) ?? '')}`;
  if (entry.role === 'tab') return `tab:${String(asId(node.parentId) ?? '')}`;
  if (entry.role === 'btn') {
    const tab = nearestAncestorId(node, 'tab', byId);
    return tab ? `tab-button:${tab}` : null;
  }
  return null;
}

function standaloneButtonVariantGraph(node) {
  const graph = variantGraph(node);
  if (!graph) return null;
  const names = graph.variants.map((variant) => String(variant.name || '').toLowerCase());
  const hasNormal = names.some((name) => /(^|[=\s])normal(\b|$)/.test(name));
  const hasHighlight = names.some((name) => /(^|[=\s])highlight(\b|$)/.test(name));
  if (!hasNormal || !hasHighlight) return null;
  return graph;
}

function dropmenuVariantGraph(node) {
  const graph = variantGraph(node);
  if (!graph) return null;
  return dropmenuAxisName(graph.variants) ? graph : null;
}

function directChildrenOf(owner, list) {
  const ownerId = String(idOf(owner));
  return list.filter((candidate) => String(asId(candidate.parentId)) === ownerId);
}

function hasRenderablePageCandidate(node) {
  const role = interactionRole(node);
  if (['tab', 'ind', 'btn', 'hot', 'scroll', 'switch', 'sec', 'fix', 'ref'].includes(role)) return false;
  const type = String(node?.type || '').toUpperCase();
  return ['FRAME', 'GROUP', 'COMPONENT', 'INSTANCE'].includes(type);
}

function sourceBackedSwitchPages(switchNode, members, list) {
  const legacyPages = members.filter(({ entry }) => entry.role === 'swpage');
  if (legacyPages.length > 0) {
    for (const member of legacyPages) member.entry.pageSource = 'legacy-swpage-prefix';
    return { pages: legacyPages, source: 'legacy-swpage-prefix', unresolved: null };
  }
  const children = directChildrenOf(switchNode, list);
  const candidates = children
    .filter(hasRenderablePageCandidate)
    .sort((a, b) => {
      const ak = Array.isArray(a.orderKey) ? a.orderKey.join('.') : '';
      const bk = Array.isArray(b.orderKey) ? b.orderKey.join('.') : '';
      return ak.localeCompare(bk) || String(idOf(a)).localeCompare(String(idOf(b)));
    });
  if (candidates.length < 2) {
    return { pages: [], source: 'direct-children', unresolved: 'switch direct children do not provide at least two source-backed page candidates' };
  }
  const pageMembers = [];
  for (const child of candidates) {
    const existing = members.find(({ entry }) => entry.id === String(idOf(child)));
    const entry = existing?.entry || {
      id: String(idOf(child)),
      name: str(child.name),
      role: 'switch-page',
      evidence: 'truth:source-direct-child',
      switchId: String(idOf(switchNode)),
    };
    entry.role = 'switch-page';
    entry.switchId = String(idOf(switchNode));
    entry.pageSource = 'switch-direct-child';
    pageMembers.push({ node: child, entry });
  }
  return { pages: pageMembers, source: 'switch-direct-child', unresolved: null };
}

/* A Figma scroll viewport commonly has one direct content track. Counting
 * direct children alone therefore rejects valid structures such as a calendar
 * track or reward row. The authorization is still fail-closed: it needs the
 * source clip plus a direct child whose source geometry actually crosses the
 * horizontal viewport bounds.
 *
 * Named `scroll/` is the explicit host. A `mix/` clip, including
 * `mix/calendar`, stays draw-only even when a child overflows; product
 * names are not interaction evidence. A random clipsContent frame is not
 * a host either. */
function overflowBox(node) {
  const box = plain(node?.box || node?.absoluteBoundingBox || {});
  const x = Number(box?.x);
  const w = Number(box?.w ?? box?.width);
  if (!Number.isFinite(x) || !Number.isFinite(w) || w <= 0) return null;
  return { x, w, right: x + w };
}

function childCrossesViewport(child, viewport) {
  const box = overflowBox(child);
  return !!(box && (box.x < viewport.x - 0.5 || box.right > viewport.right + 0.5));
}

function overflowingDirectChildren(node, children) {
  if (node?.clipsContent !== true) return [];
  const viewport = overflowBox(node);
  if (!viewport) return [];
  return children.filter((child) => childCrossesViewport(child, viewport));
}

function isCalendarMix(node, parsed = parseLayerName(node?.name)) {
  if (parsed?.role !== 'mix') return false;
  return /^(?:calendar|日历)$/i.test(str(parsed.label || ''));
}

function hscrollHost(node, children, parsed) {
  const namedScroll = parsed.role === 'scroll' || interactionRole(node) === 'scroll';
  const calendarMix = isCalendarMix(node, parsed);
  if (!namedScroll && !calendarMix) return null;
  const overflowing = overflowingDirectChildren(node, children);
  if (!overflowing.length) return null;
  return {
    axis: parsed.params.axis || 'x',
    pointer: true,
    drag: true,
    evidence: namedScroll
      ? 'source-clip-and-child-geometry-overflow'
      : 'calendar-mix-clip-and-child-geometry-overflow',
    overflowing,
  };
}

function isTodayDateDyn(node, parsed = parseLayerName(node?.name)) {
  if (parsed?.role !== 'dyn') return false;
  return /今日日期|today\s*date|current\s*date/i.test(str(parsed.label || node?.name || ''));
}

function isHscrollCommand(node) {
  const label = str(node?.name).toLowerCase();
  if (/\bprev(?:ious)?\b|\bleft\b|上一|左划|左滑|左滑动/.test(label)) return 'prev';
  if (/\bnext\b|\bright\b|下一|右划|右滑|右滑动/.test(label)) return 'next';
  return null;
}

function nearestHscrollAncestor(node, hostsById, byId) {
  let current = node;
  for (let guard = 0; guard < 12 && current; guard++) {
    current = byId.get(String(asId(current.parentId)));
    if (!current) break;
    const host = hostsById.get(String(idOf(current)));
    if (host) return host;
  }
  return null;
}

function siblingHscrollHost(node, hostsById, byId) {
  const parentId = asId(node?.parentId);
  if (parentId == null) return null;
  const siblings = [...hostsById.values()].filter((host) => {
    const hostNode = byId.get(String(host.id));
    return hostNode && String(asId(hostNode.parentId)) === String(parentId);
  });
  return siblings.length === 1 ? siblings[0] : null;
}

/**
 * Build a source-backed interaction model. Missing owner/index evidence is
 * reported as unresolved instead of guessed, making the bridge fail-closed.
 */
export function deriveInteractionModel(nodes = []) {
  const list = (Array.isArray(nodes) ? nodes : Object.values(nodes || {})).map(plainNode);
  const byId = new Map(list.map((n) => [String(idOf(n)), n]));
  const components = [];
  const unresolved = [];
  const bySwitch = new Map();

  for (const node of list) {
    const id = idOf(node);
    if (id == null) continue;
    const parsed = parseLayerName(node.name);
    const role = interactionRole(node);
    const entry = { id: String(id), name: str(node.name), role, evidence: 'truth:name-or-type' };
    const state = componentState(node);
    if (state) entry.controlState = state;
    const graph = role === 'switch' ? variantGraph(node) : null;
    if (graph) {
      entry.variantGraph = {
        componentSetId: graph.componentSetId,
        variants: graph.variants.length,
        pageSource: 'component-set-variant',
        transition: graph.transition,
        motionEvidence: graph.motionEvidence,
      };
    }

    if (role === 'sec') {
      const target = explicitTarget(node, parsed);
      if (target) entry.secTarget = target;
    }
    if (role === 'fix') {
      const fromRaw = parsed.params.from ?? node.from;
      if (fromRaw != null && fromRaw !== '' && fromRaw !== true) {
        if (/^[1-9]\d*$/.test(String(fromRaw))) entry.fixFrom = Number(fromRaw);
        else unresolved.push({ id: String(id), role, reason: 'fix @from must be a positive integer section number' });
      }
    }
    if (role === 'scroll' || isCalendarMix(node, parsed)) {
      const children = list.filter((candidate) => String(asId(candidate.parentId)) === String(id));
      const host = hscrollHost(node, children, parsed);
      if (host) {
        const { overflowing, ...hscroll } = host;
        entry.hscroll = hscroll;
        entry.hscrollSurfaceIds = overflowing.map((child) => String(idOf(child))).filter(Boolean);
      } else if (role === 'scroll') {
        unresolved.push({ id: String(id), role, reason: 'hscroll requires source clipsContent and direct child geometry overflow' });
      }
    }
    if (isTodayDateDyn(node, parsed)) {
      entry.calendarNow = {
        states: ['today', 'return-today'],
        initial: 'today',
        evidence: 'dyn-today-date-runtime-swap',
      };
    }
    if (role === 'switch' || role === 'swpage' || role === 'tab' || role === 'ind' || role === 'btn') {
      const owner = role === 'switch' ? node : ownerSwitch(node, byId);
      const ownerId = owner && idOf(owner);
      if (ownerId != null) {
        const key = String(ownerId);
        if (!bySwitch.has(key)) bySwitch.set(key, []);
        if (role === 'swpage') entry.evidence = 'truth:legacy-swpage-prefix';
        bySwitch.get(key).push({ node, entry });
        entry.switchId = key;
      } else if (role === 'btn') {
        /* Independent btn/ controls are not switch pages. A COMPONENT_SET that
           actually contains Property 1=normal and Property 1=highlight is a
           source-backed instance replacement. Missing those two states stays
           draw-only; it is not a missing switch owner. disable remains inert. */
        const stateGraph = standaloneButtonVariantGraph(node);
        if (stateGraph && entry.controlState !== 'disabled') {
          entry.buttonVariant = {
            componentSetId: stateGraph.componentSetId,
            group: String(asId(node.parentId) ?? id),
            state: entry.controlState === 'active' ? 'highlight' : 'normal',
            transition: 'immediate',
          };
        }
      } else if (role !== 'switch') {
        unresolved.push({ id: String(id), role, reason: 'missing switch ownerPath' });
      }
    }
    if (role === 'dropmenu') {
      if (entry.controlState === 'invalid') {
        unresolved.push({ id: String(id), role, reason: 'dropmenu axis must be exact lowercase on/off' });
      } else {
        const menuGraph = dropmenuVariantGraph(node);
        entry.dropmenu = {
          state: entry.controlState === 'on' ? 'on' : 'off',
          componentSetId: menuGraph?.componentSetId || null,
        };
      }
    }
    const target = explicitTarget(node, parsed);
    if (target && (role === 'tab' || role === 'btn' || role === 'hot' || role === 'sec')) entry.secTarget = target;
    if ((STRUCTURAL.has(role) && !(role === 'scroll' && !entry.hscroll) && !(role === 'mix' && !entry.hscroll))
      || role === 'btn'
      || role === 'hot'
      || role === 'dropmenu'
      || entry.calendarNow
      || target) components.push(entry);
  }

  const hostsById = new Map(components.filter((entry) => entry.hscroll).map((entry) => [entry.id, entry]));
  for (const entry of components) {
    if (entry.role !== 'btn' || entry.switchId) continue;
    const node = byId.get(entry.id);
    if (!node) continue;
    const command = isHscrollCommand(node);
    if (!command) continue;
    const host = nearestHscrollAncestor(node, hostsById, byId) || siblingHscrollHost(node, hostsById, byId);
    if (!host) continue;
    entry.hscrollHostId = String(host.id);
    entry.hscrollAction = command;
    entry.evidence = 'truth:hscroll-command-beside-clipped-overflow';
  }

  for (const [switchId, members] of bySwitch) {
    const switchMember = members.find(({ entry }) => entry.role === 'switch');
    const pageResult = switchMember ? sourceBackedSwitchPages(switchMember.node, members, list) : { pages: [], source: 'missing-switch', unresolved: 'missing switch owner' };
    const pages = pageResult.pages;
    for (const page of pages) {
      if (!components.some((entry) => entry.id === page.entry.id)) components.push(page.entry);
      if (!members.some(({ entry }) => entry.id === page.entry.id)) members.push(page);
    }
    const tabs = members.filter(({ entry }) => entry.role === 'tab');
    const inds = members.filter(({ entry }) => entry.role === 'ind');
    const graph = variantGraph(switchMember?.node);
    const controlPageMismatch = pages.length > 0 && pageResult.source === 'switch-direct-child' && !graph
      && ((tabs.length > 0 && tabs.length !== pages.length) || (inds.length > 0 && inds.length !== pages.length));
    if (controlPageMismatch) {
      unresolved.push({
        id: switchId,
        role: 'switch',
        reason: 'switch direct-child pages require complete tab/indicator mapping when controls exist (pages=' + pages.length + ', tabs=' + tabs.length + ', indicators=' + inds.length + ')',
      });
      for (const page of pages) {
        page.entry.swpage = null;
        page.entry.switchId = null;
        page.entry.pageSource = 'switch-direct-child-unresolved';
      }
      continue;
    }
    const indexFor = (entry, set) => {
      const idx = set.findIndex(({ entry: e }) => e.id === entry.id);
      return idx >= 0 ? idx : null;
    };
    for (const { entry } of members) {
      /* A button is an operation, not a selectable page. Giving prev/next
         their own indexes mixed command order into the shared state and let
         an arrow select an impossible page. Only source-backed selectable
         families receive an index, each in its own sibling order. */
      const index = SWITCH_PAGE_ROLES.has(entry.role) ? indexFor(entry, pages)
        : entry.role === 'tab' ? indexFor(entry, tabs)
          : entry.role === 'ind' ? indexFor(entry, inds) : null;
      if (index != null) entry.swpage = index;
    }
    /* Component-set variants are a valid mutually exclusive page graph even
       when the selected INSTANCE expands only one state. A controller may be
       wired only if every selectable control has an explicit source state,
       disabled controls are excluded, and source order gives a complete 1:1
       pairing. This produces a state-replacement contract only: no track,
       slide, duration, or easing is implied by static Figma variants. */
    if (pages.length === 0 && graph) {
      const families = new Map();
      for (const member of members) {
        const family = variantControlFamily(member.node, member.entry, byId);
        if (!family) continue;
        if (!families.has(family)) families.set(family, []);
        families.get(family).push(member);
      }
      const completeFamilies = [...families.values()].filter((controls) => controls.length === graph.variants.length
        && controls.filter(({ entry }) => entry.controlState === 'active').length === 1);
      if (completeFamilies.length === 1) {
        const selectable = completeFamilies[0];
        for (const [index, { entry }] of selectable.entries()) {
          entry.variantIndex = index;
          entry.pageSource = 'component-set-variant';
          entry.transition = 'immediate';
        }
        switchMember.entry.variantGraph = {
          ...switchMember.entry.variantGraph,
          selectableControls: selectable.length,
          disabledControls: members.filter(({ entry }) => entry.controlState === 'disabled').length,
          controlMapping: 'complete-source-order',
        };
      } else {
        unresolved.push({
          id: switchId,
          role: 'switch',
          reason: `component-set variant graph has ${graph.variants.length} variants but lacks a complete explicit-state control mapping`,
        });
      }
    } else if (pages.length === 0 && (tabs.length || inds.length)) {
      unresolved.push({ id: switchId, role: 'switch', reason: pageResult.unresolved || 'switch has controls but no source-backed page candidates' });
    }
  }

  const overflowChildIds = new Set(
    components.flatMap((entry) => Array.isArray(entry.hscrollSurfaceIds) ? entry.hscrollSurfaceIds : []),
  );
  const attributes = [];
  for (const entry of components) {
    const attrs = { 'data-node': entry.id };
    if (overflowChildIds.has(String(entry.id)) && !entry.hscroll) {
      attrs['data-hscroll-overflow-child'] = 'true';
    }
    if (entry.secTarget) attrs['data-sec-target'] = entry.secTarget;
    if (entry.switchId) attrs['data-switch'] = entry.switchId;
    if (entry.swpage != null) attrs['data-swpage'] = String(entry.swpage);
    /* Variant graph discovery is evidence-only in this phase. Deliberately do
       not emit data-swpage here: the renderer has not been authorized to
       materialize alternate component trees yet. */
    if (entry.hscroll) {
      attrs['data-hscroll'] = entry.hscroll.axis;
      attrs['data-hscroll-pointer'] = 'true';
      attrs['data-hscroll-drag'] = 'true';
    }
    if (entry.hscrollHostId && entry.hscrollAction) {
      attrs['data-hscroll-host'] = entry.hscrollHostId;
      attrs['data-hscroll-action'] = entry.hscrollAction;
    }
    if (entry.calendarNow) {
      attrs['data-calendar-now'] = 'true';
      attrs['data-calendar-now-state'] = entry.calendarNow.initial;
      attrs['data-calendar-now-evidence'] = entry.calendarNow.evidence;
      if (entry.calendarNow.initial !== 'return-today') attrs['data-btn-press'] = 'inert';
    }
    if ((entry.role === 'tab' || (entry.role === 'btn' && entry.variantIndex != null && entry.role !== 'ind')) && entry.switchId) attrs['data-tab'] = 'true';
    if (entry.role === 'ind' && entry.switchId) attrs['data-indicator'] = 'true';
    if (entry.role === 'btn' && entry.switchId) {
      const label = String(entry.name || '').toLowerCase();
      if (/\bprev(?:ious)?\b|\bleft\b|上一|左划|左滑|左滑动/.test(label)) attrs['data-switch-action'] = 'prev';
      else if (/\bnext\b|\bright\b|下一|右划|右滑|右滑动/.test(label)) attrs['data-switch-action'] = 'next';
    }
    if (entry.buttonVariant) {
      attrs['data-btn-variant'] = 'true';
      attrs['data-btn-variant-state'] = entry.buttonVariant.state;
      attrs['data-btn-variant-set'] = entry.buttonVariant.componentSetId;
      attrs['data-btn-variant-group'] = entry.buttonVariant.group;
    }
    if (entry.role === 'dropmenu') {
      attrs['data-dropmenu'] = 'true';
      attrs['data-dropmenu-state'] = entry.dropmenu ? entry.dropmenu.state : 'invalid';
      if (entry.dropmenu && entry.dropmenu.componentSetId) attrs['data-dropmenu-set'] = entry.dropmenu.componentSetId;
      if (!entry.dropmenu) attrs['data-btn-press'] = 'inert';
    }
    const parsed = parseLayerName(entry.name);
    if (parsed.params.link) attrs['data-link'] = String(parsed.params.link);
    if (parsed.params.go) attrs['data-go'] = String(parsed.params.go);
    if (entry.role === 'fix') {
      attrs['data-nav-shell'] = 'true';
      attrs['data-fix-pin'] = 'viewport';
      if (entry.fixFrom != null) attrs['data-fix-from'] = String(entry.fixFrom);
    }
    const withPress = attachButtonPressAttrs(attrs, {
      role: entry.role,
      controlState: entry.controlState,
      parsed,
    });
    if (Object.keys(withPress).length > 1) attributes.push({ id: entry.id, attrs: withPress });
  }
  for (const childId of overflowChildIds) {
    if (attributes.some((entry) => entry.id === childId)) continue;
    attributes.push({
      id: childId,
      attrs: {
        'data-node': childId,
        'data-hscroll-overflow-child': 'true',
      },
    });
  }
  return {
    components,
    unresolved,
    attributes,
    stats: {
      components: components.length,
      sectionTargets: components.filter((x) => x.secTarget).length,
      switches: new Set(components.filter((x) => x.switchId).map((x) => x.switchId)).size,
      swpages: components.filter((x) => x.swpage != null).length,
      switchDirectChildPages: components.filter((x) => x.pageSource === 'switch-direct-child').length,
      componentVariantGraphs: components.filter((x) => x.variantGraph?.pageSource === 'component-set-variant').length,
      componentVariantPages: components.reduce((count, x) => count + (x.variantGraph?.variants || 0), 0),
      componentVariantControls: components.filter((x) => x.variantIndex != null).length,
      hscroll: components.filter((x) => x.hscroll).length,
      calendarNow: components.filter((x) => x.calendarNow).length,
      unresolved: unresolved.length,
    },
  };
}

export function interactionAttributesForNode(node, nodes = []) {
  const model = deriveInteractionModel(nodes);
  const id = String(idOf(node));
  return model.attributes.find((x) => x.id === id)?.attrs || {};
}
