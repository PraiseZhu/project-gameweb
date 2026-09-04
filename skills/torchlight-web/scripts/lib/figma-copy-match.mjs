// copy-match.mjs — 文案匹配：稿内简中原文 → 飞书本地化表（FIGMA-ADAPT.md §6）。
//
// 地基逻辑（§0）：输入端一个字都不动，稿里不加 @key=、表里不加 ID 列，
// 所以**稿内 characters（简中原文）就是查表的唯一 key**。匹配分五级：
//
//   exact       原文字节全等                    → 直接用
//   normalized  双方归一化后全等                 → 直接用，记 matchKind
//   fuzzy       归一化后编辑距离 ≤ 阈值          → 不自动用，列候选交人确认
//               （阈值 lead 2026-08-03 裁决：len≤6 → 0 不列候选；否则 max(1, floor(len×3%))）
//   ambiguous   表里 ≥2 行简中归一化后相同但译文不同 → 报红，列所有候选行号
//   none        找不到                          → 报红，列出稿内原文 + nodeId
//
// 铁律：
//   - 叶子只能用过参传进来的 larkLeaf(pointer) 造（值与 locator 同源，
//     防伪链会解析快照按 locator 复核 value，手打必拒——见 _adversarial-test.mjs）。
//   - fuzzy/none/ambiguous 一律不静默：全部进 _unread，附诊断信息交人判断
//     （SS4 残留？稿表没同步？还是根本不需要翻译？——人定，机器不猜）。

import { normalizeCopy, editDistance, fuzzyThreshold } from './figma-copy-normalize.mjs';
import { deriveContext, resolveContextualRow, validateCopyOverlay } from './figma-copy-context.mjs';
import { findCellSplitGroups, inferRowFromNeighbors, inferLeftoverUniqueRow, inferAdjacentBoundRow, inferSplitShareRow, splitLocaleCell } from './figma-copy-structure.mjs';

const LANGS_FALLBACK = ['zh-CN', 'en', 'ko', 'ja', 'zh-TW'];

/** 表里一行的"译文指纹"：五个语言列的原始值 canonical 比较用（判 ambiguous）。 */
function translationTuple(larkSnap, at, row, langs) {
  return langs.map((lang) => {
    const v = at(larkSnap, `/rows/${row}/${lang}`);
    return v === null ? null : String(v);
  });
}

/**
 * @param {object} args
 * @param {object} args.figSnap   Figma 快照（本函数不直接读它，texts 已 walk 好；
 *                                保留入参是为了签名与 extract.mjs 其它提取器一致）
 * @param {object} args.larkSnap  飞书表快照（{ _meta:{ langCols,... }, rows:{ "17": {...} } }）
 * @param {(snap:object, pointer:string)=>any} args.at  按 JSON Pointer 取值（与 locator 同源）
 * @param {(pointer:string)=>object} args.larkLeaf 造指向飞书快照的叶子——**唯一**的造叶子通道
 * @param {Array<{nodeId:string, name:string, characters:string}>} args.texts 稿内 TEXT 节点
 * @returns {{ byNode:object, report:object, _unread:Array }}
 */
