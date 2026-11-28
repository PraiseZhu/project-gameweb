import { c2NodeView } from '../c2-contract.mjs';
import { endFile, PACK_FILES } from '../handoff-check.mjs';
import { canonicalJson } from '../canonical.mjs';
import { observed } from './static-audit.mjs';
import { inspectC2Contract } from '../c2-contract.mjs';

const identity = ({ end, scope, nodeId }) => JSON.stringify([end, scope, nodeId]);

export function auditSource(handoff, meta, manifest, revised = [], leaves = []) {
  const read = (path) => JSON.parse(handoff.payloads.get(path));
  const views = {};
  const inventories = {};
  const results = [];
  for (const end of handoff.ends) {
    const inventory = inventories[end] = read(endFile(end)).inventory;
    const view = views[end] = c2NodeView(inventory, meta.baseLanguage);
    const product = [...inventory.nodes, ...(inventory.attachments?.modals ?? []).flatMap((modal) => modal.nodes)];
    const selectionArt = meta.tabBindings.filter((row) => row.end === end && row.selectedArt).map((row) => row.selectedArt.id);
    for (const node of product.filter(view.visible)) {
      const ancestors = (node.ancestorIds ?? []).map((id) => view.byId.get(id)).filter(Boolean);
      const baked = [node, ...ancestors].some((owner) => selectionArt.includes(owner.id))
        || ancestors.some((owner) => ['bg', 'kv'].includes(owner.role));
      if (baked) continue;
      const expected = { end, scope: node.scope, nodeId: node.id };
      const trace = meta.nodes.filter((row) => identity(row) === identity(expected));
      const edit = leaves.find((row) => identity(row) === identity(expected));
      const screen = node.role === 'sec' ? node.id : ancestors.find((owner) => owner.role === 'sec')?.id ?? null;
      const expectedAsset = manifest.assets.find((row) => row.end === end && row.nodeId === node.id);
      const matching = trace.length === 1 && trace[0].role === node.role && trace[0].module === screen
        && (!edit || (edit.fromText === node.text?.characters && canonicalJson(edit.fromBox) === canonicalJson(node.pageBox)))
        && trace[0].text === (edit?.toText ?? node.text?.characters ?? null) && trace[0].asset === (expectedAsset?.path ?? null);
      results.push(observed('D02', end + ':' + node.id + ':source', matching, { expected, screen, matches: trace.length }));
    }
  }
  for (const row of meta.nodes) {
    const original = views[row.end]?.resolve({ id: row.nodeId, scope: row.scope });
    const edit = leaves.find((item) => item.domId === row.domId);
    results.push(observed('D02', row.domId + ':trace', Boolean(original && views[row.end].visible(original)
      && row.role === original.role && row.text === (edit?.toText ?? original.text?.characters ?? null)
      && canonicalJson(row.designBox) === canonicalJson(edit?.toBox ?? original.pageBox ?? null)
      && canonicalJson(row.ancestors) === canonicalJson(original.ancestorIds ?? [])), { nodeId: row.nodeId, end: row.end }));
  }
  const contract = inspectC2Contract(inventories, read(PACK_FILES.dataContract).c2, handoff.manifest.scope);
  const tabKey = (row) => JSON.stringify([row.end, row.tabId, row.switchId, row.panelId, row.selection.kind, row.selection.nodeId ?? null]);
  const declared = contract.tabs.map(tabKey).sort();
  const traced = meta.tabBindings.map((row) => tabKey({ end: row.end, tabId: row.tab.id, switchId: row.switch.id,
    panelId: row.panel.id, selection: { kind: row.selection, nodeId: row.selectedArt?.id } })).sort();
  results.push(observed('D04', 'bound-tab-scope', !contract.faults.length && !contract.questions.length
    && canonicalJson(declared) === canonicalJson(traced), { declared: declared.length, traced: traced.length }));
  const planned = read(PACK_FILES.assets).filter((row) => views[row.end].visible(views[row.end].byId.get(row.nodeId)));
  const assetKey = ({ end, nodeId, visualFingerprint }) => JSON.stringify([end, nodeId, visualFingerprint]);
  const expected = planned.map((row) => revised.find((item) => item.end === row.end && item.nodeId === row.nodeId) ?? row);
  results.push(observed('D06', 'b3-export-plan', canonicalJson(expected.map(assetKey).sort()) === canonicalJson(manifest.assets.map(assetKey).sort()),
    { planned: planned.length, actual: manifest.assets.length }));
  return results;
}
