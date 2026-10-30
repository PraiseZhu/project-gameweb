import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  pageCountOf,
  slotAssignments,
  collectSwitchCards,
  layoutPagedDots,
  resolvePagedSwitches,
  splitPagerButtons,
  uniqueCardGrid,
} from '../lib/paged-switch.mjs';
import { renderPageHtml } from '../../assets/runtime/render.mjs';
import { formatPagedIndex, paintPagedDots, pagedReleaseTarget } from '../../assets/runtime/paged-switch-runtime.mjs';
import { runEwsWeb } from '../ews-web.mjs';
import {
  appendPagedPlayers,
  defaultConfig,
  defaultDesignations,
  makeLark,
  pagedConfig,
  pcInventory,
  mobileInventory,
  writeAssets,
  writeReadyPack,
} from './helpers/ready-fixture.mjs';

test('page index keeps Figma pad width and uses model pageCount', () => {
  assert.equal(formatPagedIndex('01/10', 1, 2), '01/02');
  assert.equal(formatPagedIndex('01/10', 2, 2), '02/02');
  assert.equal(formatPagedIndex('1/10', 1, 2), '1/2');
});

test('1/4/6/8/9 cards against capacity 4 → 1/1/2/2/3 pages; leftover left-aligned', () => {
  const counts = [1, 4, 6, 8, 9];
  const pages = counts.map((n) => pageCountOf(n, 4).pageCount);
  assert.deepEqual(pages, [1, 1, 2, 2, 3]);
  assert.deepEqual(slotAssignments(6, 4).pages, [[0, 1, 2, 3], [0, 1]]);
  assert.deepEqual(slotAssignments(9, 4).pages, [[0, 1, 2, 3], [0, 1, 2, 3], [0]]);
  assert.equal(pageCountOf(0, 4).ok, false);
});

test('old carousel switch with img slides is not a paged candidate', () => {
  const pc = pcInventory();
  const collected = collectSwitchCards(
    pc.nodes.find((node) => node.id === '100:22'),
    pc.nodes,
    pc.attachments.componentSets,
  );
  assert.equal(collected.ok, true);
  assert.equal(collected.candidate, false);
  assert.equal(collected.pageCapacity, 0);
});

test('2x2 grid is a unique page template; staggered columns fail-closed', () => {
  const aligned = [
    { id: 'a', pageBox: { x: 19063, y: 9522, w: 324, h: 465 }, orderKey: '0' },
    { id: 'b', pageBox: { x: 19415, y: 9522, w: 324, h: 465 }, orderKey: '1' },
    { id: 'c', pageBox: { x: 19063, y: 10002, w: 324, h: 465 }, orderKey: '2' },
    { id: 'd', pageBox: { x: 19415, y: 10002, w: 324, h: 465 }, orderKey: '3' },
  ];
  const grid = uniqueCardGrid(aligned);
  assert.equal(grid.ok, true, grid.problems.join('\n'));
  assert.equal(grid.colCount, 2);
  assert.equal(grid.rowCount, 2);
  assert.deepEqual(grid.cards.map((node) => node.id), ['a', 'b', 'c', 'd']);
  const staggered = uniqueCardGrid([
    aligned[0],
    aligned[1],
    { ...aligned[2], pageBox: { ...aligned[2].pageBox, x: 19100 } },
    aligned[3],
  ]);
  assert.equal(staggered.ok, false);
  assert.match(staggered.problems.join('\n'), /列未左对齐/);
});

