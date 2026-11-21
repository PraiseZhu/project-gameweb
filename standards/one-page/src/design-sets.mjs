import { parseName } from '../../figma-naming/tool/src/parse.mjs';
import { StoppedError } from './stopped.mjs';

/** 与出清单 pickInnerPage 同一套页面内设计集合名：pc / mobile / cn_pc / cn_mobile。 */
export const DESIGN_SET_NAME = /^(pc|mobile|cn_pc|cn_mobile)$/i;

export function endOfDesignSetName(name) {
  const text = String(name || '').toLowerCase();
  if (text === 'pc' || text === 'cn_pc') return 'pc';
  if (text === 'mobile' || text === 'cn_mobile') return 'mobile';
  return null;
}

function isFrame(node) {
  return node?.type === 'FRAME';
}

function collectNamedFrames(root) {
  const found = [];
  const visit = (node) => {
    for (const child of node?.children || []) {
      if (!isFrame(child)) continue;
      if (DESIGN_SET_NAME.test(String(child.name || ''))) {
        found.push(child);
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  return found;
}

export function collectDesignSets(document) {
  const frames = collectNamedFrames(document);
  const sets = frames.map((node) => ({
    id: node.id,
    name: node.name,
    end: endOfDesignSetName(node.name),
    node,
  }));
  const byEnd = { pc: [], mobile: [] };
  for (const set of sets) {
    if (set.end) byEnd[set.end].push(set);
  }
  return { sets, byEnd };
}

export function requiredEndsOf(platform) {
  if (platform === 'pc+mobile') return ['pc', 'mobile'];
  if (platform === 'mobile') return ['mobile'];
  return ['pc'];
}

function namedStats(root) {
  let prefixed = 0;
  let secs = 0;
  const walk = (node) => {
    const parsed = parseName(node?.name);
    if (parsed.prefix === 'ref') return;
    if (parsed.prefix) {
      prefixed += 1;
      if (parsed.prefix === 'sec') secs += 1;
    }
    for (const child of node?.children || []) walk(child);
  };
  walk(root);
  return { prefixed, secs };
}

function topFrameLabels(document) {
  return (document?.children || [])
    .filter((child) => child?.type === 'FRAME')
    .map((child) => `${child.name}#${child.id}`);
}

export function assertDesignSets(document, platform) {
  const collected = collectDesignSets(document);
  const ambiguous = [];
  for (const end of ['pc', 'mobile']) {
    if (collected.byEnd[end].length > 1) {
      ambiguous.push(
        `${end}：${collected.byEnd[end].map((set) => `${set.name}#${set.id}`).join('、')}`,
      );
    }
  }
  if (ambiguous.length) {
    const first = collected.byEnd.pc[1] || collected.byEnd.mobile[1] || collected.sets[0];
    throw new StoppedError(
      'design-set-ambiguous',
      `页面内设计集合不唯一，不能默认取第一个。冲突：${ambiguous.join('；')}。请改到稿上只留一套可识别的 PC／手机设计集合后重跑。`,
      { end: first?.end ?? null, nodeId: first?.id ?? document?.id ?? null, object: '设计集合' },
    );
  }

  const missing = [];
  const selected = [];
  for (const end of requiredEndsOf(platform)) {
    const matches = collected.byEnd[end];
    if (matches.length !== 1) {
      missing.push(end);
      continue;
    }
    selected.push(matches[0]);
  }
  if (missing.length) {
    const recognized = collected.sets.map((set) => `${set.name}#${set.id}`).join('、') || '无';
    const tops = topFrameLabels(document).join('、') || '无';
    throw new StoppedError(
      'platform-missing',
      `范围记录的端别（${platform}）在稿上不存在：缺 ${missing.join('、')}。已识别设计集合：${recognized}。页面顶层 Frame：${tops}。请改范围或补稿后从 A 重确认。`,
      { end: missing[0], nodeId: document?.id ?? null, object: `缺 ${missing.join('、')}` },
    );
  }

  for (const set of selected) {
    const stats = namedStats(set.node);
    if (stats.secs < 1 || stats.prefixed < 1) {
      throw new StoppedError(
        'unnamed',
        `这不是已规范命名稿（${set.name}#${set.id} 没有可识别的 sec/ 前缀）。未规范稿流程已废弃，请先按命名规范改稿后再跑。`,
        { end: set.end, nodeId: set.id, object: set.name },
      );
    }
  }

  return { ...collected, selected };
}
