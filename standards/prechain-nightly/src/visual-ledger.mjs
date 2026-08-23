/**
 * 50 轮对照规范稿后的人读台账。只沉淀缺口模式和 Skill 已有改法，不写 evolution/ledger.json。
 */

export function howToFix(problem) {
  const text = String(problem || "");
  if (/裁切层里的奖励图|scroll\/奖励/.test(text)) {
    return "划动框才是 scroll/，框里的奖励图是 img/。先写对母版/轨道图；已经错写成 scroll/ 的 determined 层本轮不能覆写，记缺口下轮从 unknown 写 img/。";
  }
  if (/母版组件集未命名/.test(text)) {
    return "先给组件集母版写前缀，子件机器跟随；不要只给实例/子件加 btn/。";
  }
  if (/(头像|导航状态|多语言切换|切换按钮)/.test(text) && /btn\//.test(text)) {
    return "选中/未选中状态组件集写 btn/，先写母版再跟随。";
  }
  if (/父级已是 img/.test(text) && /立绘|素材图|边框背景|背景边框/.test(text)) {
    return "有 img 祖先时不抬二层 img/。立绘作为内部零件保持 unnamed；机械收口和 class-roles 不能写在剥离内部零件之后把前缀盖回去。";
  }
  if (/标题装饰/.test(text) || (/FRAME/.test(text) && /标题/.test(text) && /img/.test(text))) {
    return "有字的标题框不要 img/。规范稿父级只叫标题，切图写在标题装饰 RECTANGLE 上。";
  }
  if (/立绘|素材图|边框背景|背景边框/.test(text) && /unknown|卡片视觉/.test(text)) {
    return "按 Skill 钉死 2：无 img 祖先的立绘/素材图/边框背景是切图 img/，不要空判。";
  }
  if (/弹窗/.test(text)) return "按 Skill：弹窗附件前缀 modal/，不靠 page 切片才写。";
  if (/缺前缀类：/.test(text) && /\bdyn\b/.test(text)) return "按已沉淀形态：今日标记 dyn/，不要写成 ind/。";
  if (/缺前缀类：/.test(text) && /\bmix\b/.test(text)) return "按已沉淀形态：日历外层多层背景用 mix/，划动裁切层才是 scroll/。";
  if (/缺前缀类：/.test(text) && /\btab\b/.test(text)) return "按已沉淀形态：头像切换外围是 tab/，头像单项是 btn/。";
  if ((/缺前缀类：/.test(text) && /\bbg\b/.test(text)) || /backgrounds 为空/.test(text)) {
    return "页背景实例/组件写成 bg/，写回后重建 backgrounds 索引。";
  }
  if (/父级已是 img/.test(text)) return "内部卡牌/icon/一级边框不抬 img/。";
  if (/false-pass/.test(text) || /本稿同类漏前缀/.test(text)) {
    return "完整性绿不够：对照规范稿仍有漏/错前缀的层。按已沉淀形态补，不按图层 id 抄名；视觉评分必须审计写回后的稿，不要再跑机器前置洗绿。";
  }
  return "对照 Skill 已沉淀形态和 completeness 闸门改，不新增步骤。";
}

function problemKey(problem) {
  return String(problem || "").replace(/I?\d+:\d+(?:;\d+(?::\d+)?)*/g, "<id>").trim();
}

function addCount(counts, problem) {
  const key = problemKey(problem);
  if (!key) return;
  counts.set(key, (counts.get(key) || 0) + 1);
}

export function collectGapRows(attempted) {
  const counts = new Map();
  for (const row of attempted || []) {
    for (const problem of row.cliProblems || []) addCount(counts, problem);
    for (const page of row.pages || []) {
      for (const problem of page.completenessProblems || []) addCount(counts, problem);
      for (const role of page.missingClasses || []) addCount(counts, `相对规范稿缺前缀类：${role}`);
      for (const miss of page.mismatches || []) {
        if (miss?.absentFromDraft) continue;
        const body = miss.body || miss.id || "?";
        const gold = miss.goldRole || "?";
        const got = miss.recoveredRole || miss.recoveredStatus || "unknown";
        addCount(counts, `本稿同类漏前缀：${body} 规范 ${gold}/ 本稿 ${got}`);
      }
    }
  }
  return [...counts.entries()]
    .map(([problem, count]) => ({ problem, count, fix: howToFix(problem) }))
    .sort((a, b) => b.count - a.count || a.problem.localeCompare(b.problem));
}

export function renderVisualLedger({ date, expected, attempted, done, unproven, gaps, notes }) {
  const lines = [
    `# 前置链路 ${date} 人读台账`,
    "",
    "首要条件：自动流程严格按照手动 Skill「未规范稿次日开跑」执行。人确认前不写 evolution/ledger.json。",
    "",
    `- 计划轮次：${expected}`,
    `- 已证明：${done}`,
    `- 已尝试：${attempted}`,
    `- 未证明：${unproven}`,
    "",
  ];
  if (notes?.length) {
    lines.push("## 已确认根因（跨轮复用）", "");
    for (const note of notes) lines.push(`- ${note}`);
    lines.push("");
  }
  lines.push("## 反复缺口与改法", "");
  if (!gaps.length) {
    lines.push("本批没有可沉淀的反复缺口。");
  } else {
    lines.push("| 次数 | 问题 | 如何修改 |");
    lines.push("|---:|---|---|");
    for (const row of gaps) {
      const problem = String(row.problem).replaceAll("|", "/");
      const fix = String(row.fix).replaceAll("|", "/");
      lines.push(`| ${row.count} | ${problem} | ${fix} |`);
    }
  }
  lines.push("");
  lines.push("人确认判断已完成前，禁止把口径写入 SKILL 与 evolution/ledger.json。");
  lines.push("");
  return lines.join("\n");
}
