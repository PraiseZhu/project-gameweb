/**
 * build-plugin.mjs — bundle plugin/main.mjs into a single IIFE for Figma and
 * copy ui.html next to it. Figma's plugin sandbox does not support ESM, so the
 * output format must stay iife.
 */
import { build } from "esbuild";
import { mkdirSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateLedger } from "../src/exemptions.mjs";
import { RULES } from "../src/rules.mjs";
import { ledgerFingerprint } from "../plugin/ledger-fingerprint.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = resolve(ROOT, "dist/plugin");
const DEFAULT_LEDGER = resolve(ROOT, "baseline/exemptions.json");

/* 默认标签是随仓的合成示例，不是真账本。
   真账本 data/user-labels.json 是人逐层判出来的私有证据，不进公开仓；公开仓 clone
   下来时那个路径根本不存在。默认读示例的理由不是「兜底」，而是让「没有真账本」
   这件事有一个正确、可构建、且在界面上看得见的状态——而不是让构建直接失败、
   或者悄悄用空标签跑（空标签会让人已确认过的按钮/改名全部消失且插件不报错）。
   真账本走 `--labels <path>` 显式传入。 */
export const SAMPLE_LABELS = resolve(ROOT, "examples/user-labels.sample.json");
const DEFAULT_LABELS = SAMPLE_LABELS;

/** 标签来源只有两档，且判据是「解析后的绝对路径是不是那份随仓示例」——
 *  不是「调用方有没有显式传 labelsPath」。显式传示例路径照样得显示成示例，
 *  否则面板会把示例标签说成真账本，正好是这次要让人看得见的那件事。 */
export function labelsSourceOf(labelsPath) {
  return resolve(labelsPath) === SAMPLE_LABELS ? "sample" : "custom";
}

export const LABELS_SOURCE_LABEL = {
  sample: "示例标签（随仓合成，非真实裁决）",
  custom: "人工标签账本",
};

