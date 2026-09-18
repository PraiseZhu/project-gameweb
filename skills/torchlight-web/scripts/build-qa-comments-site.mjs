import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DESIGN_POLICY } from './lib/design-policy.generated.mjs';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] || join(root, '../../_tmp/qa-comments-realtime-site'));
const chrome = await readFile(join(root, 'templates/figma-chrome.js'), 'utf8');
const devices = await readFile(join(root, 'templates/figma-harness-kit-device-presets.json'), 'utf8');
const truth = { design: { fileVersion: 'qa-comments-realtime-v1' }, platforms: { pc: true, mobile: true } };
const config = [
  'window.__qaDemo = {',
  "name: 'qa-comments-realtime', title: 'QA 页面实时评论验收',",
  "summary: { what: '跨同事实时评论', how: 'XD Sites 托管 KV + 每秒同步 + IndexedDB 缓存', accept: '两个浏览器上下文可见同一条评论' },",
  "commentPageId: 'qa-comments-realtime', commentApi: '/api/qa-comments',",
  "matrix: { plat: { label: '端', options: [{ v: 'desktop', label: '桌面' }, { v: 'mobile', label: '移动' }] }, region: { label: '区域', options: [{ v: 'global', label: 'Global' }, { v: 'cn', label: '中国大陆' }] }, os: { label: '系统', options: [{ v: 'mac', label: 'macOS' }] }, mode: { label: '主题', options: [{ v: 'light', label: '浅色' }] }, lang: { label: '语言', options: [{ v: 'zh-CN', label: '简体中文' }, { v: 'en', label: 'English' }] } },",
  "defaultPrefs: { plat: 'desktop', region: 'global', os: 'mac', mode: 'light', lang: 'zh-CN' }, initialState: 'home', states: { home: { label: '首页' }, detail: { label: '详情' } }, tabStates: [],",
  'renderApp: function (ctx) {',
  "var mobile = ctx.prefs.plat === 'mobile'; var root = document.createElement('main'); root.className = 'qa-demo-content ' + (mobile ? 'qa-demo-mobile' : 'qa-demo-desktop');",
  "var title = ctx.prefs.lang === 'en' ? 'Realtime QA comments' : '实时评论验收页'; var copy = ctx.prefs.lang === 'en' ? 'Click the comment icon, select this content, and publish a note. Open this URL in another browser to verify the shared update.' : '点击评论图标，点选这块内容并发布评论；再用另一个浏览器打开此地址，验证同事可以实时看到。';",
  "root.innerHTML = '<section data-node=\"qa-shell\" data-node-name=\"QA 页面\"><article data-node=\"qa-card\" data-node-name=\"内容卡片\"><h1 data-node=\"qa-title\" data-node-name=\"标题\">' + title + '</h1><p data-node=\"qa-copy\" data-node-name=\"说明文字\">' + copy + '</p><button data-node=\"qa-action\" data-node-name=\"操作按钮\" type=\"button\">' + (ctx.prefs.lang === 'en' ? 'Action' : '操作按钮') + '</button></article></section>'; ctx.frame.replaceChildren(root);",
  '},',
  '};',
].join('\n');
let sdkModuleNumber = 0;
async function bundleSdk(entry, seen = new Set()) {
  const dist = resolve(root, 'node_modules/@xd-cell/worker-sdk/dist');
  const file = resolve(dist, entry);
  if (seen.has(file)) return '';
  seen.add(file);
  let source = await readFile(file, 'utf8');
  const exported = [];
  source.replace(/^export\s+(?:(?:async)\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm, (_, name) => {
    exported.push(name);
    return _;
  });
  const imports = [];
  source = source.replace(/^import\s+\{[^}]+\}\s+from\s+[\'"](.+?)[\'"];?\s*$/gm, (_, specifier) => {
    imports.push(specifier);
    return '';
  });
  source = source.replace(/^export\s+default\s+/gm, '');
  source = source.replace(/^export\s+\{[^}]+\};?\s*$/gm, '');
  source = source.replace(/^export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/gm, '');
  const prefix = [];
  for (const specifier of imports) {
    const child = new URL(specifier, 'file://' + file).pathname;
    prefix.push(await bundleSdk(child.slice(dist.length + 1), seen));
  }
  const body = source.trim();
  const moduleName = '__xdSdkModule' + (++sdkModuleNumber);
  const exports = exported.length ? '\nreturn { ' + exported.join(', ') + ' };' : '';
  const bindings = exported.length ? '\nconst { ' + exported.join(', ') + ' } = ' + moduleName + ';' : '';
  return prefix.join('\n') + '\nconst ' + moduleName + ' = (() => {\n' + body + exports + '\n})();' + bindings + '\n';
}
const css = '<style>html,body{margin:0;min-height:100%;background:#0f172a;color:#e5e7eb;font:16px/1.5 system-ui,sans-serif}.qa-demo-content{min-height:1250px;padding:80px 6vw;background:linear-gradient(145deg,#172554,#0f172a)}.qa-demo-content section{max-width:980px;padding:54px;background:#1e3a5f;border:2px solid #60a5fa;border-radius:18px;min-height:520px}.qa-demo-content article{max-width:720px;padding:42px;background:#264b73;border-radius:14px;min-height:330px}.qa-demo-content h1{font-size:42px;margin:0 0 28px}.qa-demo-content p{font-size:24px;max-width:620px;line-height:1.55}.qa-demo-content button{margin-top:26px;width:180px;height:48px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:inherit}.qa-demo-mobile{padding:36px 22px}.qa-demo-mobile section{padding:24px;min-height:700px}.qa-demo-mobile article{padding:24px;min-height:430px}.qa-demo-mobile h1{font-size:30px}.qa-demo-mobile p{font-size:20px}</style>';
const html = ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">', '<title>QA 页面实时评论验收</title>', css, '<script id="qa-truth" type="application/json">' + JSON.stringify(truth) + '</script>', '<script id="qa-devices" type="application/json">' + devices + '</script>', '<script id="qa-design-policy" type="application/json">' + JSON.stringify(DESIGN_POLICY) + '</script>', '<script>window.__designPolicy=' + JSON.stringify(DESIGN_POLICY) + ';</script>', '<script>' + config + '</script>', '</head><body></body><script>' + chrome + '</script></html>'].join('');
await rm(join(out, 'sdk'), { recursive: true, force: true });
await mkdir(join(out, 'assets'), { recursive: true });
const worker = await readFile(join(root, 'deploy/qa-comments-realtime/worker.js'), 'utf8');
const seenSdkModules = new Set();
const sdk = (await bundleSdk('worker/runtime.js', seenSdkModules)) + '\n' +
  (await bundleSdk('worker/platform-context.js', seenSdkModules));
await writeFile(join(out, 'worker.js'), worker.replace("import { createRuntime, getCurrentUser } from '@xd-cell/worker-sdk';", sdk));
await writeFile(join(out, 'assets/index.html'), html);
console.log(JSON.stringify({ out, workerEntry: 'worker.js', assets: 'assets', bytes: Buffer.byteLength(html) }));