test('2x2 fixture switch resolves to capacity 4 / 2 pages', () => {
  const { mobile } = appendPagedPlayers(pcInventory(), mobileInventory());
  const grid = {
    '200:81': { x: 24, y: 2560, w: 324, h: 220 },
    '200:82': { x: 376, y: 2560, w: 324, h: 220 },
    '200:83': { x: 24, y: 2795, w: 324, h: 220 },
    '200:84': { x: 376, y: 2795, w: 324, h: 220 },
  };
  const nodes = mobile.nodes.map((node) => {
    const box = grid[node.id];
    return box ? { ...node, pageBox: box, box } : node;
  });
  const collected = collectSwitchCards(
    nodes.find((node) => node.id === '200:80'),
    nodes,
    mobile.attachments.componentSets,
  );
  assert.equal(collected.ok, true, collected.problems.join('\n'));
  assert.equal(collected.pageCapacity, 4);
  assert.equal(collected.rowCount, 2);
  assert.equal(collected.colCount, 2);
  const resolved = resolvePagedSwitches({
    nodes,
    componentSets: mobile.attachments.componentSets,
    config: pagedConfig(8, { placeholder: true }),
    end: 'mobile',
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items[0].pageCapacity, 4);
  assert.equal(resolved.items[0].pageCount, 2);
  assert.deepEqual(resolved.items[0].slots.map((slot) => slot.id), ['200:81', '200:82', '200:83', '200:84']);
});

test('mobile switch without pager buttons still pages', () => {
  const { mobile } = appendPagedPlayers(pcInventory(), mobileInventory(), { pagerButtons: { mobile: false } });
  const resolved = resolvePagedSwitches({
    nodes: mobile.nodes,
    componentSets: mobile.attachments.componentSets,
    config: pagedConfig(8, { placeholder: true }),
    end: 'mobile',
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items[0].pageCount, 2);
  assert.equal(resolved.items[0].prevBtnId, null);
  assert.equal(resolved.items[0].nextBtnId, null);
});

test('mixed tab switch on the same page is skipped unless listed in pagedSwitches', () => {
  const { pc } = appendPagedPlayers(pcInventory(), mobileInventory());
  const nodes = [
    ...pc.nodes,
    {
      id: '100:90', status: 'determined', role: 'switch', name: 'switch/预选赛',
      parentId: '100:2', pageBox: { x: 0, y: 400, w: 800, h: 200 },
    },
    {
      id: '100:91', parentId: '100:90', type: 'INSTANCE', componentId: '100:31',
      pageBox: { x: 0, y: 400, w: 40, h: 40 }, orderKey: '0',
    },
    {
      id: '100:92', parentId: '100:90', type: 'INSTANCE', componentId: '100:41',
      pageBox: { x: 80, y: 400, w: 40, h: 40 }, orderKey: '1',
    },
  ];
  const resolved = resolvePagedSwitches({
    nodes,
    componentSets: pc.attachments.componentSets,
    config: pagedConfig(8, { placeholder: true }),
    end: 'pc',
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].switchId, '100:80');
});

test('mixed component instances fail closed', () => {
  const pc = pcInventory();
  const switchNode = pc.nodes.find((node) => node.id === '100:22');
  const mixed = [
    ...pc.nodes.filter((node) => node.id !== '100:23' && node.id !== '100:24'),
    {
      ...switchNode,
      id: '100:22',
    },
    {
      id: '100:23', parentId: '100:22', type: 'INSTANCE', componentId: '100:31',
      pageBox: { x: 120, y: 1120, w: 200, h: 200 }, orderKey: '0',
    },
    {
      id: '100:24', parentId: '100:22', type: 'INSTANCE', componentId: '100:41',
      pageBox: { x: 400, y: 1120, w: 200, h: 200 }, orderKey: '1',
    },
  ];
  const collected = collectSwitchCards(switchNode, mixed, pc.attachments.componentSets);
  assert.equal(collected.ok, false);
  assert.match(collected.problems.join('\n'), /不是同一组件/);
});

function packWithPlayers(cardCount) {
  const root = mkdtempSync(join(tmpdir(), 'ews-paged-'));
  const both = appendPagedPlayers(pcInventory(), mobileInventory());
  const handoff = join(root, 'handoff');
  const docs = writeReadyPack(handoff, both);
  const assetsDir = join(root, 'assets');
  writeAssets(assetsDir, docs);
  const configPath = join(root, 'config.json');
  writeFileSync(configPath, `${JSON.stringify(pagedConfig(cardCount, { placeholder: cardCount === 8 }), null, 2)}\n`);
  writeFileSync(join(root, 'lark.json'), `${JSON.stringify(makeLark(), null, 2)}\n`);
  writeFileSync(join(root, 'designations.json'), `${JSON.stringify(defaultDesignations(), null, 2)}\n`);
  const out = join(root, 'out');
  const built = runEwsWeb([
    '--handoff', handoff,
    '--assets', join(assetsDir, 'asset-map.json'),
    '--config', configPath,
    '--lark', join(root, 'lark.json'),
    '--designations', join(root, 'designations.json'),
    '--out', out,
  ], { cwd: root });
  return { root, out, built, docs };
}

test('resolve 8 placeholder cards → 2 pages capacity 4', () => {
  const { pc } = appendPagedPlayers(pcInventory(), mobileInventory());
  const resolved = resolvePagedSwitches({
    nodes: pc.nodes,
    componentSets: pc.attachments.componentSets,
    config: pagedConfig(8, { placeholder: true }),
    end: 'pc',
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items[0].pageCapacity, 4);
  assert.equal(resolved.items[0].pageCount, 2);
  assert.equal(resolved.items[0].hideChrome, false);
  assert.equal(resolved.items[0].placeholder, true);
  assert.equal(resolved.items[0].dots.length, 2);
  assert.deepEqual(resolved.items[0].pageIndexIds, ['100:93']);
});

test('missing pagedSwitches config fail-closed when switch+ind exist', () => {
  const { pc } = appendPagedPlayers(pcInventory(), mobileInventory());
  const resolved = resolvePagedSwitches({
    nodes: pc.nodes,
    componentSets: pc.attachments.componentSets,
    config: defaultConfig(),
    end: 'pc',
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.problems.join('\n'), /没有卡片列表/);
});

test('carousel owner cannot also be paged switch', () => {
  const { pc } = appendPagedPlayers(pcInventory(), mobileInventory());
  const config = pagedConfig(4);
  config.carousels = [...config.carousels, { ownerId: { pc: '100:80', mobile: '200:80' }, slides: { pc: ['100:81'], mobile: ['200:81'] } }];
  const resolved = resolvePagedSwitches({
    nodes: pc.nodes,
    componentSets: pc.attachments.componentSets,
    config,
    end: 'pc',
  });
  assert.equal(resolved.ok, false);
  assert.match(resolved.problems.join('\n'), /不能同时作为 config.carousels/);
});

test('ewsweb 8-card placeholder: 2 pages, 2 dots, old carousel kept', () => {
  const { built, out } = packWithPlayers(8);
  assert.equal(built.ok, true, (built.problems || []).join('\n'));
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /ews-carousel-slide/);
  assert.match(html, /data-paged-count="2"/);
  assert.match(html, /data-paged-capacity="4"/);
  assert.match(html, /data-paged-ind-count="4"/);
  assert.equal([...html.matchAll(/data-paged-page="/g)].filter((m, i, all) => all.findIndex((x) => x.index === m.index) === i).length > 0, true);
  assert.equal((html.match(/class="ews-paged-page"/g) || []).length, 2);
  assert.equal((html.match(/data-paged-dot="/g) || []).length, 2);
  assert.doesNotMatch(html, /data-paged-chrome="hidden"/);
  assert.match(html, /data-paged-index-for="100:80"[^>]*data-paged-index-sample="01\/10"/);
  assert.match(html, /data-paged-index-for="100:80"[^>]*>01\/02</);
  assert.doesNotMatch(html, /data-paged-index-for="[^"]+"[^>]*>01\/10</);
  const model = JSON.parse(readFileSync(join(out, 'model.json'), 'utf8'));
  const painted = renderPageHtml(model, { locale: 'zh-CN', device: 'pc' });
  assert.equal((painted.match(/data-paged-card="/g) || []).length, 8);
  assert.equal(model.platforms.pc.pagedSwitches[0].indCount, 4);
  assert.equal(model.platforms.pc.pagedSwitches[0].pageCapacity, 4);
  assert.match(painted, /ews-paged-dots[^>]*width:75px/);
  assert.match(painted, /--ews-paged-dot-active-w:48px/);
  assert.match(painted, /--ews-paged-dot-inactive-w:24px/);
  assert.match(painted, /class="ews-stage"/);
  assert.match(painted, /class="ews-node ews-paged-dot"[^>]*style="/);
  assert.doesNotMatch(painted, /--ews-paged-dot-(?:active|inactive)-image/);
  assert.doesNotMatch(painted, /--ews-paged-dot-[^;]*url\("/);
});

test('ewsweb 6 cards last page uses slot 0/1 left-aligned; 1 card hides chrome', () => {
  const six = packWithPlayers(6);
  assert.equal(six.built.ok, true, (six.built.problems || []).join('\n'));
  const html = readFileSync(join(six.out, 'index.html'), 'utf8');
  assert.equal((html.match(/class="ews-paged-page"/g) || []).length, 2);
  assert.equal((html.match(/data-paged-dot="/g) || []).length, 2);
  const lastPage = html.split('class="ews-paged-page"')[2] || '';
  assert.match(lastPage, /data-paged-card="0"/);
  assert.match(lastPage, /data-paged-card="1"/);
  assert.doesNotMatch(lastPage, /data-paged-card="2"/);
  assert.match(lastPage, /style="left:0px;top:0px;width:360px;height:360px;" data-paged-card="0"/);

  const one = packWithPlayers(1);
  assert.equal(one.built.ok, true, (one.built.problems || []).join('\n'));
  const oneHtml = readFileSync(join(one.out, 'index.html'), 'utf8');
  assert.match(oneHtml, /data-paged-count="1"/);
  assert.match(oneHtml, /data-paged-chrome="hidden"/);
  assert.match(oneHtml, /data-paged-prev=""/);
  assert.match(oneHtml, / hidden/);
});

function manuscriptPc() {
  const host = { x: 0, y: 0, w: 915, h: 10 };
  const sources = [
    { x: 0, y: 0, w: 306, h: 10 },
    { x: 309, y: 0, w: 200, h: 10 },
    { x: 512, y: 0, w: 200, h: 10 },
    { x: 715, y: 0, w: 200, h: 10 },
  ];
  return {
    host,
    selected: sources[0],
    unselected: sources[1],
    sources,
  };
}

function manuscriptMobile() {
  const host = { x: 0, y: 0, w: 518, h: 12 };
  const sources = [
    { x: 0, y: 0, w: 158, h: 12 },
    { x: 158, y: 0, w: 120, h: 12 },
    { x: 278, y: 0, w: 120, h: 12 },
    { x: 398, y: 0, w: 120, h: 12 },
  ];
  return {
    host,
    selected: sources[0],
    unselected: sources[1],
    sources,
  };
}

function hugLayout(itemSpacing) {
  return {
    layoutMode: 'HORIZONTAL',
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'HUG',
    itemSpacing,
    constraints: { horizontal: 'LEFT', vertical: 'TOP' },
  };
}

test('IND Hug host shrinks from LEFT; 915 is the 4-page result not a Fixed frame', () => {
  const pc = manuscriptPc();
  const mb = manuscriptMobile();
  const firstGapReuseXs = [0, 309, 618, 927];
  assert.ok(firstGapReuseXs[3] + 200 > pc.host.w, 'old first-x-gap copy overflows the PC frame');
  const pcWidths = { 1: 306, 2: 509, 3: 712, 4: 915 };
  const mbWidths = { 1: 158, 2: 278, 3: 398, 4: 518 };

  for (const pages of [1, 2, 3, 4]) {
    const laid = layoutPagedDots({
      pageCount: pages,
      selectedBox: pc.selected,
      unselectedBox: pc.unselected,
      hostBox: pc.host,
      sourceBoxes: pc.sources,
      hostLayout: hugLayout(3),
    });
    assert.equal(laid.gap, 3, `pc gap pages=${pages}`);
    assert.equal(laid.dots.length, pages);
    assert.equal(laid.dots[0].pageBox.w, 306);
    for (const dot of laid.dots.slice(1)) assert.equal(dot.pageBox.w, 200);
    assert.equal(laid.startX, pc.host.x);
    assert.equal(laid.hostPageBox.w, pcWidths[pages], `pc hug width pages=${pages}`);
    assert.equal(laid.hostPageBox.x, pc.host.x);
    const last = laid.dots.at(-1).pageBox;
    assert.equal(laid.overflowsHost, false, `pc overflow pages=${pages}`);
    assert.ok(last.x + last.w <= laid.hostPageBox.x + laid.hostPageBox.w + 0.51, `pc last pages=${pages}`);
  }

  const four = layoutPagedDots({
    pageCount: 4,
    selectedBox: pc.selected,
    unselectedBox: pc.unselected,
    hostBox: pc.host,
    sourceBoxes: pc.sources,
    hostLayout: hugLayout(3),
  });
  assert.deepEqual(four.dots.map((dot) => [dot.pageBox.x, dot.pageBox.w]), [[0, 306], [309, 200], [512, 200], [715, 200]]);

  const two = layoutPagedDots({
    pageCount: 2,
    selectedBox: pc.selected,
    unselectedBox: pc.unselected,
    hostBox: pc.host,
    sourceBoxes: pc.sources,
    hostLayout: hugLayout(3),
  });
  assert.equal(two.startX, 0);
  assert.equal(two.hostPageBox.w, 509);
  assert.deepEqual(two.dots.map((dot) => [dot.pageBox.x, dot.pageBox.w]), [[0, 306], [309, 200]]);

  const leftover = layoutPagedDots({
    pageCount: pageCountOf(9, 4).pageCount,
    selectedBox: pc.selected,
    unselectedBox: pc.unselected,
    hostBox: pc.host,
    sourceBoxes: pc.sources,
    hostLayout: hugLayout(3),
  });
  assert.equal(leftover.dots.length, 3);
  assert.equal(leftover.hostPageBox.w, 712);
  assert.equal(leftover.overflowsHost, false);

  for (const pages of [1, 2, 3, 4]) {
    const laid = layoutPagedDots({
      pageCount: pages,
      selectedBox: mb.selected,
      unselectedBox: mb.unselected,
      hostBox: mb.host,
      sourceBoxes: mb.sources,
      hostLayout: hugLayout(0),
    });
    assert.equal(laid.gap, 0, `mobile gap pages=${pages}`);
    assert.equal(laid.dots[0].pageBox.w, 158);
    for (const dot of laid.dots.slice(1)) assert.equal(dot.pageBox.w, 120);
    assert.equal(laid.startX, mb.host.x);
    assert.equal(laid.hostPageBox.w, mbWidths[pages], `mobile hug width pages=${pages}`);
    assert.equal(laid.overflowsHost, false, `mobile overflow pages=${pages}`);
  }
  const mobileFour = layoutPagedDots({
    pageCount: 4,
    selectedBox: mb.selected,
    unselectedBox: mb.unselected,
    hostBox: mb.host,
    sourceBoxes: mb.sources,
    hostLayout: hugLayout(0),
  });
  assert.deepEqual(mobileFour.dots.map((dot) => [dot.pageBox.x, dot.pageBox.w]), [[0, 158], [158, 120], [278, 120], [398, 120]]);
});

test('resolve 16 cards → 4 Hug dots shrink the host from the left edge', () => {
  const { pc } = appendPagedPlayers(pcInventory(), mobileInventory());
  const resolved = resolvePagedSwitches({
    nodes: pc.nodes,
    componentSets: pc.attachments.componentSets,
    config: pagedConfig(16),
    end: 'pc',
  });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  const plan = resolved.items[0];
  assert.equal(plan.pageCount, 4);
  assert.equal(plan.dots.length, 4);
  assert.equal(plan.dotGap, 3);
  assert.equal(plan.dots[0].pageBox.w, 48);
  assert.equal(plan.dots[1].pageBox.w, 24);
  const host = pc.nodes.find((node) => node.id === plan.dotHostId).pageBox;
  const last = plan.dots[3].pageBox;
  assert.equal(plan.hostPageBox.w, 129);
  assert.equal(plan.hostPageBox.x, host.x);
  assert.equal(plan.dots[0].pageBox.x, host.x);
  assert.ok(last.x + last.w <= plan.hostPageBox.x + plan.hostPageBox.w + 0.51);
});

test('paintPagedDots swaps width and asset, not aria-only', () => {
  const attrs = (init) => {
    const a = { ...init };
    return {
      style: {},
      getAttribute(name) { return Object.hasOwn(a, name) ? a[name] : null; },
      setAttribute(name, value) { a[name] = String(value); },
    };
  };
  const host = attrs({
    'data-paged-dots-for': 'sw',
    'data-paged-active-w': '306',
    'data-paged-inactive-w': '200',
    'data-paged-active-h': '10',
    'data-paged-inactive-h': '10',
    'data-paged-active-src': './assets/pc/on.png',
    'data-paged-inactive-src': './assets/pc/off.png',
  });
  const d0 = attrs({ 'data-paged-dot': '0', 'data-paged-for': 'sw' });
  const d1 = attrs({ 'data-paged-dot': '1', 'data-paged-for': 'sw' });
  const root = {
    querySelector(sel) {
      return String(sel).includes('data-paged-dots-for') ? host : null;
    },
    querySelectorAll(sel) {
      return String(sel).includes('data-paged-dot') ? [d0, d1] : [];
    },
  };
  paintPagedDots(root, 'sw', 1);
  assert.equal(d0.getAttribute('aria-current'), 'false');
  assert.equal(d1.getAttribute('aria-current'), 'true');
  assert.equal(d0.style.width, '200px');
  assert.equal(d1.style.width, '306px');
  assert.equal(d0.style.backgroundImage, "url('./assets/pc/off.png')");
  assert.equal(d1.style.backgroundImage, "url('./assets/pc/on.png')");
});

test('paged-dot CSS does not resolve image urls against runtime/', () => {
  const css = readFileSync(fileURLToPath(new URL('../../assets/runtime/ews.css', import.meta.url)), 'utf8');
  assert.doesNotMatch(css, /--ews-paged-dot-(?:active|inactive)-image/);
  assert.doesNotMatch(css, /background-image:\s*var\(--ews-paged-dot/);
});

test('slider index-chrome pager buttons keep designed opacity', () => {
  const css = readFileSync(fileURLToPath(new URL('../../assets/runtime/ews.css', import.meta.url)), 'utf8');
  assert.match(css, /\[data-paged-prev\]\[disabled\]:not\(\[data-paged-index-chrome\]\)/);
  assert.match(css, /\[data-paged-next\]\[disabled\]:not\(\[data-paged-index-chrome\]\)/);
  const indexRule = css.match(/\[data-paged-index-chrome\]\[disabled\][^{]*\{([^}]+)\}/);
  assert.ok(indexRule, 'missing index-chrome disabled rule');
  assert.doesNotMatch(indexRule[1], /opacity/);
  assert.doesNotMatch(indexRule[1], /visibility/);
  assert.doesNotMatch(indexRule[1], /color\s*:/);
});

test('slider pager buttons stamp data-paged-index-chrome; side arrows do not', () => {
  const html = renderPageHtml({
    defaultLocale: 'zh-CN',
    platforms: {
      pc: {
        designWidth: 1920,
        designHeight: 1080,
        page: { id: 'page', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
        screens: [{ key: 'sec6', sectionId: 'sec6' }],
        nodes: [
          { id: 'sec6', role: 'sec', name: 'sec/6', status: 'determined', pageBox: { x: 0, y: 0, w: 1920, h: 1080 } },
          { id: 'slider', name: '滑条', parentId: 'sec6', pageBox: { x: 800, y: 900, w: 200, h: 40 } },
          {
            id: 'side-prev', role: 'btn', name: 'btn/切换按钮', status: 'determined', parentId: 'sec6',
            pageBox: { x: 10, y: 400, w: 40, h: 40 },
          },
          {
            id: 'slide-prev', role: 'btn', name: 'btn/切换按钮', status: 'determined', parentId: 'slider',
            pageBox: { x: 800, y: 900, w: 40, h: 40 },
          },
        ],
        pagedSwitches: [{
          switchId: 'sw',
          loop: false,
          pageCount: 2,
          prevBtnIds: ['side-prev', 'slide-prev'],
          nextBtnIds: [],
          indexBtnIds: ['slide-prev'],
          pages: [],
          skipIds: [],
        }],
      },
    },
  }, { locale: 'zh-CN', device: 'pc' });
  assert.match(html, /data-node="slide-prev"[^>]*data-paged-index-chrome="1"/);
  assert.match(html, /data-node="side-prev"[^>]*data-paged-prev=""/);
  assert.doesNotMatch(html, /data-node="side-prev"[^>]*data-paged-index-chrome/);
});

test('even pager buttons split left prev / right next', () => {
  const four = splitPagerButtons([
    { id: 'r-large', pageBox: { x: 3314, w: 140 } },
    { id: 'l-large', pageBox: { x: 384, w: 140 } },
    { id: 'r-slider', pageBox: { x: 2037, w: 104 } },
    { id: 'l-slider', pageBox: { x: 1700, w: 104 } },
  ]);
  assert.equal(four.ok, true);
  assert.deepEqual(four.prev.map((item) => item.id), ['l-large', 'l-slider']);
  assert.deepEqual(four.next.map((item) => item.id), ['r-slider', 'r-large']);
  assert.equal(splitPagerButtons([{ id: 'only', pageBox: { x: 0, w: 10 } }]).ok, false);
  assert.equal(splitPagerButtons([]).ok, true);
});

test('config-listed same-component grid pages without switch role, ind, or component set', () => {
  const host = {
    id: 'vid-host', status: 'skipped', type: 'FRAME', name: 'Frame videos',
    parentId: '100:2', pageBox: { x: 100, y: 200, w: 800, h: 400 },
  };
  const cards = [0, 1, 2, 3].map((i) => ({
    id: `vid-${i}`, parentId: 'vid-host', type: 'INSTANCE', componentId: 'comp-video',
    name: '视频板块', status: 'unknown',
    pageBox: { x: 100 + i * 200, y: 200, w: 180, h: 300 }, orderKey: String(i),
  }));
  const sec = { id: '100:2', role: 'sec', name: 'sec/6', pageBox: { x: 0, y: 0, w: 1000, h: 800 } };
  const slider = { id: 'slider', name: '滑条', parentId: '100:2', pageBox: { x: 400, y: 700, w: 200, h: 40 } };
  const indexCopy = {
    id: 'idx', status: 'determined', role: 'copy', type: 'TEXT', name: '01/10',
    parentId: 'slider', text: { characters: '01/10' }, pageBox: { x: 440, y: 710, w: 80, h: 20 },
  };
  const btns = [
    { id: 'b1', status: 'determined', role: 'btn', name: 'btn/切换按钮', parentId: '100:2', pageBox: { x: 40, y: 300, w: 40, h: 40 } },
    { id: 'b2', status: 'determined', role: 'btn', name: 'btn/切换按钮', parentId: 'slider', pageBox: { x: 400, y: 700, w: 40, h: 40 } },
    { id: 'b3', status: 'determined', role: 'btn', name: 'btn/切换按钮', parentId: 'slider', pageBox: { x: 560, y: 700, w: 40, h: 40 } },
    { id: 'b4', status: 'determined', role: 'btn', name: 'btn/切换按钮', parentId: '100:2', pageBox: { x: 900, y: 300, w: 40, h: 40 } },
  ];
  const nodes = [sec, host, ...cards, slider, indexCopy, ...btns];
  const config = {
    pagedSwitches: [{
      switchId: { pc: 'vid-host' },
      placeholder: true,
      cards: [0, 1, 2, 3, 0, 1, 2, 3].map((i) => ({
        state: 'placeholder',
        fromInstance: { pc: `vid-${i}` },
      })),
    }],
  };
  const resolved = resolvePagedSwitches({ nodes, componentSets: [], config, end: 'pc' });
  assert.equal(resolved.ok, true, resolved.problems.join('\n'));
  assert.equal(resolved.items.length, 1);
  assert.equal(resolved.items[0].pageCapacity, 4);
  assert.equal(resolved.items[0].pageCount, 2);
  assert.equal(resolved.items[0].indCount, 0);
  assert.deepEqual(resolved.items[0].prevBtnIds, ['b1', 'b2']);
  assert.deepEqual(resolved.items[0].nextBtnIds, ['b3', 'b4']);
  assert.deepEqual(resolved.items[0].indexBtnIds, ['b2', 'b3']);
  assert.deepEqual(resolved.items[0].pageIndexIds, ['idx']);
  assert.equal(resolved.items[0].pages.length, 2);
});

test('paged drag release follows official swipe rules (half page or quick flick turns, else snaps back)', () => {
  const base = { page: 0, pageCount: 2, loop: false, width: 1000 };
  assert.equal(pagedReleaseTarget({ ...base, dx: -600, ms: 800 }), 1);
  assert.equal(pagedReleaseTarget({ ...base, dx: -300, ms: 800 }), 0);
  assert.equal(pagedReleaseTarget({ ...base, dx: -60, ms: 120 }), 1);
  assert.equal(pagedReleaseTarget({ ...base, dx: -5, ms: 50 }), 0);
  assert.equal(pagedReleaseTarget({ ...base, dx: 600, ms: 800 }), 0);
  assert.equal(pagedReleaseTarget({ ...base, page: 1, dx: -600, ms: 800 }), 1);
  assert.equal(pagedReleaseTarget({ ...base, page: 1, loop: true, dx: -600, ms: 800 }), 0);
});
