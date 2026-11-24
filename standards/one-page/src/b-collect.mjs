import { compileOnePage } from '../../figma-naming/tool/src/onepage/compile.mjs';
import { assertDesignSets } from './design-sets.mjs';
import { pairEnds } from './same-modules.mjs';
import { problemsFromInventories, problem } from './problems.mjs';
import {
  buildButtonQuestions,
  buildCarouselQuestions,
  buildTabQuestions,
  numberCards,
} from './questions.mjs';
import { buildDataHintQuestions } from './data-hints.mjs';
import { autoMotions } from './motion-auto.mjs';
import {
  buildFontQuestions,
  checkFontFiles,
  missingLangVariants,
} from './fonts-b2.mjs';
import {
  unwrapSnapshot,
  identifyLanguageColumns,
  detectBatches,
  matchTranslations,
} from './translations.mjs';
import {
  productNodes,
  nodeById,
  sectionNumberOf,
  insideRole,
  textCharacters,
  linkKeysInInventories,
  linkKeyStyle,
} from './inventory-walk.mjs';
import { canonicalJson, sha256Hex } from './canonical.mjs';

const TYPE_ORDER = [
  'l10n-columns',
  'l10n-batches',
  'l10n-choice',
  'button-cross-end',
  'button-action',
  'carousel',
  'tab',
  'font-map',
  'data-static-or-dynamic',
];

function metaOf(config) {
  return (config && typeof config.meta === 'object' && !Array.isArray(config.meta)) ? config.meta : {};
}

function answeredKeysFromMeta(meta, type) {
  const out = new Set();
  for (const row of Object.values(meta?.answers || {})) {
    if (row?.status === 'stale') continue;
    if (type && row.type !== type) continue;
    if (row.componentKey) out.add(row.componentKey);
  }
  return out;
}

function autoLinks(inventories, config) {
  if (Object.hasOwn(config || {}, 'links') && !object(config.links)) {
    return { links: config.links, added: [] };
  }
  const links = object(config?.links) ? { ...config.links } : {};
  const added = [];
  for (const inv of Object.values(inventories || {})) {
    for (const node of productNodes(inv)) {
      const key = node.params?.link;
      if (!key) continue;
      if (!Object.hasOwn(links, key)) {
        links[key] = { url: null };
        added.push(key);
      }
    }
  }
  return { links, added };
}

