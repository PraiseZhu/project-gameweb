import { pixelScope } from './pixel-scope.mjs';

export function pagingCases(meta, config, end) {
  const result = [];
  const nodes = new Map(meta.nodes.map((node) => [node.domId, node]));
  for (const state of pixelScope(meta).filter((item) => item.screen.end === end)) {
    const present = (node) => node && node.end === end && (!node.module || node.module === state.screen.nodeId)
      && !state.hiddenPanels.some((panel) => node.ancestors?.includes(panel));
    for (const [owner, row] of Object.entries(config?.bindings ?? {})) {
      if (!row.pagination || !present(nodes.get(owner))) continue;
      const controls = Object.entries(config?.actions ?? {}).filter(([id, action]) => present(nodes.get(id))
        && ['next-page','previous-page'].includes(action.type) && action.targets.includes(owner));
      if (controls.length) result.push({ state, owner, paging: row.pagination, controls });
    }
  }
  return result;
}

export const pagingKey = ({ end, screen, caseId, sampleId, owner, actionId }) => [end, screen, caseId, sampleId, owner, actionId].join(':');

export function requiredPaging(meta, config, samples) {
  return meta.ends.flatMap((end) => pagingCases(meta, config, end).flatMap(({ state, owner, controls }) =>
    ['@initial', ...samples.filter((sample) => !sample.ends || sample.ends.includes(end)).map((sample) => sample.id)].flatMap((sampleId) =>
      controls.map(([actionId]) => ({ end, screen:state.screen.domId, caseId:state.caseId, sampleId, owner, actionId })))));
}

export function hasPagingResult(rows, scope) {
  return rows.some((row) => {
    if (row.check !== 'D08' || row.status !== 'pass' || !row.detail || pagingKey(row.detail) !== pagingKey(scope)) return false;
    const { pages, hidden, steps } = row.detail;
    return Number.isSafeInteger(pages) && pages >= 0 && (pages <= 1
      ? row.target === pagingKey(scope) + ':pagination-hidden' && hidden === true
      : row.target === pagingKey(scope) + ':pagination-action' && Array.isArray(steps) && steps.length === pages
        && steps.every((step) => step.ok && step.hit?.ok && JSON.stringify(step.expected) === JSON.stringify(step.actual)));
  });
}

export async function auditPaging(page, { meta, config, end, sampleId = '@initial', enter, hitTarget, add }) {
  for (const { state, owner, paging, controls } of pagingCases(meta, config, end)) {
    const scope = { end, screen: state.screen.domId, caseId: state.caseId, sampleId, owner };
    try {
      await enter(state);
      const target = page.locator('#' + owner);
      if (!await target.count() || !await target.evaluate((node) => node.checkVisibility() && !node.closest('[hidden],[inert]'))) throw Error('分页容器在该状态不可用');
      const list = paging.list && page.locator('#' + paging.list);
      if (list && await list.count() !== 1) throw Error('分页列表未绑定实际对象');
      const ids = list ? await list.locator(':scope > [data-carousel-item]').evaluateAll((nodes) => nodes.map((node) => node.id)) : paging.panels ?? [];
      const size = list ? paging.perPage : 1;
      if (!Number.isSafeInteger(size) || size < 1 || ids.some((id) => !id) || new Set(ids).size !== ids.length) throw Error('实际分页项目无唯一标识');
      const pages = Math.ceil(ids.length / size);
      const visible = () => page.evaluate((ids) => ids.filter((id) => {
        const node = document.getElementById(id);
        return node?.checkVisibility() && !node.closest('[hidden],[inert]');
      }), ids);
      for (const [actionId, action] of controls) {
        const detail = { ...scope, actionId, pages };
        const control = page.locator('#' + actionId);
        if (pages <= 1) {
          const hidden = await control.count() === 1 && await control.evaluate((node) => node.hidden && node.inert && !node.checkVisibility());
          add('D08', pagingKey(detail) + ':pagination-hidden', hidden, { ...detail, hidden });
          continue;
        }
        const steps = [];
        for (let step = 0; step < pages; step++) {
          const before = await visible();
          const index = Math.floor(ids.indexOf(before[0]) / size);
          const next = (index + pages + (action.type === 'next-page' ? 1 : -1)) % pages;
          const expected = ids.slice(next * size, (next + 1) * size);
          const hit = await control.count() === 1 ? await hitTarget(page, '#' + actionId) : { ok: false };
          if (hit.ok) await page.mouse.click(hit.x, hit.y);
          await page.waitForFunction(() => !document.querySelector('[data-moving-track]'), undefined, { timeout: 3000 });
          const actual = await visible();
          const ok = index >= 0 && JSON.stringify(before) === JSON.stringify(ids.slice(index * size, (index + 1) * size))
            && hit.ok && JSON.stringify(actual) === JSON.stringify(expected);
          steps.push({ index, next, expected, actual, hit, ok });
          if (!ok) break;
        }
        add('D08', pagingKey(detail) + ':pagination-action', steps.length === pages && steps.every((step) => step.ok), { ...detail, steps });
      }
    } catch (error) {
      for (const [actionId] of controls) {
        const detail = { ...scope, actionId };
        add('D08', pagingKey(detail) + ':pagination-unavailable', false, { ...detail, reason: error.message });
      }
    }
  }
}
