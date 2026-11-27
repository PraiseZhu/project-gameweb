export function dataValue(value, path) {
  return Array.isArray(path) && path.every((key) => typeof key === 'string' || typeof key === 'number')
    ? path.reduce((item, key) => item != null && Object.hasOwn(item, key) ? item[key] : undefined, value) : undefined;
}

export async function auditDataPresentation({ page, context, end, config, sample, add }) {
  const expected = Object.entries(config.bindings).flatMap(([id, row]) => {
    if (!row.data || !['slots', 'list'].includes(row.data.kind)) return [];
    const rows = dataValue(sample.data, row.data.path);
    if (!Array.isArray(rows)) return [];
    const pager = Object.entries(config.bindings).find(([, item]) => item.pagination?.list === id);
    return [{ id, kind: row.data.kind, slots: row.data.slots ?? [], count: rows.length,
      owner: pager?.[0], perPage: pager?.[1].pagination.perPage }];
  });
  const facts = await page.evaluate(({ expected, end, actions }) => expected.flatMap((expect) => {
    const list = document.getElementById(expect.id);
    if (list?.closest('[data-device]')?.dataset.device !== end) return [];
    const items = [...list.children].filter((item) => item.hasAttribute('data-carousel-item'));
    const visibleItems = items.filter((item) => !item.hidden && !item.inert);
    const owner = document.getElementById(expect.owner);
    const device = list.closest('[data-device]');
    const linked = (attr, ref) => [...device.querySelectorAll('[' + attr + ']')].filter((node) => node.getAttribute(attr) === ref);
    const empty = linked('data-empty-for', list.id).concat(owner ? linked('data-empty-for', owner.id) : []);
    const indicators = owner ? linked('data-ind-for', owner.id) : [];
    const pageCount = owner ? Math.ceil(expect.count / expect.perPage) : 0;
    const controls = Object.entries(actions).filter(([, action]) => ['next-page','previous-page'].includes(action.type) && action.targets.includes(expect.owner));
    const hiddenControls = controls.map(([id]) => {
      const button = document.getElementById(id);
      return { id, hidden: Boolean(button?.hidden && button.inert && !button.checkVisibility()) };
    });
    const ids = items.map(({ id }) => id);
    const structure = expect.kind === 'slots' ? JSON.stringify(ids) === JSON.stringify(expect.slots)
      : items.length === expect.count && new Set(ids).size === ids.length && ids.every(Boolean);
    const pagination = !owner || (visibleItems.length === Math.min(expect.count, expect.perPage)
      && empty.every((node) => node.hidden === (expect.count > 0))
      && indicators.every((node) => node.hidden === (pageCount <= 1) && node.children.length === (pageCount > 1 ? pageCount : 0))
      && (pageCount <= 1 ? hiddenControls.every(({ hidden }) => hidden)
        : controls.every(([id]) => document.getElementById(id)?.hidden === false)));
    return [{ id: expect.id, count: expect.count, actual: ids.length, active: visibleItems.length, pageCount,
      perPage: expect.perPage, owner: expect.owner, ids, hiddenControls, ok: structure && pagination }];
  }), { expected, end, actions: config.actions });
  for (const row of facts) {
    add('D09', row.id + ':presentation:' + sample.id, row.ok, row);
    if (row.pageCount > 1 && row.ok && await page.locator('#' + row.owner).isVisible()) {
      const swipe = await auditTouchPages(page, context, row);
      add('D08', row.owner + ':touch:' + sample.id, swipe.ok, swipe);
      if (swipe.clicks.length) add('D08', row.owner + ':drag-click:' + sample.id, swipe.clicks.every(Boolean), { prevented: swipe.clicks });
      if (swipe.roundtrip) add('D07', row.owner + ':state-roundtrip:' + sample.id, swipe.roundtrip.ok, swipe.roundtrip);
    }
  }
}

