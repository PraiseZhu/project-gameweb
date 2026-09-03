import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packageManagerCommand, normalizePathForComparison } from './nightly-health.mjs';

const SCRIPT = fileURLToPath(new URL('./nightly-health.mjs', import.meta.url));
const WORKFLOW = fileURLToPath(new URL('../workflows/nightly-health.yml', import.meta.url));

test('跨平台路径比较统一分隔符且 Windows 不区分盘符大小写', () => {
  assert.equal(normalizePathForComparison('C:\\Repo\\Package\\', 'win32'), 'c:/repo/package');
  assert.equal(normalizePathForComparison('c:/repo/package/test', 'win32'), 'c:/repo/package/test');
});

test('npm 命令在 Windows 通过 cmd shell 启动，在 POSIX 直接启动', () => {
  assert.equal(packageManagerCommand('win32'), 'npm.cmd');
  assert.equal(packageManagerCommand('linux'), 'npm');
});

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'nightly-health-'));
  mkdirSync(join(root, 'skills'));
  mkdirSync(join(root, 'standards'));
  mkdirSync(join(root, '.github'));
  return root;
}

function runList(root) {
  return spawnSync(process.execPath, [SCRIPT, '--list'], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
}

function writePkg(dir, scripts) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'tmp', scripts }, null, 2));
}

function writePublicTest(dir) {
  mkdirSync(join(dir, 'test'), { recursive: true });
  writeFileSync(join(dir, 'test', 'ok.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
}

test('发现逻辑不依赖当前包名或可选附加脚本', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'renamable-skill'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'skills', 'renamable-skill'));
  writePkg(join(root, 'standards', 'renamable-standard', 'tool'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'standards', 'renamable-standard', 'tool'));
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /skills\/renamable-skill/);
  assert.match(res.stdout, /standards\/renamable-standard\/tool/);
  assert.equal((res.stdout.match(/npm test \+ file proof/g) ?? []).length, 2);
  assert.doesNotMatch(res.stdout, /release:audit|fonts:check/);
});

test('守卫或列包失败后工作流仍会尝试真实夜间检查', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /if:\s*\$\{\{\s*always\(\)\s*\}\}[\s\S]*continue-on-error:\s*true[\s\S]*run:\s*node \.github\/scripts\/nightly-health\.mjs --list/);
  assert.match(workflow, /if:\s*\$\{\{\s*always\(\)\s*\}\}[\s\S]*run:\s*node \.github\/scripts\/nightly-health\.mjs\s*(?:\n|$)/);
});

test('仓库根 package.json 必须红', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /仓库根有 package.json/);
});

test('零包完整夜间仍写今晚红报告再失败', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const { res, json, md } = runPatrol(root);
  const doc = JSON.parse(readFileSync(json, 'utf8'));
  const text = readFileSync(md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.equal(doc.targets, 0);
  assert.equal(doc.items.some((item) => item.grade === 'tonight' && /没有可检查的包/.test(item.summary)), true);
  assert.match(text, /## 今晚红/);
  assert.match(text, /没有可检查的包/);
  assertNoNewLabel(text);
});

test('skills 根上直接放 SKILL.md 必须红', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'skills', 'SKILL.md'), '# stray');
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /skills\/SKILL.md/);
});

test('skill 用 tool\/package.json 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'ghost', 'tool'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /只允许规范工具使用/);
});

test('规范工具可以用 tool\/package.json', () => {
  const root = makeRoot();
  writePkg(join(root, 'standards', 'naming', 'tool'), { test: 'node --test' });
  writePublicTest(join(root, 'standards', 'naming', 'tool'));
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /standards\/naming/);
});

test('没有 test 脚本必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'empty'), { lint: 'echo x' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /可核验的 npm test/);
});

test('echo ok 不算自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'fake'), { test: 'echo ok' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /echo\/true\/exit 0/);
});

test('嵌套包必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'outer'), { test: 'node --test' });
  writePkg(join(root, 'skills', 'outer', 'nested'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /嵌套包/);
});

