/**
 * Generic paged-switch: same-component cards in switch/ + scope ind/ → pages.
 * Cards must be a unique row or a column-aligned grid. Capacity = cards drawn.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function pickEnd(value, end) {
  if (value && typeof value === 'object' && !Array.isArray(value) && ('pc' in value || 'mobile' in value)) {
    return value[end];
  }
  return value;
}

export function pageCountOf(cardCount, pageCapacity) {
  const n = Number(cardCount);
  const cap = Number(pageCapacity);
  if (!Number.isInteger(n) || n < 0) return { ok: false, problems: ['卡片数必须是非负整数'] };
  if (!Number.isInteger(cap) || cap < 1) return { ok: false, problems: ['每页容量必须是正整数（来自稿上画出的卡片数）'] };
  if (n === 0) return { ok: false, problems: ['pagedSwitches.cards 不能为空'] };
  return { ok: true, pageCount: Math.ceil(n / cap) };
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Adjacent IND spacing from ready boxes, not the first pair's x-delta. */
export function indInterItemGap(sourceBoxes = []) {
  const sorted = [...sourceBoxes]
    .filter((box) => box && Number.isFinite(num(box.x)) && Number.isFinite(num(box.w)))
    .sort((a, b) => num(a.x) - num(b.x));
  if (sorted.length < 2) return 0;
  return num(sorted[1].x) - (num(sorted[0].x) + num(sorted[0].w));
}

function axisConstraint(layout, axis) {
  return String(layout?.constraints?.[axis] || '').toUpperCase();
}

function isHug(value) {
  const text = String(value || '').toUpperCase();
  return text === 'HUG' || text === 'HUG_CONTENTS';
}

/**
 * Page count = dot count. Active uses selected ready size, others unselected.
 * Hug host width follows content (selected + gaps + unselected); LEFT/TOP stay.
 * 915-wide bbox is the 4-page result, not a Fixed frame.
 */
export function layoutPagedDots({
  pageCount,
  selectedBox,
  unselectedBox,
  hostBox,
  sourceBoxes = [],
  hostLayout = null,
} = {}) {
  const pages = Math.max(0, Math.floor(num(pageCount)));
  const selectedW = num(selectedBox?.w);
  const unselectedW = num(unselectedBox?.w);
  const selectedH = num(selectedBox?.h, num(unselectedBox?.h));
  const unselectedH = num(unselectedBox?.h, selectedH);
  const padL = num(hostLayout?.paddingLeft);
  const padR = num(hostLayout?.paddingRight);
  const padT = num(hostLayout?.paddingTop);
  const padB = num(hostLayout?.paddingBottom);
  const gap = Number.isFinite(Number(hostLayout?.itemSpacing))
    ? Number(hostLayout.itemSpacing)
    : indInterItemGap(sourceBoxes);
  const groupW = pages === 0 ? 0 : selectedW + Math.max(0, pages - 1) * (unselectedW + gap);
  const groupH = Math.max(selectedH, unselectedH);
  const hugH = isHug(hostLayout?.layoutSizingHorizontal);
  const hugV = isHug(hostLayout?.layoutSizingVertical);
  const hostX = num(hostBox?.x);
  const hostY = num(hostBox?.y);
  const originalW = num(hostBox?.w);
  const originalH = num(hostBox?.h);
  const nextW = hugH || !hostLayout ? padL + groupW + padR : originalW;
  const nextH = hugV || !hostLayout ? padT + groupH + padB : originalH;
  const horizontal = axisConstraint(hostLayout, 'horizontal');
  let startX = hostX + padL;
  if (!hugH && hostLayout) {
    if (horizontal === 'RIGHT') startX = hostX + originalW - padR - groupW;
    else if (horizontal === 'CENTER' || horizontal === 'CENTER_CENTER') startX = hostX + (originalW - groupW) / 2;
  }
  const startY = hostY + padT;
  const dots = [];
  for (let page = 0; page < pages; page += 1) {
    const active = page === 0;
    dots.push({
      page,
      pageBox: {
        x: page === 0 ? startX : startX + selectedW + gap + (page - 1) * (unselectedW + gap),
        y: startY,
        w: active ? selectedW : unselectedW,
        h: active ? selectedH : unselectedH,
      },
    });
  }
  const last = dots.at(-1);
  const lastRight = last ? last.pageBox.x + last.pageBox.w : startX;
  const hostPageBox = { x: hostX, y: hostY, w: nextW, h: nextH };
  return {
    dots,
    gap,
    groupW,
    startX,
    selectedW,
    unselectedW,
    selectedH,
    unselectedH,
    hostPageBox,
    overflowsHost: nextW > 0 && lastRight > hostX + nextW + 0.51,
  };
}

