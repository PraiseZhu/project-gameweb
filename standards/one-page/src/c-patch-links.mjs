import { canonicalJson, sha256Hex } from './canonical.mjs';

const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const withoutLinks = ({ links, fonts, meta, ...rest }) => rest;
const comparable = ({ fonts, meta, ...config }) => config;

function linkValue(entry) {
  need(entry && Object.keys(entry).length === 1 && Object.hasOwn(entry,'url'), '配置变化不是已声明外链值');
  if (entry.url === null) return null;
  const url = typeof entry.url === 'string' && URL.canParse(entry.url) && new URL(entry.url);
  need(url && ['http:','https:'].includes(url.protocol) && !url.username && !url.password, '外链必须是无凭据的 HTTP(S)');
  return entry.url;
}

export function planLinks({ previous, current, config, delta }) {
  const dependencies = delta.affectedSharedDeps;
  need(dependencies.length === 1 && dependencies[0].kind === 'config' && same(withoutLinks(previous),withoutLinks(current))
    && dependencies[0].previousDigest === sha256Hex(comparable(previous)) && dependencies[0].digest === sha256Hex(comparable(current)),
  '变化不止是已声明的外链配置');
  const keys = Object.keys(previous.links ?? {}).sort();
  need(same(keys,Object.keys(current.links ?? {}).sort()), 'B4 外链键范围变化');
  const changes = keys.filter((key) => !same(previous.links[key],current.links[key])).map((key) => {
    const before = linkValue(previous.links[key]);
    const after = linkValue(current.links[key]);
    need(Object.hasOwn(config.links,key) && config.links[key] === before
      && Object.values(config.actions).some((action) => action.type === 'open-link' && action.key === key), '当前成品没有对应的外链对象');
    return { key, before, after };
  });
  need(changes.length, '无可应用外链变化');
  need(delta.evidence.nodeChanges.every(({ kind, previous, current }) => kind === 'copy' && previous?.action?.type === 'open-link'
    && changes.some(({ key, before, after }) => previous.action.key === key && previous.action.url === before
      && same(current,{ ...previous, action:{ ...previous.action,url:after } }))), '外链配置之外还有节点变化');
  return { changes, sourceDigest:delta.currentInputs.configDigest };
}

export function verifyLinkProof(config, delta, proof) {
  need(proof.sourceDigest === delta.currentInputs.configDigest && proof.changes.length
    && new Set(proof.changes.map(({ key }) => key)).size === proof.changes.length && proof.changes.every(({ key, before, after }) => before !== after
      && linkValue({ url:after }) === after && Object.hasOwn(config.links,key) && config.links[key] === after
      && Object.values(config.actions).some((action) => action.type === 'open-link' && action.key === key)), '共用外链配置与绑定来源不符');
}
