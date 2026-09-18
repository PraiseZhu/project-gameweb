#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRS = new Set(['.git', 'node_modules']);
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const supportedSkills = new Set(['torchlight-web', 'yise-web-ui']);

function loadCanonicalTemplates(filename) {
  return new Map([...supportedSkills].map(skill => [skill,
    readFileSync(resolve(repoRoot, 'skills', skill, 'templates', filename), 'utf8')
      .replace(/\r\n/g, '\n').replaceAll('</script', '<\\/script').trim(),
  ]));
}

const canonicalRenderers = loadCanonicalTemplates('figma-render.js');
const canonicalChrome = loadCanonicalTemplates('qa-chrome.js');
const canonicalAdapters = loadCanonicalTemplates('qa-component-adapter.js');

export function collectHtmlFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('不允许符号链接：' + entry.name);
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) walk(file);
      } else if (entry.isFile() && /\.html?$/i.test(entry.name)) {
        files.push(file);
      }
    }
  };
  walk(root);
  return files.sort();
}

export function inspectArtifact(html, expectedSkill = null) {
  const problems = [];
  if (!supportedSkills.has(expectedSkill)) problems.push('缺少有效的 expected skill，拒绝猜测所属项目');
  const count = (needle) => html.split(needle).length - 1;
  if (count('CONTENT_PROTECTION_BEGIN') !== 1 || count('CONTENT_PROTECTION_END') !== 1) {
    problems.push('内容保护代码段必须各出现一次且成对存在');
  }
  const isComponent = count('QA_COMPONENT_ADAPTER_BEGIN') > 0 || count('QA_CHROME_BEGIN') > 0;
  if (isComponent) {
    if (count('FIGMA_RENDER_BEGIN') || count('FIGMA_RENDER_END')) problems.push('拒绝混合经典与组件两种壳');
    if (count('QA_COMPONENT_ADAPTER_BEGIN') !== 1 || count('QA_COMPONENT_ADAPTER_END') !== 1) problems.push('组件适配器代码段必须各出现一次且成对存在');
    if (count('QA_CHROME_BEGIN') !== 1 || count('QA_CHROME_END') !== 1) problems.push('组件 QA chrome 代码段必须各出现一次且成对存在');
    const chromeMatch = html.match(/\/\* QA_CHROME_BEGIN[^]*?\*\/([\s\S]*?)\/\* QA_CHROME_END \*\//);
    const chrome = chromeMatch?.[1].replace(/\r\n/g, '\n').trim();
    if (!chromeMatch || chrome !== canonicalChrome.get(expectedSkill)) problems.push('组件 QA chrome 与 ' + (expectedSkill || '未指定项目') + ' 当前模板不同步');
    const adapterMatch = html.match(/\/\* QA_COMPONENT_ADAPTER_BEGIN[\s\S]*?\*\/([\s\S]*?)\/\* QA_COMPONENT_ADAPTER_END \*\//);
    if (!adapterMatch || adapterMatch[1].replace(/\r\n/g, '\n').trim() !== canonicalAdapters.get(expectedSkill)) problems.push('组件 adapter 与当前模板不同步');
  } else {
    if (count('FIGMA_RENDER_BEGIN') !== 1 || count('FIGMA_RENDER_END') !== 1) problems.push('渲染器必须唯一，拒绝重复内联');
    const match = html.match(/\/\* FIGMA_RENDER_BEGIN \*\/([\s\S]*?)\/\* FIGMA_RENDER_END \*\//);
    const renderer = match?.[1].replace(/\r\n/g, '\n').trim();
    if (!match || renderer !== canonicalRenderers.get(expectedSkill)) problems.push('内联渲染器与 ' + (expectedSkill || '未指定项目') + ' 当前模板不同步；需重新生成或 figma-inline');
  }
  for (const needle of [
    'data-content-protection-style',
    'user-select:none!important',
    '-webkit-user-drag:none!important',
    "addEventListener('selectstart'",
    "addEventListener('copy'",
    "addEventListener('cut'",
    "addEventListener('dragstart'",
    "addEventListener('contextmenu'",
  ]) {
    if (!html.includes(needle)) problems.push('缺保护契约：' + needle);
  }
  if (/__CONTENT_PROTECTION_TEST__|__CONTENT_PROTECTION_TEST_CLEANUP__|__contentProtectionCleanup/.test(html)) {
    problems.push('产物暴露测试或关闭保护开关');
  }
  return problems;
}

function inferSkill(root, file, explicitSkill) {
  const candidates = new Set([basename(resolve(root)), ...relative(root, file).split(sep).slice(0, -1)]
    .filter(part => supportedSkills.has(part)));
  if (explicitSkill !== null) {
    if (!supportedSkills.has(explicitSkill)) return null;
    candidates.add(explicitSkill);
  }
  // Conflicting path/argument identities must fail, not let --skill override
  // a yise artifact directory to accept a torchlight renderer (or vice versa).
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function checkArtifacts(root, explicitSkill = null) {
  if (!root || !existsSync(root)) return { ok: false, errors: ['未提供存在的真实产物目录'] };
  let stat;
  try { stat = lstatSync(root); } catch (error) { return { ok: false, errors: ['无法读取产物目录：' + error.message] }; }
  if (!stat.isDirectory() || stat.isSymbolicLink()) return { ok: false, errors: ['产物路径必须是本地目录，不能是符号链接'] };
  let files;
  try { files = collectHtmlFiles(root); } catch (error) { return { ok: false, errors: ['遍历产物目录失败：' + error.message] }; }
  if (!files.length) return { ok: false, errors: ['产物目录没有 HTML 文件'] };
  const errors = [];
  const passed = [];
  for (const file of files) {
    let html;
    try { html = readFileSync(file, 'utf8'); } catch (error) {
      errors.push(relative(root, file) + ': 无法读取：' + error.message);
      continue;
    }
    const rel = relative(root, file);
    const skill = inferSkill(root, file, explicitSkill);
    const problems = skill ? inspectArtifact(html, skill) : ['无法确定产物所属 skill；请使用按项目目录或 --skill 显式指定'];
    const hash = createHash('sha256').update(html).digest('hex');
    if (problems.length) errors.push(rel + ': ' + problems.join('；'));
    else passed.push({ file: rel, skill, sha256: hash });
  }
  return { ok: errors.length === 0, files, passed, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const skillIndex = args.indexOf('--skill');
  const explicitSkill = skillIndex >= 0 ? args.splice(skillIndex, 2)[1] : process.env.CONTENT_PROTECTION_ARTIFACT_SKILL || null;
  const input = args[0] || process.env.CONTENT_PROTECTION_ARTIFACT_DIR;
  const invalidArgs = args.length > 1 || args.some(arg => arg.startsWith('--'))
    || (skillIndex >= 0 && !supportedSkills.has(explicitSkill));
  if (invalidArgs) {
    console.error('参数无效：<产物目录> [--skill torchlight-web|yise-web-ui]');
    process.exitCode = 1;
  } else if (!input) {
    console.error('内容保护产物闸门失败：必须显式提供真实产物目录参数或 CONTENT_PROTECTION_ARTIFACT_DIR。');
    process.exitCode = 1;
  } else {
    const result = checkArtifacts(resolve(input), explicitSkill);
    for (const error of result.errors || []) console.error(error);
    for (const item of result.passed || []) console.log(item.file + ': 内容保护产物检查通过 sha256=' + item.sha256);
    if (!result.ok) process.exitCode = 1;
    else console.log('内容保护产物闸门通过：' + result.passed.length + ' 个 HTML');
  }
}
