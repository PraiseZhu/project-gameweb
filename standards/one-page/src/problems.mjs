import { canonicalJson } from './canonical.mjs';

const B2_CODES = new Set([
  'ACTION_MISSING',
  'ACTION_CONFIG',
  'ACTION_TYPE',
  'ACTION_PARAMETER',
  'ACTION_VALUE',
  'ACTION_TARGETS',
  'ACTION_LINK_SOURCE',
  'ACTION_STATE',
  'ACTION_CONTROL',
  'LINK_URL',
  'STATE_MAPPING',
  'STATE_DESIGN',
  'STATE_DECLARATION',
  'STATE_CONTROL',
  'PAGINATION',
  'RELATION_MISSING',
  'RELATION_CONFLICT',
  'MOTION_MISSING',
  'MOTION_RULE',
  'MOTION_CONTRACT',
  'MOTION_PARAMETER',
  'FONT_UNSET',
  'FONT_WEIGHT',
  'FONT_FILE',
  'FONT_DIGEST',
  'FONT_GLYPH',
  'FONT_IDENTITY',
  'FONT_SOURCE',
  'FONT_AXIS',
  'DATA_CHECK',
  'DATA_SAMPLE',
  'SLOT_MAPPING',
  'SLOT_DEFAULT',
  'SLOT_DECLARATION',
  'FIELD_TARGET',
  'FIELD_DECLARATION',
  'FIELD_ACTION',
  'FUNCTION_CONTRACT',
  'BINDING_CONFIG',
  'BINDING_KEY',
  'LAYOUT_DECLARATION',
  'config-invalid',
]);

const TOOL_CODES = new Set([
  'CONFIG_KEY',
  'CONFIG_TYPE',
  'LINK_CONFIG',
  'FONT_CONFIG',
  'DATA_CONTRACT',
  'TARGET',
  'TARGET_SCOPE',
  'L10N_CONFIG',
]);

const A_CODES = new Set([
  'a-missing',
  'a-tampered',
  'a-entry',
  'source-version',
  'platform-missing',
]);

const IMPACT = {
  ACTION_MISSING: '点击入口没有动作，做页无法实现交互',
  RELATION_MISSING: 'tab／页码／指示缺少唯一目标，做页无法建立关系',
  PAGINATION: '分页合同缺失，做页无法实现翻页',
  'source-version': '稿件版本与范围记录不一致，读的不是 A 确认过的那一版',
  unnamed: '不是已规范命名稿，不能抽取事实',
  'design-set-ambiguous': '页面内设计集合不唯一，不能默认取第一个',
  'platform-missing': '范围记录的端别在稿上不存在，范围与稿件冲突',
  'pair-ambiguous': '双端模块无法唯一配对，未匹配不能自动当单端',
  'pair-unmatched': '双端未找到唯一同名模块，不能自动当单端专属',
  'a-missing': '没有可用的 A 环节记录，B 不能开工',
  'a-tampered': 'A 的范围或环节记录已被改，B 不能开工',
  'a-entry': 'A 环节记录未通过开工前检查，B 不能开工',
  'config-invalid': '项目配置坏了，不能按空配置继续抽取',
};

export const RETURN_TO = Object.freeze(['A', '设计稿', 'B2', '工具']);

export function returnToFor(code) {
  if (A_CODES.has(code)) return 'A';
  if (TOOL_CODES.has(code)) return '工具';
  if (B2_CODES.has(code)) return 'B2';
  return '设计稿';
}

export function impactFor(code, fallback = '当前范围缺这项，做页不能猜') {
  return IMPACT[code] ?? fallback;
}

export function problem({
  end = null,
  section = null,
  nodeId = null,
  object,
  missing,
  impact,
  returnTo,
  code = null,
} = {}) {
  const dest = returnTo ?? returnToFor(code);
  return {
    end,
    section,
    nodeId,
    object: object ?? code ?? '',
    missing: missing ?? '',
    impact: impact ?? impactFor(code),
    returnTo: dest,
    ...(code ? { code } : {}),
  };
}

export function problemFromStopped(err, extras = {}) {
  return problem({
    end: extras.end ?? err.end ?? null,
    section: extras.section ?? err.section ?? null,
    nodeId: extras.nodeId ?? err.nodeId ?? null,
    object: extras.object ?? err.object ?? err.code,
    missing: err.message,
    code: err.code,
  });
}

export function problemFromIssue(end, issue) {
  return problem({
    end: issue.nodeId == null ? null : end,
    section: issue.section ?? null,
    nodeId: issue.nodeId ?? null,
    object: issue.name || issue.code,
    missing: issue.message,
    code: issue.code,
  });
}

function sectionFromPairKey(key) {
  const match = /^sec\/(\d+)/.exec(String(key || ''));
  return match ? Number(match[1]) : null;
}

export function problemsFromPairing(pairing) {
  const out = [];
  for (const row of pairing.ambiguous || []) {
    const nodeId = [...(row.pcIds || []), ...(row.mobileIds || [])][0] ?? null;
    out.push(problem({
      end: null,
      section: sectionFromPairKey(row.key),
      nodeId,
      object: row.key,
      missing: `双端模块无法唯一配对（${row.reason}）。pc=${(row.pcIds || []).join(',') || '无'}；mobile=${(row.mobileIds || []).join(',') || '无'}`,
      code: 'pair-ambiguous',
    }));
  }
  for (const row of pairing.unmatchedDual || []) {
    out.push(problem({
      end: row.end === 'mobile-only' ? 'mobile' : 'pc',
      section: sectionFromPairKey(row.key),
      nodeId: row.id ?? null,
      object: row.key,
      missing: '另一端没有唯一同名模块；未匹配不能自动当单端',
      code: 'pair-unmatched',
    }));
  }
  return out;
}

export function assertProblemShape(item) {
  return item
    && typeof item === 'object'
    && 'end' in item
    && 'section' in item
    && 'nodeId' in item
    && typeof item.object === 'string'
    && typeof item.missing === 'string'
    && typeof item.impact === 'string'
    && RETURN_TO.includes(item.returnTo);
}

function validProblemEnd(end) {
  return end == null || end === 'pc' || end === 'mobile';
}

function validProblemSection(section) {
  return section == null || (Number.isSafeInteger(section) && section >= 0);
}

function validProblemNodeId(nodeId) {
  return nodeId == null || (typeof nodeId === 'string' && nodeId.trim() !== '');
}

export function assertProblemDomain(item) {
  return assertProblemShape(item)
    && validProblemEnd(item.end)
    && validProblemSection(item.section)
    && validProblemNodeId(item.nodeId);
}

export function dedupeProblems(items) {
  const seen = new Set();
  const out = [];
  for (const item of items || []) {
    const key = canonicalJson({
      end: item.end,
      section: item.section,
      nodeId: item.nodeId,
      object: item.object,
      missing: item.missing,
      returnTo: item.returnTo,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function problemsFromInventories(inventories, pairing) {
  const out = [];
  for (const end of ['pc', 'mobile']) {
    const inv = inventories?.[end];
    if (!inv) continue;
    for (const issue of inv.issues || []) {
      out.push(problemFromIssue(end, issue));
    }
  }
  out.push(...problemsFromPairing(pairing));
  return dedupeProblems(out);
}
