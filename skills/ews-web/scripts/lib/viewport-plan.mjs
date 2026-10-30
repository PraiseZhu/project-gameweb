/**
 * Derive product-viewport / pixel check targets from the ready pack + model.
 * Uses determined sec/ in the inventory, not hardcoded hero/gallery/footer keys.
 * Independent footer is included only when the model points at a real node.
 */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function geom(box) {
  if (!box || typeof box !== 'object') return null;
  const x = Number(box.x);
  const y = Number(box.y);
  const w = Number(box.w ?? box.width);
  const h = Number(box.h ?? box.height);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0 ? { x, y, w, h } : null;
}

function nodeBox(nodes, id) {
  const node = asArray(nodes).find((item) => String(item.id) === String(id));
  return geom(node?.pageBox || node?.box);
}

export function inventorySections(pack, device) {
  return asArray(pack?.inventories?.[device]?.nodes).filter((node) => (
    node.status === 'determined' && node.role === 'sec'
  ));
}

export function viewportPlanFromPack({ model, pack, device } = {}) {
  const problems = [];
  if (!device) return { ok: false, problems: ['viewport plan 缺 device'], screens: [], footer: null, keys: [] };
  const platform = model?.platforms?.[device];
  if (!platform) {
    return { ok: false, problems: [`${device}: model 缺该端`], screens: [], footer: null, keys: [] };
  }
  const nodes = asArray(platform.nodes);
  const screens = asArray(platform.screens).map((screen) => {
    const sectionId = String(screen.sectionId || screen.id || '');
    return {
      key: String(screen.key),
      sectionId,
      kind: 'section',
      pageBox: nodeBox(nodes, sectionId),
    };
  });
  if (!screens.length) problems.push(`${device}: model 没有 screens（需由 inventory 的 sec/ 派生）`);
  for (const screen of screens) {
    if (!screen.sectionId) problems.push(`${device}: screen ${screen.key} 缺 sectionId`);
    else if (!screen.pageBox) problems.push(`${device}: screen ${screen.key} ${screen.sectionId} 缺真实 pageBox`);
  }

  const footerId = platform.footer?.id ? String(platform.footer.id) : null;
  let footer = null;
  if (footerId) {
    const footerBox = nodeBox(nodes, footerId) || nodeBox(platform.footer?.nodes, footerId);
    if (!footerBox) problems.push(`${device}: 声明了 footer ${footerId} 但缺几何`);
    else {
      footer = { key: 'footer', sectionId: footerId, kind: 'footer', pageBox: footerBox };
    }
  }

  const secs = inventorySections(pack, device);
  if (pack && !secs.length) problems.push(`${device}: inventory 没有 determined sec/`);
  const covered = new Set(screens.map((screen) => screen.sectionId).filter(Boolean));
  if (footerId) covered.add(footerId);
  for (const sec of secs) {
    if (!covered.has(String(sec.id))) {
      problems.push(`${device}: inventory sec ${sec.id}（${sec.name || 'sec'}）未进入 screens 也不是独立 footer`);
    }
  }
  for (const screen of screens) {
    if (!screen.sectionId) continue;
    if (secs.length && !secs.some((sec) => String(sec.id) === screen.sectionId)) {
      problems.push(`${device}: screen ${screen.key} 指向 ${screen.sectionId}，inventory 没有该 determined sec/`);
    }
  }

  const ordered = [...screens].sort((a, b) => Number(a.pageBox?.y || 0) - Number(b.pageBox?.y || 0)
    || String(a.key).localeCompare(String(b.key)));
  const keys = [...ordered.map((screen) => screen.key), ...(footer ? ['footer'] : [])];
  return {
    ok: problems.length === 0,
    problems,
    device,
    screens: ordered,
    footer,
    keys,
    hasFooter: Boolean(footer),
  };
}
