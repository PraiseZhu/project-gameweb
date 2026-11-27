import { lstatSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { createSafeStaticServer } from '../../../stop1-figma-pixel/tool/src/safe-server.mjs';
import { checkAssets } from '../assets-manifest.mjs';
import { checkPage } from '../c-page-check.mjs';
import { readRegular } from '../c-check/evidence.mjs';
import { canonicalJson, sha256Hex } from '../canonical.mjs';
import { checkDesignApproved } from '../d-proof.mjs';
import { byteDigest, checkHandoff, isDigest, safeRelative } from '../handoff-check.mjs';
import { checkedLocale } from './locale-copy-audit.mjs';

export const E_KIND = 'e-multilang';
export const E_SCHEMA = 'onepage-e-multilang/v1';
export const E_MANIFEST = 'e-manifest.json';
export const E_STAGE = 'stage-record.json';
export const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
export const need = (condition, message) => { if (!condition) throw new Error(message); };
export const readJson = (root, path) => JSON.parse(readRegular(root, path));

export function checkInputs(options) {
  const { approval, approvalVersion, pagePack, pageVersion, check, checkVersion, scopeVersion, handoffPack,
    handoffVersion, consumerContract, assetsPack, assetsVersion, assetsSha256 } = options;
  const approved = checkDesignApproved(approval, { expectedStage:'D', expectedOutputVersion:approvalVersion,
    pagePack, pageVersion, check, checkVersion, scopeVersion });
  need(approved.ok, approved.reason);
  const built = checkPage({ pack:pagePack, expectVersion:pageVersion, scopeVersion });
  need(built.ok, built.reason);
  const b3 = checkHandoff({ pack:handoffPack, expectVersion:handoffVersion, scopeVersion, consumerContract }, { includePayloads:true });
  need(b3.ok, b3.message ?? b3.reason);
  const c1 = checkAssets({ pack:assetsPack, expectVersion:assetsVersion, scopeVersion });
  need(c1.ok, c1.message);
  const { manifest:meta } = built;
  need(c1.stage.output.digest === assetsSha256 && meta.c1.version === c1.manifest.version && meta.c1.digest === assetsSha256
    && meta.b3.version === b3.version && meta.b3.digest === b3.manifestSha256
    && equal(c1.manifest.b3, { version:b3.version, scopeVersion, manifestSha256:b3.manifestSha256 })
    && meta.baseLanguage === c1.manifest.baseLanguage && meta.baseLanguage === b3.manifest.scope.baseLanguage
    && equal(meta.ends, b3.ends) && equal(meta.files, approved.manifest.binding.files), 'D、B3、C1 未绑定同一成品、范围和基础语言');
  b3.manifest.scope.languages.forEach(checkedLocale);
  const targets = b3.manifest.scope.languages.filter((lang) => lang !== meta.baseLanguage);
  const inputs = [approved.record.output, c1.stage.output, { kind:'b-handoff', version:b3.version, digest:b3.manifestSha256 }]
    .map(({ kind, version, digest }) => ({ kind, version, digest, scopeVersion }));
  return { meta, targets, b3, inputs };
}

export function fileHashes(root, prefix = '') {
  need(lstatSync(join(root, prefix)).isDirectory(), 'E 只接受实际目录');
  const entries = [];
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix + name;
    need(safeRelative(path), 'E 路径不合法');
    const stat = lstatSync(join(root, path));
    if (stat.isDirectory()) {
      const children = fileHashes(root, path + '/');
      need(Object.keys(children).length, 'E 存在空目录：' + path);
      entries.push(...Object.entries(children));
    } else {
      const bytes = readRegular(root, path);
      entries.push([path, { bytes:bytes.length, sha256:byteDigest(bytes) }]);
    }
  }
  return Object.fromEntries(entries);
}

export function checkEEntry(recordPath, { expectedStage, expectedOutputVersion, scopeVersion, beforePublish } = {}) {
  try {
    const root = dirname(recordPath);
    need(basename(recordPath) === E_STAGE && expectedStage === 'E' && isDigest(expectedOutputVersion) && isDigest(scopeVersion)
      && (beforePublish || !basename(root).startsWith('.e-writing-')), 'E 验包必须提供已发布成果的阶段、版本和范围');
    const bytes = readRegular(root, E_MANIFEST);
    const { version, ...body } = JSON.parse(bytes);
    const { version:recordVersion, ...record } = readJson(root, E_STAGE);
    const files = fileHashes(root);
    delete files[E_MANIFEST];
    delete files[E_STAGE];
    need(body.schema === E_SCHEMA && version === expectedOutputVersion && sha256Hex(body) === version
      && body.scopeVersion === scopeVersion && equal(files, body.files)
      && recordVersion === sha256Hex(record) && record.result === 'pass' && record.stage === 'E'
      && equal(record.inputs, body.inputs)
      && equal(record.output, { kind:E_KIND, version, path:E_MANIFEST, digest:byteDigest(bytes) }), 'E 清单、文件 SHA-256 或阶段记录不一致');
    return { ok:true, manifest:{ version, ...body }, record:{ version:recordVersion, ...record } };
  } catch (error) {
    return { ok:false, reason:'E 验包失败：' + error.message };
  }
}

