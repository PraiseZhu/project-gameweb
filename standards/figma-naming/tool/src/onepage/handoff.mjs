import { createHash } from 'node:crypto';
import { allNodesOf } from '../inventory.mjs';
import { CONTRACT_VERSION, INVENTORY_SCHEMA, HANDOFF_SCHEMA, CAPABILITIES } from '../../../spec/onepage.mjs';

export const digest = value => createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex');
export function validateOnePageInventory(inv) {
  const problems = [];
  if (!inv || typeof inv !== 'object' || !Array.isArray(inv.nodes)) return {ok:false,problems:['缺合法清单对象']};
  for (const group of ['modals','componentSets','components']) {
    const items=inv.attachments?.[group];
    if (items !== undefined && (!Array.isArray(items) || items.some(x=>!x || !Array.isArray(x.nodes) || x.nodes.some(n=>!n || typeof n!=='object')))) return {ok:false,problems:['附件格式无效']};
  }
  if (inv.nodes.some(n=>!n || typeof n !== 'object') || !Array.isArray(inv.relations) || inv.relations.some(r=>!r || typeof r !== 'object')) return {ok:false,problems:['节点或关系格式无效']};
  if (inv?.schema !== INVENTORY_SCHEMA || inv?.contract !== CONTRACT_VERSION) problems.push('不支持的清单契约');
  if (inv?.ok !== true || inv?.status !== 'ready' || !Array.isArray(inv?.issues) || inv.issues.length) problems.push('清单未通过编译');
  if (!Array.isArray(inv?.requiredCapabilities) || Object.values(CAPABILITIES).some(x => !inv.requiredCapabilities.includes(x))) problems.push('缺契约能力声明');
  const nodes = allNodesOf(inv), ids = new Set(nodes.map(n => `${n.scope}:${n.id}`));
  if (!nodes.length || ids.size !== nodes.length) problems.push('节点缺失或重复');
  for (const n of nodes) if (n.status === 'determined' && (!n.role || !n.declaration)) problems.push(`节点 ${n.id} 缺角色或来源`);
  for (const r of inv?.relations || []) {
    if (r.status !== 'determined' || !ids.has(`${r.from?.scope}:${r.from?.id}`) || !ids.has(`${r.to?.scope}:${r.to?.id}`)) problems.push('关系未解析或引用缺失');
  }
  return { ok: !problems.length, problems };
}
export function createOnePagePack(inv) {
  const check = validateOnePageInventory(inv);
  if (!check.ok) throw new Error(check.problems.join('；'));
  return { schema:HANDOFF_SCHEMA,contract:CONTRACT_VERSION,status:'ready',requiredCapabilities:[...inv.requiredCapabilities],inventory:inv,inventoryHash:digest(inv) };
}
export function acceptOnePagePack(pack, consumer) {
  const problems = [];
  if (pack?.schema !== HANDOFF_SCHEMA || pack?.contract !== CONTRACT_VERSION || pack?.status !== 'ready') problems.push('不支持的交接契约');
  const required = Object.values(CAPABILITIES);
  if (!Array.isArray(pack?.requiredCapabilities) || required.some(x => !pack.requiredCapabilities.includes(x))) problems.push('交接包能力声明不完整');
  if (pack?.inventoryHash !== digest(pack?.inventory)) problems.push('清单摘要不一致');
  problems.push(...validateOnePageInventory(pack?.inventory).problems);
  if (consumer?.contract !== CONTRACT_VERSION) problems.push('消费者未实现新契约，不能降级为旧包');
  if (!Array.isArray(consumer?.capabilities)) problems.push('消费者能力必须是数组');
  const extra=Array.isArray(pack?.requiredCapabilities) ? pack.requiredCapabilities : [];
  const supported=Array.isArray(consumer?.capabilities) ? consumer.capabilities : [];
  for (const capability of new Set([...required,...extra])) if (!supported.includes(capability)) problems.push(`消费者缺能力 ${capability}`);
  return { ok:!problems.length,problems };
}