test('skill 同时有根 package 和 tool/package 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'dual'), { test: 'node --test' });
  writePkg(join(root, 'skills', 'dual', 'tool'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /只允许规范工具使用/);
});

test('skill 多出非法 tool/package 时根包自测仍要跑', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'dual'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'skills', 'dual'));
  writePkg(join(root, 'skills', 'dual', 'tool'), { test: 'node --test' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /只允许规范工具使用/);
  assert.match(res.stdout, /skills\/dual npm test/);
  assert.match(res.stdout, /skills\/dual trusted tap/);
});

test('规范工具根 package 与 tool/package 都要列出来', () => {
  const root = makeRoot();
  writePkg(join(root, 'standards', 'naming'), { test: 'node --test' });
  writePublicTest(join(root, 'standards', 'naming'));
  writePkg(join(root, 'standards', 'naming', 'tool'), { test: 'node --test' });
  writePublicTest(join(root, 'standards', 'naming', 'tool'));
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /standards\/naming/);
  assert.match(res.stdout, /standards\/naming\/tool/);
});

test('echo pass 和 echo ok && true 都不算自测', () => {
  for (const script of ['echo pass', 'echo ok && true']) {
    const root = makeRoot();
    writePkg(join(root, 'skills', 'fake'), { test: script });
    const res = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
    });
    rmSync(root, { recursive: true, force: true });
    assert.notEqual(res.status, 0, script);
    assert.match(res.stderr, /可核验的 npm test|echo\/true\/exit 0/);
  }
});

test('仓库根隐藏目录里的 package.json 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, '.ghost'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /\.ghost/);
});

test('.github 里的 package.json 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, '.github', 'deep'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /\.github/);
});

test('docs 下深层 package.json 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'docs', 'foo'), { test: 'node --test' });
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /docs/);
});

test('错位内容必须红，但不能阻断已发现包的真实自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'docs', 'misplaced'), { test: 'node --test' });
  writePkg(join(root, 'skills', 'still-runs'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'skills', 'still-runs'));
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /docs.*夜间扫不到/);
  assert.match(res.stdout, /skills\/still-runs npm test/);
  assert.match(res.stdout, /skills\/still-runs trusted tap/);
});

test('坏 package.json 必须红，但不能阻断其他包的真实自测', () => {
  const root = makeRoot();
  mkdirSync(join(root, 'skills', 'broken-json'), { recursive: true });
  writeFileSync(join(root, 'skills', 'broken-json', 'package.json'), '{');
  writePkg(join(root, 'standards', 'still-runs', 'tool'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'standards', 'still-runs', 'tool'));
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /读不了 skills\/broken-json\/package\.json/);
  assert.match(res.stdout, /standards\/still-runs\/tool npm test/);
  assert.match(res.stdout, /standards\/still-runs\/tool trusted tap/);
});

test('exit 0 && node --test 和 node --test || true 都不算自测', () => {
  for (const script of ['exit 0 && node --test', 'node --test || true', 'node --test ; true']) {
    const root = makeRoot();
    writePkg(join(root, 'skills', 'fake'), { test: script });
    const res = spawnSync(process.execPath, [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
    });
    rmSync(root, { recursive: true, force: true });
    assert.notEqual(res.status, 0, script);
    assert.match(res.stderr, /可核验的 npm test|echo\/true\/exit 0/);
  }
});

test('管道型真实命令不算 no-op', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'pipe'), { test: 'echo data | node --test' });
  writePublicTest(join(root, 'skills', 'pipe'));
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /npm test \+ file proof/);
  assert.doesNotMatch(res.stdout, /缺可核验的 npm test/);
});

test('纯冒号不算自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'colon'), { test: ':' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /可核验的 npm test/);
});

test('node --test || echo ignored 不算自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'mask'), { test: 'node --test || echo ignored' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /可核验的 npm test/);
});

test('零测试文件的 npm test 全流程必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'emptytest'), { test: 'node --test' });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有可核验|0 个测试|看不到测试计数/);
});

