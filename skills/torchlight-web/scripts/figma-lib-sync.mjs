#!/usr/bin/env node
/**
 * figma-lib-sync.mjs — 把 extract.mjs 依赖的 Skill 通用库机械拷进 demo。【任务 15】
 *
 * ═══ 为什么有这个脚本 ═══
 *
 * verify.mjs 的门 A 第三段（extractor drift）在**不可变观察快照的副本树**里执行
 * demo/extract.mjs —— 副本树在仓库之外，`import '../../scripts/lib/xxx'`
 * 解析不到 → gateA 红。这是整套「机械证明」链上唯一真正的洞。
 *
 * 修法（对齐老师把 extract-helpers.mjs 拷进 demo 的既有做法）：
 * 通用库唯一真源留在 scripts/lib/，demo 里那份是**派生物** —— 机械拷贝 + --check 查漂移，
 * 与 figma-inline.mjs 同构。任何一边手改就报红。
 *
 * ═══ 依赖清单机械求出 ═══
 *
 * 从 demo/extract.mjs 的 import 出发做传递闭包（不许手写清单 —— 漏一个，快照里就红）。
 * 只认相对 import 解析进 **scripts/lib/** 的；逃逸到别处的（第三方包、其它目录）报错列出，
 * 由人决定，不静默拷。
 *
 * ═══ 用法 ═══
 *   node scripts/figma-lib-sync.mjs --demo <dir>           # 拷贝（幂等）
 *   node scripts/figma-lib-sync.mjs --demo <dir> --check   # 只查漂移，不一致非零退出
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k === '--demo') args.demo = process.argv[++i];
  else if (k === '--check') args.check = true;
  else fail(`未知参数：${k}`);
}
if (!args.demo) fail('必须给 --demo <dir>');

const demoDir = resolve(args.demo);
const skillLibDir = resolve(import.meta.dirname, 'lib');   // 本脚本在 scripts/，通用库在 scripts/lib/
const extractorPath = join(demoDir, 'extract.mjs');
if (!existsSync(extractorPath)) fail(`缺 ${extractorPath}`);

const sha = (s) => createHash('sha256').update(s).digest('hex');
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

/** 从文件里解析相对 import，返回解析后的绝对路径数组 */
function relativeImports(fileAbs) {
  const src = readFileSync(fileAbs, 'utf8');
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;                    // 裸导入（node:*/第三方）不管
    out.push(resolve(dirname(fileAbs), spec));
  }
  return out;
}

/* ── 传递闭包：extract.mjs → 其相对 import → 那些文件的相对 import → … ──
 * 认两种形态：
 *   '../../scripts/lib/<x>'（直引真源）—— 拷；
 *   './lib/<x>'（已指向机械副本）—— 真源是 scripts/lib/<x>，照样拷/校。
 *   （第二种是bootstrap后的常态：extract.mjs 已指向 ./lib，闭包要能把
 *    './lib/<x>' 映射回真源，否则首次拷贝前文件不存在就死锁。） */
const closure = new Map();   // 真源绝对路径 → lib 内相对路径（保留子目录，如 translation/locale-policy.mjs）
const foreign = [];          // 逃逸到 scripts/lib 之外的相对 import（报错，不静默拷）
const libDir = join(demoDir, 'lib');
const queue = [extractorPath];
/* 闂?X 鐨勮嚜瀹氫箟闂ㄨ剼鏈篃瑕佽繘闂寢 鈥斺€?trustedScriptCopy 鐨勫揩鐓ф爲鍙惈 demo 鐩綍锛宑ustomGate 鑴氭湰
   import 鐨?scripts/lib 妯″潡鑻ユ病鍚屾杩?demo/lib锛屽揩鐓у唴鐩稿 import 瑙ｆ瀽涓嶅埌 鈫?gateX ERR_MODULE_NOT_FOUND銆?
   鎶?spec.customGates 鐨?script 骞跺叆绉嶅瓙锛屽畠浠殑 './lib/<x>' / 鐩村紩鐪熸簮 import 涓庢彁鍙栧櫒璧板悓涓€濂楅棴鍖呫€?*/
