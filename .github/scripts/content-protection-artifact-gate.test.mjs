import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkArtifacts, inspectArtifact } from './content-protection-artifact-gate.mjs';

const script = fileURLToPath(new URL('./content-protection-artifact-gate.mjs', import.meta.url));
const renderer = readFileSync(new URL('../../skills/torchlight-web/templates/figma-render.js', import.meta.url), 'utf8');
const htmlWithRenderer = renderer => '<html><script>/* FIGMA_RENDER_BEGIN */\n' + renderer.replaceAll('</script', '<\\/script') + '\n/* FIGMA_RENDER_END */</script></html>';
const validHtml = htmlWithRenderer(renderer);
const yiseHtml = htmlWithRenderer(readFileSync(new URL('../../skills/yise-web-ui/templates/figma-render.js', import.meta.url), 'utf8'));

function fixture(files = { 'index.html': validHtml }) {
  const dir = mkdtempSync(join(process.cwd(), '.tmp-content-protection-artifact-'));
  for (const [name, html] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  return dir;
}
function run(dir, extra = ['--skill', 'torchlight-web']) {
  return spawnSync(process.execPath, [script, dir, ...extra], { encoding: 'utf8',
    env: { ...process.env, CONTENT_PROTECTION_ARTIFACT_SKILL: '' } });
}
function clean(dir) { rmSync(dir, { recursive: true, force: true }); }

test('产物闸门接受所有 HTML 页面并输出 sha256', () => {
  const dir = fixture({ 'index.html': validHtml, 'qa/review.HTML': validHtml });
  const result = run(dir);
  clean(dir);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /index\.html: 内容保护产物检查通过 sha256=[0-9a-f]{64}/);
  assert.match(result.stdout, /qa\/review\.HTML: 内容保护产物检查通过 sha256=[0-9a-f]{64}/);
  assert.match(result.stdout, /2 个 HTML/);
});

test('产物闸门拒绝关闭开关、重复保护段和不完整策略', () => {
  const dir = fixture({
    'index.html': validHtml + ' CONTENT_PROTECTION_BEGIN',
    'qa.html': '<html><script>__contentProtectionCleanup()</script></html>',
  });
  const result = run(dir);
  clean(dir);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /代码段|关闭开关|策略标记/);
});

test('未提供产物目录时必须失败，不能静默扫描当前工作树', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: process.cwd(), env: { ...process.env, CONTENT_PROTECTION_ARTIFACT_DIR: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须显式提供/);
});

test('检查器识别缺失事件和测试关闭钩子', () => {
  assert.match(inspectArtifact(validHtml.replace("addEventListener('contextmenu', stop, true);", ''), 'torchlight-web').join(';'), /contextmenu/);
  assert.match(inspectArtifact(validHtml + '__CONTENT_PROTECTION_TEST_CLEANUP__', 'torchlight-web').join(';'), /测试或关闭/);
  const dir = fixture({ 'index.html': validHtml, 'archive/old.html': '<html></html>' });
  const result = checkArtifacts(dir, 'torchlight-web');
  clean(dir);
  assert.equal(result.ok, false, '交付目录中的 archive 页面也必须检查，不能靠改目录名绕过');
});

test('空目录、文件路径、内部符号链接和伪造标记不能通过', () => {
  const dir = fixture({});
  try {
    assert.equal(checkArtifacts(dir).ok, false);
    writeFileSync(join(dir, 'index.html'), validHtml);
    assert.equal(checkArtifacts(join(dir, 'index.html')).ok, false);
    symlinkSync(join(dir, 'index.html'), join(dir, 'alias.html'));
    assert.equal(checkArtifacts(dir).ok, false);
    assert.ok(inspectArtifact('CONTENT_PROTECTION_BEGIN CONTENT_PROTECTION_END').length);
  } finally { clean(dir); }
});

test('component shell and stale renderer cannot masquerade as a protected product', () => {
  const shell = readFileSync(new URL('../../skills/torchlight-web/templates/component-shell.html', import.meta.url), 'utf8');
  assert.ok(inspectArtifact(shell, 'torchlight-web').length > 0);
  assert.ok(inspectArtifact(validHtml.replace("event.preventDefault();", "void 0;"), 'torchlight-web').some(p => p.includes('不同步')));
  assert.ok(inspectArtifact(validHtml + validHtml, 'torchlight-web').some(p => p.includes('唯一')));
});