export async function buildPlugin({
  outDir = DEFAULT_OUT,
  ledgerPath = DEFAULT_LEDGER,
  labelsPath = DEFAULT_LABELS,
  buildDate = new Date().toISOString().slice(0, 10),
  logLevel = "info",
} = {}) {
  let ledgerRaw;
  let ledger;
  try {
    ledgerRaw = readFileSync(ledgerPath, "utf8");
    ledger = JSON.parse(ledgerRaw);
    validateLedger(ledger, { rules: RULES });
  } catch (error) {
    throw new Error(`随包豁免账本无效，拒绝构建：${ledgerPath}（${error?.message ?? String(error)}）`);
  }
  const fingerprint = ledgerFingerprint(ledger);

  /*
   * 人工标签同样必须内联进插件包：插件运行在 Figma 的
   * 沙箱里，读不到磁盘文件。跟随包豁免账本走同一条路——esbuild define 注入原始
   * JSON 文本，运行时再解析——而不是新建一套机制，理由：
   *   1. 这条路已经被 exemptions 验证过，随包账本能正确注入、能在开发环境下
   *      安全回退到空值（BUNDLED_RAW 那段 typeof 判断），复用等于少踩一次坑。
   *   2. define 是编译期常量替换，产物里就是一段字面量字符串，不依赖任何运行时
   *      文件系统 API——沙箱环境的硬约束天然满足。
   * 校验只做 probe-m1a.mjs 自己也做的那一层（JSON 能解析、version === 1），
   * 不为标签另造一套 schema 校验器；构建时校验不通过就直接拒绝构建，不静默用
   * 空标签兜底——空标签会让人已经确认过的按钮/改名全部消失，且插件不会报错，
   * 后果只在体检结果里悄悄变差，比构建失败更难查。
   */
  let labelsRaw;
  try {
    labelsRaw = readFileSync(labelsPath, "utf8");
    const labelsDoc = JSON.parse(labelsRaw);
    if (labelsDoc.version !== 1 || !Array.isArray(labelsDoc.labels)) {
      throw new Error(`version 必须是 1 且 labels 必须是数组`);
    }
  } catch (error) {
    throw new Error(`随包人工标签无效，拒绝构建：${labelsPath}（${error?.message ?? String(error)}）`);
  }
  /* 来源在这里定死并一路带到面板。示例标签能构建，但不能让人以为自己装的是
     带真裁决的包——那会让「为什么我确认过的按钮又冒出来了」变成无从下手的问题。 */
  const labelsSource = labelsSourceOf(labelsPath);

  mkdirSync(outDir, { recursive: true });
  await build({
    entryPoints: [resolve(ROOT, "plugin/main.mjs")],
    outfile: resolve(outDir, "main.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["es2017"],
    define: {
      __BUILD_DATE__: JSON.stringify(buildDate),
      __BUNDLED_EXEMPTIONS_RAW__: JSON.stringify(ledgerRaw),
      __BUNDLED_EXEMPTIONS_FINGERPRINT__: JSON.stringify(fingerprint),
      __BUNDLED_LABELS_RAW__: JSON.stringify(labelsRaw),
      __BUNDLED_LABELS_SOURCE__: JSON.stringify(labelsSource),
    },
    logLevel,
  });

  copyFileSync(resolve(ROOT, "plugin/ui.html"), resolve(outDir, "ui.html"));

/* manifest 必须与产物同目录 —— Figma 按 manifest 所在目录解析 main / ui 的相对路径。
   2026-08-06 踩过：manifest 留在 plugin/ 而产物在 dist/plugin/，Figma 找不到 main.js，
   报「An error occurred while loading the plugin environment」，错误信息完全看不出是路径问题。 */
  copyFileSync(resolve(ROOT, "plugin/manifest.json"), resolve(outDir, "manifest.json"));

/* 构建后自检：manifest 指向的文件必须真的在输出目录里。
   这道门禁防的是整类错误，不只是上面那一次 —— 把「导入时才炸、且错误信息无用」
   变成「构建时就炸、且直接说清缺哪个文件」。 */
  const manifest = JSON.parse(readFileSync(resolve(outDir, "manifest.json"), "utf8"));

/* 必填字段检查。Figma 缺字段时只报「An error occurred while loading the plugin
   environment」，不说缺哪个 —— 2026-08-06 因为漏了 networkAccess 白试了一轮。 */
/* id 是必填的原因不是 Figma 通用要求，而是**本插件自己的代码依赖它**：
   annotate.mjs 用 setPluginData/getPluginData 标识标注根，而 Figma 对没有 id 的插件
   直接拒绝 plugin data（「Cannot get private plugin data in a plugin without an ID」）。
   2026-08-06 实机踩到。门禁能查的不是 Figma 的规则演变，而是「我们的代码依赖哪些字段」。 */
  const REQUIRED = ["name", "id", "api", "editorType", "main", "ui", "networkAccess"];
  const absent = REQUIRED.filter((k) => manifest[k] === undefined);
  if (absent.length) {
    throw new Error(`manifest 缺必填字段：${absent.join(", ")}；Figma 不会指出具体缺失字段`);
  }

  const missing = ["main", "ui"]
    .map((k) => manifest[k])
    .filter((rel) => rel && !existsSync(resolve(outDir, rel)));
  if (missing.length) {
    throw new Error(`manifest 指向的文件不在输出目录：${missing.join(", ")}；输出目录：${outDir}`);
  }

  /* 标签内联自检：门禁防的是「define 键名打错/漏传」这类构建期就该炸的错误，
     不是运行时才发现标签消失。挑第一条标签的 nodeId 当探针——它是随包 JSON
     字符串里必然出现的具体值，比检查文件体积或存在 __BUNDLED_LABELS_RAW__
     字样更可靠：只要 esbuild 的字符串替换真的发生，这个 nodeId 就必然在产物里。 */
  const bundledMainJs = readFileSync(resolve(outDir, "main.js"), "utf8");
  const labelsDoc = JSON.parse(labelsRaw);
  const probeNodeId = labelsDoc.labels[0]?.nodeId;
  if (probeNodeId && !bundledMainJs.includes(probeNodeId)) {
    throw new Error(`构建产物里找不到人工标签内容（缺少已知 nodeId ${probeNodeId}）：标签可能没被正确内联进插件包`);
  }

  /* 来源自检：面板显示的来源来自产物里的这个字面量，所以门禁也查产物本身，
     不查我们刚算出来的那个变量——用同一个变量自证等于什么都没查。 */
  if (!bundledMainJs.includes(JSON.stringify(labelsSource))) {
    throw new Error(`构建产物里找不到标签来源标记（${labelsSource}）：面板会显示不出用的是示例还是真账本`);
  }

  console.log(`✔ dist/plugin/ 自包含：manifest.json + ${manifest.main} + ${manifest.ui}`);
  console.log(`  随包豁免：${ledger.active.length} 条 · ${fingerprint.activeHash.slice(0, 8)}`);
  console.log(`  随包人工标签：${labelsDoc.labels.length} 条 · ${LABELS_SOURCE_LABEL[labelsSource]}`);
  console.log(`  标签来源文件：${resolve(labelsPath)}`);
  if (labelsSource === "sample") {
    console.log("  ⚠ 用的是随仓合成示例标签，面板会显示「示例标签」。真账本请传 --labels <path>");
  }
  console.log(`  在 Figma 里导入这个 manifest：${resolve(outDir, "manifest.json")}`);
  return { outDir, ledger, ledgerRaw, fingerprint, manifest, labelsDoc, labelsRaw, labelsSource, labelsPath: resolve(labelsPath) };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--labels") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--labels 需要一个文件路径");
      }
      options.labelsPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--labels=")) {
      const value = arg.slice("--labels=".length);
      if (!value) throw new Error("--labels 需要一个文件路径");
      options.labelsPath = resolve(value);
      continue;
    }
    throw new Error(`不认识的参数：${arg}；用法: node scripts/build-plugin.mjs [--labels <path>]`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await buildPlugin(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`✘ ${error?.message ?? String(error)}`);
    process.exit(1);
  }
}