try {
  const specPath = join(demoDir, 'spec.json');
  if (existsSync(specPath)) {
    const spec = JSON.parse(readFileSync(specPath, 'utf8'));
    for (const g of spec.customGates ?? []) {
      if (g && typeof g.script === 'string') {
        const gateAbs = join(demoDir, g.script);
        if (existsSync(gateAbs)) queue.push(gateAbs);
      }
    }
  }
} catch { /* spec 涓嶅彲璇绘椂涓嶉樆濉炴彁鍙栧櫒闂寢锛屼繚鎸佸師琛屼负 */ }
while (queue.length) {
  const cur = queue.shift();
  for (let dep of relativeImports(cur)) {
    const relToDemo = relative(demoDir, dep);
    if (!relToDemo.startsWith('..')) {
      if (relToDemo.startsWith('lib' + sep) || relToDemo.startsWith('lib/')) {
        dep = join(skillLibDir, relative(join(demoDir, 'lib'), dep));   // 机械副本 → 映射回真源（保留 translation/ 等子目录）
      } else {
        continue;                                  // demo 内部自有依赖（extract-helpers.mjs 等）不用拷
      }
    }
    if (!existsSync(dep)) fail(`${cur} import 了不存在的文件：${dep}`);
    const relToLib = relative(skillLibDir, dep);
    if (relToLib.startsWith('..')) { foreign.push(`${relative(demoDir, cur)} → ${relative(demoDir, dep)}`); continue; }
    if (!closure.has(dep)) {
      closure.set(dep, relative(skillLibDir, dep));
      queue.push(dep);
    }
  }
}
if (foreign.length) {
  fail(`extract.mjs 的依赖逃逸到 scripts/lib 之外（请人工决定怎么处理，不静默拷）：\n  ${foreign.join('\n  ')}`);
}
/* 目标路径冲突检查：同一 lib 相对路径若来自两个不同真源会互相覆盖 —— 当场报，不许悄悄盖 */
const byBase = new Map();
for (const [abs, base] of closure) {
  if (byBase.has(base) && byBase.get(base) !== abs) fail(`lib 相对路径撞名：${byBase.get(base)} 与 ${abs} 都映射到 ${base}`);
  byBase.set(base, abs);
}

const HEADER = (base) =>
  `// 本文件由 scripts/figma-lib-sync.mjs 从 scripts/lib/${base} 机械拷出，勿手改；改真源后重跑：node scripts/figma-lib-sync.mjs --demo <demo 目录>`;

/** 拷贝体 = 告示行 + 真源内容（LF 归一化，同 figma-inline 的现成做法） */
function copyBody(srcAbs, base) {
  const content = readFileSync(srcAbs, 'utf8').replace(/\r\n/g, '\n');
  return HEADER(base) + '\n' + content;
}

/* ── --check：demo/lib 副本 ≡ scripts/lib 真源（sha256 逐字节，告示行豁免）── */
if (args.check) {
  const problems = [];
  const present = existsSync(libDir)
    ? new Set(readdirSync(libDir).filter((name) => statSync(join(libDir, name)).isFile()))   // 瀛愮洰褰曪紙translation/锛変腑鐨勬枃浠跺湪 closure 閲屼互 base 鍚瓙璺緞鍖呴厤锛屽埆鎶婄洰褰曞綋澶氫綑鏂囦欢
    : new Set();
  for (const [srcAbs, base] of closure) {
    const copyPath = join(libDir, base);
    present.delete(base);
    if (!existsSync(copyPath)) { problems.push(`${base}：demo/lib/ 里缺这份副本`); continue; }
    const want = copyBody(srcAbs, base);
    const got = readFileSync(copyPath, 'utf8').replace(/\r\n/g, '\n');
    if (sha(got) !== sha(want)) {
      const srcNewer = statSync(srcAbs).mtimeMs > statSync(copyPath).mtimeMs;
      problems.push(`${base}：副本与真源不一致（${srcNewer ? '真源较新 —— 重跑 figma-lib-sync' : '副本较新 —— 副本被手改过，重跑 figma-lib-sync 覆盖'}）`);
    }
  }
  for (const extra of present) problems.push(`demo/lib/${extra}：不在依赖闭包里（多出来的文件，删了或查来源）`);
  if (problems.length) {
    console.log(JSON.stringify({ ok: false, problems }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, checked: closure.size, files: [...closure.values()] }, null, 2));
  process.exit(0);
}

/* ── 拷贝（幂等）── */
mkdirSync(libDir, { recursive: true });
const written = [];
for (const [srcAbs, base] of closure) {
  const body = copyBody(srcAbs, base);
  const dst = join(libDir, base);
  mkdirSync(dirname(dst), { recursive: true });   // 子目录（translation/ 等）先建，别让写文件撞 ENOENT
  if (existsSync(dst) && sha(readFileSync(dst, 'utf8').replace(/\r\n/g, '\n')) === sha(body)) continue;   // 幂等：一致不重写
  writeFileSync(dst, body);
  written.push(base);
}
console.log(JSON.stringify({
  ok: true,
  closure: [...closure.values()],
  wrote: written,
  skippedAsIdentical: [...closure.values()].filter((b) => !written.includes(b)),
  hint: '把 extract.mjs 里 ../../scripts/lib/<x> 的 import 改成 ./lib/<x>（一次性手动指向本地副本）',
}, null, 2));