export function extractCopy({ figSnap, larkSnap, at, larkLeaf, texts, copyOverlay = null, contexts = null }) {
  void figSnap; // texts 已是从快照 walk 出的 TEXT 节点，此处不再二次遍历

  /* ── 同字段多场景（任务3）：运营覆盖层 + 机械派生的 context。
   * contexts：Map<nodeId, {tags,scene,contextKey,...}>，由调用方用
   *   buildAncestorMap(truth.nodes)+deriveContext 机械生成——场景信号不手填。
   * copyOverlay：demo 内 fixture（运营显式映射/规则），先校验再启用；
   *   校验发现问题即抛（引用不存在的行/未知键 = 覆盖层本身不可信）。 */
  if (copyOverlay) {
    const rowExists = (row) => {
      try { return at(larkSnap, `/rows/${row}/zh-CN`) != null; } catch { return false; }
    };
    const problems = validateCopyOverlay(copyOverlay, { rowExists });
    if (problems.length) throw new Error('copyOverlay 校验失败: ' + problems.join('; '));
  }
  const _contextual = []; // 多场景解析留痕（进报告，不进 truth）

  // ── 语言列：从表快照 _meta.langCols 读（{A:'zh-CN',B:'en',...}），不硬编码 ──
  let langs = LANGS_FALLBACK;
  try {
    const langCols = at(larkSnap, '/_meta/langCols');
    const vals = Object.keys(langCols)
      .sort()
      .map((col) => langCols[col]);
    if (vals.length) langs = vals;
  } catch {
    /* 快照缺 langCols 时退回默认五列 */
  }

  // ── 扫表：行号 → { rawZh, normZh }。值一律走 at() 取，与 locator 同一条路径 ──
  const rows = Object.keys(larkSnap.rows).sort((a, b) => Number(a) - Number(b));
  const table = []; // [{ row, rawZh, normZh }]
  for (const row of rows) {
    const rawZh = at(larkSnap, `/rows/${row}/zh-CN`);
    if (rawZh === null || rawZh === undefined) continue; // 简中空的行做不了 key
    const raw = String(rawZh);
    table.push({ row, rawZh: raw, normZh: normalizeCopy(raw) });
  }

  // ── 顺手统计（§6「地区差异」）：简中有值但某语言列为空的行。只统计，不定规则 ──
  const emptyLangCells = { byLang: Object.fromEntries(langs.map((l) => [l, 0])), rows: [] };
  for (const row of rows) {
    const rawZh = at(larkSnap, `/rows/${row}/zh-CN`);
    if (normalizeCopy(rawZh) === '') continue; // 前提：简中有值
    const missing = langs.filter((lang) => normalizeCopy(at(larkSnap, `/rows/${row}/${lang}`)) === '');
    if (!missing.length) continue;
    for (const lang of missing) emptyLangCells.byLang[lang] += 1;
    let note = null;
    try {
      note = at(larkSnap, `/rows/${row}/note`);
    } catch {
      /* 无备注列 */
    }
    emptyLangCells.rows.push({ row, missing, note });
  }

  // ── 简中重复组（ambiguous 的素材；lead 裁决：report 里单独列出，附各语言译文差异当证据）──
  const zhGroups = new Map(); // normZh → [row,...]
  for (const t of table) {
    if (!zhGroups.has(t.normZh)) zhGroups.set(t.normZh, []);
    zhGroups.get(t.normZh).push(t.row);
  }
  const duplicateZhGroups = [...zhGroups.entries()]
    .filter(([, rs]) => rs.length > 1)
    .map(([normZh, rs]) => {
      // 每行五语原文 + 每个语言列在组内是否有差异 + 哪些行该列为空
      const perRow = Object.fromEntries(rs.map((r) => [r, Object.fromEntries(langs.map((lang) => [lang, at(larkSnap, `/rows/${r}/${lang}`)]))]));
      const differingLangs = langs.filter((lang) => new Set(rs.map((r) => JSON.stringify(perRow[r][lang] ?? null))).size > 1);
      const emptyByRow = Object.fromEntries(
        rs.map((r) => [r, langs.filter((lang) => normalizeCopy(perRow[r][lang]) === '')]).filter(([, miss]) => miss.length),
      );
      return {
        normZh,
        rows: rs,
        zhCN: perRow[rs[0]]['zh-CN'],
        translationsIdentical: differingLangs.length === 0,
        differingLangs, // 哪些语言列在组内不一致（若稿命中此 key 即 ambiguous 报红）
        emptyByRow, // 哪些行有语言列空缺（录入不全的迹象）
        perRow, // 各行五语原文，证据留档
      };
    });

  const byNode = {};
  const _unread = [];
  const tally = { exact: 0, normalized: 0, fuzzy: 0, ambiguous: 0, none: 0, cellSplit: 0, inferredNeighbor: 0, inferredLeftover: 0, inferredAdjacent: 0, inferredSplitShare: 0 };
  const cellSplit = findCellSplitGroups(texts, table);
  const _review = [];

  /** 命中唯一一行后造五语叶子；空语言列不造叶子（值是 null），记 missingLangs。 */
  function adopt(t, kind, { lineIndex = null, lineCount = null, partIndex = 0, partCount = 1 } = {}) {
    const translations = {};
    const missingLangs = [];
    const split = Number.isInteger(lineIndex) && Number.isInteger(lineCount) && lineCount > 1;
    for (const lang of langs) {
      const v = at(larkSnap, `/rows/${t.row}/${lang}`);
      if (v === null || v === undefined) {
        missingLangs.push(lang);
        continue;
      }
      if (!split) {
        translations[lang] = larkLeaf(`/rows/${t.row}/${lang}`);
        continue;
      }
      const piece = splitLocaleCell(v, lineIndex, lineCount, { partIndex, partCount });
      if (piece == null) {
        missingLangs.push(lang);
        continue;
      }
      const leaf = larkLeaf(`/rows/${t.row}/${lang}`);
      translations[lang] = { ...leaf, value: piece, splitLine: lineIndex, splitPart: partIndex };
    }
    return {
      matchKind: kind,
      row: t.row,
      tableZhCN: t.rawZh, // 表里的简中原文（normalized 命中时与稿内略有出入，留证）
      translations,
      missingLangs,
    };
  }

  for (const { nodeId, name, characters } of texts) {
    const raw = characters === null || characters === undefined ? '' : String(characters);
    const norm = normalizeCopy(raw);
    const base = { nodeId, name, characters: raw, normalized: norm };
    // ★ 人工行号指认（copy-designations → overlay.nodeRow，任务：语言对应接入）：
    //    designations 不是第三真源——它只把 nodeId 指到 Lark 行号；采用值仍由 larkLeaf 从该行
    //    机械取（值与 locator 同源，过 makeFixtureLeaf 值绑定校验）。优先级最高（explicit）。
    //    放在 exact/normalized 之前：指认的就是"这条稿内原文对应表里第 N 行"，无需再走匹配。
    // ★ deliberatelyUnbound（copy-designations → overlay.suppress，lead 2026-08-10 路径②）：
    //    显式声明"此节点以 Figma 稿字符为准，不采用任何 Lark/线上译文"。归一化会把稿内手动
    //    换行 \n 磨平成与表行全等（§6 点名案例 2:31229），导致 SS4 稿文案被 SS5 译文覆盖、
    //    手动换行丢失、折行点被 text-wrap:balance 改错。suppress 优先级高于一切匹配（含
    //    designation），让节点保持无绑定 → renderer 兜底显示稿内原文 + data-copy-missing。
    //    这不是匹配失败，是显式的"以稿为准"裁决；记 matchKind:'deliberately-unbound' 进 unread，
    //    由 coverage gate 照常计入缺译，绝不静默。
    if (copyOverlay && copyOverlay.suppress && copyOverlay.suppress[nodeId]) {
      byNode[nodeId] = { ...base, matchKind: 'deliberately-unbound', translations: {}, missingLangs: langs.slice() };
      _unread.push({
        ...base,
        matchKind: 'deliberately-unbound',
        reason: `人工裁决以 Figma 稿字符为准（copy-designations.deliberatelyUnbound），不采用 Lark 译文——${copyOverlay.suppress[nodeId].why || '见 copy-designations'}`,
      });
      tally.none += 1;
      continue;
    }
    const cellGroup = cellSplit.byNode.get(String(nodeId));
    const cellSplitMeta = (() => {
      if (!cellGroup) return null;
      const parts = Array.isArray(cellGroup.parts) ? cellGroup.parts : [];
      const part = parts.find((item) => (item.nodeIds || []).includes(String(nodeId)));
      const lineIndex = part ? part.lineIndex : cellGroup.nodeIds.indexOf(String(nodeId));
      const partIndex = part ? (part.nodeIds || []).indexOf(String(nodeId)) : 0;
      const partCount = part ? (part.nodeIds || []).length : 1;
      return { lineIndex, lineCount: cellGroup.lines.length, partIndex, partCount };
    })();
    const __nodeRow = copyOverlay && copyOverlay.nodeRow && copyOverlay.nodeRow[nodeId];
    if (__nodeRow && __nodeRow.row != null) {
      const __row = Number(__nodeRow.row);
      let __rawZh = '';
      try { __rawZh = String(at(larkSnap, `/rows/${__row}/zh-CN`) ?? ''); } catch { __rawZh = ''; }
      const splitMeta = cellSplitMeta && Number.isInteger(cellSplitMeta.lineCount) && cellSplitMeta.lineCount > 1
        ? cellSplitMeta
        : {};
      byNode[nodeId] = {
        ...base,
        ...adopt({ row: __row, rawZh: __rawZh }, 'designated', splitMeta),
        ...(cellSplitMeta ? { cellSplit: cellSplitMeta } : {}),
        note: `人工指认第 ${__row} 行（${__nodeRow.why || 'copy-designations'}）；值由 larkLeaf 机械取，非手填${cellSplitMeta ? `；拆格句序第 ${cellSplitMeta.lineIndex + 1}/${cellSplitMeta.lineCount} 句第 ${cellSplitMeta.partIndex + 1}/${cellSplitMeta.partCount} 截仍保留` : ''}`,
      };
      tally.exact += 1; // designated 计入 exact 桶（已解析）
      continue;
    }
    if (cellGroup) {
      const splitMeta = cellSplitMeta;
      if (cellGroup.unresolved) {
        tally.ambiguous += 1;
        byNode[nodeId] = {
          ...base,
          matchKind: 'ambiguous',
          cellSplit: splitMeta,
          candidates: cellGroup.candidates,
        };
        _unread.push({
          ...base,
          matchKind: 'ambiguous',
          reason: `表第 ${cellGroup.candidates.map((item) => item.row).join('、')} 行一格 ${cellGroup.lines.length} 句对相邻 TEXT，本层第 ${splitMeta.lineIndex + 1} 句，多行简中相同但译文不同，机器不替人选`,
          candidates: cellGroup.candidates,
        });
        continue;
      }
      byNode[nodeId] = {
        ...base,
        ...adopt({ row: cellGroup.row, rawZh: cellGroup.rawZh }, 'cell-split', splitMeta),
        cellSplit: splitMeta,
        note: `表第 ${cellGroup.row} 行一格 ${cellGroup.lines.length} 句对相邻 TEXT，本层第 ${splitMeta.lineIndex + 1} 句第 ${splitMeta.partIndex + 1}/${splitMeta.partCount} 截；请审拆句`,
      };
      tally.cellSplit += 1;
      tally.exact += 1;
      _review.push({
        nodeId: String(nodeId),
        matchKind: 'cell-split',
        row: cellGroup.row,
        lineIndex: splitMeta.lineIndex,
        partIndex: splitMeta.partIndex,
        why: `cell-split of row ${cellGroup.row} line ${splitMeta.lineIndex + 1}/${cellGroup.lines.length} part ${splitMeta.partIndex + 1}/${splitMeta.partCount}`,
      });
      continue;
    }

    // 1) exact：原文字节全等
    const exactHits = table.filter((t) => t.rawZh === raw);
    // 2) normalized：双方归一化后全等（exact 未命中才走这级）
    const normHits = exactHits.length ? [] : table.filter((t) => t.normZh === norm && norm !== '');
    const hits = exactHits.length ? exactHits : normHits;
    const kind = exactHits.length ? 'exact' : 'normalized';

    if (hits.length > 1) {
      // 多行命中：译文完全一致则视同单行（取最小行号），否则 ambiguous 报红
      const tuples = new Set(hits.map((t) => JSON.stringify(translationTuple(larkSnap, at, t.row, langs))));
      if (tuples.size === 1) {
        byNode[nodeId] = { ...base, ...adopt(hits[0], kind), note: `表里 ${hits.map((t) => t.row).join('/')} 行简中与译文完全一致，取第 ${hits[0].row} 行` };
        tally[kind] += 1;
      } else {
        // ── 同字段多场景（任务3）：译文不同不一定是缺陷，可能是「目录短译/内容长译」。
        //    先试 context 解析：显式映射 > 场景规则 > 长度规则 > 组内默认，全不命中才不猜。
        const ctx = contexts && typeof contexts.get === 'function' ? contexts.get(nodeId) : null;
        if (ctx) {
          const res = resolveContextualRow({
            zhNorm: norm, candidates: hits, ctx, overlay: copyOverlay, larkSnap, at, langs,
          });
          if (!res.unresolved) {
            const hit = hits.find((t) => Number(t.row) === Number(res.row)) || { row: res.row, rawZh: at(larkSnap, `/rows/${res.row}/zh-CN`) };
            byNode[nodeId] = {
              ...base, ...adopt({ row: res.row, rawZh: String(hit.rawZh ?? '') }, kind),
              context: { contextKey: ctx.contextKey, scene: ctx.scene, via: res.via },
              note: `多场景按 context(${ctx.contextKey}) 经 ${res.via} 选定第 ${res.row} 行：${res.why}`,
            };
            tally[kind] += 1;
            _contextual.push({ ...base, contextKey: ctx.contextKey, scene: ctx.scene, via: res.via, row: res.row, why: res.why, resolved: true });
            continue;
          }
          _contextual.push({ ...base, contextKey: ctx.contextKey, scene: ctx.scene, via: res.via, why: res.why, resolved: false, candidates: hits.map((t) => ({ row: t.row, tableZhCN: t.rawZh })) });
        }
        tally.ambiguous += 1;
        byNode[nodeId] = {
          ...base,
          matchKind: 'ambiguous',
          candidates: hits.map((t) => ({ row: t.row, tableZhCN: t.rawZh })),
        };
        _unread.push({
          ...base,
          matchKind: 'ambiguous',
          reason: ctx
            ? `表里第 ${hits.map((t) => t.row).join('、')} 行简中相同但译文不同，context(${ctx.contextKey}) 未配映射/规则——多场景待运营裁决`
            : `表里第 ${hits.map((t) => t.row).join('、')} 行简中（归一化后）相同但译文不同，机器不替人选`,
        });
      }
      continue;
    }

    if (hits.length === 1) {
      byNode[nodeId] = { ...base, ...adopt(hits[0], kind) };
      tally[kind] += 1;
      continue;
    }

    // 3) fuzzy：归一化后编辑距离 ≤ max(2, 长度×3%)。只列候选，绝不自动采用
    const scored = table
      .map((t) => ({ t, dist: editDistance(norm, t.normZh), threshold: fuzzyThreshold(norm, t.normZh) }))
      .sort((a, b) => a.dist - b.dist || Number(a.t.row) - Number(b.t.row));
    const candidates = scored
      .filter((s) => s.dist <= s.threshold)
      .map((s) => ({ row: s.t.row, distance: s.dist, threshold: Number(s.threshold.toFixed(2)), tableZhCN: s.t.rawZh }));

    if (candidates.length) {
      tally.fuzzy += 1;
      byNode[nodeId] = { ...base, matchKind: 'fuzzy', candidates };
      _unread.push({
        ...base,
        matchKind: 'fuzzy',
        reason: `归一化后仍有差异（最近第 ${candidates[0].row} 行，距离 ${candidates[0].distance}），按 §6 不自动采用，候选交人确认`,
        candidates,
      });
      continue;
    }

    // 4) none：找不到。报红，附最近的 3 行做诊断（超阈值，仅人读，不是候选）
    tally.none += 1;
    const closest = scored.slice(0, 3).map((s) => ({
      row: s.t.row,
      distance: s.dist,
      threshold: Number(s.threshold.toFixed(2)),
      aboveThreshold: true,
      tableZhCN: s.t.rawZh,
    }));
    byNode[nodeId] = { ...base, matchKind: 'none' };
    _unread.push({
      ...base,
      matchKind: 'none',
      reason: '飞书表里找不到对应简中（exact/normalized/fuzzy 全部未命中）——SS4 残留？稿表没同步？还是不需要翻译？请人工判断',
      closest,
    });
  }

  const firstPassBound = { ...byNode };
  function adoptInferred(nodeId, entry, picked, kind) {
    const candidates = Array.isArray(entry.candidates) ? entry.candidates : [];
    const hit = candidates.find((item) => Number(item.row) === Number(picked.row))
      || { row: picked.row, tableZhCN: at(larkSnap, `/rows/${picked.row}/zh-CN`) };
    const split = entry.cellSplit && Number.isInteger(entry.cellSplit.lineIndex)
      ? {
        lineIndex: entry.cellSplit.lineIndex,
        lineCount: entry.cellSplit.lineCount,
        partIndex: entry.cellSplit.partIndex || 0,
        partCount: entry.cellSplit.partCount || 1,
      }
      : {};
    byNode[nodeId] = {
      nodeId: entry.nodeId,
      name: entry.name,
      characters: entry.characters,
      normalized: entry.normalized,
      ...adopt({ row: picked.row, rawZh: String(hit.tableZhCN ?? hit.rawZh ?? '') }, kind, split),
      note: picked.why,
    };
    if (kind === 'inferred-leftover') tally.inferredLeftover += 1;
    else if (kind === 'inferred-adjacent') tally.inferredAdjacent += 1;
    else if (kind === 'inferred-split-share') tally.inferredSplitShare += 1;
    else tally.inferredNeighbor += 1;
    tally.ambiguous = Math.max(0, tally.ambiguous - 1);
    tally.exact += 1;
    const unreadAt = _unread.findIndex((item) => String(item.nodeId) === String(nodeId) && item.matchKind === 'ambiguous');
    if (unreadAt >= 0) _unread.splice(unreadAt, 1);
    _review.push({
      nodeId: String(nodeId),
      matchKind: kind,
      row: picked.row,
      why: picked.why,
    });
  }

  for (const [nodeId, entry] of Object.entries(byNode)) {
    if (!entry || entry.matchKind !== 'ambiguous') continue;
    const candidates = Array.isArray(entry.candidates) ? entry.candidates : [];
    const neighbor = inferRowFromNeighbors({
      nodeId,
      candidateRows: candidates.map((item) => item.row),
      texts,
      byNode: firstPassBound,
    });
    if (neighbor.unresolved) continue;
    adoptInferred(nodeId, entry, neighbor, 'inferred-neighbor');
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const [nodeId, entry] of Object.entries(byNode)) {
      if (!entry || entry.matchKind !== 'ambiguous') continue;
      const adjacent = inferAdjacentBoundRow({
        nodeId,
        candidateRows: (entry.candidates || []).map((item) => item.row),
        texts,
        byNode,
      });
      if (adjacent.unresolved) continue;
      adoptInferred(nodeId, entry, adjacent, 'inferred-adjacent');
      grew = true;
    }
    for (const [nodeId, entry] of Object.entries(byNode)) {
      if (!entry || entry.matchKind !== 'ambiguous' || !entry.cellSplit) continue;
      const shared = inferSplitShareRow({
        nodeId,
        candidateRows: (entry.candidates || []).map((item) => item.row),
        texts,
        byNode,
      });
      if (shared.unresolved) continue;
      adoptInferred(nodeId, entry, shared, 'inferred-split-share');
      grew = true;
    }
  }

  const leftoverSeen = new Set();
  for (const [nodeId, entry] of Object.entries(byNode)) {
    if (!entry || entry.matchKind !== 'ambiguous' || leftoverSeen.has(String(nodeId))) continue;
    const leftover = inferLeftoverUniqueRow({
      nodeId,
      candidateRows: (entry.candidates || []).map((item) => item.row),
      texts,
      byNode,
    });
    if (leftover.unresolved) continue;
    const groupIds = leftover.remainingNodeIds && leftover.remainingNodeIds.length
      ? leftover.remainingNodeIds
      : [String(nodeId)];
    for (const id of groupIds) {
      leftoverSeen.add(String(id));
      const groupEntry = byNode[id];
      if (!groupEntry || groupEntry.matchKind !== 'ambiguous') continue;
      adoptInferred(id, groupEntry, leftover, 'inferred-leftover');
    }
  }

  const report = {
    total: texts.length,
    ...tally,
    rowsInTable: table.length,
    langs,
    duplicateZhGroups,
    emptyLangCells,
    contextual: _contextual, // 同字段多场景解析留痕：resolved/via/contextKey/why（进报告不进 truth）
    review: _review,
  };

  return { byNode, report, _unread };
}
