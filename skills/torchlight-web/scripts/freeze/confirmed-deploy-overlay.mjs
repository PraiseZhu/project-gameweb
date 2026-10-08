/**
 * Colleague-confirmed deploy overlay for freeze capture only.
 *
 * The Lark table is still the only translation source. Confirmed HTML (phase-2
 * cn/tw/en/ko) may differ from the table on overlapping modules. Freeze pages
 * that humans QA get those matching edits; live demo / Main gates stay on the
 * Figma + table pipeline.
 *
 * Matching edits encoded here (2026-09-26 zip a077688, phase-2):
 *   - EN / KO sec10 leading "• " prefixes are absent in the confirmed pages.
 *   - Prize art: mobile 1187:1742 uses confirmed 1119-4101.webp (136.102×109.619,
 *     img 0,0). PC 1187:986 uses confirmed 1119-3124.webp (226.219×227.801, img 0,0).
 *     Do not paste the PC slice into the mobile frame.
 *   - Prize badge 1187:990 / 1187:1748 follows the confirmed 角标, not Figma
 *     「传奇战斗」. JA 990/1748 shrink a notch (19.3 / 10) so Noto Sans JP ink
 *     fits the ribbon; keep top/left. Do not change EN/KO/CN/TW.
 *   - TW/EN/KO first-screen date cells have one visible line; hide the empty
 *     second Figma TEXT. The leftover line sits in the two-line 82px box
 *     (confirmed mobile top 482.723, PC top 959), not the first-line Y.
 *     Keep 1187:886 / 1187:1770 boxes. TW PC/mobile stay the confirmed one-line
 *     stone. CN/JA stay the two-line Figma plates (JA still has two date lines).
 *     EN/KO keep Figma two-line plate height, but use nodiv copies so baked
 *     1187:889 / 1187:1774 are gone. Mobile EN/KO/JA still use the gold 1771
 *     banner. Do not clip-path a hole. Do not shrink EN/KO to one-line thickness.
 *   - TW 查看更多 follows the confirmed page on footer 974/1860 and prize-row 1008.
 *   - Crystal / catalyst captions follow confirmed wrap, weight and box.
 *   - Module7 bodies 1187:1416 / 1187:1432 (PC, Figma 1187:1412 / 1187:1428) and
 *     1187:2288 / 1187:2302 (mobile) follow confirmed wrap/weight. PC stays 50px /
 *     56.35px; mobile 20px / 24px. JA was shrinking to 25.65px / 6px — restore the
 *     same 50/20 as KO/EN, weight 400. KO long 1432/2302 keep confirmed
 *     hard-wraps (PC two-line after 시즌 드롭 정령, mobile three-line). JA PC 1432
 *     still two-line after シーズンドロップペット. JA mobile 2302 follows Figma
 *     1187:2301 (600×72, align CENTER) and Lark row 78: wrap inside the frame,
 *     centered, no overflowing hard-wraps. JA later-section headings/bodies that live-render classified as
 *     card-title (0.833 → 58.31 / 41.65) keep weight 400 like EN/KO, but shrink to
 *     64.5px / 47.2px so Noto Sans JP ink height matches EN Noto Sans at 70/50
 *     (measured 51→47 heading, 36→34 body). JA-only hero slogan 1187:896 stays 31px;
 *     mobile 1187:1779 is 19px. Do not change DESIGN.md. Module7 titles 1187:2280 /
 *     1187:2294 / 1187:1392 / 1187:1408 follow Lark row 62 for Global (TW 賽季福利,
 *     EN Season Rewards, JA シーズン特典, KO 시즌 혜택). CN stays 赛季福利.
 *     EN welfare gold lines 1763/1766 use the confirmed 3px clip, not the Figma 0-height VECTOR.
 *     JA mobile 1763/1766 use the same 3px clip, inset 38px each side so the gold
 *     lines do not cover シーズン特典. Keep EN 50.9062. Do not change CN/TW/KO.
 *     CN mobile 1187:1841 lines 1845/1849/1853/1857 end with 。 like the
 *     confirmed CN page (避难所视觉升级。); Figma still uses ；. PC CN 959/963/967/971
 *     already end with 。. Global TW/EN/JA/KO mobile 1845/1849/1853/1857 follow
 *     Lark row 82 body (same as PC 959/963/967/971), with no trailing ； or 。.
 *     Module7 later titles 2280 / 2294 / 1408 / 1424 copy first-page 1824 / 938
 *     / 1392 type: same top, font-size, line-height, family, and EN/JA/KO
 *     font-weight 400 (CN/TW stay 600). Do not lift every 1830-type heading.
 *     Do not change DESIGN.md.
 */
import { copyFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OVERLAY_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'confirmed-overlay');
export const CONFIRMED_FASHIONBOX_FILE = '1187-1742.webp';
export const CONFIRMED_FASHIONBOX_SRC = path.join(OVERLAY_DIR, CONFIRMED_FASHIONBOX_FILE);
export const CONFIRMED_PRIZE_PC_FILE = '1187-986.webp';
export const CONFIRMED_PRIZE_PC_SRC = path.join(OVERLAY_DIR, CONFIRMED_PRIZE_PC_FILE);
export const CONFIRMED_DATE_PC_FILE = '1187-886-oneline.webp';
export const CONFIRMED_DATE_PC_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_PC_FILE);
export const CONFIRMED_DATE_MOBILE_FILE = '1187-1770-oneline.webp';
export const CONFIRMED_DATE_MOBILE_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_MOBILE_FILE);
export const CONFIRMED_DATE_PC_TWOLINE_FILE = '1187-886-twoline.webp';
export const CONFIRMED_DATE_PC_TWOLINE_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_PC_TWOLINE_FILE);
export const CONFIRMED_DATE_MOBILE_TWOLINE_FILE = '1187-1770-twoline.webp';
export const CONFIRMED_DATE_MOBILE_TWOLINE_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_MOBILE_TWOLINE_FILE);
export const CONFIRMED_DATE_PC_NODIV_FILE = '1187-886-twoline-nodiv.webp';
export const CONFIRMED_DATE_PC_NODIV_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_PC_NODIV_FILE);
export const CONFIRMED_DATE_MOBILE_NODIV_FILE = '1187-1770-twoline-nodiv.webp';
export const CONFIRMED_DATE_MOBILE_NODIV_SRC = path.join(OVERLAY_DIR, CONFIRMED_DATE_MOBILE_NODIV_FILE);