function object(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function aggregateLinkTodos(inventories) {
  const groups = new Map();
  for (const end of ['pc', 'mobile']) {
    const inv = inventories?.[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const row of inv.devTodo || []) {
      if (row.kind && row.kind !== 'link-url-pending') continue;
      if (row.kind == null && row.key == null && !row.node) continue;
      const key = row.key == null || row.key === '' ? '(无键)' : String(row.key);
      if (!groups.has(key)) {
        groups.set(key, {
          kind: 'link-url-pending',
          blocking: false,
          key: row.key ?? null,
          count: 0,
          buttons: [],
          locations: [],
        });
      }
      const group = groups.get(key);
      const node = row.node?.id ? byId.get(row.node.id) : null;
      const rawName = node?.name || node?.label || row.node?.id || '按钮';
      const name = String(rawName).split('@')[0];
      const section = row.section ?? sectionNumberOf(node, byId);
      group.count += 1;
      if (!group.buttons.includes(name)) group.buttons.push(name);
      group.locations.push({
        end,
        section,
        nodeId: row.node?.id ?? null,
        name,
      });
    }
  }
  return [...groups.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function collectCopyTexts(inventories) {
  const texts = [];
  for (const end of ['pc', 'mobile']) {
    const inv = inventories[end];
    if (!inv) continue;
    const byId = nodeById(inv);
    for (const node of productNodes(inv)) {
      const characters = textCharacters(node);
      if (!characters) continue;
      if (insideRole(node, byId, ['img', 'bg', 'kv'])) continue;
      texts.push({
        end,
        nodeId: node.id,
        section: sectionNumberOf(node, byId),
        name: node.name || characters.slice(0, 20),
        characters,
      });
    }
  }
  return texts;
}

function sortQuestions(items) {
  return [...items].sort((a, b) => {
    const type = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
    if (type) return type;
    const object = String(a.object).localeCompare(String(b.object));
    if (object) return object;
    const left = a.locations?.[0]?.nodeId || '';
    const right = b.locations?.[0]?.nodeId || '';
    return String(left).localeCompare(String(right));
  });
}

function recompile(snapshot, config, platform) {
  const design = assertDesignSets(snapshot.document, platform);
  const inventories = {};
  for (const set of design.selected) {
    inventories[set.end] = compileOnePage(snapshot.document, {
      requestedNodeId: set.id,
      config,
      fileKey: snapshot.fileKey,
    });
  }
  const pairing = pairEnds({
    platform,
    pc: inventories.pc ?? null,
    mobile: inventories.mobile ?? null,
  });
  return { design, inventories, pairing, problems: problemsFromInventories(inventories, pairing) };
}

function findLiveNode(inventories, nodeId) {
  for (const inv of Object.values(inventories || {})) {
    const hit = (inv?.nodes || []).find((node) => node.id === nodeId);
    if (hit) return hit;
  }
  return null;
}

function answerIdentityChanged(row, inventories) {
  for (const loc of row.locations || []) {
    if (!loc?.nodeId) continue;
    const node = findLiveNode(inventories, loc.nodeId);
    if (!node) continue;
    if (loc.characters != null && textCharacters(node) !== loc.characters) return true;
    const liveName = String(node.name || '').split('@')[0];
    const storedName = String(loc.name || '').split('@')[0];
    if (storedName && liveName && storedName !== liveName) return true;
  }
  return false;
}

function markStaleAnswers(meta, inventories) {
  const live = new Set();
  for (const inv of Object.values(inventories || {})) {
    for (const node of inv?.nodes || []) {
      if (node?.id) live.add(node.id);
    }
  }
  const answers = { ...(meta.answers || {}) };
  const stale = [];
  const staticCopy = { ...(meta.staticCopy || {}) };
  const dynamicNeeded = { ...(meta.dynamicNeeded || {}) };
  for (const [key, row] of Object.entries(answers)) {
    const ids = (row.locations || []).map((item) => item.nodeId).filter(Boolean);
    if (!ids.length) continue;
    const gone = ids.every((id) => !live.has(id));
    if (gone || answerIdentityChanged(row, inventories)) {
      answers[key] = { ...row, status: 'stale' };
      stale.push({ key, object: row.object ?? key });
      for (const loc of row.locations || []) {
        if (loc.ref) {
          delete staticCopy[loc.ref];
          delete dynamicNeeded[loc.ref];
        }
        if (loc.nodeId) {
          delete staticCopy[loc.nodeId];
          delete dynamicNeeded[loc.nodeId];
        }
      }
    }
  }
  return { answers, stale, staticCopy, dynamicNeeded };
}

function reconcileDynamicNeeded(dynamicNeeded, inventories) {
  const next = { ...(dynamicNeeded || {}) };
  for (const [key, row] of Object.entries(next)) {
    const node = findLiveNode(inventories, row?.nodeId);
    if (!node) continue;
    const params = node.params || node.declaration?.params || {};
    if (typeof params.field === 'string' && params.field.trim()) delete next[key];
  }
  return next;
}

function rememberedBatchSelection(meta, fingerprint) {
  for (const row of Object.values(meta?.answers || {})) {
    if (row?.status === 'stale') continue;
    if (row.type !== 'l10n-batches') continue;
    if (row.fingerprint !== fingerprint) continue;
    if (!Array.isArray(row.value?.batches)) continue;
    return row.value.batches;
  }
  return null;
}

function l10nCardsAndResult({ snapshot, meta, texts, languages }) {
  const questions = [];
  const problems = [];
  const translations = { matched: [], pending: [], choices: [], source: null };
  if (snapshot == null) {
    if ((languages || []).some((lang) => lang !== 'cn')) {
      translations.pending = texts.map((item) => ({ ...item, status: 'pending', reason: 'no-snapshot' }));
    }
    return { questions, translations, problems };
  }
  const unwrapped = unwrapSnapshot(snapshot);
  if (!unwrapped) {
    problems.push(problem({
      object: '译文快照',
      missing: '已提供的译文快照无法解析为表格（需要 values 或 table.values）',
      code: 'L10N_CONFIG',
      returnTo: '工具',
    }));
    return { questions, translations, problems };
  }
  translations.source = unwrapped.source || null;
  const identified = identifyLanguageColumns(unwrapped.values, meta.l10n);
  if (!identified.ok) {
    if (identified.reason) {
      problems.push(problem({
        object: '翻译表语言列',
        missing: identified.reason,
        code: 'L10N_CONFIG',
        returnTo: '工具',
      }));
    }
    questions.push({
      type: 'l10n-columns',
      object: '翻译表语言列',
      componentKey: 'l10n-columns',
      locations: [],
      options: [
        ...identified.columns.map((col) => ({ id: `col-${col.index}`, lang: col.lang, header: col.header, index: col.index })),
        ...identified.unknown.map((col) => ({ id: `col-${col.index}`, lang: null, header: col.header, index: col.index })),
        ...identified.duplicates.flatMap((row) => row.columns.map((col) => ({
          id: `col-${col.index}`,
          lang: row.lang,
          header: col.header,
          index: col.index,
          duplicate: true,
        }))),
      ],
      suggested: null,
      prompt: '表头语言列无法唯一识别，请确认每列对应哪种语言（同一语言多列请勾选本次使用的列）。',
      splitAllowed: false,
      fingerprint: sha256Hex({ type: 'l10n-columns', headers: unwrapped.values[0] }),
    });
    return { questions, translations, problems };
  }
  const batches = detectBatches(unwrapped.values, identified.columns);
  const titleBatches = batches.filter((batch) => Number.isInteger(batch.row));
  const needsPick = titleBatches.some((batch) => batch.maybeBody) || titleBatches.length > 1;
  const batchFingerprint = sha256Hex({ type: 'l10n-batches', batches: titleBatches });
  const rememberedBatches = rememberedBatchSelection(meta, batchFingerprint);
  if (needsPick && rememberedBatches == null) {
    questions.push({
      type: 'l10n-batches',
      object: '翻译表段落',
      componentKey: 'l10n-batches',
      locations: [],
      options: titleBatches.map((batch) => ({
        id: batch.id,
        label: batch.maybeBody ? `${batch.title}（也可能是未翻译的正文）` : batch.title,
        start: batch.start,
        end: batch.end,
        maybeBody: Boolean(batch.maybeBody),
      })),
      suggested: null,
      prompt: '请勾选本次用作段落标题的行。源列里只有一格字的行也可能是还没翻译的正文；没勾选的仍按正文对翻译。',
      splitAllowed: false,
      fingerprint: batchFingerprint,
    });
    return { questions, translations, problems };
  }
  const selectedIds = rememberedBatches != null
    ? rememberedBatches
    : batches.map((batch) => batch.id);
  const matched = matchTranslations({
    values: unwrapped.values,
    columns: identified.columns,
    batches,
    selectedBatchIds: selectedIds,
    texts,
  });
  if (!matched.ok) {
    problems.push(problem({
      object: '译文匹配',
      missing: matched.reason || '译文匹配失败',
      code: 'L10N_CONFIG',
      returnTo: '工具',
    }));
    return { questions, translations, problems };
  }
  const chosen = meta.l10n?.choices || {};
  for (const item of matched.choices || []) {
    const key = `l10n-choice:${item.end}:${item.nodeId}`;
    const saved = chosen[key];
    const still = saved && (item.options || []).find((opt) => canonicalJson(opt.byLang) === canonicalJson(saved.byLang));
    if (still) {
      matched.matched.push({
        ...item,
        status: 'matched',
        byLang: still.byLang,
        basis: still.basis || saved.basis,
        rows: still.rows || saved.rows,
      });
      continue;
    }
    questions.push({
      type: 'l10n-choice',
      object: item.characters.slice(0, 40),
      componentKey: key,
      locations: [{ end: item.end, section: item.section, nodeId: item.nodeId, name: item.name }],
      options: item.options.map((opt, index) => ({ id: `opt-${index}`, ...opt })),
      suggested: null,
      prompt: '同一句在所选段落里有多种译法，请选本次使用的译文。',
      splitAllowed: false,
      fingerprint: sha256Hex({ type: 'l10n-choice', nodeId: item.nodeId, options: item.options }),
    });
  }
  translations.matched = matched.matched;
  translations.pending = matched.pending;
  translations.choices = matched.choices;
  translations.columns = identified.columns;
  translations.batches = batches;
  translations.selectedBatchIds = selectedIds;
  return { questions, translations, problems };
}

function textsByLangFrom(translations) {
  const out = {};
  for (const row of translations.matched || []) {
    for (const [lang, text] of Object.entries(row.byLang || {})) {
      out[lang] = `${out[lang] || ''}${text}`;
    }
  }
  return out;
}

export function collectB2({
  snapshot,
  scope,
  config,
  l10nSnapshot = null,
  configDir = null,
} = {}) {
  const working = structuredClone(config || {});
  if (working.bindings) {
    for (const key of Object.keys(working.bindings)) {
      const value = working.bindings[key];
      const onlyMotion = value && typeof value === 'object' && Object.keys(value).every((field) => field === 'motion');
      if (onlyMotion && !key.startsWith('node:') && !key.startsWith('component:')) delete working.bindings[key];
    }
  }

  const first = recompile(snapshot, working, scope.platform);
  const linkPatch = autoLinks(first.inventories, working);
  if (linkPatch.added.length && object(linkPatch.links)) working.links = linkPatch.links;
  const motionPatch = autoMotions(first.inventories, working);
  if (motionPatch.applied.length) {
    working.motions = motionPatch.motions;
    working.bindings = motionPatch.bindings;
    for (const key of Object.keys(working.bindings)) {
      const value = working.bindings[key];
      const onlyMotion = value && typeof value === 'object' && Object.keys(value).every((field) => field === 'motion');
      if (onlyMotion && !key.startsWith('node:') && !key.startsWith('component:')) delete working.bindings[key];
    }
  }

  let compiled = recompile(snapshot, working, scope.platform);
  const meta = metaOf(working);
  const stale = markStaleAnswers(meta, compiled.inventories);
  if (stale.stale.length) {
    working.meta = {
      ...meta,
      answers: stale.answers,
      staticCopy: stale.staticCopy,
      dynamicNeeded: stale.dynamicNeeded,
    };
    if (working.bindings) {
      for (const row of stale.stale) {
        const answer = stale.answers[row.key];
        for (const loc of answer?.locations || []) {
          if (loc.ref) delete working.bindings[loc.ref];
        }
      }
    }
    compiled = recompile(snapshot, working, scope.platform);
  } else if (Object.keys(meta).length) {
    working.meta = {
      ...meta,
      answers: stale.answers,
      staticCopy: stale.staticCopy ?? meta.staticCopy,
      dynamicNeeded: stale.dynamicNeeded ?? meta.dynamicNeeded,
    };
  }

  if (!working.meta) working.meta = { ...meta };
  working.meta.dynamicNeeded = reconcileDynamicNeeded(working.meta.dynamicNeeded || {}, compiled.inventories);
  const splitKeys = new Set(meta.splitKeys || []);
  const liveMeta = working.meta || {};
  const button = buildButtonQuestions(compiled.inventories, {
    splitKeys,
    crossEnd: meta.crossEnd || {},
  });
  const carousel = buildCarouselQuestions(compiled.inventories);
  const tabs = buildTabQuestions(compiled.inventories);
  const structureDesign = [...(carousel.designProblems || []), ...(tabs.designProblems || [])];
  const structureIds = new Set(structureDesign.map((item) => item.nodeId).filter(Boolean));
  const pageClickIds = new Set();
  for (const end of ['pc', 'mobile']) {
    for (const node of productNodes(compiled.inventories[end])) {
      const scope = node.scope || 'page';
      if (scope === 'page' || String(scope).startsWith('modal')) pageClickIds.add(node.id);
    }
  }
  const orphanPagination = !(carousel.questions || []).length
    ? (compiled.problems || []).filter((item) => item.code === 'PAGINATION' && !structureIds.has(item.nodeId))
    : [];
  const data = buildDataHintQuestions(compiled.inventories, {
    confirmedRefs: new Set([
      ...Object.keys(liveMeta.staticCopy || {}),
      ...Object.keys(liveMeta.dynamicNeeded || {}),
    ]),
  });
  const fonts = buildFontQuestions(compiled.inventories, {
    languages: scope.languages,
    baseLanguage: scope.baseLanguage,
    fonts: working.fonts,
    answeredFaces: answeredKeysFromMeta(liveMeta, 'font-map'),
  });
  const texts = collectCopyTexts(compiled.inventories);
  const l10n = l10nCardsAndResult({
    snapshot: l10nSnapshot,
    meta: liveMeta,
    texts,
    languages: scope.languages,
  });
  const fontCheck = checkFontFiles({
    inventories: compiled.inventories,
    languages: scope.languages,
    baseLanguage: scope.baseLanguage,
    fonts: working.fonts,
    configDir,
    translations: l10n.translations,
  });
  const fontBlockers = fontCheck.blockers;
  const langVariants = missingLangVariants(compiled.inventories, scope.languages);

  const rawQuestions = sortQuestions([
    ...l10n.questions,
    ...button.questions,
    ...(carousel.questions || carousel),
    ...(tabs.questions || tabs),
    ...fonts.questions,
    ...data,
  ]);
  const questions = numberCards(rawQuestions);

  const designProblems = [
    ...compiled.problems.filter((item) => item.returnTo === '设计稿'),
    ...langVariants.map((item) => problem({
      end: item.locations?.[0]?.end ?? null,
      section: item.locations?.[0]?.section ?? null,
      nodeId: item.locations?.[0]?.nodeId ?? null,
      object: item.object,
      missing: item.missing,
      code: item.code,
      returnTo: '设计稿',
    })),
    ...Object.values(liveMeta.dynamicNeeded || {}).map((item) => problem({
      end: item.end ?? null,
      section: item.section ?? null,
      nodeId: item.nodeId ?? null,
      object: item.object,
      missing: item.missing,
      code: 'FIELD_DECLARATION',
      returnTo: '设计稿',
    })),
    ...structureDesign.map((item) => problem({
      end: item.end ?? null,
      section: item.section ?? null,
      nodeId: item.nodeId ?? null,
      object: item.object,
      missing: item.missing,
      code: item.object?.startsWith('tab/') ? 'RELATION_MISSING' : 'PAGINATION',
      returnTo: '设计稿',
    })),
    ...orphanPagination.map((item) => problem({
      end: item.end ?? null,
      section: item.section ?? null,
      nodeId: item.nodeId ?? null,
      object: item.object,
      missing: item.missing || '轮播分页合同无法建立，因 switch 缺少 list/面板结构',
      code: 'PAGINATION',
      returnTo: '设计稿',
    })),
  ];

  const toolProblems = [
    ...compiled.problems.filter((item) => item.returnTo === '工具').map((item) => problem({
      end: item.end ?? null,
      section: item.section ?? null,
      nodeId: item.nodeId ?? null,
      object: item.object || item.code,
      missing: item.nodeId == null && /^TARGET/.test(item.code || '')
        ? `配置 bindings 解析失败：${item.missing}`
        : item.missing,
      impact: item.impact,
      code: item.code,
      returnTo: '工具',
    })),
    ...(l10n.problems || []),
  ];

  const todos = [];
  todos.push(...aggregateLinkTodos(compiled.inventories));
  for (const row of l10n.translations.pending || []) {
    todos.push({
      kind: 'pending-translation',
      blocking: false,
      end: row.end,
      section: row.section,
      nodeId: row.nodeId,
      name: row.name,
      characters: row.characters,
    });
  }
  const style = linkKeyStyle(linkKeysInInventories(compiled.inventories));
  if (style.mixed) {
    todos.push({
      kind: 'link-key-mixed',
      blocking: false,
      message: '同稿链接名中英混用',
      keys: style.keys,
    });
  }
  for (const row of stale.stale) {
    todos.push({ kind: 'stale-answer', blocking: false, ...row });
  }
  for (const row of motionPatch.skipped || []) {
    todos.push(row);
  }

  const fontBlocking = fontBlockers.map((item) => problem({
    end: item.locations?.[0]?.end ?? null,
    section: item.locations?.[0]?.section ?? null,
    nodeId: item.locations?.[0]?.nodeId ?? null,
    object: item.object,
    missing: item.missing,
    code: item.code,
    returnTo: 'B2',
  }));

  const b2Problems = [
    ...compiled.problems.filter((item) => {
      if (item.returnTo !== 'B2') return false;
      if (item.code === 'PAGINATION' && (!(carousel.questions || []).length || structureIds.has(item.nodeId))) return false;
      if (item.code === 'RELATION_MISSING' && (structureIds.has(item.nodeId) || (item.nodeId && !pageClickIds.has(item.nodeId)))) return false;
      if (item.code === 'ACTION_MISSING' && item.nodeId && !pageClickIds.has(item.nodeId)) return false;
      return true;
    }),
    ...fontBlocking,
  ];
  const problems = [
    ...b2Problems,
    ...designProblems,
    ...toolProblems,
  ];
  const hasB2Block = problems.some((item) => item.returnTo === 'B2');
  const hasToolBlock = problems.some((item) => item.returnTo === '工具');
  const hasDesign = problems.some((item) => item.returnTo === '设计稿');
  let result = 'pass';
  if (questions.length > 0 || hasB2Block) result = 'needs-input';
  else if (hasToolBlock || hasDesign) result = 'fail';

  return {
    workingConfig: working,
    inventories: compiled.inventories,
    pairing: compiled.pairing,
    questions,
    translations: l10n.translations,
    todos,
    problems,
    result,
    auto: { links: linkPatch.added, motions: motionPatch.applied },
    stale: stale.stale,
    fontBlockers,
    fontInputs: fontCheck.fontInputs,
    designProblems,
  };
}