export function slotAssignments(cardCount, pageCapacity) {
  const counted = pageCountOf(cardCount, pageCapacity);
  if (!counted.ok) return counted;
  const pages = [];
  for (let start = 0; start < cardCount; start += pageCapacity) {
    const slots = [];
    for (let slot = 0; slot < pageCapacity && start + slot < cardCount; slot += 1) slots.push(slot);
    pages.push(slots);
  }
  return { ok: true, pageCount: counted.pageCount, pages };
}

export function classifyPlayerState(value) {
  const text = String(value || '');
  if (/待/.test(text)) return 'pending';
  if (/已有|已确认|已確認/.test(text)) return 'confirmed';
  return null;
}

export function classifyIndName(name) {
  const body = String(name || '').replace(/^ind[/／]/i, '');
  if (/未选中|未選中|unselected|inactive/i.test(body)) return 'unselected';
  if (/选中|選中|selected|active/i.test(body)) return 'selected';
  return null;
}

export function variantValue(variant) {
  const props = variant?.componentProperties || {};
  const fromProp = props['Property 1'] ?? props.property1 ?? props.state;
  if (fromProp != null && fromProp !== '') return String(fromProp);
  const name = String(variant?.name || '');
  const eq = name.lastIndexOf('=');
  return eq >= 0 ? name.slice(eq + 1) : name;
}

function ancestorNamed(node, byId, name) {
  const want = String(name || '').trim();
  if (!want || !node) return false;
  const seen = new Set();
  let current = node;
  while (current && !seen.has(String(current.id))) {
    seen.add(String(current.id));
    if (String(current.name || '').trim() === want) return true;
    current = current.parentId ? byId.get(String(current.parentId)) : null;
  }
  return false;
}

export function splitPagerButtons(buttons = []) {
  const sorted = [...buttons].sort(compareHorizontal);
  if (sorted.length === 0) return { ok: true, prev: [], next: [] };
  if (sorted.length === 1) {
    return { ok: false, prev: [], next: [], problem: '作用域只有 1 个 btn/切换按钮，无法区分左右' };
  }
  if (sorted.length % 2 !== 0) {
    return { ok: false, prev: [], next: [], problem: `作用域有 ${sorted.length} 个 btn/切换按钮，不能猜` };
  }
  const mid = sorted.length / 2;
  return { ok: true, prev: sorted.slice(0, mid), next: sorted.slice(mid) };
}

function pageIndexCopyIds(nodes, scope, byId) {
  return asArray(nodes).filter((item) => {
    if (item.status !== 'determined') return false;
    if (!(item.role === 'copy' || String(item.type || '').toUpperCase() === 'TEXT')) return false;
    if (nearestSecId(item, byId) !== scope) return false;
    if (!ancestorNamed(item, byId, '滑条')) return false;
    const text = String(item.text?.characters || item.characters || item.name || '').trim();
    return /^\d+\s*\/\s*\d+$/.test(text);
  }).map((item) => String(item.id));
}

export function nearestSecId(node, byId) {
  if (!node) return null;
  if (node.role === 'sec') return String(node.id);
  if (Array.isArray(node.ancestorIds)) {
    for (let i = node.ancestorIds.length - 1; i >= 0; i -= 1) {
      const ancestor = byId.get(String(node.ancestorIds[i]));
      if (ancestor?.role === 'sec') return String(ancestor.id);
    }
  }
  const seen = new Set();
  let current = node;
  while (current?.parentId && !seen.has(String(current.parentId))) {
    seen.add(String(current.parentId));
    current = byId.get(String(current.parentId));
    if (!current) break;
    if (current.role === 'sec') return String(current.id);
  }
  return null;
}