const STRIP_BULLET_LOCALES = new Set(['en', 'ko']);
const CONFIRMED_SEC10_LINES = Object.freeze({
  en: Object.freeze([
    'Built-in Pactspirit effect lookup',
    'Improved Compass Placement',
    'Auto Memory Crafting',
    'Faster loot drops',
  ]),
  ko: Object.freeze([
    '정령 적용 여부 확인 페이지 내장',
    '나침반 배치 편의성 개선',
    '추억 자동 제작',
    '드롭 속도 증가',
  ]),
});

const DATE_EMPTY_SECOND_NODES = Object.freeze(['1187:899', '1187:1777']);
const DATE_KEEP_NODES = Object.freeze(['1187:898', '1187:1776']);
const DATE_EMPTY_SECOND_LOCALES = Object.freeze(['tw', 'en', 'ko']);
const DATE_TWOLINE_LOCALES = Object.freeze(['cn', 'ja']);
const DATE_JA_SECOND_COPY = Object.freeze({
  '1187:899': '新シーズン 10月16日11:00',
  '1187:1777': '新シーズン 10月16日11:00',
});

const PRIZE_BADGE_NODES = Object.freeze(['1187:990', '1187:1748']);
const PRIZE_BADGE_COPY = Object.freeze({
  cn: '传奇掉落',
  tw: '傳奇掉落',
  en: 'Legendary',
  ko: '레전드 드롭!',
  ja: '伝説ドロップ',
});

const MORE_BUTTON_NODES = Object.freeze(['1187:974', '1187:1860', '1187:1008']);
const TW_MORE_FROM = '看更多';
const TW_MORE_TO = '查看更多';

