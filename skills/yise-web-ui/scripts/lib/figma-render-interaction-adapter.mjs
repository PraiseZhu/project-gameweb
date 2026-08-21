/**
 * Convert a source-validated interaction model into the renderer's existing
 * `data-switch-*` contract. Geometry and DOM stay outside this module.
 */
import { deriveInteractionModel } from './figma-interaction-contract.mjs';

const cloneAttrs = (attrs) => Object.fromEntries(Object.entries(attrs || {}).map(([key, value]) => [key, String(value)]));
const byId = (entries = []) => new Map(entries.map((entry) => [String(entry.id), entry]));

function sourceSelectedIndex(members, pageCount) {
  const activeByFamily = new Map();
  for (const entry of members) {
    if (!['tab', 'ind'].includes(entry.role) || entry.swpage == null || entry.controlState !== 'active') continue;
    const index = Number(entry.swpage);
    if (!Number.isInteger(index) || index < 0 || index >= pageCount) continue;
    if (!activeByFamily.has(entry.role)) activeByFamily.set(entry.role, new Set());
    activeByFamily.get(entry.role).add(index);
  }
  if ([...activeByFamily.values()].some((indexes) => indexes.size !== 1)) return null;
  const unique = [...new Set([...activeByFamily.values()].flatMap((indexes) => [...indexes]))];
  if (unique.length === 1) return { index: unique[0], evidence: 'component-property-active-variant' };
  if (!unique.length && activeByFamily.size === 0) return null;
  return null;
}

export function buildRendererInteractionPayload(model = {}) {
  const components = Array.isArray(model?.components) ? model.components : [];
  const baseAttributes = byId(Array.isArray(model?.attributes) ? model.attributes : []);
  const unresolved = Array.isArray(model?.unresolved) ? model.unresolved.map((entry) => ({ ...entry })) : [];
  const groups = new Map();
  for (const component of components) {
    if (!component?.switchId) continue;
    const id = String(component.switchId);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(component);
  }
  const attributes = new Map([...baseAttributes.entries()].map(([id, entry]) => [id, cloneAttrs(entry.attrs)]));
  const switches = [];
  for (const [switchId, members] of groups) {
    if (unresolved.some((entry) => String(entry.id) === switchId && entry.role === 'switch')) continue;
    const owner = members.find((entry) => entry.role === 'switch' && String(entry.id) === switchId);
    const pages = members.filter((entry) => entry.pageSource === 'switch-direct-child' && entry.role === 'switch-page' && entry.swpage != null)
      .sort((a, b) => Number(a.swpage) - Number(b.swpage));
    if (!owner || pages.length < 2 || pages.some((page, index) => Number(page.swpage) !== index)) continue;
    const initial = sourceSelectedIndex(members, pages.length);
    if (!initial) { unresolved.push({ id: switchId, role: 'switch', reason: 'direct-child switch has conflicting source-active controls' }); continue; }
    const ownerAttrs = { ...(attributes.get(switchId) || {}) };
    Object.assign(ownerAttrs, { 'data-node': switchId, 'data-switch': switchId, 'data-switch-owner': 'true', 'data-switch-page-source': 'switch-direct-child', 'data-switch-index': String(initial.index), 'data-switch-initial-index': String(initial.index), 'data-switch-default-evidence': initial.evidence });
    delete ownerAttrs['data-motion-carousel']; delete ownerAttrs['data-motion-carousel-index'];
    attributes.set(switchId, ownerAttrs);
    for (const page of pages) {
      const attrs = { ...(attributes.get(String(page.id)) || {}) };
      Object.assign(attrs, { 'data-node': String(page.id), 'data-switch': switchId, 'data-swpage': String(page.swpage), 'data-switch-page': String(page.swpage), 'data-switch-page-source': 'switch-direct-child' });
      attributes.set(String(page.id), attrs);
    }
    for (const member of members) {
      if (!['tab', 'ind'].includes(member.role) || member.swpage == null) continue;
      const attrs = { ...(attributes.get(String(member.id)) || {}) };
      const active = Number(member.swpage) === initial.index;
      Object.assign(attrs, { 'data-node': String(member.id), 'data-switch': switchId, 'data-swpage': String(member.swpage), 'aria-selected': active ? 'true' : 'false' });
      if (member.role === 'tab') attrs['data-tab'] = 'true';
      if (member.role === 'ind') attrs['data-indicator'] = 'true';
      if (active) attrs['data-active'] = 'true'; else delete attrs['data-active'];
      attributes.set(String(member.id), attrs);
    }
    switches.push({ id: switchId, source: 'switch-direct-child', pageIds: pages.map((page) => String(page.id)), initialIndex: initial.index, initialEvidence: initial.evidence });
  }
  return { schema: 'figma-render-interaction-payload/v1', attributes: [...attributes.entries()].map(([id, attrs]) => ({ id, attrs })), switches, unresolved, stats: { switches: switches.length, pages: switches.reduce((total, entry) => total + entry.pageIds.length, 0), unresolved: unresolved.length } };
}

export function buildRendererInteractionPayloadFromNodes(nodes = []) {
  return buildRendererInteractionPayload(deriveInteractionModel(nodes));
}

export function createRenderInteractionHandoff({ sourceModel = null } = {}) {
  if (!sourceModel) return { schema: 'figma-render-interaction-handoff/v1', status: 'unavailable', reason: 'source interaction model is required; no DOM or raw inventory inference is allowed', payload: null };
  return { schema: 'figma-render-interaction-handoff/v1', status: 'ready', payload: buildRendererInteractionPayload(sourceModel) };
}