export function componentSetOf(componentId, componentSets) {
  const id = String(componentId || '');
  if (!id) return null;
  for (const set of asArray(componentSets)) {
    if (String(set.id) === id) return set;
    if (asArray(set.variants).some((variant) => String(variant.id) === id)) return set;
  }
  return null;
}

function boxX(node) {
  return Number(node?.pageBox?.x);
}

function boxY(node) {
  return Number(node?.pageBox?.y);
}

function compareHorizontal(a, b) {
  const dx = boxX(a) - boxX(b);
  if (dx !== 0) return dx;
  return String(a.orderKey || '').localeCompare(String(b.orderKey || ''));
}

/** Same-component cards must form one unique row, or a column-aligned grid. */
export function uniqueCardGrid(instances) {
  if (!instances.length) return { ok: true, cards: [], colCount: 0, rowCount: 0, problems: [] };
  const rowsMap = new Map();
  for (const node of instances) {
    const x = boxX(node);
    const y = boxY(node);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { ok: false, cards: [], colCount: 0, rowCount: 0, problems: [`${node.id} 卡片没有可用 pageBox，不能猜分页`] };
    }
    const key = Math.round(y);
    if (!rowsMap.has(key)) rowsMap.set(key, []);
    rowsMap.get(key).push(node);
  }
  const rows = [...rowsMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => [...row].sort((a, b) => boxX(a) - boxX(b) || String(a.orderKey || '').localeCompare(String(b.orderKey || ''))));
  const colCount = rows[0].length;
  if (colCount < 1) {
    return { ok: false, cards: [], colCount: 0, rowCount: 0, problems: ['分页 switch 没有可用列'] };
  }
  const firstXs = rows[0].map((node) => Math.round(boxX(node)));
  for (let i = 1; i < firstXs.length; i += 1) {
    if (!(firstXs[i] > firstXs[i - 1])) {
      return {
        ok: false,
        cards: [],
        colCount: 0,
        rowCount: 0,
        problems: [`${rows[0][i - 1].id} 与 ${rows[0][i].id} 不是规则网格（同行 x 不递增）`],
      };
    }
  }
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    const isLast = r === rows.length - 1;
    if (!isLast && row.length !== colCount) {
      return {
        ok: false,
        cards: [],
        colCount: 0,
        rowCount: 0,
        problems: [`${row[0].id} 所在行不是规则网格（列数 ${row.length} ≠ ${colCount}）`],
      };
    }
    if (isLast && row.length > colCount) {
      return {
        ok: false,
        cards: [],
        colCount: 0,
        rowCount: 0,
        problems: [`${row[0].id} 末行列数多于第一行，不能猜分页`],
      };
    }
    for (let c = 0; c < row.length; c += 1) {
      if (c > 0 && !(boxX(row[c]) > boxX(row[c - 1]))) {
        return {
          ok: false,
          cards: [],
          colCount: 0,
          rowCount: 0,
          problems: [`${row[c - 1].id} 与 ${row[c].id} 不是规则网格`],
        };
      }
      if (Math.round(boxX(row[c])) !== firstXs[c]) {
        return {
          ok: false,
          cards: [],
          colCount: 0,
          rowCount: 0,
          problems: [`${row[c].id} 卡片不是规则网格（列未左对齐）`],
        };
      }
    }
  }
  return { ok: true, cards: rows.flat(), colCount, rowCount: rows.length, problems: [] };
}