const CRYSTAL_NODE = '1187:1761';
const CRYSTAL_COPY = Object.freeze({
  cn: '契灵结晶- 战斗×30',
  tw: '契靈結晶-戰鬥×30',
  en: 'Pactspirit Crystal - Battle x30',
  ko: '정령 결정 -전투×30',
  ja: 'ペットクリスタル-戦闘×30',
});
const CRYSTAL_STYLE = Object.freeze({
  cn: Object.freeze({
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.711px',
    width: '126px',
    minWidth: '126px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    height: '46px',
  }),
  tw: Object.freeze({
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.711px',
    width: '126px',
    minWidth: '0px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    wrapStyle: 'balance',
    height: 'auto',
    maxHeight: '52px',
  }),
  en: Object.freeze({
    fontSize: '15px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.711px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
  }),
  ko: Object.freeze({
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.711px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
  }),
  ja: Object.freeze({
    fontSize: '15px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.711px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
  }),
});
const CATALYST_NODE = '1187:1752';
const CATALYST_COPY = Object.freeze({
  cn: '触媒自选包',
  tw: '觸媒自選包',
  en: 'Activation Medium\n Selection Pack',
  ko: '기본 촉발체 \n자유 선택 상자',
  ja: '触媒自選パック',
});
const CATALYST_STYLE = Object.freeze({
  cn: Object.freeze({
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '22.54px',
    top: '123px',
    left: '106.766px',
    width: 'max-content',
    minWidth: '126px',
    whiteSpace: 'pre-wrap',
    height: '23px',
  }),
  tw: Object.freeze({
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '22.54px',
    top: '123px',
    left: '106.766px',
    width: '126px',
    minWidth: '0px',
    maxWidth: '126px',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    height: 'auto',
    maxHeight: '52px',
  }),
  en: Object.freeze({
    fontSize: '15px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.766px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    minHeight: '23px',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
    maxHeight: null,
  }),
  ko: Object.freeze({
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.766px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    minHeight: '23px',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
    maxHeight: null,
  }),
  ja: Object.freeze({
    fontSize: '15px',
    fontWeight: '400',
    lineHeight: '22.54px',
    top: '111.5px',
    left: '106.766px',
    width: 'max-content',
    minWidth: '126px',
    maxWidth: '126px',
    minHeight: '23px',
    whiteSpace: 'pre',
    overflowWrap: 'normal',
    wordBreak: 'keep-all',
    wrapStyle: 'initial',
    height: 'auto',
    maxHeight: null,
  }),
});
const DATE_KEEP_LOCAL_TOP = Object.freeze({
  '1187:898': 959,
  '1187:1776': 482.723,
});
const DATE_PLATE_NODES = Object.freeze({
  '1187:886': CONFIRMED_DATE_PC_FILE,
  '1187:1770': CONFIRMED_DATE_MOBILE_FILE,
});
const DATE_TWOLINE_NODES = Object.freeze({
  '1187:886': CONFIRMED_DATE_PC_TWOLINE_FILE,
  '1187:1770': CONFIRMED_DATE_MOBILE_TWOLINE_FILE,
});
const DATE_MOBILE_BANNER_LOCALES = Object.freeze(['en', 'ko', 'ja']);
const DATE_MOBILE_ONELINE_LOCALES = Object.freeze(['tw']);
const DATE_NODIV_LOCALES = Object.freeze(['en', 'ko']);
const DATE_PC_PLATE_FILE = {
  en: CONFIRMED_DATE_PC_NODIV_FILE,
  ko: CONFIRMED_DATE_PC_NODIV_FILE,
  tw: CONFIRMED_DATE_PC_FILE,
  ja: CONFIRMED_DATE_PC_TWOLINE_FILE,
  cn: CONFIRMED_DATE_PC_TWOLINE_FILE,
};
const DATE_MOBILE_PLATE_FILE = {
  en: CONFIRMED_DATE_MOBILE_NODIV_FILE,
  ko: CONFIRMED_DATE_MOBILE_NODIV_FILE,
  ja: CONFIRMED_DATE_MOBILE_TWOLINE_FILE,
  tw: CONFIRMED_DATE_MOBILE_FILE,
  cn: CONFIRMED_DATE_MOBILE_TWOLINE_FILE,
};
const MOBILE_PRIZE_FRAME = Object.freeze({
  nodeId: '1187:1742',
  width: '136.102px',
  height: '109.619px',
  box: '77.141,1294.381,136.102,109.619',
});
const PC_PRIZE_FRAME = Object.freeze({
  nodeId: '1187:986',
  width: '226.219px',
  height: '227.801px',
  box: '3453.781,627.199,226.219,227.801',
});
const MODULE7_BODY_NODES = Object.freeze(['1187:1416', '1187:1432', '1187:2288', '1187:2302']);
const MODULE7_MOBILE_P2 = Object.freeze({
  tw: Object.freeze({ fontSize: '20px', fontWeight: '600', lineHeight: '24px' }),
  en: Object.freeze({ fontSize: '20px', fontWeight: '400', lineHeight: '24px' }),
  ko: Object.freeze({ fontSize: '20px', fontWeight: '400', lineHeight: '24px' }),
  ja: Object.freeze({ fontSize: '20px', fontWeight: '400', lineHeight: '24px' }),
});
const MODULE7_MOBILE_P3 = Object.freeze({
  tw: Object.freeze({
    fontSize: '20px',
    fontWeight: '600',
    lineHeight: '24px',
    wrapStyle: 'balance',
  }),
  en: Object.freeze({
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '24px',
    wrapStyle: 'balance',
  }),
  ko: Object.freeze({
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '24px',
    wrapStyle: 'initial',
    whiteSpace: 'pre',
    wordBreak: 'keep-all',
    overflowWrap: 'normal',
    minHeight: '72px',
  }),
  ja: Object.freeze({
    fontSize: '20px',
    fontWeight: '400',
    lineHeight: '24px',
    wrapStyle: 'balance',
    whiteSpace: 'normal',
    wordBreak: 'normal',
    overflowWrap: 'normal',
    textAlign: 'center',
    minHeight: '72px',
  }),
});
const MODULE7_BODY_STYLE = Object.freeze({
  tw: Object.freeze({
    '1187:1416': Object.freeze({
      fontSize: '50px',
      fontWeight: '600',
      lineHeight: '56.35px',
    }),
    '1187:1432': Object.freeze({
      fontSize: '50px',
      fontWeight: '600',
      lineHeight: '56.35px',
      wrapStyle: 'balance',
    }),
    '1187:2288': MODULE7_MOBILE_P2.tw,
    '1187:2302': MODULE7_MOBILE_P3.tw,
  }),
  en: Object.freeze({
    '1187:1416': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
    }),
    '1187:1432': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
      wrapStyle: 'balance',
    }),
    '1187:2288': MODULE7_MOBILE_P2.en,
    '1187:2302': MODULE7_MOBILE_P3.en,
  }),
  ko: Object.freeze({
    '1187:1416': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    }),
    '1187:1432': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
      wrapStyle: 'initial',
      whiteSpace: 'pre',
      wordBreak: 'keep-all',
      overflowWrap: 'normal',
    }),
    '1187:2288': MODULE7_MOBILE_P2.ko,
    '1187:2302': MODULE7_MOBILE_P3.ko,
  }),
  ja: Object.freeze({
    '1187:1416': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    }),
    '1187:1432': Object.freeze({
      fontSize: '50px',
      fontWeight: '400',
      lineHeight: '56.35px',
      wrapStyle: 'initial',
      whiteSpace: 'pre',
      wordBreak: 'keep-all',
      overflowWrap: 'normal',
    }),
    '1187:2288': MODULE7_MOBILE_P2.ja,
    '1187:2302': MODULE7_MOBILE_P3.ja,
  }),
});
const MODULE7_BODY_COPY = Object.freeze({
  ko: Object.freeze({
    '1187:1432': '시즌 시리즈 이벤트 참여 시 레전드 전투 정령 30회 소환권, 레어 시즌 드롭 정령, \n레어 드롭 정령 승급 휘장, 한정 무기 외형 등 풍성한 보상을 획득할 수 있습니다.',
    '1187:2302': '시즌 시리즈 이벤트 참여 시 레전드 전투 정령 30회 소환권, \n레어 시즌 드롭 정령, 레어 드롭 정령 승급 휘장, \n한정 무기 외형 등 풍성한 보상을 획득할 수 있습니다.',
  }),
  ja: Object.freeze({
    '1187:1432': 'シーズン一連のイベントに参加すると、伝説戦闘ペット10連ガチャ券、レアなシーズンドロップペット、\nレアなドロップペットのランクアップバッジ、限定武器外見などの豪華報酬が手に入る！',
    '1187:2302': 'シーズン一連のイベントに参加すると、伝説戦闘ペット10連ガチャ券、レアなシーズンドロップペット、レアなドロップペットのランクアップバッジ、限定武器外見などの豪華報酬が手に入る！',
  }),
});
const JA_HEADING_MATCH_ENKO = Object.freeze({
  fontSize: '64.5px',
  fontWeight: '400',
  lineHeight: '79.3px',
});
const JA_BODY_MATCH_ENKO = Object.freeze({
  fontSize: '47.2px',
  fontWeight: '400',
  lineHeight: '53.2px',
});
const JA_TYPE_MATCH_ENKO = Object.freeze({
  'I1187:909;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:928;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:938;1187:1392;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:1408;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:1424;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:944;1187:1022': JA_HEADING_MATCH_ENKO,
  'I1187:954;1187:1022': JA_HEADING_MATCH_ENKO,
  '1187:926': JA_BODY_MATCH_ENKO,
  '1187:936': JA_BODY_MATCH_ENKO,
  '1187:952': JA_BODY_MATCH_ENKO,
  '1187:959': JA_BODY_MATCH_ENKO,
  '1187:963': JA_BODY_MATCH_ENKO,
  '1187:967': JA_BODY_MATCH_ENKO,
  '1187:971': JA_BODY_MATCH_ENKO,
  'I1187:938;1187:1400': JA_BODY_MATCH_ENKO,
});
const JA_HERO_SLOGAN = Object.freeze({
  '1187:896': Object.freeze({
    fontSize: '31px',
    lineHeight: '37.2px',
  }),
  '1187:1779': Object.freeze({
    fontSize: '19px',
    lineHeight: '22.8px',
  }),
});
const WELFARE_LINE_NODES = Object.freeze(['1187:1763', '1187:1766']);
const WELFARE_LINE_CLIP = Object.freeze({
  en: Object.freeze({
    '1187:1763': Object.freeze({
      height: '3px',
      minHeight: '3px',
      overflow: 'visible',
      clipPath: 'inset(0px 50.9062px 0px 0px)',
    }),
    '1187:1766': Object.freeze({
      height: '3px',
      minHeight: '3px',
      overflow: 'visible',
      clipPath: 'inset(0px 0px 0px 50.9062px)',
    }),
  }),
  ja: Object.freeze({
    '1187:1763': Object.freeze({
      height: '3px',
      minHeight: '3px',
      overflow: 'visible',
      clipPath: 'inset(0px 38px 0px 0px)',
    }),
    '1187:1766': Object.freeze({
      height: '3px',
      minHeight: '3px',
      overflow: 'visible',
      clipPath: 'inset(0px 0px 0px 38px)',
    }),
  }),
});

