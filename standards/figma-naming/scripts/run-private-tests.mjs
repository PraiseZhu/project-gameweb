/**
 * run-private-tests.mjs —— 跑那些必须有私有证据才能跑的测试。
 *
 * 为什么单独一条命令、而不是让它们在 `npm test` 里自己 skip：
 *   skip 掉的测试会让 `npm test` 显示全绿，而实际少跑了真稿回归门禁那种
 *   最重要的几条。绿灯必须意味着「跑过了并且过了」，不能意味着「没跑」。
 *   所以公开仓的 `npm test` 里根本没有这些文件，它们全部住在 test-private/；
 *   本脚本负责在证据缺失时**显式报出缺哪个路径、少跑几项，并以非零退出码结束**。
 *
 * 「少跑几项」不是估算：每个文件的 topLevelTests 是手写并由本脚本自检的——
 * 证据齐全时会把真实跑出来的顶层测试数与声明值逐文件比对，对不上就报错。
 * 这样声明值不会随着测试增删悄悄过期，变成一个越来越假的数字。
 */
import { existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { run } from "node:test";
import { spec } from "node:test/reporters";
import { requireFileKey } from "./draft-cache.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 每个私有测试文件要什么证据、有几项顶层测试。
 *
 * requires 写的是**这个文件真正会读的路径**，不是「所有私有路径」——报缺失时
 * 要能指到具体那一个，让人知道该去补哪份文件，而不是笼统说「缺私有数据」。
 *
 * 写成函数而不是常量：`.cache/` 的文件名带 fileKey，而 key 住在环境变量里
 * （见 scripts/draft-cache.mjs）。常量会让「import 这个模块」本身就要求配好 key，
 * 而公开仓的 `npm test` 要 import 它做表结构自检，那些用例根本不碰真稿。
 * 缺 key 时也不许拼一条假路径去查存在性——那会报「缺 .cache/xxx.json」，
 * 把「你没配 key」说成「你缺快照」，指错方向。
 */
export function privateSuites(fileKey = requireFileKey()) {
  const canonicalCache = `.cache/${fileKey}-1-15.json`;
  return [
    {
      file: "test-private/lint-real-draft.test.mjs",
      topLevelTests: 1,
      requires: [canonicalCache],
      why: "真稿数字门禁：pc 80 / mobile 71 / 三处分档 / 动作数",
    },
    {
      file: "test-private/regression.test.mjs",
      topLevelTests: 2,
      requires: [
        canonicalCache,
        "baseline/findings/pc.json",
        "baseline/findings/mobile.json",
      ],
      why: "真稿全量 findings 与已认可基线逐条一致",
    },
    {
      file: "test-private/apply-exemptions-real-draft.test.mjs",
      topLevelTests: 1,
      requires: [canonicalCache],
      why: "生产豁免账本在真稿上的效果：报警 80 不变、动作 42 → 28",
    },
    {
      file: "test-private/naming-verdicts-real-labels.test.mjs",
      topLevelTests: 1,
      requires: ["data/user-labels.json"],
      why: "示例标签字段清单不许对真账本漂移",
    },
  ];
}

export function checkEvidence(suites, { root = ROOT } = {}) {
  const runnable = [];
  const blocked = [];
  for (const suite of suites) {
    const missing = suite.requires.filter((path) => !existsSync(resolve(root, path)));
    if (missing.length) blocked.push({ ...suite, missing });
    else runnable.push(suite);
  }
  return { runnable, blocked };
}

export function formatBlockedReport(blocked) {
  const notRun = blocked.reduce((sum, suite) => sum + suite.topLevelTests, 0);
  const missingPaths = [...new Set(blocked.flatMap((suite) => suite.missing))].sort();
  const lines = [
    `✘ 私有证据缺失：未运行 ${notRun} 项，缺 ${missingPaths.join("、")}`,
    "",
    "逐个文件：",
  ];
  for (const suite of blocked) {
    lines.push(`  · ${suite.file}（${suite.topLevelTests} 项未运行）—— ${suite.why}`);
    for (const path of suite.missing) lines.push(`      缺 ${path}`);
  }
  lines.push(
    "",
    "这些文件不进公开仓（.gitignore 挡着）。补齐方式：",
    "  .cache/            npm run lint -- \"<figma 链接>\"  重新抓取稿件快照",
    "  baseline/findings/ node scripts/save-baseline.mjs <体检根名>",
    "  data/user-labels.json  人工裁决账本，从私有来源取",
    "",
    "公开仓只跑 `npm test`（不需要任何私有证据）。",
  );
  return lines.join("\n");
}

async function main() {
  /* key 缺失时 requireFileKey 抛，错误里写清去 .env 配哪个变量。
     这里把它渲染成一条人读的报告 + 非零退出，而不是让 Node 甩一段栈——
     栈把「你少配了一行」埋在调用链里。也不降级成「私有证据缺失」：
     那是两种不同的病，混报会让人跑去重新抓快照，而真正缺的是一行配置。 */
  let suites;
  try {
    suites = privateSuites();
  } catch (error) {
    console.error([
      `✘ 私有套件未运行：${error.message}`,
      "",
      "公开仓只跑 `npm test`（不需要 key，也不需要任何私有证据）。",
    ].join("\n"));
    process.exit(1);
  }
  const { runnable, blocked } = checkEvidence(suites);

  if (blocked.length) {
    console.error(formatBlockedReport(blocked));
    /* 有能跑的也不跑：这条命令的语义是「私有套件整体通过」，
       跑一半再退出非零，只会让人以为剩下那一半的绿是完整的。 */
    process.exit(1);
  }

  const files = runnable.map((suite) => resolve(ROOT, suite.file));
  const stream = run({ files, concurrency: 1 });
  const passedByFile = new Map();
  let failed = 0;
  let passed = 0;

  const bump = (map, file) => map.set(file, (map.get(file) ?? 0) + 1);
  stream.on("test:pass", (event) => {
    if (event.nesting !== 0) return;
    passed += 1;
    if (event.file) bump(passedByFile, event.file);
  });
  stream.on("test:fail", (event) => {
    if (event.nesting !== 0) return;
    failed += 1;
  });
  stream.compose(new spec()).pipe(process.stdout);

  await new Promise((resolveDone, rejectDone) => {
    stream.on("end", resolveDone);
    stream.on("error", rejectDone);
  });

  if (failed > 0) {
    console.error(`\n✘ 私有套件失败：${failed} 项未通过`);
    process.exit(1);
  }

  /* 声明值自检：证据齐全时，真实跑出来的顶层项数必须与 privateSuites() 声明的
     一致。对不上说明声明值过期了——而那个数正是证据缺失时报给用户的
     「未运行 N 项」，过期就等于报了个假数。 */
  const drift = [];
  for (const suite of runnable) {
    const actual = passedByFile.get(resolve(ROOT, suite.file)) ?? 0;
    if (actual !== suite.topLevelTests) {
      drift.push(`  · ${relative(ROOT, suite.file)}：实际 ${actual} 项，声明 ${suite.topLevelTests} 项`);
    }
  }
  if (drift.length) {
    console.error([
      "\n✘ privateSuites() 的 topLevelTests 声明与实际项数不符，请更新 scripts/run-private-tests.mjs：",
      ...drift,
      "  （这个数字是证据缺失时报给用户的「未运行 N 项」，过期就是报假数）",
    ].join("\n"));
    process.exit(1);
  }

  console.log(`\n✔ 私有套件通过：${passed} 项（${runnable.length} 个文件）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
