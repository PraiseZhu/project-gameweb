import { canonicalJson, sha256Hex } from './canonical.mjs';
import { byteDigest, isDigest } from './handoff-check.mjs';
import { pixelScope, targetRegion } from './c-check/pixel-scope.mjs';

const schema = 'onepage-c4-design/v1';
const same = (left, right) => canonicalJson(left) === canonicalJson(right);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const content = (target, property, value) => sha256Hex({ target, property, value });
export const designRule = ({ target, property, value }) => '#' + target.domId + '>.art{' + property + ':' + value + '}';

export function planDesign({ instruction, page, base, prior = [] }) {
  const { target, property, value, confirmation, decision } = instruction;
  const allowed = ['schema','base','target','property','value','confirmation','decision'];
  need(Object.keys(instruction).every((key) => allowed.includes(key)), '设计指令含未支持字段；不接受任意 CSS 或 JS');
  need(instruction.schema === schema && same(instruction.base, base) && base.scopeVersion === page.scopeVersion
    && ['pageVersion','checkVersion','checkDigest','scopeVersion'].every((key) => isDigest(base[key])), '设计指令未绑定当前已验单页');
  const candidates = page.nodes.filter((node) => node.domId === target?.domId && node.end === target.end
    && node.module === target.module && node.nodeId === target.nodeId);
  const node = candidates[0];
  need(candidates.length === 1 && /^[\w-]+$/.test(node.domId) && node.asset && node.role === 'img'
    && !page.tabBindings.some((row) => row.end === node.end && row.selectedArt?.id === node.nodeId)
    && same(target, { domId:node.domId, end:node.end, module:node.module, nodeId:node.nodeId }), '设计目标不存在或不是明确的图层');
  need(property === 'opacity' && Number.isFinite(value) && value > 0 && value <= 1, '不支持的设计指令或属性值');
  const fingerprint = content(target, property, value);
  const previous = prior.find((row) => row.target.domId === target.domId && row.property === property);
  const conflict = previous && previous.fingerprint !== fingerprint ? { target, property,
    previous:previous.fingerprint, proposed:fingerprint, fingerprint:sha256Hex({ base, property, target, previous:previous.fingerprint, proposed:fingerprint }) } : null;
  if (conflict && !decision) return { conflict };
  need(conflict ? decision?.fingerprint === conflict.fingerprint && ['overwrite','keep-manual'].includes(decision.choice) : !decision,
    '裁决过期或未绑定精确冲突');
  const currentValue = decision?.choice === 'keep-manual' ? previous.value : value;
  const currentFingerprint = content(target,property,currentValue);
  if (confirmation) {
    const { caseId, viewport, rect, basis, fingerprint: approved } = confirmation;
    const entry = pixelScope(page).find((row) => row.screen.end === node.end && row.screen.nodeId === node.module && row.caseId === caseId);
    need(entry && !entry.hiddenPanels.some((id) => node.ancestors.includes(id)) && /^[\w-]+$/.test(caseId)
      && typeof basis === 'string' && basis.trim() && basis.length <= 300 && approved === currentFingerprint
      && confirmation.pageVersion === base.pageVersion
      && same(rect, targetRegion(page, entry.screen, node, viewport).region), '确认区域或确认依据不匹配');
  }
  need(node.designBox && ['x','y','w','h'].every((key) => Number.isFinite(node.designBox[key]))
    && node.designBox.w > 0 && node.designBox.h > 0, '微调对象缺权威几何边界');
  const selected = { target, property, value:currentValue, fingerprint:currentFingerprint, region:node.designBox, ...(confirmation ? { confirmation } : {}) };
  return { selected, manualTweaks:[...prior.filter((item) => item !== previous).map(({ confirmation,...anchor }) => anchor), selected],
    ...(decision ? { decision, conflict } : {}) };
}

export function verifyDesign(page, proof) {
  const { base, instruction, instructionBytes, prior, plan } = proof;
  const bytes = Buffer.from(instructionBytes, 'base64');
  const expected = planDesign({ instruction, page, base, prior });
  need(same(JSON.parse(bytes), instruction) && byteDigest(bytes) === page.c4.designDigest
    && sha256Hex(proof) === page.c4.materialDigest && expected.selected && same(plan, expected)
    && plan.manualTweaks.every((row) => row.fingerprint === content(row.target,row.property,row.value)
      && same(row.region,page.nodes.find((node) => node.domId === row.target.domId)?.designBox))
    && plan.manualTweaks.every((row) => page.c4.affectedDomIds.includes(row.target.domId)), '设计指令或裁决证明不匹配');
  return plan.manualTweaks;
}

export function approvedDesignRegions(tweaks, screen, caseId, viewport) {
  return tweaks.filter(({ target, confirmation }) => confirmation && target.end === screen.end && target.module === screen.nodeId
    && confirmation.caseId === caseId && same(confirmation.viewport, viewport)).map(({ target, property, value, confirmation }) => ({
    domId:target.domId, rect:confirmation.rect, digest:sha256Hex(confirmation), property, value,
  }));
}
