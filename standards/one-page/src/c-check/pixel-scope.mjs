export function pixelScope(meta) {
  const screens = meta.nodes.filter((node) => node.role === 'sec');
  const cases = screens.map((screen) => ({ screen, caseId: 'default' }));
  for (const row of meta.tabBindings) {
    const resolve = (ref) => meta.nodes.find((node) => node.end === row.end && node.nodeId === ref.id && node.scope === ref.scope);
    const tab = resolve(row.tab);
    const panel = resolve(row.panel);
    const screen = screens.find((node) => node.end === row.end && node.nodeId === tab?.module);
    if (!screen || !panel || panel.module !== screen.nodeId) throw new Error('必验 TAB 状态未绑定本端本屏');
    cases.push({ screen, caseId: tab.domId, tab, panel, group: [row.switch.scope, row.switch.id].join(':') });
  }
  const ordered = cases.filter((state) => state.tab).sort((left, right) => meta.nodes.indexOf(left.tab) - meta.nodes.indexOf(right.tab));
  return cases.map((state) => {
    const selected = new Map();
    const applicable = ordered.filter((item) => item.screen === state.screen);
    for (const item of applicable) if (!selected.has(item.group)) selected.set(item.group, item);
    if (state.tab) selected.set(state.group, state);
    const active = [...selected.values()];
    return { ...state, selectedTabs: active.map((item) => item.tab.domId),
      hiddenPanels: applicable.filter((item) => !active.includes(item)).map((item) => item.panel.nodeId) };
  });
}

export function targetRegion(meta, screen, target, viewport) {
  const { width, height } = viewport;
  const screenBox = screen.designBox;
  const box = target.designBox;
  if (![width, height].every((size) => Number.isSafeInteger(size) && size > 0) || !screenBox || !box) throw new Error('缺绑定的局部设计框');
  const scale = screen.end === 'pc' ? Math.min(width / 3840, height / 2160) : Math.min(width / 750, height / 1430);
  const x = (width - screenBox.w * scale) / 2 + (box.x - screenBox.x) * scale;
  const y = (height - screenBox.h * scale) / 2 + (box.y - screenBox.y) * scale;
  const edges = [x, y, x + box.w * scale, y + box.h * scale];
  if (!edges.every(Number.isFinite) || box.w <= 0 || box.h <= 0 || edges[0] < -1e-6 || edges[1] < -1e-6
      || edges[2] > width + 1e-6 || edges[3] > height + 1e-6) throw new Error('局部设计框越出参考视口');
  const left = Math.floor(edges[0] + 1e-6);
  const top = Math.floor(edges[1] + 1e-6);
  return { edges, region: [left, top, Math.ceil(edges[2] - 1e-6) - left, Math.ceil(edges[3] - 1e-6) - top] };
}

export const criticalModules = (meta, screen, state) => meta.nodes.filter((node) => node.end === screen.end && node.module === screen.nodeId
  && ['btn', 'tab', 'nav', 'title', 'kv'].includes(node.role)
  && !state.hiddenPanels.some((id) => node.ancestors?.includes(id)));

export const hasHiddenPaginationEvidence = (rows, { end, screen, caseId }, actionId, action) =>
  ['next-page','previous-page'].includes(action?.type) && action.targets.length > 0 && action.targets.every((owner) => rows.some((row) => {
    const detail = row.detail;
    return row.check === 'D08' && row.target === [end, screen, caseId, '@initial', owner, actionId, 'pagination-hidden'].join(':')
      && row.status === 'pass' && detail?.end === end && detail.screen === screen && detail.caseId === caseId
      && detail.sampleId === '@initial' && detail.owner === owner && detail.actionId === actionId && detail.hidden === true && [0, 1].includes(detail.pages);
  }));
