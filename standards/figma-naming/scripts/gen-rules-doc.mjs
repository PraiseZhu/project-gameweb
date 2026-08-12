#!/usr/bin/env node
/**
 * gen-rules-doc.mjs — 从 src/rules.mjs 生成 docs/RULES.md。
 *
 * 规则**元信息**（code / severity / disposition / basis / assumes）的事实来源是
 * 规范 §6 的清单表；`why` / `fix` 的事实来源是 rules.mjs。本文件只做渲染，产物不要手改。
 * 用法：npm run rules
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RULES, SEVERITIES, DISPOSITION_LABEL } from "../src/rules.mjs";
import {
  SPEC_VERSION, SPEC_DOC, ASSUMPTIONS_VERSION, ASSUMPTIONS_DOC,
  PREFIXES, PARAMS, DISPOSITIONS, NON_PREFIX_WORDS, PREFIX_SYNTAX,
} from "../src/spec.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEV_LABEL = { P0: "P0 阻断", P1: "P1 返工", P2: "P2 建议" };
const L = [];

L.push("# 检查规则表");
L.push("");
L.push("> 本文件由 `npm run rules` 从 `src/rules.mjs` 生成，**不要手改**。");
L.push(`> 依据规范：${SPEC_VERSION} — \`${SPEC_DOC}\``);
L.push(`> 下游假定：${ASSUMPTIONS_VERSION} — \`${ASSUMPTIONS_DOC}\``);
L.push("");
L.push("## 三个维度");
L.push("");
L.push("**严重度** —— 有多严重：");
L.push("");
L.push("| 级别 | 含义 |");
L.push("|---|---|");
L.push("| P0 | 声明的意图会被静默丢弃或产出错误结果，且不会报错（不改 = 埋雷）；CLI 退出码 1 |");
L.push("| P1 | 能接进去，但要靠猜，产出与预期不符，需要人回来对 |");
L.push("| P2 | 不影响本轮接入，影响后续可维护性（多语言、改稿成本） |");
L.push("");
L.push("**处置** —— 有没有可接受的出路（报告与插件按这个分区）：");
L.push("");
L.push("| 处置 | 含义 |");
L.push("|---|---|");
L.push("| `must_fix` | 唯一正确的出路是改命名或去掉标记，没有「保持现状也对」这一路 |");
L.push("| `must_answer` | 存在显式的接受路径，但必须给出答案，不能忽略 |");
L.push("| `confirm` | 不改也不一定错，只需核实 |");
L.push("");
L.push("**依据性质** —— `deterministic` 由语法或结构矛盾直接判定；`heuristic` 由经验规则推断意图。");
L.push("**启发式规则不允许是 `must_fix`**（测试强制），因为推断出来的东西不该用判决口吻。");
L.push("");
L.push("## 总表");
L.push("");
L.push("| 错误码 | 标题 | 级别 | 处置 | 依据性质 | 规范条 | 依赖假定 |");
L.push("|---|---|---|---|---|---|---|");
for (const [code, r] of Object.entries(RULES)) {
  L.push(`| \`${code}\` | ${r.title} | ${r.severity} | ${r.disposition} | ${r.basis} | ${r.spec} | ${(r.assumes ?? []).join(" ")} |`);
}
L.push("");

for (const disp of DISPOSITIONS) {
  const entries = Object.entries(RULES).filter(([, r]) => r.disposition === disp);
  if (!entries.length) continue;
  L.push(`## ${DISPOSITION_LABEL[disp]} · \`${disp}\`（${entries.length} 条）`);
  L.push("");
  for (const sev of SEVERITIES) {
    for (const [code, r] of entries.filter(([, x]) => x.severity === sev)) {
      L.push(`### \`${code}\` ${r.title}`);
      L.push("");
      L.push(`- **级别**：${SEV_LABEL[r.severity]} ｜ **依据性质**：${r.basis === "heuristic" ? "启发式（经验推断意图）" : "确定（语法/结构矛盾）"} ｜ **层面**：${r.layer}层`);
      L.push(`- **不改会怎样**：${r.why}`);
      L.push(`- **怎么改**：${r.fix}`);
      L.push(`- **规范依据**：\`${SPEC_DOC}\` ${r.spec} ｜ **依赖假定**：${(r.assumes ?? []).join(" ")}（见 \`${ASSUMPTIONS_DOC}\`）`);
      L.push("");
    }
  }
}

L.push("## 前缀总表（机器可读镜像）");
L.push("");
L.push("| 前缀 | 分类 | 含义 | 可挂 @参数 | 约束 |");
L.push("|---|---|---|---|---|");
for (const [p, d] of Object.entries(PREFIXES)) {
  const cons = [
    d.slice && "命名即切图",
    d.structural && "结构语义",
    d.topLevelOnly && "只能在体检根直接子层",
    d.requireAncestor && `必须位于 \`${d.requireAncestor}/\` 内`,
    d.exemptSubtree === "ALL" && "整个子树忽略",
    d.exemptSubtree === "NAMING" && "子树免前缀语法/免图像未命名报警",
  ].filter(Boolean);
  L.push(`| \`${p}/\` | ${d.group} | ${d.desc} | ${d.params.length ? d.params.map((x) => `\`@${x}\``).join(" ") : "—"} | ${cons.join("；") || "—"} |`);
}
L.push("");
L.push("## @参数表（机器可读镜像）");
L.push("");
L.push("| 参数 | 取值 | 可用前缀 | 作用 |");
L.push("|---|---|---|---|");
const VAL = { required: "必填，任意字符串", int: "必填，正整数", ratio: "必填，0–1 的数", none: "纯标记，不带值" };
for (const [k, v] of Object.entries(PARAMS)) {
  L.push(`| \`@${k}\` | ${VAL[v.value]} | ${v.on.map((x) => `\`${x}/\``).join(" ")} | ${v.desc} |`);
}
L.push("");
L.push("## 前缀形态判定参数（规范 §4.1 镜像）");
L.push("");
L.push("| 参数 | 值 |");
L.push("|---|---|");
L.push(`| 斜杠前英文词最短长度 | ${PREFIX_SYNTAX.minWordLen} |`);
L.push(`| 视作分隔符 | ${PREFIX_SYNTAX.separators.map((s) => `\`${s}\``).join(" ")} |`);
L.push(`| 短词长度上限 | ${PREFIX_SYNTAX.shortWordMaxLen} |`);
L.push(`| 短词拼错阈值 | ${PREFIX_SYNTAX.typoThresholdShort} |`);
L.push(`| 长词拼错阈值 | ${PREFIX_SYNTAX.typoThresholdLong} |`);
L.push("");
L.push("排除词表（规范 §4.2）——出现在斜杠前时不算在用前缀：");
L.push("");
L.push([...NON_PREFIX_WORDS].map((w) => `\`${w}\``).join(" "));
L.push("");
L.push("## 有意不检查的（避免误报）");
L.push("");
L.push("| 不检查 | 原因 |");
L.push("|---|---|");
L.push("| 命名覆盖率低 | 规范 §0：只有前端接入时要消费的层才需要前缀，纯容器/结构组保持原名即可。报告里只作信息项呈现。 |");
L.push("| 斜杠前是 Figma 自动名或含数字（`Group/2`、`04/10`、`Frame 12/copy`） | 规范 §4.1/§4.2：斜杠是合法字符，不等于在用前缀语法。 |");
L.push("| 非 ASCII 的疑似前缀（`按钮/确定`） | 规范 §4.1：无法区分「中文前缀」与「名字里本来就有斜杠」，暂不判定。 |");
L.push("| TEXT 图层没有前缀 | 规范 §3：节点类型本身已说明它是文字，前缀重复。 |");
L.push("| `btn/` 没带动作参数 | 规范 §1：点击后的行为由下游配置决定（假定 A3），不属于命名规范职责。 |");
L.push("| 文案 key 的生成与命名风格 | 假定 A6：本工具不规定 key 如何生成，那是下游的事。 |");
L.push("| `ref/` 子树内的一切 | 规范 §1：整个子树忽略——不检查、不报警。 |");
L.push("| `dyn/` `mix/` 子树的前缀与图像未命名问题 | 规范 §1：子树免前缀语法、免图像未命名报警。 |");
L.push("| 已有任何识别前缀的节点的「该切没命名」 | 设计师已经声明过这层是什么，再报就是噪音。 |");
L.push("| Figma Export 勾选与资产身份 | 规范 §5：Export 只是人工导出设置，不是资产契约；本工具只按命名前缀识别切图意图。 |");
L.push("");

mkdirSync(resolve(ROOT, "docs"), { recursive: true });
const out = resolve(ROOT, "docs/RULES.md");
writeFileSync(out, L.join("\n"));
console.log(`✔ docs/RULES.md（${Object.keys(RULES).length} 条规则）`);