export function collectSwitchCards(switchNode, nodes, componentSets) {
  const problems = [];
  const children = asArray(nodes).filter((node) => String(node.parentId) === String(switchNode.id));
  const instances = children.filter((node) => String(node.type || '').toUpperCase() === 'INSTANCE' && node.componentId);
  if (!instances.length) return { ok: true, candidate: false, cards: [], pageCapacity: 0, problems };
  const sets = instances.map((node) => {
    const set = componentSetOf(node.componentId, componentSets);
    return { node, set, setId: set ? String(set.id) : null };
  });
  if (sets.some((item) => !item.setId)) {
    const componentIds = new Set(instances.map((node) => String(node.componentId || '')).filter(Boolean));
    if (componentIds.size === 1) {
      const grid = uniqueCardGrid(instances);
      if (!grid.ok) {
        problems.push(...grid.problems.map((item) => `${switchNode.id} ${item}`));
        return { ok: false, candidate: true, cards: [], pageCapacity: 0, problems };
      }
      return {
        ok: true,
        candidate: true,
        cards: grid.cards,
        pageCapacity: grid.cards.length,
        colCount: grid.colCount,
        rowCount: grid.rowCount,
        componentSet: null,
        componentSetId: [...componentIds][0],
        problems,
      };
    }
    problems.push(`${switchNode.id} 卡片实例无法映射到组件集，不能猜分页`);
    return { ok: false, candidate: true, cards: [], pageCapacity: 0, problems };
  }
  const unique = new Set(sets.map((item) => item.setId));
  if (unique.size !== 1) {
    problems.push(`${switchNode.id} 卡片不是同一组件（${[...unique].join(', ')}），不能猜分页`);
    return { ok: false, candidate: true, cards: [], pageCapacity: 0, problems };
  }
  const grid = uniqueCardGrid(instances);
  if (!grid.ok) {
    problems.push(...grid.problems.map((item) => `${switchNode.id} ${item}`));
    return { ok: false, candidate: true, cards: [], pageCapacity: 0, problems };
  }
  return {
    ok: true,
    candidate: true,
    cards: grid.cards,
    pageCapacity: grid.cards.length,
    colCount: grid.colCount,
    rowCount: grid.rowCount,
    componentSet: sets[0].set,
    componentSetId: sets[0].setId,
    problems,
  };
}

function descendantsOf(nodes, rootId) {
  const byParent = new Map();
  for (const node of nodes) {
    const pid = String(node.parentId || '');
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(node);
  }
  const out = [];
  const walk = (id) => {
    for (const child of byParent.get(String(id)) || []) {
      out.push(child);
      walk(child.id);
    }
  };
  const root = nodes.find((node) => String(node.id) === String(rootId));
  if (root) out.push(root);
  walk(rootId);
  return out;
}

function cloneTree(sourceId, nodes, slotBox, sourceBox, prefix) {
  const dx = Number(slotBox?.x || 0) - Number(sourceBox?.x || 0);
  const dy = Number(slotBox?.y || 0) - Number(sourceBox?.y || 0);
  const tree = descendantsOf(nodes, sourceId);
  const idMap = new Map();
  for (const node of tree) idMap.set(String(node.id), `${prefix}~${node.id}`);
  return tree.map((node) => {
    const pageBox = node.pageBox
      ? { ...node.pageBox, x: node.pageBox.x + dx, y: node.pageBox.y + dy }
      : null;
    const parentId = node.id === sourceId ? null : (idMap.get(String(node.parentId)) || null);
    return {
      ...node,
      id: idMap.get(String(node.id)),
      parentId,
      sourceNodeId: node.sourceNodeId || node.id,
      pageBox,
      pagedCard: node.id === sourceId,
    };
  });
}

function applyReplaceable(nodes, replaceable, end) {
  if (!replaceable || typeof replaceable !== 'object') return nodes;
  return nodes.map((node) => {
    const key = node.assetKey;
    if (!key || !Object.hasOwn(replaceable, key)) return node;
    const mapped = pickEnd(replaceable[key], end);
    if (mapped == null || mapped === '') return node;
    return { ...node, sourceNodeId: String(mapped), pagedAsset: String(mapped) };
  });
}

function matchCardToSlot(card, slots, componentSet, end) {
  const state = String(pickEnd(card.state, end) ?? card.state ?? '').trim();
  if (!state) return { ok: false, problem: '卡片缺 state' };
  const fromInstance = pickEnd(card.fromInstance, end);
  if (fromInstance) {
    const slot = slots.find((item) => String(item.id) === String(fromInstance));
    if (!slot) return { ok: false, problem: `fromInstance ${fromInstance} 不是稿上画出的卡片` };
    return { ok: true, slot };
  }
  const hits = slots.filter((slot) => {
    const variant = asArray(componentSet?.variants).find((item) => String(item.id) === String(slot.componentId));
    const value = variant ? variantValue(variant) : '';
    if (state === value) return true;
    return classifyPlayerState(value) === state;
  });
  if (hits.length === 0) return { ok: false, problem: `state ${state} 对不上稿上卡片变体` };
  if (new Set(hits.map((item) => item.componentId)).size !== 1 && hits.length !== 1) {
    return { ok: false, problem: `state ${state} 匹配到多个不同变体，不能猜` };
  }
  return { ok: true, slot: hits[0] };
}