const PRIZE_ASSET_NODES = Object.freeze({
  '1187:1742': CONFIRMED_FASHIONBOX_FILE,
  '1187:986': CONFIRMED_PRIZE_PC_FILE,
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceOpenTag(html, nodeId, rewrite) {
  const needle = `data-node="${nodeId}"`;
  let from = 0;
  let out = '';
  let last = 0;
  let changed = false;
  while (from < html.length) {
    const idx = html.indexOf(needle, from);
    if (idx < 0) break;
    const start = html.lastIndexOf('<', idx);
    const gt = html.indexOf('>', idx);
    if (start < 0 || gt < 0 || start > idx) {
      from = idx + needle.length;
      continue;
    }
    const next = rewrite(html.slice(start, gt + 1));
    if (next != null && next !== html.slice(start, gt + 1)) {
      out += html.slice(last, start) + next;
      last = gt + 1;
      changed = true;
    }
    from = gt + 1;
  }
  if (!changed) return html;
  return out + html.slice(last);
}

function firstTextRange(html, nodeId, from = 0) {
  const needle = `data-node="${nodeId}"`;
  const idx = html.indexOf(needle, from);
  if (idx < 0) return null;
  const start = html.lastIndexOf('<', idx);
  const gt = html.indexOf('>', idx);
  if (start < 0 || gt < 0 || start > idx) return null;
  const next = html.indexOf('<', gt + 1);
  if (next < 0) return null;
  return { start, tagEnd: gt + 1, textStart: gt + 1, textEnd: next, searchFrom: next };
}

function replaceTextContent(html, nodeId, nextText) {
  let from = 0;
  let out = '';
  let last = 0;
  let changed = false;
  while (from < html.length) {
    const range = firstTextRange(html, nodeId, from);
    if (!range) break;
    const current = html.slice(range.textStart, range.textEnd);
    if (current !== nextText) {
      out += html.slice(last, range.textStart) + nextText;
      last = range.textEnd;
      changed = true;
    }
    from = range.searchFrom;
  }
  if (!changed) return html;
  return out + html.slice(last);
}

function rewriteShallowChunk(html, nodeId, rewrite) {
  const needle = `data-node="${nodeId}"`;
  let from = 0;
  let out = '';
  let last = 0;
  let changed = false;
  while (from < html.length) {
    const idx = html.indexOf(needle, from);
    if (idx < 0) break;
    const start = html.lastIndexOf('<', idx);
    const gt = html.indexOf('>', idx);
    if (start < 0 || gt < 0 || start > idx) {
      from = idx + needle.length;
      continue;
    }
    const end = Math.min(html.length, start + 1800);
    const raw = html.slice(start, end);
    const next = rewrite(raw);
    if (next != null && next !== raw) {
      out += html.slice(last, start) + next;
      last = end;
      changed = true;
      from = end;
    } else {
      from = gt + 1;
    }
  }
  if (!changed) return html;
  return out + html.slice(last);
}

function hideOpenTag(tag) {
  let next = tag;
  if (/\saria-hidden="/i.test(next)) {
    next = next.replace(/\saria-hidden="[^"]*"/i, ' aria-hidden="true"');
  } else {
    next = next.replace(/>$/, ' aria-hidden="true">');
  }
  if (/\sstyle="/i.test(next)) {
    next = next.replace(/\sstyle="([^"]*)"/i, (_, css) => {
      let out = String(css || '');
      out = out.replace(/display\s*:\s*[^;"]+;?/gi, '');
      out = out.replace(/visibility\s*:\s*[^;"]+;?/gi, '');
      out = out.replace(/;\s*;/g, ';').replace(/^\s*;\s*/, '').trim();
      const bits = ['display: none', 'visibility: hidden'];
      return ` style="${out}${out && !out.endsWith(';') ? ';' : ''}${out ? ' ' : ''}${bits.join('; ')}"`;
    });
  } else {
    next = next.replace(/>$/, ' style="display: none; visibility: hidden;">');
  }
  return next;
}

export function stripConfirmedSec10Bullets(text, locale) {
  if (!STRIP_BULLET_LOCALES.has(locale)) return String(text ?? '');
  const lines = CONFIRMED_SEC10_LINES[locale] || [];
  let out = String(text ?? '');
  for (const line of lines) {
    const re = new RegExp('•\\s*' + escapeRegExp(line), 'g');
    out = out.replace(re, line);
  }
  return out;
}

const CN_TW_SEC10_PERIOD_NODES = Object.freeze([
  '1187:1845',
  '1187:1849',
  '1187:1853',
  '1187:1857',
]);
const CN_TW_SEC10_PERIOD_COPY = Object.freeze({
  '1187:1845': '避难所视觉升级。',
  '1187:1849': '异界体验优化打宝更便捷。',
  '1187:1853': '交易行查价&amp;快速购买优化。',
  '1187:1857': '新赛季契灵被动生效，无需切换。',
});

export function applyConfirmedCnTwSec10PeriodOverlay(html, locale) {
  if (locale !== 'cn') return html;
  let out = String(html || '');
  for (const nodeId of CN_TW_SEC10_PERIOD_NODES) {
    out = replaceTextContent(out, nodeId, CN_TW_SEC10_PERIOD_COPY[nodeId]);
  }
  return out;
}

const GLOBAL_SEC10_MOBILE_NODES = CN_TW_SEC10_PERIOD_NODES;
const GLOBAL_SEC10_MOBILE_COPY = Object.freeze({
  tw: Object.freeze({
    '1187:1845': '契靈生效查詢頁內置',
    '1187:1849': '羅盤放置體驗優化',
    '1187:1853': '追憶自動打造',
    '1187:1857': '掉落速度加快',
  }),
  en: Object.freeze({
    '1187:1845': 'Built-in Pactspirit effect lookup',
    '1187:1849': 'Improved Compass Placement',
    '1187:1853': 'Auto Memory Crafting',
    '1187:1857': 'Faster loot drops',
  }),
  ja: Object.freeze({
    '1187:1845': 'ペットの有効状態が確認できる専用ページをゲーム内に実装',
    '1187:1849': 'コントローラー使用時のトレードハウス＆\n異界の操作フローを最適化',
    '1187:1853': '異界の特殊マップモディファイアにカスタムマーク機能を追加',
    '1187:1857': 'ドロップスピードの高速化',
  }),
  ko: Object.freeze({
    '1187:1845': '정령 적용 여부 확인 페이지 내장',
    '1187:1849': '나침반 배치 편의성 개선',
    '1187:1853': '추억 자동 제작',
    '1187:1857': '드롭 속도 증가',
  }),
});

const GLOBAL_SEC10_MOBILE_STYLE = Object.freeze({
  tw: Object.freeze({}),
  en: Object.freeze({ fontWeight: '400' }),
  ko: Object.freeze({ fontWeight: '400' }),
  ja: Object.freeze({
    fontWeight: '400',
    whiteSpace: 'pre-wrap',
  }),
});

export function applyConfirmedGlobalSec10MobileOverlay(html, locale) {
  const copy = GLOBAL_SEC10_MOBILE_COPY[locale];
  if (!copy) return html;
  let out = String(html || '');
  const spec = GLOBAL_SEC10_MOBILE_STYLE[locale] || {};
  for (const nodeId of GLOBAL_SEC10_MOBILE_NODES) {
    out = replaceTextContent(out, nodeId, copy[nodeId]);
    out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, {
      ...captionCss(spec),
      ...localeFontProps(locale),
    }));
  }
  return out;
}

export function applyConfirmedPrizeBadgeOverlay(html, locale) {
  const next = PRIZE_BADGE_COPY[locale];
  if (!next) return html;
  let out = String(html || '');
  const isForeign = locale === 'en' || locale === 'ko' || locale === 'ja';
  for (const nodeId of PRIZE_BADGE_NODES) {
    out = replaceTextContent(out, nodeId, next);
    out = replaceOpenTag(out, nodeId, (tag) => {
      const props = {
        height: 'auto',
        'min-height': '0px',
        'max-height': nodeId === '1187:1748' ? '68px' : '100.65px',
        overflow: 'visible',
      };
      if (isForeign) {
        props['font-weight'] = '400';
        if (nodeId === '1187:1748') {
          props['font-size'] = locale === 'en' ? '9px' : locale === 'ja' ? '10px' : '11px';
          props['line-height'] = locale === 'en' ? '11px' : locale === 'ja' ? '10px' : '11px';
        }
        if (nodeId === '1187:990') {
          props['font-size'] = locale === 'en' || locale === 'ja' ? '19.3px' : '21.3px';
          props['line-height'] = locale === 'en' || locale === 'ja' ? '21.3px' : '21.3px';
        }
      }
      return patchCss(tag, props);
    });
  }
  return out;
}

const WELFARE_NODE = '1187:1765';
const WELFARE_COPY = Object.freeze({
  cn: '赛季福利',
  tw: '賽季福利',
  en: 'Season Rewards',
  ko: '시즌 혜택',
  ja: 'シーズン特典',
});
const MODULE7_TITLE_NODES = Object.freeze([
  'I1187:2280;1187:1897',
  'I1187:2294;1187:1897',
  'I1187:938;1187:1392;1187:1022',
  'I1187:1408;1187:1022',
  'I1187:1424;1187:1022',
]);
const MODULE7_TITLE_COPY = WELFARE_COPY;
const MODULE7_TITLE_STYLE_MOBILE = Object.freeze([
  'I1187:2280;1187:1897',
  'I1187:2294;1187:1897',
]);
const MODULE7_TITLE_STYLE_PC = Object.freeze([
  'I1187:1408;1187:1022',
  'I1187:1424;1187:1022',
]);
const MODULE7_TITLE_FIRST_MOBILE = 'I1187:1824;1187:2266;1187:1897';
const MODULE7_TITLE_FIRST_PC = 'I1187:938;1187:1392;1187:1022';
const MODULE7_TITLE_TYPE_KEYS = Object.freeze([
  'top',
  'font-size',
  'line-height',
  'letter-spacing',
  'font-family',
  'font-synthesis',
  'white-space',
  'min-height',
  'height',
  'max-height',
  'min-width',
  'max-width',
  'width',
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'overflow-wrap',
  'word-break',
  'text-wrap-style',
  'box-sizing',
]);

export function applyConfirmedWelfareOverlay(html, locale) {
  const next = WELFARE_COPY[locale];
  if (!next) return html;
  let out = replaceTextContent(html, WELFARE_NODE, next);
  const props = { left: '375px', ...localeFontProps(locale) };
  if (locale === 'en' || locale === 'ko' || locale === 'ja') props['font-weight'] = '400';
  out = replaceOpenTag(out, WELFARE_NODE, (tag) => {
    let next = patchCss(tag, props);
    if (!/\sdata-ss14-slg-base-left="/i.test(next)) {
      next = next.replace(/>$/, ' data-ss14-slg-base-left="375">');
    }
    return next;
  });
  const lineSpec = WELFARE_LINE_CLIP[locale];
  if (lineSpec) {
    for (const nodeId of WELFARE_LINE_NODES) {
      const spec = lineSpec[nodeId];
      if (!spec) continue;
      out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, captionCss(spec)));
    }
  }
  return out;
}

