import { allNodesOf } from '../../figma-naming/tool/src/inventory.mjs';
import { sha256Hex } from './canonical.mjs';

const plain = (value) => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, names) => plain(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const sourceValid = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 500;
const id = (value) => typeof value === 'string' && value.length > 0;
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const sameNode = (node, ref) => node && ref && node.id === ref.id && node.scope === ref.scope;

export function sameC2Scope(declaration, scope) {
  return digest(scope.scopeVersion) && declaration?.scopeVersion === scope.scopeVersion && declaration.fileVersion === scope.fileVersion;
}

export function c2NodeView(inventory, baseLanguage) {
  const nodes = allNodesOf(inventory);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visible = (node) => {
    if (node?.status !== 'determined') return false;
    const seen = new Set();
    for (let current = node; current; current = byId.get(current.parentId)) {
      if (seen.has(current.id) || current.langs?.length && !current.langs.includes(baseLanguage)) return false;
      seen.add(current.id);
    }
    return true;
  };
  const resolve = (reference) => {
    const node = byId.get(reference?.id);
    return sameNode(node, reference) ? node : undefined;
  };
  const tabGroups = () => (inventory.relations ?? []).flatMap((relation) => {
    if (relation.kind !== 'tab' || relation.status !== 'determined') return [];
    const tab = resolve(relation.from);
    if (!visible(tab)) return [];
    const group = resolve(relation.to);
    const panels = visible(group) ? (group.pagination?.panels ?? []).filter((reference) => visible(resolve(reference))) : [];
    return [{ tab, group, panels, relation }];
  });
  return { nodes, byId, visible, resolve, tabGroups };
}

export function tabSelectionValid(selection, artworkIds) {
  return exact(selection, ['kind']) && ['none','sliding-indicator'].includes(selection.kind)
    || exact(selection, ['kind','nodeId']) && selection.kind === 'asset' && artworkIds.includes(selection.nodeId);
}

export function componentInputValid(input) {
  if (!exact(input, ['receiver','valueShape','valueTypes','source']) || !sourceValid(input.source)
    || !Array.isArray(input.valueTypes) || !input.valueTypes.length || new Set(input.valueTypes).size !== input.valueTypes.length) return false;
  return input.receiver === 'text-content' && input.valueShape === 'scalar'
    && input.valueTypes.every((type) => ['string','number','boolean'].includes(type));
}

export function inspectC2Contract(inventories, declaration, { scopeVersion, fileVersion, baseLanguage } = {}) {
  const faults = [];
  const questions = [];
  const tabs = [];
  const inputs = [];
  const consumed = new Set();
  const claimedPanels = new Set();
  const empty = { scopeVersion, fileVersion, tabs: [], componentInputs: [] };
  const keys = ['fileVersion','tabs','componentInputs'];
  let block = declaration === undefined ? empty : declaration;
  let expired = false;
  let hasObjects = false;
  if (declaration !== undefined) {
    const legacy = exact(block, keys);
    if ((!legacy && (!exact(block, [...keys,'scopeVersion']) || !digest(block.scopeVersion))) || !id(block.fileVersion)
      || !Array.isArray(block.tabs) || !Array.isArray(block.componentInputs)) {
      return { faults: [{ message: 'C2 声明结构错误' }], questions, tabs, inputs, expired, hasObjects };
    }
    if (!legacy && block.scopeVersion === scopeVersion && block.fileVersion !== fileVersion) {
      return { faults: [{ message: 'C2 声明在当前范围内的设计版本不一致' }], questions, tabs, inputs, expired, hasObjects };
    }
    if (legacy || !sameC2Scope(block, empty)) {
      expired = true;
      block = empty;
    }
  }
  for (const [end, inventory] of Object.entries(inventories)) {
    const { nodes, visible, tabGroups } = c2NodeView(inventory, baseLanguage);
    hasObjects ||= nodes.some((node) => visible(node) && (node.role === 'tab' || node.bindings?.field?.target === 'component-input'));
    const missing = (type, node, details, prompt) => {
      const card = { type, object: node.name, componentKey: type + ':' + end + ':' + node.id,
        locations: [{ end, nodeId: node.id, name: node.name }], scopeVersion, fileVersion, ...details, prompt, splitAllowed: false };
      questions.push({ ...card, fingerprint: sha256Hex(card) });
    };
    for (const { tab, group, panels: candidates } of tabGroups()) {
      const artwork = nodes.filter((node) => node.scope === tab.scope && node.ancestorIds?.includes(tab.id)
        && visible(node) && (node.exportPolicy || node.sliceExport));
      const matches = block.tabs.filter((row) => row?.end === end && row.tabId === tab.id);
      const fail = (message) => faults.push({ end, nodeId: tab.id, message });
      if (!matches.length) {
        if (candidates.length) missing('tab-panel', tab, { switchId: group.id, panelIds: candidates.map((item) => item.id), artworkIds: artwork.map((item) => item.id) }, '需要逐 TAB 的明确面板、选中图方式与来源');
        else fail('H29 当前语言 TAB 没有可见的组内候选面板');
        continue;
      }
      matches.forEach((item) => consumed.add(item));
      const [row] = matches;
      if (matches.length !== 1 || !exact(row, ['end','tabId','switchId','panelId','source','selection']) || !sourceValid(row.source)
        || !group || row.switchId !== group.id || !candidates.some((item) => item.id === row.panelId)) {
        fail('H29 存在重复、跨端或跨组面板关系'); continue;
      }
      if (!tabSelectionValid(row.selection, artwork.map((item) => item.id))) {
        fail('H29 缺明确选中图方式，或素材不在该 TAB 子树的导出计划'); continue;
      }
      const slot = JSON.stringify([end, row.switchId, row.panelId]);
      if (claimedPanels.has(slot)) { fail('H29 同组面板已有 TAB'); continue; }
      claimedPanels.add(slot);
      tabs.push(row);
    }
    for (const node of nodes) {
      if (!visible(node) || node.bindings?.field?.target !== 'component-input') continue;
      const matches = block.componentInputs.filter((row) => row?.end === end && row.nodeId === node.id);
      if (!matches.length) { missing('component-input', node, {}, '需要受支持接收器、值形态和值类型'); continue; }
      matches.forEach((item) => consumed.add(item));
      const [{ end: declaredEnd, nodeId, ...shape }] = matches;
      if (matches.length !== 1 || !id(nodeId) || !componentInputValid(shape)
        || nodes.some((child) => child.parentId === node.id && child.scope === node.scope && child.status === 'determined')) {
        faults.push({ end, nodeId: node.id, message: 'H25 未知接收器、重复声明或值约束无效' }); continue;
      }
      inputs.push({ end: declaredEnd, nodeId, ...shape });
    }
  }
  if (consumed.size !== block.tabs.length + block.componentInputs.length) faults.push({ message: 'C2 声明存在跨端或未引用节点' });
  const groups = new Map();
  for (const row of tabs) {
    const key = JSON.stringify([row.end,row.switchId]);
    const kind = groups.get(key);
    if (kind && kind !== row.selection.kind) faults.push({ end:row.end,nodeId:row.tabId,message:'H29 同组混用选中图方式' });
    groups.set(key,row.selection.kind);
  }
  if (expired) faults.push({ message: 'C2 声明范围已失效，请按当前范围重新回答' });
  return { faults, questions, tabs, inputs, expired, hasObjects };
}

export function compiledC2Declarations(inventories, config, scope) {
  const declaration = config?.dataContract?.c2;
  const { faults, questions, tabs, inputs, expired, hasObjects } = inspectC2Contract(inventories, declaration, scope);
  const contract = declaration !== undefined && !faults.length
    ? { scopeVersion: scope.scopeVersion, fileVersion: scope.fileVersion, tabs, componentInputs: inputs } : undefined;
  return { faults, questions, contract, expired, hasObjects };
}