const viewports = {
  pc:[[1280,720],[1366,768],[1440,810],[1440,900],[1840,1000],[1920,1080],[2560,1440],[2560,1080],[2560,720]],
  mobile:[[320,568],[375,667],[375,812],[390,844],[812,375],[844,390],[690,829],[768,1024],[1024,768]],
};

const dataKey = { cn:'zh_CN',tw:'zh_TW',en:'en_US',jp:'ja_JP',kr:'ko_KR' };
const valueAt = (value, path) => path.reduce((part, key) => part != null && typeof key !== 'object' && Object.hasOwn(part, key) ? part[key] : undefined, value);

export function languageFilterCases({ fields, samples, config, meta, lang }) {
  const donor = samples.find((sample) => sample.id === 'success-full' && sample.testData === true);
  const cases = [];
  for (const field of fields.filter((row) => row.language === 'by-language' && row.languageMissing === 'hide-item')) {
    for (const loc of field.locations) {
      const trace = meta.nodes.find((row) => row.end === loc.end && row.nodeId === loc.nodeId);
      const binding = trace && config.bindings[trace.domId]?.fields?.field;
      const index = binding?.path?.findIndex((token) => typeof token === 'object' && token?.itemOf) ?? -1;
      if (index < 0) continue;
      const owner = meta.nodes.find((row) => row.end === loc.end && row.nodeId === binding.path[index].itemOf);
      need(owner && config.bindings[owner.domId]?.data?.kind === 'list' && donor, 'H31 缺 B3 绑定的数据样例或列表宿主');
      need(equal(binding.path.slice(0,index), config.bindings[owner.domId].data.path)
        && binding.path.slice(index + 1).length && binding.path.slice(index + 1).every((key) => typeof key === 'string'),
      'H31 字段路径未绑定列表：' + trace.domId);
      const data = structuredClone(donor.data);
      const rows = valueAt(data, binding.path.slice(0,index));
      need(Array.isArray(rows) && rows.length > 0, 'H31 缺非空数据样例：' + owner.domId);
      for (const row of rows) {
        const path = binding.path.slice(index + 1);
        const parent = valueAt(row, path.slice(0,-1));
        const key = path.at(-1);
        need(parent && typeof key === 'string' && Object.hasOwn(parent,key), 'H31 无法定位已声明的语种字段：' + trace.domId);
        parent[key] = { ...(typeof parent[key] === 'object' && parent[key] !== null ? parent[key] : {}),
          [dataKey[lang]]:undefined };
      }
      cases.push({ end:loc.end, owner:owner.domId, target:trace.domId, path:binding.path, data });
    }
  }
  return cases;
}

