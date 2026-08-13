#!/usr/bin/env node
/**
 * figma-inline.mjs — 把 Skill 层的通用件机械内联进 demo 的 index.html。【本 Skill 新增】
 *
 * 内联两段：
 *   templates/figma-render.js  → FIGMA_RENDER_BEGIN / FIGMA_RENDER_END   通用渲染器
 *   templates/figma-chrome.js  → FIGMA_CHROME_BEGIN / FIGMA_CHROME_END   验收壳
 *
 * ═══ 为什么要有这个脚本 ═══
 *
 * demo 必须是单个可双击打开的 index.html（老师的硬门：不许依赖本地服务器），
 * 所以通用件得内联进去。而在这之前，内联是**手抄**的，于是出过两次真问题：
 *
 *  1) 壳：模板改了、产物没跟上，两份代码悄悄分叉，任何测试都不报错
 *     （冒烟测的是产物，模板改了它不知道）。
 *  2) 渲染器：更严重 —— 它一度**只存在于某个 demo 的 index.html 里**。
 *     结果嵌套还原、裁剪生效、渐变字、文字投影、图层模糊、排版模式这六项修复
 *     全都只落在那一个页面上，下一个页面一样都拿不到。
 *     那不叫做了一套可复用的 Skill，叫改了一个页面的效果。
 *
 * 所以：通用件一律住在 templates/，由本脚本写入产物；
 * `--check` 让"忘了同步"变成可断言的（非零退出），而不是靠记性。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-inline.mjs --demo <dir>            # 两段都内联
 *   node scripts/figma-inline.mjs --demo <dir> --check    # 只检查是否一致
 *   node scripts/figma-inline.mjs --demo <dir> --only render|chrome
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { INLINE_MARKERS, locateInlineBlock, buildInlineBlock } from './lib/inline-markers.mjs';
import { join, resolve } from 'node:path';

/** 每段：模板文件、区间标记、模板首行注释头的替换目标 */
const PARTS = { render: INLINE_MARKERS.render, chrome: INLINE_MARKERS.chrome };

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--check') args.check = true;
  else if (k === '--only') args.only = process.argv[++i];
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');
if (args.only && !PARTS[args.only]) fail(`--only 只能是 ${Object.keys(PARTS).join(' / ')}`);

const skillDir = resolve(import.meta.dirname, '..');
const idxPath = join(resolve(args.demo), 'index.html');
if (!existsSync(idxPath)) fail(`缺 ${idxPath}`);

// 统一 LF。踩过一次：文本模式写入把 LF 变成 CRLF（622 处），
// 靠 indexOf('\n};\n</script>') 定位的冒烟测试全部失灵。
let html = readFileSync(idxPath, 'utf8').replace(/\r\n/g, '\n');

const names = args.only ? [args.only] : Object.keys(PARTS);
const results = [];
let changed = false;

for (const name of names) {
  const P = PARTS[name];
  const tplPath = join(skillDir, 'templates', P.template);
  if (!existsSync(tplPath)) fail(`缺模板 ${tplPath}`);
  const tpl = readFileSync(tplPath, 'utf8').replace(/\r\n/g, '\n');

  const loc = locateInlineBlock(html, name);
  if (!loc) fail(`index.html 里找不到 ${P.begin} / ${P.end} 标记（${name} 段）`);
  const { b, replaceEnd } = loc;
  const inlined = buildInlineBlock(name, tpl);
  const current = html.slice(b, replaceEnd);
  const same = current.trim() === inlined.trim();

  results.push({ part: name, template: `templates/${P.template}`, same, bytes: Buffer.byteLength(inlined) });
  if (!args.check && !same) {
    html = html.slice(0, b) + inlined + html.slice(replaceEnd);
    changed = true;
  }
}

/* Motion remains demo opt-in. Its source is a small checked-in JSON file, then
   this same mechanical inliner embeds it for the offline HTML artifact. */
const motionPath = join(resolve(args.demo), 'motion.config.json');
if (existsSync(motionPath)) {
  let motion;
  try { motion = JSON.parse(readFileSync(motionPath, 'utf8')); }
  catch (err) { fail(`motion.config.json 不是合法 JSON：${err.message}`); }
  if (motion?.schema !== 'figma-motion-opt-in/v1' || !motion?.adapter?.template?.roles) {
    fail('motion.config.json 缺 figma-motion-opt-in/v1 adapter.template.roles');
  }
  const motionTag = `<script id="qa-motion" type="application/json">${JSON.stringify(motion)}</script>`;
  const motionRe = /<script\s+id="qa-motion"[^>]*>[\s\S]*?<\/script>/;
  const existing = motionRe.exec(html);
  const same = !!existing && existing[0] === motionTag;
  results.push({ part: 'motion', template: 'motion.config.json', same, bytes: Buffer.byteLength(motionTag) });
  if (!args.check && !same) {
    if (existing) html = html.slice(0, existing.index) + motionTag + html.slice(existing.index + existing[0].length);
    else {
      const anchor = html.indexOf('<script id="qa-truth"');
      if (anchor < 0) fail('index.html 里找不到 qa-truth，无法内联 motion.config.json');
      html = html.slice(0, anchor) + motionTag + '\n' + html.slice(anchor);
    }
    changed = true;
  }
}

if (args.check) {
  const allSame = results.every((r) => r.same);
  console.log(JSON.stringify({
    ok: allSame,
    parts: results,
    hint: allSame ? '产物里的通用件与 templates/ 一致'
      : '产物与模板不一致 —— 跑一次不带 --check 的本脚本：' +
        results.filter((r) => !r.same).map((r) => r.part).join(', '),
  }, null, 2));
  process.exit(allSame ? 0 : 1);
}

if (changed) writeFileSync(idxPath, html, 'utf8');
console.log(JSON.stringify({ ok: true, wroteInto: changed ? 'index.html' : '（本来就一致，没改动）', parts: results }, null, 2));