function pinDateOpenTag(tag, nodeId) {
  let next = tag;
  const originY = Number((tag.match(/data-skipped-al-origin-y="([^"]+)"/) || [])[1]);
  const boxY = Number((tag.match(/data-skipped-al-box-y="([^"]+)"/) || [])[1]);
  const boxH = Number((tag.match(/data-skipped-al-box-h="([^"]+)"/) || [])[1]);
  const sourceH = Number((tag.match(/data-skipped-al-source-h="([^"]+)"/) || [])[1]);
  let localTop = DATE_KEEP_LOCAL_TOP[nodeId];
  if (Number.isFinite(boxY) && Number.isFinite(boxH) && Number.isFinite(originY) && Number.isFinite(sourceH)) {
    localTop = boxY + (boxH - sourceH) / 2 - originY;
  }
  if (Number.isFinite(localTop) && /\sstyle="/i.test(next)) {
    next = next.replace(/top:\s*[^;"]+/i, `top: ${localTop}px`);
    if (nodeId === '1187:898') next = next.replace(/left:\s*[^;"]+/i, 'left: 1920.5px');
  }
  if (/\sdata-confirmed-date-slot="/i.test(next)) return next;
  return next.replace(/>$/, ' data-confirmed-date-slot="single-center">');
}

function rewriteDatePlateSrc(html, nodeId, fromName, toName) {
  if (!fromName || !toName || fromName === toName) return html;
  const needle = `data-node="${nodeId}"`;
  const idx = html.indexOf(needle);
  if (idx < 0) return html;
  const start = html.lastIndexOf('<', idx);
  const windowEnd = Math.min(html.length, start + 4000);
  const raw = html.slice(start, windowEnd);
  const next = raw.replace(new RegExp(escapeRegExp(fromName), 'g'), toName);
  if (next === raw) return html;
  return html.slice(0, start) + next + html.slice(windowEnd);
}

export function applyConfirmedDateSlotOverlay(html, locale) {
  let out = String(html || '');
  if (DATE_EMPTY_SECOND_LOCALES.includes(locale)) {
    for (const nodeId of DATE_EMPTY_SECOND_NODES) {
      out = replaceOpenTag(out, nodeId, hideOpenTag);
      out = replaceTextContent(out, nodeId, '');
    }
    for (const nodeId of DATE_KEEP_NODES) {
      out = replaceOpenTag(out, nodeId, (tag) => pinDateOpenTag(tag, nodeId));
    }
    const pcPlate = DATE_PC_PLATE_FILE[locale] || CONFIRMED_DATE_PC_FILE;
    const mobilePlate = DATE_MOBILE_PLATE_FILE[locale] || CONFIRMED_DATE_MOBILE_FILE;
    out = rewriteDatePlateSrc(out, '1187:886', '1187-886.webp', pcPlate);
    out = rewriteDatePlateSrc(out, '1187:1770', '1187-1770.webp', mobilePlate);
    out = replaceOpenTag(out, '1187:886', (tag) => {
      if (/\sdata-confirmed-date-plate="/i.test(tag)) return tag;
      const kind = DATE_NODIV_LOCALES.includes(locale) ? 'twoline-nodiv' : 'oneline';
      return tag.replace(/>$/, ` data-confirmed-date-plate="${kind}">`);
    });
    out = replaceOpenTag(out, '1187:1770', (tag) => {
      if (/\sdata-confirmed-date-plate="/i.test(tag)) return tag;
      const kind = DATE_NODIV_LOCALES.includes(locale)
        ? 'twoline-nodiv'
        : DATE_MOBILE_BANNER_LOCALES.includes(locale) ? 'twoline' : 'oneline';
      return tag.replace(/>$/, ` data-confirmed-date-plate="${kind}">`);
    });
    return out;
  }
  if (DATE_TWOLINE_LOCALES.includes(locale)) {
    if (locale === 'ja') {
      for (const nodeId of DATE_EMPTY_SECOND_NODES) {
        const copy = DATE_JA_SECOND_COPY[nodeId];
        if (copy) out = replaceTextContent(out, nodeId, copy);
      }
    }
    out = rewriteDatePlateSrc(out, '1187:886', '1187-886.webp', CONFIRMED_DATE_PC_TWOLINE_FILE);
    out = rewriteDatePlateSrc(out, '1187:1770', '1187-1770.webp', CONFIRMED_DATE_MOBILE_TWOLINE_FILE);
    for (const nodeId of Object.keys(DATE_TWOLINE_NODES)) {
      out = replaceOpenTag(out, nodeId, (tag) => {
        if (/\sdata-confirmed-date-plate="/i.test(tag)) return tag;
        return tag.replace(/>$/, ' data-confirmed-date-plate="twoline">');
      });
    }
  }
  return out;
}

const MORE_LABEL_NODES = Object.freeze([
  'I1187:974;1187:1141',
  'I1187:1860;1187:1988',
  'I1187:1008;1187:1135',
]);

export function applyConfirmedMoreButtonOverlay(html, locale) {
  if (locale !== 'tw') return html;
  let out = String(html || '');
  for (const nodeId of MORE_LABEL_NODES) {
    out = replaceTextContent(out, nodeId, TW_MORE_TO);
  }
  return out;
}

function splitCssDecls(css) {
  const decls = [];
  let buf = '';
  let i = 0;
  const src = String(css || '');
  while (i < src.length) {
    if (src.startsWith('&quot;', i)) {
      buf += '&quot;';
      i += 6;
      continue;
    }
    const ch = src[i];
    if (ch === ';') {
      const piece = buf.trim();
      if (piece) decls.push(piece);
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) decls.push(tail);
  return decls;
}

function patchCss(tag, props) {
  if (!/\sstyle="/i.test(tag)) return tag;
  return tag.replace(/\sstyle="([^"]*)"/i, (_, css) => {
    const decls = splitCssDecls(css);
    const order = [];
    const map = new Map();
    for (const decl of decls) {
      const idx = decl.indexOf(':');
      if (idx < 0) continue;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const value = decl.slice(idx + 1).trim();
      if (!map.has(prop)) order.push(prop);
      map.set(prop, value);
    }
    for (const [prop, value] of Object.entries(props)) {
      const key = String(prop).toLowerCase();
      if (value == null) {
        map.delete(key);
        continue;
      }
      if (!map.has(key)) order.push(key);
      map.set(key, String(value));
    }
    const next = order
      .filter((prop) => map.has(prop))
      .map((prop) => `${prop}: ${map.get(prop)}`)
      .join('; ');
    return ` style="${next}"`;
  });
}

const OVERLAY_FONT_FAMILY = Object.freeze({
  tw: '&quot;Noto Sans HK&quot;, &quot;Noto Sans KR&quot;, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif',
  en: '&quot;Noto Sans&quot;, &quot;Noto Sans KR&quot;, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif',
  ko: '&quot;Noto Sans KR&quot;, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif',
  ja: '&quot;Noto Sans JP&quot;, &quot;Noto Sans KR&quot;, &quot;PingFang SC&quot;, &quot;Microsoft YaHei&quot;, sans-serif',
});

function localeFontProps(locale) {
  const family = OVERLAY_FONT_FAMILY[locale];
  if (!family) return {};
  return {
    'font-family': family,
    'font-variation-settings': null,
    'font-synthesis': null,
  };
}

function captionCss(spec) {
  if (!spec) return {};
  const props = {};
  if (spec.fontSize) props['font-size'] = spec.fontSize;
  if (spec.fontWeight) props['font-weight'] = spec.fontWeight;
  if (spec.lineHeight) props['line-height'] = spec.lineHeight;
  if (spec.top) props.top = spec.top;
  if (spec.left) props.left = spec.left;
  if (spec.width) props.width = spec.width;
  if (spec.minWidth) props['min-width'] = spec.minWidth;
  if (spec.maxWidth) props['max-width'] = spec.maxWidth;
  if (spec.minHeight) props['min-height'] = spec.minHeight;
  if (spec.maxHeight !== undefined) props['max-height'] = spec.maxHeight;
  if (spec.whiteSpace) props['white-space'] = spec.whiteSpace;
  if (spec.overflowWrap) props['overflow-wrap'] = spec.overflowWrap;
  if (spec.wordBreak) props['word-break'] = spec.wordBreak;
  if (spec.wrapStyle) props['text-wrap-style'] = spec.wrapStyle;
  if (spec.height) props.height = spec.height;
  if (spec.maxHeight) props['max-height'] = spec.maxHeight;
  if (spec.clipPath) props['clip-path'] = spec.clipPath;
  if (spec.overflow) props.overflow = spec.overflow;
  if (spec.textAlign) props['text-align'] = spec.textAlign;
  return props;
}

function applyCaptionBox(html, nodeId, { text, spec, locale } = {}) {
  let out = String(html || '');
  if (text != null) out = replaceTextContent(out, nodeId, text);
  const props = { ...captionCss(spec), ...localeFontProps(locale) };
  if (!Object.keys(props).length) return out;
  out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, props));
  return out;
}

export function applyConfirmedCrystalCaptionOverlay(html, locale) {
  return applyCaptionBox(html, CRYSTAL_NODE, {
    text: CRYSTAL_COPY[locale],
    spec: CRYSTAL_STYLE[locale],
    locale,
  });
}

export function applyConfirmedCatalystCaptionOverlay(html, locale) {
  return applyCaptionBox(html, CATALYST_NODE, {
    text: CATALYST_COPY[locale],
    spec: CATALYST_STYLE[locale],
    locale,
  });
}

function fitPrizeImg(tag) {
  if (!/\sstyle="/i.test(tag)) return tag;
  return tag.replace(/\sstyle="([^"]*)"/i, (_, css) => {
    let out = String(css || '');
    out = out.replace(/left\s*:\s*[^;"]+/i, 'left: 0px');
    out = out.replace(/top\s*:\s*[^;"]+/i, 'top: 0px');
    out = out.replace(/width\s*:\s*[^;"]+/i, 'width: 100%');
    out = out.replace(/height\s*:\s*[^;"]+/i, 'height: 100%');
    if (!/object-fit\s*:/i.test(out)) out += '; object-fit: fill';
    else out = out.replace(/object-fit\s*:\s*[^;"]+/i, 'object-fit: fill');
    return ` style="${out}"`;
  });
}

function fitPrizeFrame(tag, frame) {
  let next = tag;
  if (/\sdata-node-box="/i.test(next)) {
    next = next.replace(/\sdata-node-box="[^"]*"/i, ` data-node-box="${frame.box}"`);
  }
  next = patchCss(next, { width: frame.width, height: frame.height });
  return next;
}

export function applyConfirmedPrizeArtGeometryOverlay(html) {
  let out = String(html || '');
  out = replaceOpenTag(out, MOBILE_PRIZE_FRAME.nodeId, (tag) => fitPrizeFrame(tag, MOBILE_PRIZE_FRAME));
  out = replaceOpenTag(out, PC_PRIZE_FRAME.nodeId, (tag) => fitPrizeFrame(tag, PC_PRIZE_FRAME));
  out = rewriteShallowChunk(out, MOBILE_PRIZE_FRAME.nodeId, (chunk) => (
    chunk.replace(/<img\b[^>]*>/i, (img) => fitPrizeImg(img))
  ));
  out = rewriteShallowChunk(out, PC_PRIZE_FRAME.nodeId, (chunk) => (
    chunk.replace(/<img\b[^>]*>/i, (img) => fitPrizeImg(img))
  ));
  return out;
}

function headingWeightProps(locale) {
  if (locale !== 'en' && locale !== 'ko' && locale !== 'ja') return {};
  return {
    'font-weight': '400',
    'font-variation-settings': null,
  };
}

function cssMapFromTag(tag) {
  const match = String(tag || '').match(/\sstyle="([^"]*)"/i);
  if (!match) return new Map();
  const map = new Map();
  for (const decl of splitCssDecls(match[1])) {
    const idx = decl.indexOf(':');
    if (idx < 0) continue;
    map.set(decl.slice(0, idx).trim().toLowerCase(), decl.slice(idx + 1).trim());
  }
  return map;
}

function typePropsFromTag(tag, locale) {
  const map = cssMapFromTag(tag);
  const props = {};
  for (const key of MODULE7_TITLE_TYPE_KEYS) {
    if (map.has(key)) props[key] = map.get(key);
  }
  Object.assign(props, headingWeightProps(locale));
  if (locale === 'en' || locale === 'ko' || locale === 'ja') {
    Object.assign(props, localeFontProps(locale));
  }
  return props;
}

function copyTitleTypeFromFirst(html, firstId, laterIds, locale) {
  const range = firstTextRange(html, firstId);
  if (!range) return html;
  const firstTag = html.slice(range.start, range.tagEnd);
  const props = typePropsFromTag(firstTag, locale);
  if (!Object.keys(props).length) return html;
  let out = html;
  for (const nodeId of laterIds) {
    out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, props));
  }
  return out;
}

export function applyConfirmedModule7TitleOverlay(html, locale) {
  const next = MODULE7_TITLE_COPY[locale];
  if (!next) return html;
  let out = String(html || '');
  for (const nodeId of MODULE7_TITLE_NODES) {
    out = replaceTextContent(out, nodeId, next);
  }
  out = copyTitleTypeFromFirst(out, MODULE7_TITLE_FIRST_MOBILE, MODULE7_TITLE_STYLE_MOBILE, locale);
  out = copyTitleTypeFromFirst(out, MODULE7_TITLE_FIRST_PC, MODULE7_TITLE_STYLE_PC, locale);
  const weight = headingWeightProps(locale);
  if (weight['font-weight']) {
    out = replaceOpenTag(out, MODULE7_TITLE_FIRST_MOBILE, (tag) => patchCss(tag, weight));
    out = replaceOpenTag(out, MODULE7_TITLE_FIRST_PC, (tag) => patchCss(tag, weight));
  }
  return out;
}

export function applyConfirmedModule7Overlay(html, locale) {
  const localeSpec = MODULE7_BODY_STYLE[locale];
  let out = applyConfirmedModule7TitleOverlay(html, locale);
  if (!localeSpec) return out;
  const copy = MODULE7_BODY_COPY[locale] || {};
  for (const nodeId of MODULE7_BODY_NODES) {
    const spec = localeSpec[nodeId];
    if (!spec) continue;
    if (copy[nodeId] != null) out = replaceTextContent(out, nodeId, copy[nodeId]);
    out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, {
      ...captionCss(spec),
      ...localeFontProps(locale),
    }));
  }
  return out;
}

export function applyConfirmedJaTypeMatchOverlay(html, locale) {
  if (locale !== 'ja') return html;
  let out = String(html || '');
  for (const [nodeId, spec] of Object.entries(JA_TYPE_MATCH_ENKO)) {
    out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, {
      ...captionCss(spec),
      ...localeFontProps('ja'),
    }));
  }
  for (const [nodeId, spec] of Object.entries(JA_HERO_SLOGAN)) {
    out = replaceOpenTag(out, nodeId, (tag) => patchCss(tag, captionCss(spec)));
  }
  return out;
}

export function applyConfirmedCopyOverlay(html, locale) {
  let out = stripConfirmedSec10Bullets(html, locale);
  out = applyConfirmedCnTwSec10PeriodOverlay(out, locale);
  out = applyConfirmedGlobalSec10MobileOverlay(out, locale);
  out = applyConfirmedPrizeBadgeOverlay(out, locale);
  out = applyConfirmedWelfareOverlay(out, locale);
  out = applyConfirmedDateSlotOverlay(out, locale);
  out = applyConfirmedMoreButtonOverlay(out, locale);
  out = applyConfirmedCrystalCaptionOverlay(out, locale);
  out = applyConfirmedCatalystCaptionOverlay(out, locale);
  out = applyConfirmedPrizeArtGeometryOverlay(out);
  out = applyConfirmedJaTypeMatchOverlay(out, locale);
  out = applyConfirmedModule7Overlay(out, locale);
  return out;
}

function assetSrcs(html, nodeId, fileName) {
  const found = [];
  const markup = String(html || '');
  const nodeRe = new RegExp(`<[^>]+data-node="${escapeRegExp(nodeId)}"[^>]*>`, 'gi');
  let tag;
  while ((tag = nodeRe.exec(markup))) {
    const src = tag[0].match(/\ssrc="([^"]+)"/i);
    if (src && src[1]) found.push(src[1]);
  }
  const imgRe = new RegExp(`<img\\b[^>]*src="([^"]*${escapeRegExp(fileName)})"[^>]*>`, 'gi');
  while ((tag = imgRe.exec(markup))) {
    const node = tag[0].match(/\sdata-node="([^"]+)"/i);
    if (!node || node[1] === nodeId) found.push(tag[1]);
  }
  if (!found.length) {
    const fileRe = new RegExp(`(?:src|href)="([^"]*${escapeRegExp(fileName)})"`, 'gi');
    while ((tag = fileRe.exec(markup))) found.push(tag[1]);
  }
  return [...new Set(found)];
}

async function copyOverlayAsset(srcPath, html, stagingAssets, nodeId, fileName) {
  const hrefs = assetSrcs(html, nodeId, fileName);
  if (!hrefs.length) return [];
  if (!existsSync(srcPath)) {
    throw new Error('CONFIRMED_OVERLAY_MISSING:' + srcPath);
  }
  const files = [];
  for (const href of hrefs) {
    const destName = path.basename(String(href).split(/[?#]/)[0]);
    if (!destName) continue;
    await copyFile(srcPath, path.join(stagingAssets, destName));
    files.push(destName);
  }
  return files;
}

function datePlateSrc(fileName) {
  if (fileName === CONFIRMED_DATE_PC_FILE) return CONFIRMED_DATE_PC_SRC;
  if (fileName === CONFIRMED_DATE_MOBILE_FILE) return CONFIRMED_DATE_MOBILE_SRC;
  if (fileName === CONFIRMED_DATE_PC_TWOLINE_FILE) return CONFIRMED_DATE_PC_TWOLINE_SRC;
  if (fileName === CONFIRMED_DATE_MOBILE_TWOLINE_FILE) return CONFIRMED_DATE_MOBILE_TWOLINE_SRC;
  if (fileName === CONFIRMED_DATE_PC_NODIV_FILE) return CONFIRMED_DATE_PC_NODIV_SRC;
  if (fileName === CONFIRMED_DATE_MOBILE_NODIV_FILE) return CONFIRMED_DATE_MOBILE_NODIV_SRC;
  return null;
}

export async function applyConfirmedFashionBoxOverlay({ html, stagingAssets, assetsHref, locale } = {}) {
  if (!html || !stagingAssets) return { replaced: false, files: [] };
  const files = [];
  for (const [nodeId, fileName] of Object.entries(PRIZE_ASSET_NODES)) {
    const srcPath = fileName === CONFIRMED_PRIZE_PC_FILE
      ? CONFIRMED_PRIZE_PC_SRC
      : CONFIRMED_FASHIONBOX_SRC;
    files.push(...await copyOverlayAsset(srcPath, html, stagingAssets, nodeId, fileName));
  }
  const plateNodes = {};
  if (DATE_EMPTY_SECOND_LOCALES.includes(locale)) {
    plateNodes['1187:886'] = DATE_PC_PLATE_FILE[locale] || CONFIRMED_DATE_PC_FILE;
    plateNodes['1187:1770'] = DATE_MOBILE_PLATE_FILE[locale] || CONFIRMED_DATE_MOBILE_FILE;
  } else if (DATE_TWOLINE_LOCALES.includes(locale)) {
    plateNodes['1187:886'] = CONFIRMED_DATE_PC_TWOLINE_FILE;
    plateNodes['1187:1770'] = CONFIRMED_DATE_MOBILE_TWOLINE_FILE;
  }
  if (Object.keys(plateNodes).length) {
    for (const [nodeId, fileName] of Object.entries(plateNodes)) {
      const srcPath = datePlateSrc(fileName);
      if (!srcPath) continue;
      files.push(...await copyOverlayAsset(srcPath, html, stagingAssets, nodeId, fileName));
    }
    for (const leftover of ['1187-886.webp', '1187-1770.webp']) {
      const leftoverPath = path.join(stagingAssets, leftover);
      if (!existsSync(leftoverPath)) continue;
      await unlink(leftoverPath);
    }
  }
  return { replaced: files.length > 0, files: [...new Set(files)], assetsHref: assetsHref || null };
}