test('一个包的文件证明失败不能阻断其他包的真实自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'bad-proof'), { test: 'node --test' });
  writePkg(join(root, 'skills', 'still-runs'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'skills', 'still-runs'));
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /bad-proof: 包内没有可核验/);
  assert.match(res.stdout, /skills\/still-runs npm test/);
  assert.match(res.stdout, /skills\/still-runs trusted tap/);
});

test('docs 下深层 SKILL.md 必须红', () => {
  const root = makeRoot();
  mkdirSync(join(root, 'docs', 'deep'), { recursive: true });
  writeFileSync(join(root, 'docs', 'deep', 'SKILL.md'), '# stray skill');
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /SKILL\.md/);
});

test('skill 包内深层 SKILL.md 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'outer'), { test: 'node --test' });
  mkdirSync(join(root, 'skills', 'outer', 'deep'), { recursive: true });
  writeFileSync(join(root, 'skills', 'outer', 'SKILL.md'), '# root skill');
  writeFileSync(join(root, 'skills', 'outer', 'deep', 'SKILL.md'), '# nested skill');
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /深层 SKILL\.md/);
});

test('伪造 reporter 摘要不算自测', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'fake'), {
    test: 'printf "ℹ tests 1\\nℹ pass 1\\nℹ fail 0\\n"',
  });
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /伪造摘要|可核验的 npm test|没有可核验/);
});

test('间接 runner 伪造 TAP 摘要仍红，因为夜间自己收测试文件', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'indirect'), { test: 'node fake-runner.mjs' });
  writeFileSync(join(root, 'skills', 'indirect', 'fake-runner.mjs'), 'console.log("# tests 1\\n# pass 1\\n# fail 0");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有可核验|0 个测试|看不到/);
});