export function resolvePagedSwitches({ nodes = [], componentSets = [], config = {}, end } = {}) {
  const problems = [];
  const byId = new Map(asArray(nodes).map((node) => [String(node.id), node]));
  const carouselOwners = new Set(
    asArray(config.carousels).map((item) => String(pickEnd(item.ownerId, end) || item.ownerId || '')).filter(Boolean),
  );
  const configEntries = asArray(config.pagedSwitches);
  const configBySwitch = new Map();
  for (const [index, entry] of configEntries.entries()) {
    const switchId = String(pickEnd(entry?.switchId, end) || entry?.switchId || '');
    if (!switchId) {
      problems.push(`pagedSwitches[${index}] 缺 ${end} switchId`);
      continue;
    }
    if (configBySwitch.has(switchId)) problems.push(`pagedSwitches 重复 switchId ${switchId}`);
    configBySwitch.set(switchId, entry);
  }

  const items = [];
  for (const node of nodes) {
    const switchId = String(node.id);
    const listed = configBySwitch.has(switchId);
    if (!listed && (node.status !== 'determined' || node.role !== 'switch')) continue;
    const collected = collectSwitchCards(node, nodes, componentSets);
    const scope = nearestSecId(node, byId);
    const inds = asArray(nodes).filter((item) => (
      item.status === 'determined'
      && item.role === 'ind'
      && nearestSecId(item, byId) === scope
    ));
    const pagedCandidate = collected.ok && collected.candidate && (inds.length > 0 || listed);
    if (!pagedCandidate) {
      if (listed) {
        problems.push(...collected.problems);
        if (!collected.problems.length) problems.push(`${switchId} 不是可分页网格（同一组件规则网格；未列出时还要同 sec ind/）`);
      }
      continue;
    }
    problems.push(...collected.problems);
    if (carouselOwners.has(switchId)) {
      problems.push(`${switchId} 不能同时作为 config.carousels 与分页 switch`);
      continue;
    }
    const entry = configBySwitch.get(switchId);
    if (!entry) {
      problems.push(`${switchId} 已识别为分页 switch，但 config.pagedSwitches 没有卡片列表`);
      continue;
    }

    let selectedInd = null;
    let unselectedInd = null;
    let indLayout = null;
    if (inds.length) {
      const grouped = { selected: [], unselected: [] };
      let indOk = true;
      for (const ind of inds) {
        const kind = classifyIndName(ind.name);
        if (!kind) {
          problems.push(`${ind.id} ind 无法唯一分成选中/未选中`);
          indOk = false;
          continue;
        }
        grouped[kind].push(ind);
      }
      if (!indOk) continue;
      if (!grouped.selected.length || !grouped.unselected.length) {
        problems.push(`${switchId} 作用域 ind 必须同时有选中与未选中样式`);
        continue;
      }
      selectedInd = [...grouped.selected].sort(compareHorizontal)[0];
      unselectedInd = [...grouped.unselected].sort(compareHorizontal)[0];
      const indSorted = [...inds].sort(compareHorizontal);
      const hostNode = selectedInd.parentId ? byId.get(String(selectedInd.parentId)) : null;
      const sourceBoxes = indSorted.map((item) => item.pageBox);
      const hostBox = hostNode?.pageBox || (() => {
        const xs = sourceBoxes.map((box) => num(box?.x));
        const rights = sourceBoxes.map((box) => num(box?.x) + num(box?.w));
        return {
          x: Math.min(...xs),
          y: num(selectedInd.pageBox?.y),
          w: Math.max(...rights) - Math.min(...xs),
          h: num(selectedInd.pageBox?.h),
        };
      })();
      indLayout = { selectedInd, unselectedInd, hostNode, sourceBoxes, hostBox };
    }

    const pagerBtns = asArray(nodes).filter((item) => (
      item.status === 'determined'
      && item.role === 'btn'
      && /^btn[/／]切换按钮$/.test(String(item.name || '').trim())
      && nearestSecId(item, byId) === scope
    )).sort(compareHorizontal);
    const split = splitPagerButtons(pagerBtns);
    if (!split.ok) {
      problems.push(`${switchId} ${split.problem}`);
      continue;
    }

    const cards = asArray(entry.cards);
    const counted = pageCountOf(cards.length, collected.pageCapacity);
    if (!counted.ok) {
      problems.push(...counted.problems.map((item) => `${switchId} ${item}`));
      continue;
    }
    const assigned = slotAssignments(cards.length, collected.pageCapacity);
    const hideChromeWhenSinglePage = entry.hideChromeWhenSinglePage !== false;
    const hideChrome = hideChromeWhenSinglePage && counted.pageCount <= 1;

    const skipIds = new Set();
    for (const slot of collected.cards) {
      for (const part of descendantsOf(nodes, slot.id)) skipIds.add(String(part.id));
    }
    for (const ind of inds) skipIds.add(String(ind.id));

    const pages = [];
    let cardOk = true;
    for (const [pageIndex, slots] of assigned.pages.entries()) {
      const itemsOnPage = [];
      for (const [offset, slotIndex] of slots.entries()) {
        const card = cards[pageIndex * collected.pageCapacity + offset];
        const matched = matchCardToSlot(card, collected.cards, collected.componentSet, end);
        if (!matched.ok) {
          problems.push(`${switchId} cards[${pageIndex * collected.pageCapacity + offset}] ${matched.problem}`);
          cardOk = false;
          break;
        }
        const slot = collected.cards[slotIndex];
        const prefix = `paged~${switchId}~${pageIndex}~${slotIndex}`;
        let cloned = cloneTree(matched.slot.id, nodes, slot.pageBox, matched.slot.pageBox, prefix);
        cloned = applyReplaceable(cloned, card.replaceable, end);
        if (cloned[0]) cloned[0] = { ...cloned[0], pagedCard: String(slotIndex), pagedPage: String(pageIndex) };
        itemsOnPage.push({ slotIndex, sourceId: matched.slot.id, nodes: cloned });
      }
      if (!cardOk) break;
      pages.push({ index: pageIndex, items: itemsOnPage });
    }
    if (!cardOk) continue;

    const laid = indLayout
      ? layoutPagedDots({
        pageCount: counted.pageCount,
        selectedBox: indLayout.selectedInd.pageBox,
        unselectedBox: indLayout.unselectedInd.pageBox,
        hostBox: indLayout.hostBox,
        sourceBoxes: indLayout.sourceBoxes,
        hostLayout: indLayout.hostNode?.layout || null,
      })
      : { dots: [], gap: 0, hostPageBox: null };

    items.push({
      switchId,
      scopeId: scope,
      pageCapacity: collected.pageCapacity,
      pageCount: counted.pageCount,
      indCount: inds.length,
      dotGap: laid.gap,
      hostPageBox: laid.hostPageBox,
      hideChrome,
      hideChromeWhenSinglePage,
      placeholder: entry.placeholder === true,
      componentSetId: collected.componentSetId,
      slots: collected.cards.map((slot) => ({ id: slot.id, pageBox: slot.pageBox, componentId: slot.componentId })),
      selectedInd,
      unselectedInd,
      dots: laid.dots || [],
      dotHostId: selectedInd?.parentId ? String(selectedInd.parentId) : null,
      prevBtnId: split.prev[0] ? String(split.prev[0].id) : null,
      nextBtnId: split.next[0] ? String(split.next[0].id) : null,
      prevBtnIds: split.prev.map((item) => String(item.id)),
      nextBtnIds: split.next.map((item) => String(item.id)),
      indexBtnIds: [...split.prev, ...split.next]
        .filter((item) => ancestorNamed(item, byId, '滑条'))
        .map((item) => String(item.id)),
      pageIndexIds: pageIndexCopyIds(nodes, scope, byId),
      skipIds: [...skipIds],
      loop: entry.loop === true,
      pages,
    });
    configBySwitch.delete(switchId);
  }

  for (const leftover of configBySwitch.keys()) {
    problems.push(`pagedSwitches 指向 ${leftover}，但 ${end} 没有可分页网格（同一组件卡片排成唯一横排或规则网格；未列出时还要同作用域 ind/）`);
  }

  return { ok: problems.length === 0, problems, items };
}