async function auditTouchPages(page, context, row) {
  const owner = page.locator('#' + row.owner);
  const box = await owner.boundingBox();
  if (!box || box.width < 64) return { ok: false, reason: '轮播无可滑动区域', clicks: [] };
  const left = Math.max(0, box.x) + 5;
  const right = Math.min(page.viewportSize().width, box.x + box.width) - 5;
  const y = Math.max(1, Math.min(page.viewportSize().height - 1, box.y + box.height / 2));
  const active = () => page.evaluate((ids) => ids.filter((id) => {
    const node = document.getElementById(id);
    return node && !node.closest('[inert],[hidden]');
  }), row.ids);
  const screen = await owner.evaluate((node) => node.closest('[data-screen]')?.id);
  const hit = await owner.evaluate((node, point) => node.contains(document.elementFromPoint(point.x, point.y)), { x: right, y });
  if (!hit || right - left < 45) return { ok: false, reason: '触摸命中不足或被遮挡', clicks: [] };
  const control = await page.locator('#' + screen).evaluate((node) => [...node.querySelectorAll('[data-action]')].flatMap((button) => {
    const box = button.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    return button.contains(document.elementFromPoint(x, y)) ? [{ id: button.id, x, y }] : [];
  })[0] ?? null);
  if (control) await page.evaluate((id) => {
    window.c3DragClicks = [];
    window.addEventListener('click', (event) => {
      if (event.detail > 0 && document.getElementById(id)?.contains(event.target)) {
        setTimeout(() => window.c3DragClicks.push(event.defaultPrevented), 0);
      }
    }, { capture: true });
  }, control.id);
  const session = await context.newCDPSession(page);
  const gesture = (type, x) => session.send('Input.dispatchTouchEvent', { type, touchPoints: x === undefined ? [] : [{ x, y }] });
  const steps = [];
  let roundtrip;
  try {
    for (let index = 1; index <= row.pageCount; index++) {
      await gesture('touchStart', right);
      await gesture('touchMove', (left + right) / 2);
      await gesture('touchMove', left);
      await gesture('touchEnd');
      if (control) await page.mouse.click(control.x, control.y);
      const expectedPage = index % row.pageCount;
      const expected = row.ids.slice(expectedPage * row.perPage, (expectedPage + 1) * row.perPage);
      const track = await page.locator('#' + row.id + ' [data-moving-track]').count();
      await page.locator('#' + row.id + ' [data-moving-track]').first().waitFor({ state: 'detached' });
      const actual = await active();
      const stayed = await page.locator('#' + screen).evaluate((node) => node.classList.contains('is-current'));
      steps.push({ expected, actual, track, stayed, ok: stayed && track === 1 && JSON.stringify(actual) === JSON.stringify(expected) });
      if (index === row.pageCount - 1 && expected.length && JSON.stringify(actual) === JSON.stringify(expected)) {
        const paired = await owner.evaluate((node) => [...document.querySelectorAll('[data-carousel]')].find((other) => other !== node
          && other.closest('[data-device]') !== node.closest('[data-device]') && other.dataset.carousel === node.dataset.carousel)?.id);
        if (paired) {
          const anchor = await page.locator('#' + expected[0]).getAttribute('data-item-key');
          const viewport = page.viewportSize();
          const currentEnd = await owner.evaluate((node) => node.closest('[data-device]').dataset.device);
          await page.setViewportSize({ width: currentEnd === 'mobile' ? 1025 : 1024, height: viewport.height });
          const peer = page.locator('#' + paired);
          await peer.waitFor({ state: 'visible' });
          const peerHasAnchor = await peer.evaluate((node, key) => [...node.querySelectorAll('[data-item-key]')].some((item) =>
            item.dataset.itemKey === key && !item.closest('[hidden],[inert]')), anchor);
          await page.setViewportSize(viewport);
          await owner.waitFor({ state: 'visible' });
          const restored = await active();
          roundtrip = { anchor, peerHasAnchor, restored, expected, ok: Boolean(anchor) && peerHasAnchor && JSON.stringify(restored) === JSON.stringify(expected) };
        }
      }
    }
  } finally { await session.detach(); }
  const clicks = control ? await page.evaluate(() => window.c3DragClicks) : [];
  if (control && clicks.length !== steps.length) clicks.push(false);
  return { ok: steps.every((step) => step.ok), steps, clicks, roundtrip };
}