test('lister 漏掉包内失败测试必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'omit'), { test: 'node --test' });
  mkdirSync(join(root, 'skills', 'omit', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'skills', 'omit', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'omit', 'test', 'ok.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
  writeFileSync(join(root, 'skills', 'omit', 'test', 'bad.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; test("bad", () => { assert.equal(1, 2); });');
  writeFileSync(join(root, 'skills', 'omit', 'scripts', 'test-public.mjs'), 'console.log("test/ok.test.mjs");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /漏了包内公开测试|bad\.test\.mjs/);
});

test('任意 exclude 失败公开测试必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'hide'), { test: 'node --test' });
  mkdirSync(join(root, 'skills', 'hide', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'skills', 'hide', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'hide', 'test', 'ok.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
  writeFileSync(join(root, 'skills', 'hide', 'test', 'bad.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; test("bad", () => { assert.equal(1, 2); });');
  writeFileSync(join(root, 'skills', 'hide', 'scripts', 'test-public.mjs'), 'console.log("test/ok.test.mjs");\nconsole.log("# exclude test/bad.test.mjs");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /排除项缺原因|排除项类别不受控|bad\.test\.mjs/);
});

test('存在失败测试但 npm test 是 fake-runner 必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'maskfail'), { test: 'node fake-runner.mjs' });
  mkdirSync(join(root, 'skills', 'maskfail', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'maskfail', 'test', 'bad.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; test("bad", () => { assert.equal(1, 2); });');
  writeFileSync(join(root, 'skills', 'maskfail', 'fake-runner.mjs'), 'process.exit(0);\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /TAP 失败|看不到 # tests|bad/);
});

test('只 exit 0 的测试文件完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'exitonly'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'exitonly', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'exitonly', 'test', 'noop.test.mjs'), 'process.exit(0);\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('仅 console.log 的测试文件完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'logonly'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'logonly', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'logonly', 'test', 'noop.test.mjs'), 'console.log("no test assertions");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('function test(){} 完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'fnonly'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'fnonly', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'fnonly', 'test', 'decl.test.mjs'), 'function test() {}\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('死代码 assert 不算声明', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'deadassert'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'deadassert', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'deadassert', 'test', 'dead.test.mjs'), 'if (false) assert.equal(1, 1);\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('console.log 里的 test("x") 不算声明', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'logtitle'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'logtitle', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'logtitle', 'test', 'fake.test.mjs'), "console.log('test(\"x\")');\n");
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('未调用箭头函数里的 test 完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'arrowfn'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'arrowfn', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'arrowfn', 'test', 'arrow.test.mjs'), 'const f = () => { test("x", () => {}); };\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|# Subtest/);
});

test('if(false) test 完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'deadif'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'deadif', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'deadif', 'test', 'deadif.test.mjs'), 'if (false) test("x", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|# Subtest/);
});

test('未调用函数里的 test("x") 不算声明', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'nestedfn'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'nestedfn', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'nestedfn', 'test', 'nested.test.mjs'), 'function f(){ test("x", () => {}); }\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('字符串里写 test( 不算声明', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'strfake'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'strfake', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'strfake', 'test', 'fake.test.mjs'), 'console.log("test(\\"x\\")");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('空测试文件完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'emptyfile'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'emptyfile', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'emptyfile', 'test', 'empty.test.mjs'), '');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有声明 test|没有真实用例名/);
});

test('全部 skip 的包完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'allskip'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'allskip', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'allskip', 'test', 'skip.test.mjs'), 'import test from "node:test"; test.skip("only", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有实际通过|全 skip/);
});

test('全部 todo 的包完整夜间必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'alltodo'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'alltodo', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'alltodo', 'test', 'todo.test.mjs'), 'import test from "node:test"; test.todo("only");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /没有实际通过|全 skip/);
});

test('测试标题恰等于其测试文件名仍必须绿', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'same'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'same', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'same', 'test', 'same.test.mjs'), 'import test from "node:test"; test("same.test.mjs", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test('合法标题为 a/b.test.mjs 仍必须绿', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'slashfile'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'slashfile', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'slashfile', 'test', 'slashfile.test.mjs'), 'import test from "node:test"; test("a/b.test.mjs", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test('合法标题以 .test.mjs 结尾仍必须绿', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'namedfile'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'namedfile', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'namedfile', 'test', 'named.test.mjs'), 'import test from "node:test"; test("foo.test.mjs", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test('合法标题含斜杠的测试必须绿', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'slash'), { test: 'node --test test/*.test.mjs' });
  mkdirSync(join(root, 'skills', 'slash', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'slash', 'test', 'slash.test.mjs'), 'import test from "node:test"; test("a/b", () => {});\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
});

test('正常公开测试的完整夜间流程必须绿', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'okpkg'), { test: 'node --test test/*.test.mjs' });
  writePublicTest(join(root, 'skills', 'okpkg'));
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(`${res.stdout}\n${res.stderr}`, /夜间健康检查通过/);
});

test('自报 broken 排除失败公开测试必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'fakedecl'), { test: 'node --test' });
  mkdirSync(join(root, 'skills', 'fakedecl', 'scripts'), { recursive: true });
  mkdirSync(join(root, 'skills', 'fakedecl', 'test'), { recursive: true });
  writeFileSync(join(root, 'skills', 'fakedecl', 'test', 'ok.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
  writeFileSync(join(root, 'skills', 'fakedecl', 'test', 'bad.test.mjs'), 'import test from "node:test"; import assert from "node:assert/strict"; test("bad", () => { assert.equal(1, 2); });');
  writeFileSync(join(root, 'skills', 'fakedecl', 'scripts', 'test-public.mjs'), 'console.log("test/ok.test.mjs");\nconsole.log("# exclude test/bad.test.mjs :: broken: self-declared");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /排除项类别不受控|bad\.test\.mjs/);
});

test('lister 给出包外路径必须红', () => {
  const root = makeRoot();
  writePkg(join(root, 'skills', 'escape'), { test: 'node --test' });
  mkdirSync(join(root, 'skills', 'escape', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'outside.test.mjs'), 'import test from "node:test"; test("out", () => {});');
  writeFileSync(join(root, 'skills', 'escape', 'ok.test.mjs'), 'import test from "node:test"; test("ok", () => {});');
  writeFileSync(join(root, 'skills', 'escape', 'scripts', 'test-public.mjs'), 'console.log("../../outside.test.mjs");\n');
  const res = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, NIGHTLY_HEALTH_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(`${res.stdout}\n${res.stderr}`, /包外路径/);
});

function writeHealthySkill(root, name, extras = {}) {
  const dir = join(root, 'skills', name);
  writePkg(dir, { test: 'node --test test/*.test.mjs' });
  writePublicTest(dir);
  if (extras.exclusions) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'nightly-exclusions.json'), JSON.stringify(extras.exclusions, null, 2));
  }
  return dir;
}

function assertNoNewLabel(text) {
  assert.match(text, /无昨日基线/);
  assert.doesNotMatch(text, /今晚新/);
}

function runPatrol(root, extra = {}) {
  const json = extra.json || join(root, 'report.json');
  const md = extra.md || join(root, 'report.md');
  const args = [SCRIPT, '--json', json, '--md', md];
  if (extra.baseline) args.push('--baseline', extra.baseline);
  return {
    json,
    md,
    res: spawnSync(process.execPath, args, {
      encoding: 'utf8',
      env: {
        ...process.env,
        NIGHTLY_HEALTH_ROOT: root,
        NIGHTLY_HEALTH_NOW: extra.now || '2026-08-24T16:00:00Z',
      },
    }),
  };
}

test('排除项不合法是今晚红，不是缺口', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'yise');
  mkdirSync(join(root, 'skills', 'yise', 'scripts', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'skills', 'yise', 'scripts', '__tests__', 'comp-paint-order.test.mjs'), 'import test from "node:test"; test("demo", () => {});');
  writeFileSync(join(root, 'skills', 'yise', 'scripts', 'test-public.mjs'), 'console.log("test/ok.test.mjs");\nconsole.log("# exclude scripts/__tests__/comp-paint-order.test.mjs :: demo: current page");\n');
  writeFileSync(join(root, 'skills', 'yise', 'scripts', 'nightly-exclusions.json'), JSON.stringify({ demo: [], broken: {} }));
  const { res, json, md } = runPatrol(root);
  const doc = JSON.parse(readFileSync(json, 'utf8'));
  const text = readFileSync(md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.equal(doc.items.filter((item) => item.grade === 'tonight').length >= 1, true);
  assert.match(text, /## 今晚红/);
  assertNoNewLabel(text);
});

test('broken 进已知债，demo 和交接 broken 进缺口，进程仍绿', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'yise', {
    exclusions: {
      demo: ['scripts/__tests__/hero-scroll-slot.test.mjs'],
      broken: {
        'scripts/__tests__/comp-fix-r7.test.mjs': 'tailwind 内部 API',
        'scripts/__tests__/figma-from-handoff.test.mjs': 'green-draft 已转 unnamed',
      },
    },
  });
  const { res, json, md } = runPatrol(root);
  const doc = JSON.parse(readFileSync(json, 'utf8'));
  const text = readFileSync(md, 'utf8');
  const mdPrints = [...text.matchAll(/为什么：([^\n]+)/g)].map((m) => m[1]);
  const jsonPrints = doc.items.map((item) => item.summary);
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.equal(doc.items.some((item) => item.grade === 'tonight'), false);
  assert.equal(doc.items.some((item) => item.grade === 'debt' && /comp-fix-r7/.test(item.path)), true);
  assert.equal(doc.items.some((item) => item.grade === 'gap' && /hero-scroll-slot/.test(item.path)), true);
  assert.equal(doc.items.some((item) => item.grade === 'gap' && /figma-from-handoff/.test(item.path)), true);
  assert.deepEqual([...mdPrints].sort(), [...jsonPrints].sort());
  assert.match(text, /## 已知债/);
  assert.match(text, /## 缺口/);
});

test('路径噪声去掉后指纹相同，换包名则不同', async () => {
  const { fingerprintOf } = await import('./nightly-health.mjs');
  const a = fingerprintOf({
    package: 'skills/yise-web-ui',
    check: 'health',
    summary: 'fail at /Users/runner/work/a/nightly-health.mjs:12 2026-08-24T16:00:00.000Z',
  });
  const b = fingerprintOf({
    package: 'skills/yise-web-ui',
    check: 'health',
    summary: 'fail at /tmp/other/nightly-health.mjs:12 2026-08-25T01:02:03.000Z',
  });
  const c = fingerprintOf({
    package: 'standards/figma-naming/tool',
    check: 'health',
    summary: 'fail at /tmp/other/nightly-health.mjs:12 2026-08-25T01:02:03.000Z',
  });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('无基线禁止标新发现，北京 0 点日期是当天', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'okpkg');
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const { res, json, md } = runPatrol(root, { now: '2026-08-24T16:00:00Z' });
  const doc = JSON.parse(readFileSync(json, 'utf8'));
  const text = readFileSync(md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.equal(doc.date, '2026-08-25');
  assertNoNewLabel(text);
});

test('昨日同指纹进已知债，昨日有今晚无进已消失', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'okpkg');
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const first = runPatrol(root);
  const firstDoc = JSON.parse(readFileSync(first.json, 'utf8'));
  const fp = firstDoc.items.find((item) => item.grade === 'tonight').fingerprint;
  const baseline = join(root, 'yesterday.json');
  writeFileSync(baseline, JSON.stringify({ items: [{ fingerprint: fp }] }));
  const second = runPatrol(root, { baseline, json: join(root, 'second.json'), md: join(root, 'second.md') });
  const secondDoc = JSON.parse(readFileSync(second.json, 'utf8'));
  writeFileSync(join(root, 'skills', 'okpkg', 'package.json'), JSON.stringify({ name: 'tmp', scripts: { test: 'node --test test/*.test.mjs' } }));
  rmSync(join(root, 'package.json'));
  const goneRun = runPatrol(root, { baseline, json: join(root, 'gone.json'), md: join(root, 'gone.md') });
  const goneDoc = JSON.parse(readFileSync(goneRun.json, 'utf8'));
  const goneText = readFileSync(goneRun.md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(first.res.status, 0);
  assert.equal(second.res.status, 0, `${second.res.stdout}\n${second.res.stderr}`);
  assert.equal(secondDoc.items.some((item) => item.grade === 'debt' && item.fingerprint === fp), true);
  assert.equal(goneRun.res.status, 0, `${goneRun.res.stdout}\n${goneRun.res.stderr}`);
  assert.equal(goneDoc.items.some((item) => item.fingerprint === fp), false);
  assert.match(goneText, /## 已消失/);
  assert.match(goneText, new RegExp(fp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('坏基线按无基线，禁止标新', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'okpkg');
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const baseline = join(root, 'yesterday.json');
  writeFileSync(baseline, '{not json');
  const { res, md } = runPatrol(root, { baseline });
  const text = readFileSync(md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assertNoNewLabel(text);
});

test('exclusions JSON 坏了是今晚红，缺文件不红', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'okpkg');
  mkdirSync(join(root, 'skills', 'okpkg', 'scripts'), { recursive: true });
  writeFileSync(join(root, 'skills', 'okpkg', 'scripts', 'nightly-exclusions.json'), '{bad');
  const bad = runPatrol(root, { json: join(root, 'bad.json'), md: join(root, 'bad.md') });
  const badDoc = JSON.parse(readFileSync(bad.json, 'utf8'));
  writeFileSync(join(root, 'skills', 'okpkg', 'scripts', 'nightly-exclusions.json'), JSON.stringify({ demo: {}, broken: [] }));
  const schema = runPatrol(root, { json: join(root, 'schema.json'), md: join(root, 'schema.md') });
  const schemaDoc = JSON.parse(readFileSync(schema.json, 'utf8'));
  rmSync(join(root, 'skills', 'okpkg', 'scripts', 'nightly-exclusions.json'));
  const missing = runPatrol(root, { json: join(root, 'missing.json'), md: join(root, 'missing.md') });
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(bad.res.status, 0);
  assert.equal(badDoc.items.some((item) => item.grade === 'tonight' && /无法解析/.test(item.summary)), true);
  assert.notEqual(schema.res.status, 0);
  assert.equal(schemaDoc.items.some((item) => item.grade === 'tonight' && /demo 不是数组|broken 不是对象/.test(item.summary)), true);
  assert.equal(missing.res.status, 0, `${missing.res.stdout}\n${missing.res.stderr}`);
});

test('夜巡工作流有 artifact 往返和 always 写 Summary，没有 pull_request', () => {
  const workflow = readFileSync(WORKFLOW, 'utf8');
  assert.match(workflow, /if:\s*\$\{\{\s*always\(\)\s*\}\}/);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/);
  assert.match(workflow, /actions\/github-script@v7/);
  assert.match(workflow, /listWorkflowRuns/);
  assert.match(workflow, /head_branch === branch/);
  assert.match(workflow, /beijingDate\(run\.created_at\) === yesterday/);
  assert.match(workflow, /上一北京日、默认分支/);
  assert.match(workflow, /actions\/download-artifact@v4/);
  assert.match(workflow, /run-id:/);
  assert.match(workflow, /github-token:\s*\$\{\{\s*github\.token\s*\}\}/);
  assert.match(workflow, /repository:\s*\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(workflow, /include-hidden-files:\s*true/);
  assert.match(workflow, /steps\.prev-nightly\.outcome/);
  assert.match(workflow, /listWorkflowRuns 失败/);
  assert.match(workflow, /昨日基线已就位|无昨日基线/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /name:\s*nightly-fingerprints/);
  assert.match(workflow, /retention-days:\s*2/);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /List packages under check[\s\S]*continue-on-error:\s*true[\s\S]*nightly-health\.mjs --list/);
  assert.match(workflow, /actions:\s*read/);
  assert.doesNotMatch(workflow, /downloadArtifact/);
  assert.doesNotMatch(workflow, /pull_request/);
  assert.doesNotMatch(workflow, /issues:\s*write/);
  assert.doesNotMatch(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /reports\/nightly|git add|git commit/);
});

test('选基线只要上一北京日默认分支，跨 ref 和更早的 run 不算昨日', async () => {
  const { pickYesterdayNightlyRun } = await import('./nightly-health.mjs');
  const now = '2026-08-25T16:00:00Z';
  const yesterdayMain = {
    id: 11,
    status: 'completed',
    head_branch: 'main',
    created_at: '2026-08-24T16:05:00Z',
  };
  const olderMain = {
    id: 10,
    status: 'completed',
    head_branch: 'main',
    created_at: '2026-08-23T16:05:00Z',
  };
  const otherRef = {
    id: 12,
    status: 'completed',
    head_branch: 'feat/nightly-patrol-report',
    created_at: '2026-08-24T16:10:00Z',
  };
  const todayDispatch = {
    id: 13,
    status: 'completed',
    head_branch: 'main',
    created_at: '2026-08-25T16:01:00Z',
  };
  const picked = pickYesterdayNightlyRun(
    [todayDispatch, otherRef, yesterdayMain, olderMain],
    { currentRunId: 99, now, defaultBranch: 'main' },
  );
  const none = pickYesterdayNightlyRun(
    [todayDispatch, otherRef, olderMain],
    { currentRunId: 99, now, defaultBranch: 'main' },
  );
  assert.equal(picked?.id, 11);
  assert.equal(none, null);
});

test('脚本不写 GITHUB_STEP_SUMMARY，留给 workflow always 步骤', () => {
  const root = makeRoot();
  writeHealthySkill(root, 'okpkg');
  const summary = join(root, 'step-summary.md');
  const json = join(root, 'report.json');
  const md = join(root, 'report.md');
  writeFileSync(summary, '');
  const res = spawnSync(process.execPath, [SCRIPT, '--json', json, '--md', md], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NIGHTLY_HEALTH_ROOT: root,
      NIGHTLY_HEALTH_NOW: '2026-08-24T16:00:00Z',
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  const summaryText = readFileSync(summary, 'utf8');
  const report = readFileSync(md, 'utf8');
  rmSync(root, { recursive: true, force: true });
  assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
  assert.match(report, /夜巡 /);
  assert.equal(summaryText, '');
});