test('generated component artifacts use the matching QA chrome and adapter', () => {
  for (const skill of ['torchlight-web', 'yise-web-ui']) {
    const dir = mkdtempSync(join(process.cwd(), '.tmp-content-protection-component-'));
    try {
      const result = spawnSync(process.execPath, [
        join(process.cwd(), 'skills', skill, 'scripts/init.mjs'),
        '--dir', join(dir, 'component'), '--name', 'artifact-component', '--mode', 'component',
        '--entry', 'src/Fixture.tsx',
      ], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const html = readFileSync(join(dir, 'component/index.html'), 'utf8');
      assert.deepEqual(inspectArtifact(html, skill), [], skill + ' generated component must pass');
      assert.equal(checkArtifacts(join(dir, 'component'), skill).ok, true);
    } finally { clean(dir); }
  }
});

test('两项目产物只能匹配各自 renderer，互换必须失败', () => {
  for (const [skill, ownHtml, otherHtml] of [
    ['torchlight-web', validHtml, yiseHtml], ['yise-web-ui', yiseHtml, validHtml],
  ]) {
    const dir = fixture({ [skill + '/index.html']: ownHtml });
    try {
      assert.equal(checkArtifacts(dir).ok, true, skill + ' correct renderer');
      assert.equal(checkArtifacts(join(dir, skill)).ok, true, 'named root is also supported');
      assert.deepEqual(inspectArtifact(ownHtml, skill), []);
      writeFileSync(join(dir, skill, 'index.html'), otherHtml);
      const result = checkArtifacts(dir);
      assert.equal(result.ok, false, skill + ' must reject foreign renderer');
      assert.match(result.errors.join(';'), new RegExp(skill + ' 当前模板不同步'));
      assert.equal(run(dir, []).status, 1, 'CLI must also reject swapped renderer');
      assert.equal(checkArtifacts(join(dir, skill)).ok, false);
    } finally { clean(dir); }
  }
});

test('一个扫描目录包含两项目时逐文件绑定项目，不能整体任选一个模板', () => {
  const dir = fixture({ 'torchlight-web/index.html': validHtml, 'yise-web-ui/qa/review.html': yiseHtml });
  try {
    const result = checkArtifacts(dir);
    assert.equal(result.ok, true);
    assert.deepEqual(result.passed.map(p => p.skill), ['torchlight-web', 'yise-web-ui']);
    assert.equal(run(dir, []).status, 0);
    writeFileSync(join(dir, 'yise-web-ui/qa/review.html'), validHtml);
    assert.equal(checkArtifacts(dir).ok, false);
  } finally { clean(dir); }
});

test('未命名产物目录必须显式指定有效项目，独立检查器同样拒绝猜测', () => {
  const dir = fixture();
  try {
    assert.equal(checkArtifacts(dir).ok, false);
    assert.equal(run(dir, []).status, 1);
    assert.equal(checkArtifacts(dir, 'torchlight-web').ok, true);
    assert.equal(run(dir).status, 0);
    assert.equal(checkArtifacts(dir, 'yise-web-ui').ok, false);
    for (const skill of [undefined, null, '', 'unknown', 'constructor']) assert.ok(inspectArtifact(validHtml, skill).length > 0);
    for (const args of [['--skill'], ['--skill', 'unknown'], ['--skill', 'torchlight-web', '--skill', 'yise-web-ui'], ['--unknown']]) {
      assert.equal(run(dir, args).status, 1, JSON.stringify(args));
    }
  } finally { clean(dir); }
});

test('显式项目不能覆盖冲突目录；嵌套冲突也不能静默放行', () => {
  const dir = fixture({ 'yise-web-ui/index.html': validHtml });
  try {
    assert.equal(checkArtifacts(dir, 'torchlight-web').ok, false);
    assert.equal(checkArtifacts(join(dir, 'yise-web-ui'), 'torchlight-web').ok, false);
    assert.equal(run(dir).status, 1);
    mkdirSync(join(dir, 'yise-web-ui/torchlight-web'));
    writeFileSync(join(dir, 'yise-web-ui/torchlight-web/index.html'), validHtml);
    assert.equal(checkArtifacts(dir).ok, false);
  } finally { clean(dir); }
});
