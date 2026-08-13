/**
 * report.mjs — findings → 终端摘要 / Markdown 报告 / JSON。
 *
 * 分区依据是 disposition（有没有可接受的出路），不是 severity。
 * 理由：设计师要先知道「哪些必须改」，再决定花多少时间在「需要判断」的那批上。
 */
import { RULES, SEVERITIES, DISPOSITION_LABEL } from "./rules.mjs";
import { SPEC_VERSION, SPEC_DOC, ASSUMPTIONS_VERSION, ASSUMPTIONS_DOC, PREFIXES, DISPOSITIONS } from "./spec.mjs";

const SEV_LABEL = { P0: "P0 阻断", P1: "P1 返工", P2: "P2 建议" };
const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", yellow: "\x1b[33m", blue: "\x1b[36m", green: "\x1b[32m",
};
const SEV_COLOR = { P0: C.red, P1: C.yellow, P2: C.blue };
const DISP_COLOR = { must_fix: C.red, must_answer: C.yellow, confirm: C.blue };

export function figmaLink(fileKey, nodeId) {
  if (!fileKey || !nodeId) return null;
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeId.replace(/:/g, "-")}`;
}

/** 按 disposition → code 分组，组内按 severity 排 */
function group(findings) {
  const out = new Map();
  for (const disp of DISPOSITIONS) {
    const inDisp = findings.filter((f) => f.disposition === disp);
    if (!inDisp.length) continue;
    const byCode = new Map();
    for (const f of inDisp) {
      if (!byCode.has(f.code)) byCode.set(f.code, []);
      byCode.get(f.code).push(f);
    }
    out.set(disp, [...byCode.entries()].sort((a, b) =>
      SEVERITIES.indexOf(RULES[a[0]].severity) - SEVERITIES.indexOf(RULES[b[0]].severity)
      || b[1].length - a[1].length));
  }
  return out;
}

/**
 * 组件实例内的 finding 按「组件 + 问题特征 + 实例内位置」归并。
 *
 * 归并键为什么是这四段（少任何一段都会漏）：
 *   componentId    同一主组件才可能「改一次消一批」
 *   code           不同问题是不同的修复动作
 *   实例内位置索引  真稿里一个实例内有 2 个同名的「小钻石 1」，只用名字会把两个修复点合成一个
 *   图层名          位置相同但名字不同 = 该实例被 override 改过名，是实例特有的真问题，
 *                  只用位置会把它藏进主组件那一行
 * 键内条数才是「改一次消一批」的真实批量，且必然等于受影响的实例数。
 */
export function groupByComponent(findings) {
  const groups = new Map();
  const standalone = [];
  for (const f of findings) {
    if (!f.instance) { standalone.push(f); continue; }
    const key = `${f.instance.componentId ?? "?"}::${f.code}::${(f.instance.path ?? []).join(".")}::${f.name}`;
    if (!groups.has(key)) {
      groups.set(key, {
        componentId: f.instance.componentId ?? null, instanceName: f.instance.name,
        code: f.code, layerName: f.name,
        instancePath: (f.instance.pathNames ?? []).join(" / "), items: [],
      });
    }
    groups.get(key).items.push(f);
  }
  return { groups: [...groups.values()].sort((a, b) => b.items.length - a.items.length), standalone };
}

/** 报告数 vs 实际要做的动作数。默认排除已豁免项；includeExempted 保留全量入口。 */
export function actionCount(findings, { includeExempted = false } = {}) {
  const counted = includeExempted ? findings : findings.filter((finding) => !finding.exemptedBy);
  const { groups, standalone } = groupByComponent(counted);
  return { findings: counted.length, actions: groups.length + standalone.length, componentGroups: groups.length, standalone: standalone.length };
}

function rootLine(result) {
  const r = result.root ?? {};
  const bits = [`体检根 = ${r.name ?? "?"}${r.type ? `（${r.type}）` : ""}`];
  bits.push(`直接子层 sec/ ${r.directSec ?? 0} 个`);
  bits.push(`子树内 sec/ 共 ${r.secTotal ?? 0} 个`);
  return bits.join(" · ");
}

export function renderTerminal(result, meta, { maxPerCode = 3, color = true } = {}) {
  const c = color ? C : Object.fromEntries(Object.keys(C).map((k) => [k, ""]));
  const dispColor = color ? DISP_COLOR : { must_fix: "", must_answer: "", confirm: "" };
  const sevColor = color ? SEV_COLOR : { P0: "", P1: "", P2: "" };
  const L = [];
  const { stats, counts, findings, byDisposition } = result;

  L.push(`${c.bold}figma-naming-lint${c.reset} · ${meta.frameName ?? "?"}${meta.frameSize ? ` ${meta.frameSize}` : ""} · 规范 ${SPEC_VERSION} · 假定 ${ASSUMPTIONS_VERSION}`);
  L.push(`${c.dim}${rootLine(result)}${c.reset}`);
  for (const w of result.root?.warnings ?? []) {
    L.push(`${c.red}⚠ ${w.replace(/`/g, "")}${c.reset}`);
  }
  L.push(`${c.dim}扫描 ${stats.nodes} 层，其中带前缀 ${stats.prefixed} 层`
    + (stats.refSubtrees ? `；跳过 ref/ 子树 ${stats.refSubtrees} 处（${stats.refNodesSkipped} 层）` : "")
    + `${c.reset}`);
  L.push("");

  if (!findings.length) {
    L.push(`${c.green}✔ 未发现命名问题${c.reset}`);
    return L.join("\n");
  }

  const act = actionCount(findings);
  L.push(DISPOSITIONS.filter((d) => byDisposition?.[d])
    .map((d) => `${dispColor[d]}${DISPOSITION_LABEL[d]} ${byDisposition[d]}${c.reset}`)
    .join(c.dim + " · " + c.reset)
    + `${c.dim}   （${SEVERITIES.map((s) => `${SEV_LABEL[s]} ${counts[s]}`).join(" / ")}）${c.reset}`);
  L.push(`${c.dim}${act.findings} 条报警 = ${act.standalone} 处逐个改 + ${act.componentGroups} 个组件改一次${c.reset}`);
  L.push("");

  for (const [disp, codes] of group(findings)) {
    L.push(`${dispColor[disp]}${c.bold}【${DISPOSITION_LABEL[disp]}】${c.reset}`);
    for (const [code, list] of codes) {
      const r = RULES[code];
      L.push(`  ${sevColor[r.severity]}${r.severity}${c.reset} ${c.bold}${code}${c.reset} ${r.title} ${c.dim}×${list.length}${r.basis === "heuristic" ? " 启发式" : ""}${c.reset}`);
      for (const f of list.slice(0, maxPerCode)) {
        L.push(`     ${c.dim}·${c.reset} ${shortPath(f.path)}${f.suggestion ? ` ${c.dim}→ ${f.suggestion}${c.reset}` : ""}`);
      }
      if (list.length > maxPerCode) L.push(`     ${c.dim}… 另 ${list.length - maxPerCode} 条见报告${c.reset}`);
    }
    L.push("");
  }
  return L.join("\n").trimEnd();
}

export function renderMarkdown(result, meta) {
  const { stats, counts, findings, byDisposition } = result;
  const L = [];
  const link = (f) => {
    const url = figmaLink(meta.fileKey, f.nodeId);
    return url ? `[${escapePipe(shortPath(f.path))}](${url})` : escapePipe(shortPath(f.path));
  };

  L.push(`# 设计稿命名体检报告`);
  L.push("");
  L.push(`| 项 | 值 |`, `|---|---|`);
  L.push(`| 稿件 | ${meta.frameName ?? "?"}${meta.frameSize ? ` · ${meta.frameSize}` : ""} |`);
  L.push(`| 体检根自检 | ${escapePipe(rootLine(result))} |`);
  for (const w of result.root?.warnings ?? []) L.push(`| ⚠ 选根警告 | ${escapePipe(w)} |`);
  if (meta.fileKey) L.push(`| Figma | \`${meta.fileKey}\` / \`${meta.nodeId}\` |`);
  if (meta.lastModified) L.push(`| 稿件最后修改 | ${meta.lastModified} |`);
  L.push(`| 体检时间 | ${meta.generatedAt} |`);
  L.push(`| 依据规范 | ${SPEC_VERSION} — \`${SPEC_DOC}\` |`);
  L.push(`| 下游假定 | ${ASSUMPTIONS_VERSION} — \`${ASSUMPTIONS_DOC}\` |`);
  L.push(`| 扫描规模 | ${stats.nodes} 层（带前缀 ${stats.prefixed} 层${stats.refSubtrees ? `；跳过 ref/ 子树 ${stats.refSubtrees} 处 / ${stats.refNodesSkipped} 层` : ""}） |`);
  if (findings.length) {
    const act = actionCount(findings);
    L.push(`| 结论 | ${DISPOSITIONS.filter((d) => byDisposition?.[d]).map((d) => `**${DISPOSITION_LABEL[d]} ${byDisposition[d]}**`).join(" · ")} |`);
    L.push(`| 实际动作 | ${act.findings} 条报警 = ${act.standalone} 处逐个改 + ${act.componentGroups} 个组件改一次 |`);
    L.push(`| 严重度分布 | ${SEVERITIES.map((s) => `${SEV_LABEL[s]} ${counts[s]}`).join(" · ")} |`);
  } else {
    L.push(`| 结论 | 未发现命名问题 |`);
  }
  L.push("");

  if (!findings.length) {
    L.push("## ✔ 未发现命名问题");
    L.push("");
  } else {
    L.push("> **处置分档**：必须改 = 唯一出路是改命名或去标记；必须回答 = 存在显式接受路径但不能忽略；核实一下 = 不改也不一定错。");
    L.push("> 标「启发式」的规则是按经验推断意图，不是语法或结构矛盾直接判定的，请按提示自行判断。");
    L.push("");
    for (const [disp, codes] of group(findings)) {
      L.push(`## ${DISPOSITION_LABEL[disp]}（${byDisposition[disp]} 条）`);
      L.push("");
      for (const [code, list] of codes) {
        const r = RULES[code];
        L.push(`### \`${code}\` ${r.title} — ${list.length} 条`);
        L.push("");
        L.push(`- **级别**：${SEV_LABEL[r.severity]} ｜ **依据性质**：${r.basis === "heuristic" ? "启发式（经验推断）" : "确定（语法/结构矛盾）"}`);
        L.push(`- **不改会怎样**：${r.why}`);
        L.push(`- **怎么改**：${r.fix}`);
        L.push(`- **规范依据**：\`${SPEC_DOC}\` ${r.spec} ｜ **依赖假定**：${(r.assumes ?? []).join(" ")} （见 \`${ASSUMPTIONS_DOC}\`）`);
        L.push("");
        L.push(`| 图层 | 类型 | 说明 | 建议 |`, `|---|---|---|---|`);
        for (const f of list) {
          L.push(`| ${link(f)}${f.instance ? ` ${escapePipe(`〔实例 ${f.instance.name}〕`)}` : ""} | ${f.type} | ${escapePipe(f.detail)} | ${f.suggestion ? `\`${escapePipe(f.suggestion)}\`` : "—"} |`);
        }
        L.push("");
      }
    }

    const { groups } = groupByComponent(findings);
    if (groups.length) {
      L.push("## 按组件归并（改一次消一批）");
      L.push("");
      L.push("> 组件实例内部的层名继承主组件，在每个实例里逐个改名不现实。归并键是「组件 + 错误码 + 实例内位置」——只按组件归会把被 override 单独改过的实例藏起来，只用图层名会把同组件内多个同名图层合成一个修复点。");
      L.push("");
      L.push(`| 主组件 | 错误码 | 实例内位置 | 影响实例数 |`, `|---|---|---|---|`);
      for (const g of groups) {
        L.push(`| \`${g.componentId ?? "?"}\` ${escapePipe(g.instanceName)} | \`${g.code}\` | ${escapePipe(g.instancePath || g.layerName)} | ${g.items.length} |`);
      }
      L.push("");
    }
  }

  L.push("## 命名分布（信息项，非错误）");
  L.push("");
  L.push("> 规范 §0：只有前端接入时要消费的层才需要前缀，纯容器/结构组保持原名即可。**覆盖率低本身不是问题**，这里只是给个全局手感。");
  L.push("");
  L.push(`| 前缀 | 含义 | 数量 |`, `|---|---|---|`);
  for (const [p, def] of Object.entries(PREFIXES)) {
    L.push(`| \`${p}/\` | ${def.desc} | ${stats.byPrefix[p] ?? 0} |`);
  }
  L.push(`| — | 无前缀（含纯容器） | ${stats.nodes - stats.prefixed} |`);
  L.push("");
  L.push(`TEXT 图层共 ${stats.texts} 个（§3：TEXT 不需要前缀）；声明切图意图的节点 ${stats.sliceIntents} 个；位于组件实例内部的层 ${stats.inInstance} 个。`);
  L.push("");
  return L.join("\n");
}

/** 路径太长时保留头尾 */
function shortPath(path, keep = 3) {
  const parts = String(path).split(" / ");
  if (parts.length <= keep + 1) return parts.join(" / ");
  return `${parts[0]} / … / ${parts.slice(-keep).join(" / ")}`;
}

const escapePipe = (s) => String(s ?? "").replace(/\|/g, "\\|");
