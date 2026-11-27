import { canonicalJson } from './canonical.mjs';

const same = (left,right) => canonicalJson(left) === canonicalJson(right);
const need = (condition,message) => { if (!condition) throw new Error(message); };
const key = ({ end,scope,nodeId }) => JSON.stringify([end,scope,nodeId]);
const boxValid = (box) => box && ['x','y','w','h'].every((side) => Number.isFinite(box[side])) && box.w > 0 && box.h > 0;
const comparable = ({ pageBox,parentBox,box,absoluteBoundingBox,visualFingerprint,motion,text,...facts }) => ({ ...facts,
  text:text ? Object.fromEntries(Object.entries(text).filter(([field]) => field !== 'characters')) : null });

export function planLeafChanges({ page, delta, before, after }) {
  const facts = delta.evidence.nodeChanges;
  const edits = [];
  const assets = delta.affectedAssets;
  for (const fact of facts) {
    const original = before[fact.end]?.get(fact.nodeId);
    const next = after[fact.end]?.get(fact.nodeId);
    const matches = page.nodes.filter((row) => key(row) === key(fact));
    if (fact.kind === 'visual') continue;
    const oldText = original?.text?.characters;
    const newText = next?.text?.characters;
    if (!original || !next || !matches.length || !['copy','layout'].includes(fact.kind)) {
      if (fact.kind === 'visual' && matches.every((row) => row.role === 'sec')) continue;
      throw new Error('B4 未能局部定位节点变化：' + key(fact));
    }
    const [trace] = matches;
    need(matches.length === 1 && trace.module && !trace.asset && trace.text === oldText && typeof oldText === 'string' && oldText.trim()
      && typeof newText === 'string' && newText.trim() && /^[\w-]+$/.test(trace.domId) && same(trace.designBox,original.pageBox)
      && ![...before[fact.end].values()].some((node) => node.parentId === original.id)
      && ![...after[fact.end].values()].some((node) => node.parentId === next.id) && same(comparable(original),comparable(next)),
    'B4 叶节点结构或排版事实变化，不能安全局部处理：' + key(fact));
    const changedBox = !same(original.pageBox,next.pageBox);
    need(changedBox || oldText !== newText, 'B4 没有可应用的文案或布局变化：' + key(fact));
    need([original.pageBox,next.pageBox,original.parentBox,next.parentBox].every(boxValid), 'B4 缺权威几何：' + key(fact));
    if (changedBox) {
      need(original.parentId === trace.module && [original.parentBox,next.parentBox].every((box) => box.x >= 0 && box.y >= 0)
        && ['x','y','w','h'].every((side) => next.pageBox[side] - original.pageBox[side] === next.parentBox[side] - original.parentBox[side]),
      'B4 局部布局不是可定位的同屏直接子节点：' + key(fact));
    }
    if (fact.previousFingerprint) need(fact.previousFingerprint === original.visualFingerprint, 'B4 旧节点指纹不匹配');
    edits.push({ end:fact.end,scope:fact.scope,nodeId:fact.nodeId,domId:trace.domId,fromText:oldText,toText:newText,
      fromBox:original.pageBox,toBox:next.pageBox,fromParent:original.parentBox,toParent:next.parentBox, changedBox });
  }
  need(edits.length > 0 && facts.every((fact) => edits.some((row) => key(row) === key(fact)) || (fact.kind === 'visual'
    && [...edits,...assets].some((row) => row.end === fact.end && (key(row) === key(fact)
      || before[row.end].get(row.nodeId)?.ancestorIds?.includes(fact.nodeId))))), 'B4 含未定位且未应用的节点变化，请走完整生成链');
  return edits;
}

export function verifyLeaves(page, delta, edits) {
  need(new Set(edits.map(key)).size === edits.length && edits.every((edit) =>
    delta.evidence.nodeChanges.some((fact) => key(fact) === key(edit) && ['copy','layout'].includes(fact.kind))
    && [edit.fromBox,edit.toBox,edit.fromParent,edit.toParent].every(boxValid)
    && page.nodes.some((row) => key(row) === key(edit) && row.domId === edit.domId && row.text === edit.toText && same(row.designBox,edit.toBox))),
  'B4 局部节点结果与成品追溯不符');
}

const escapeText = (value) => value.replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

export function applyLeafMarkup(html, edit) {
  if (edit.fromText === edit.toText) return html;
  const pattern = new RegExp('<(p|h[1-6]) id="' + edit.domId + '"[^>]*>[^<]*(?:<span data-slogan-ink>[^<]*</span>)?</\\1>','g');
  const matches = [...html.matchAll(pattern)];
  need(matches.length === 1, '修改对象不属于唯一可核的原生文字');
  const [markup] = matches[0];
  const before = '>' + escapeText(edit.fromText) + '</';
  need(markup.split(before).length === 2, '已验文案锚点发生漂移');
  return html.slice(0,matches[0].index) + markup.replace(before,() => '>' + escapeText(edit.toText) + '</') + html.slice(matches[0].index + markup.length);
}

export function applyLeafLayout(css, edit) {
  if (!edit.changedBox) return css;
  const pattern = new RegExp('\\.' + edit.domId + '\\{[^}]+\\}','g');
  const rules = [...css.matchAll(pattern)];
  need(rules.length === 1, '找不到唯一的局部布局规则');
  const [original] = rules[0];
  let updated = original;
  const axes = { 'width':'w','height':'h','margin-left':'x','margin-top':'y' };
  for (const [property,axis] of Object.entries(axes)) {
    const before = '--' + property + ':' + edit.fromParent[axis] / 200 + 'rem;';
    const after = '--' + property + ':' + edit.toParent[axis] / 200 + 'rem;';
    need(updated.split(before).length === 2, '已验布局规则不匹配：' + property);
    updated = updated.replace(before,after);
  }
  return css.replace(original,updated);
}
