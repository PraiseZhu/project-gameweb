import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./nightly-health.mjs', import.meta.url));

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

test('现有仓布局能列出 yise 与 figma-naming', () => {
  const res = spawnSync(process.execPath, [SCRIPT, '--list'], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /skills\/yise-web-ui/);
  assert.match(res.stdout, /standards\/figma-naming/);
  assert.match(res.stdout, /fonts:check/);
});

test('仓库根 package.json 必须红', () => {
  const root = makeRoot();
  writeFileSync(join(root, 'package.json'), '{"name":"nope"}');
  const res = runList(root);
  rmSync(root, { recursive: true, force: true });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /仓库根有 package.json/);
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