export async function measureLocale(browser, root, locale, meta) {
  const server = createSafeStaticServer(root);
  const origin = await server.listen();
  const results = [];
  const problems = [];
  try {
    for (const end of meta.ends) for (const [width, height] of viewports[end]) {
      const context = await browser.newContext({ viewport:{ width, height }, reducedMotion:'reduce', serviceWorkers:'block' });
      try {
        await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        page.on('pageerror', (error) => problems.push(error.message));
        await page.goto(origin + '/' + locale.lang + '.html');
        const device = page.locator('[data-device="' + end + '"]');
        const active = device.locator('.screen.is-current');
        await active.waitFor({ state:'visible' });
        need(await page.locator('html').getAttribute('lang') === locale.tag, '运行时语言错误');
        const measure = async (state) => {
          await page.evaluate(() => document.fonts.ready.then(() => undefined));
          const facts = await page.evaluate((rows) => {
            return rows.flatMap((row) => {
              const item = document.getElementById(row.id);
              if (!item || !item.getClientRects().length || item.closest('[hidden],[inert]')) return [];
              const style = getComputedStyle(item);
              const range = document.createRange();
              range.selectNodeContents(item.querySelector('[data-slogan-ink]') ?? item);
              const box = item.getBoundingClientRect();
              const ink = range.getBoundingClientRect();
              const occluded = [...range.getClientRects()].some((rect) => {
                const x = (rect.left + rect.right) / 2;
                const y = (rect.top + rect.bottom) / 2;
                if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
                for (const hit of document.elementsFromPoint(x,y)) {
                  if (item.contains(hit) || hit.contains(item)) return false;
                  const paint = getComputedStyle(hit);
                  if (Number(paint.opacity) > 0 && (hit.matches('img,svg,video,canvas,button,input') || paint.backgroundImage !== 'none'
                    || !['transparent','rgba(0, 0, 0, 0)'].includes(paint.backgroundColor))) return true;
                }
                return false;
              });
              const fontPx = Number.parseFloat(style.fontSize);
              const unit = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 200;
              const fontLoaded = row.untranslated || [...document.fonts].some((face) => style.fontFamily.includes(face.family) && face.status === 'loaded');
              return [{ ...row, fontPx, fontLoaded, occluded, overflow:ink.width > (row.box?.w ?? Infinity) * unit + 1
                || ink.height > (row.box?.h ?? Infinity) * unit + 1 || item.scrollWidth > item.clientWidth + 1
                || ink.left < -1 || ink.right > innerWidth + 1 || ink.top < -1 || ink.bottom > innerHeight + 1
                || box.x < -1 || box.right > innerWidth + 1 || box.y < -1 || box.bottom > innerHeight + 1 }];
            });
          }, locale.rows.filter((row) => row.end === end));
          results.push({ end, width, height, state, rows:facts });
        };
        const ids = await device.locator('[data-screen]').evaluateAll((nodes) => nodes.map((node) => node.id));
        for (const [index, id] of ids.entries()) {
          if (index) await page.keyboard.press('PageDown');
          const screen = page.locator('#' + id + '.is-current');
          await screen.waitFor({ state:'visible' });
          const checkState = async (state) => {
            await measure(state);
            const actions = await device.locator('[data-action]').evaluateAll((nodes) => nodes.flatMap((node) => {
              const action = window.OnePageConfig.actions[node.dataset.originalAction ?? node.id];
              return !node.closest('[hidden],[inert]') && node.getClientRects().length && ['open-modal','open-menu','toggle-menu'].includes(action?.type)
                ? [{ id:node.id, target:action.targets[0] }] : [];
            }));
            for (const action of actions) {
              await page.locator('#' + action.id).click();
              const target = page.locator('#' + action.target);
              await target.waitFor({ state:'visible' });
              await measure(state + ':' + action.id);
              await page.keyboard.press('Escape');
              await target.waitFor({ state:'hidden' });
            }
          };
          await checkState(id);
          const tabs = await screen.locator('[data-tab-group]').evaluateAll((nodes) => nodes.filter((node) => !node.closest('[hidden],[inert]')).map((node) => node.id));
          for (const tab of tabs) {
            const control = page.locator('#' + tab);
            await control.click();
            need(await control.getAttribute('aria-selected') === 'true', 'TAB 未进入：' + tab);
            await checkState(id + ':' + tab);
          }
        }
      } finally { await context.close(); }
    }
    for (const sample of locale.filterCases ?? []) {
      const [width,height] = viewports[sample.end][0];
      const context = await browser.newContext({ viewport:{ width,height }, reducedMotion:'reduce', serviceWorkers:'block' });
      try {
        const endpoint = origin + '/__onepage_e_sample__';
        await context.addInitScript((address) => {
          Object.defineProperty(window,'OnePageConfig',{ configurable:true, set(value) {
            value.dataUrl = address;
            Object.defineProperty(window,'OnePageConfig',{ value, configurable:true });
          } });
        }, endpoint);
        await context.route('**/*', (route) => {
          const url = new URL(route.request().url());
          if (url.origin !== origin) return route.abort();
          if (url.pathname === '/__onepage_e_sample__') return route.fulfill({ json:sample.data });
          return route.continue();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.goto(origin + '/' + locale.lang + '.html');
        await page.waitForFunction(() => ['ready','unavailable','unpublished'].includes(document.documentElement.dataset.dataState));
        const fact = await page.evaluate(({ owner }) => {
          const list = document.getElementById(owner);
          const paging = Object.entries(window.OnePageConfig.bindings).find(([,binding]) => binding.pagination?.list === owner);
          const empty = [...document.querySelectorAll('[data-empty-for]')].filter((node) => [owner,paging?.[0]].includes(node.dataset.emptyFor));
          return { dataState:document.documentElement.dataset.dataState,
            items:list?.querySelectorAll(':scope > [data-carousel-item]').length,
            empty:empty.length > 0 && empty.every((node) => !node.hidden) };
        }, { owner:sample.owner });
        need(fact.dataState === 'ready' && fact.items === 0 && fact.empty, 'H31 语言过滤归零失败：' + sample.end + ' / '
          + sample.owner + ' / ' + sample.target + ' / ' + JSON.stringify(fact));
        results.push({ end:sample.end,width,height,state:'H31:' + sample.owner, rows:[], ...fact });
      } finally { await context.close(); }
    }
    need(!problems.length && !server.requestedPaths().some(({ status }) => status >= 400), '外语页有运行时错误或本地资源缺失：' + problems.join('；'));
    return results;
  } finally { await server.close(); }
}
