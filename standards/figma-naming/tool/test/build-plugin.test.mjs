import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildPlugin,
  labelsSourceOf,
  SAMPLE_LABELS,
} from "../scripts/build-plugin.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_LABELS_PATH = resolve(ROOT, "examples/user-labels.sample.json");
const REAL_LABELS_PATH = resolve(ROOT, "data/user-labels.json");

function tmpOutDir() {
  return mkdtempSync(resolve(tmpdir(), "figma-naming-lint-build-plugin-"));
}

/**
 * 插件读不到磁盘，人工标签必须在构建时内联进产物。这条测试直接检查
 * 构建出的 main.js 字节内容——不是检查 build-plugin.mjs 有没有调用某个函数，
 * 而是检查产物本身真的带着标签。这才是「标签没被打进去」这个失效模式
 * 真正会被看漏的地方：build-plugin.mjs 调用了错误的 define 键名、或者
 * esbuild tree-shaking 掉了一段没被引用的代码，函数级别的单测都测不出来，
 * 必须看最终产物。
 */
test("build-plugin：构建产物里能找到人工标签内容", async () => {
  const outDir = tmpOutDir();
  try {
    const { labelsDoc } = await buildPlugin({ outDir, logLevel: "silent" });
    assert.ok(labelsDoc.labels.length > 0, "随包示例标签里应该有标签，否则这条测试测不出东西");
    const mainJs = readFileSync(resolve(outDir, "main.js"), "utf8");
    // 每一条标签的 nodeId 都要在产物里逐个查到——不是随便抓一个算了事。
    // nodeId 全是 ASCII（数字/冒号），可以直接按字节比较；标签里的中文字段
    // （body/nodeNameAtLabelTime 等）esbuild 打包时会转成 \uXXXX 转义，
    // 直接按原文比对会因为编码形式不同而误报，所以故意不查这些字段。
    for (const label of labelsDoc.labels) {
      assert.ok(mainJs.includes(label.nodeId), `main.js 里找不到标签 nodeId ${label.nodeId}`);
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/**
 * 变异检验：把标签源文件换成不存在的路径，模拟"标签没被打进去"这一类问题
 * 里最直接的一种（路径配错）。构建必须直接失败，不能悄悄退回空标签或退回示例——
 * 空标签会让人已经确认过的按钮/改名全部消失，而插件本身不会报任何错，
 * 后果只会在体检结果里悄悄变差，比构建失败更难查。
 *
 * 这条与「默认用示例」不矛盾：默认走示例是**没传路径**时的正确初始状态，而
 * **传了路径却读不到**是配置错误，必须炸。把后者也兜底成示例，等于让
 * `--labels ~/typo.json` 静默产出一个不带真裁决的包。
 */
test("build-plugin：显式传的标签文件读不到时构建直接失败，不静默退回示例或空标签", async () => {
  const outDir = tmpOutDir();
  try {
    await assert.rejects(
      () => buildPlugin({ outDir, labelsPath: resolve(ROOT, "data/does-not-exist.json"), logLevel: "silent" }),
      /随包人工标签无效/,
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/**
 * 变异检验的另一半：标签文件存在但格式不对（version 不是 1，或 labels 不是数组）。
 * 这是「文件路径对了、内容却坏了」的那一类错误——比路径配错更隐蔽，因为文件
 * 确实存在，粗心的检查（比如只查文件存不存在）会漏掉它。
 */
test("build-plugin：标签文件 version 不对时构建拒绝", async () => {
  const outDir = tmpOutDir();
  const badLabelsPath = resolve(outDir, "bad-labels.json");
  writeFileSync(badLabelsPath, JSON.stringify({ version: 2, labels: [] }));
  try {
    await assert.rejects(
      () => buildPlugin({ outDir, labelsPath: badLabelsPath, logLevel: "silent" }),
      /随包人工标签无效/,
    );
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/**
 * 默认标签是随仓的合成示例，不是私有真账本。
 *
 * 这条是「公开仓 clone 下来能不能构建」的那一格：真账本 data/user-labels.json
 * 不进公开仓，那个路径根本不存在。默认读示例让「没有真账本」有一个正确、
 * 可构建、且在面板上看得见的状态。
 */
test("build-plugin：不传 labelsPath 时默认读随仓示例标签", async () => {
  const outDir = tmpOutDir();
  try {
    const { labelsRaw, labelsSource, labelsPath } = await buildPlugin({ outDir, logLevel: "silent" });
    assert.equal(labelsRaw, readFileSync(SAMPLE_LABELS_PATH, "utf8"));
    assert.equal(labelsSource, "sample");
    assert.equal(labelsPath, SAMPLE_LABELS_PATH);
    // 默认路径不许是真账本——那个文件在公开仓不存在，默认指它等于公开仓构建不了。
    assert.notEqual(labelsPath, REAL_LABELS_PATH);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/**
 * 来源判定的判别性用例。危险方向是**判定变宽**：把 labelsSourceOf 写成
 * 「调用方没传 labelsPath 就是 sample、传了就是 custom」。那样写在最常见的两条
 * 路径上碰巧都对（默认不传 → sample、传真账本 → custom），却会在
 * 「显式传示例路径」这一格把示例标签说成真账本——正好是这次要让人看得见的那件事。
 *
 * 所以 fixture 里必须有这一格：显式传示例的绝对路径、以及一条经过 ../ 绕回来的
 * 等价路径，两者都必须判成 sample；同时 examples/ 下另一个文件必须判成 custom，
 * 挡住「按目录判」这种同样偏宽的写法。
 */
test("labelsSourceOf：判据是路径指向哪份文件，不是调用方有没有传参", () => {
  assert.equal(labelsSourceOf(SAMPLE_LABELS), "sample");
  assert.equal(labelsSourceOf(SAMPLE_LABELS_PATH), "sample",
    "显式传示例路径也必须判成 sample，不能因为「传了参数」就当真账本");
  /* 这一格必须传**没有归一化过**的路径字符串：用 resolve() 先拼好再传，等于
     替被测代码把活干了，「判据没走 resolve、直接裸字符串比」这个变异就显示不出
     差别（实测过：先 resolve 再传时那个变异全绿通过）。
     用绝对路径拼 ..，不用相对路径——相对路径的结果取决于进程 cwd，
     会把一条本该确定的断言变成看运行方式的运气。 */
  assert.equal(
    labelsSourceOf(`${ROOT}/scripts/../examples/user-labels.sample.json`),
    "sample",
    "带 .. 的等价路径指的还是那份示例——判据要走 resolve，不是裸字符串相等",
  );
  assert.equal(labelsSourceOf(REAL_LABELS_PATH), "custom");
  assert.equal(labelsSourceOf(resolve(ROOT, "examples/user-labels.other.json")), "custom",
    "examples/ 下另一个文件不是那份示例，不能按目录判");
});

/**
 * 来源标记必须真的进产物：面板显示的来源来自 main.js 里的那个字面量，
 * 构建期算对了但没注入，等于面板显示不出来。跟标签内容一样，只能看产物字节，
 * 不能拿构建返回的那个变量自证。
 */
test("build-plugin：标签来源标记内联进产物，示例与自定义各自不同", async () => {
  const sampleOut = tmpOutDir();
  const customOut = tmpOutDir();
  const customLabelsPath = resolve(customOut, "custom-labels.json");
  writeFileSync(customLabelsPath, JSON.stringify({
    version: 1,
    labels: [{ nodeId: "8888:1", kind: "no-prefix", nodeNameAtLabelTime: "x" }],
  }));
  try {
    const sampleBuild = await buildPlugin({ outDir: sampleOut, logLevel: "silent" });
    assert.equal(sampleBuild.labelsSource, "sample");
    const sampleMain = readFileSync(resolve(sampleOut, "main.js"), "utf8");
    assert.ok(sampleMain.includes('"sample"'), "产物里要有 sample 来源字面量");
    assert.ok(!sampleMain.includes('"custom"'),
      "示例包里不许出现 custom 来源字面量——两档打成同一个值时，只查「有没有」抓不到");

    const customBuild = await buildPlugin({
      outDir: customOut, labelsPath: customLabelsPath, logLevel: "silent",
    });
    assert.equal(customBuild.labelsSource, "custom");
    assert.equal(customBuild.labelsPath, customLabelsPath);
    const customMain = readFileSync(resolve(customOut, "main.js"), "utf8");
    assert.ok(customMain.includes('"custom"'), "产物里要有 custom 来源字面量");
    assert.ok(customMain.includes("8888:1"), "自定义标签内容要真的进产物");
    assert.ok(!customMain.includes("__BUNDLED_LABELS_SOURCE__"),
      "define 必须已被替换掉，不能留着占位符靠运行时兜底");
  } finally {
    rmSync(sampleOut, { recursive: true, force: true });
    rmSync(customOut, { recursive: true, force: true });
  }
});
