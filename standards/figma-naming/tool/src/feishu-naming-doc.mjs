/**
 * 设计师飞书页的机器稿。前缀 / 参数 / 报警码 / 版本号从 spec.mjs + rules.mjs 出。
 * 飞书是发布件，不是第二份规范。
 */
import { PREFIXES, PARAMS, SPEC_VERSION } from "../../spec/spec.mjs";
import { RULES } from "./rules.mjs";
import { FEISHU_TABLE_LIMIT } from "./feishu-docx.mjs";

export const FEISHU_DOCUMENT_ID = "XtXudyWuToo4i0xTF0TckunbngL";
export const FEISHU_DOCUMENT_URL = `https://xd.feishu.cn/docx/${FEISHU_DOCUMENT_ID}`;

/** 合进 main 后，本机定时只盯这些文件。SHA 没变就不铺飞书。 */
export const FEISHU_SYNC_PATHS = [
  "standards/figma-naming/spec/naming-spec.md",
  "standards/figma-naming/spec/spec.mjs",
  "standards/figma-naming/tool/src/rules.mjs",
  "standards/figma-naming/tool/src/feishu-naming-doc.mjs",
  "standards/figma-naming/tool/src/feishu-docx.mjs",
];

export function decideLocalSync({ hasSecrets, currentSha, stampedSha }) {
  if (!hasSecrets) return { action: "fail", reason: "missing-secret" };
  if (!currentSha) return { action: "fail", reason: "missing-sha" };
  if (stampedSha && stampedSha === currentSha) return { action: "skip", reason: "unchanged" };
  return { action: "publish", reason: stampedSha ? "changed" : "first-run" };
}

const PREFIX_TIPS = {
  sec: "必须带编号，如 sec/1-首屏。中间可隔无前缀容器，不要分区套分区",
  fix: "侧边导航、回顶。不参与分区流。可选 @from=N：滚到第 N 屏及以下才出现",
  ref: "整棵子树忽略，里面怎么命名都不检查",
  img: "普通文字不要加这个。按语言换图 → 看「按语言换图」",
  bg: "—",
  kv: "可加 @parallax=0–1。同一父层只有一层时，改用 img/",
  btn: "@link=  @go=modal/名字  @sec=N 都选填。开弹窗抄弹窗图层名，不要写 id",
  hot: "@link=  @go=modal/名字 选填",
  modal: "必须是独立 frame，不要叠在页面稿里",
  dropmenu: "PC 开合菜单，变体精确小写 on/off，不挂 @",
  dyn: "只标容器，里面不用再标前缀",
  mix: "只标容器。里面的图由清单自动按 img/ 切，文字仍可改；scroll/ 写在里面继续滑动裁切",
  scroll: "默认横滑；纵滑写 @y。第一个子层是轨道，轨道里的图仍要命名",
  switch: "—",
  tab: "—",
  ind: "一组可以同名。同一分区里要能唯一对上一个 switch/。组件集内部变体由清单切合成形，零件不用命名",
};

const PREFIX_WHEN = {
  sec: "一屏 / 一个分区",
  fix: "钉在视口上的层",
  ref: "参考稿、示意稿",
  img: "装饰图、美术字标题",
  bg: "大面积底图",
  kv: "KV 视差分层",
  btn: "可点击",
  hot: "透明热区",
  modal: "弹窗",
  dropmenu: "PC 开合菜单",
  dyn: "倒计时、进度、今日标记",
  mix: "日历网格、活动列表等图文大块",
  scroll: "可滑动区",
  switch: "切换器 / 轮播容器",
  tab: "页签条",
  ind: "轮播圆点",
};

const PARAM_LABEL = {
  required: (name) => `@${name}=<key>`,
  int: (name) => `@${name}=<N>`,
  ratio: (name) => `@${name}=<0-1>`,
  none: (name) => `@${name}`,
};

const GROUP_ORDER = ["结构", "视觉", "交互", "复合"];
const GROUP_HEADING = { 结构: "结构", 视觉: "切图", 交互: "交互", 复合: "复合 / 行为" };

export function prefixToken(name) {
  return `${name}/`;
}

export function paramToken(name, spec = PARAMS[name]) {
  if (!spec) throw new Error(`未知参数 ${name}`);
  const fmt = PARAM_LABEL[spec.value];
  if (!fmt) throw new Error(`未知参数取值类型 ${spec.value}`);
  return fmt(name);
}

export function prefixesByGroup() {
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const [name, spec] of Object.entries(PREFIXES)) {
    const list = groups.get(spec.group);
    if (!list) throw new Error(`前缀 ${name} 的分组 ${spec.group} 不在发布稿分组里`);
    list.push({ name, spec });
  }
  return GROUP_ORDER.map((group) => ({
    group,
    heading: GROUP_HEADING[group],
    rows: groups.get(group).map(({ name, spec }) => ({
      prefix: prefixToken(name),
      when: PREFIX_WHEN[name] ?? spec.desc,
      tip: PREFIX_TIPS[name] ?? "—",
    })),
  }));
}

export function paramRows() {
  const merged = [];
  const seen = new Map();
  for (const [name, spec] of Object.entries(PARAMS)) {
    const token = paramToken(name, spec);
    const on = spec.on.map(prefixToken).join("  ");
    const key = `${[...spec.on].sort().join(",")}|${spec.value}|${spec.desc}`;
    if (spec.value === "none") {
      const bucket = seen.get(key);
      if (bucket) {
        bucket.param = `${bucket.param} / ${token}`;
        continue;
      }
    }
    const row = { param: token, on, desc: spec.desc };
    seen.set(key, row);
    merged.push(row);
  }
  return merged;
}

export function ruleRows() {
  return Object.entries(RULES).map(([code, rule]) => {
    if (!rule.fix || !String(rule.fix).trim()) {
      throw new Error(`报警码 ${code} 在 rules.mjs 里没有 fix，发布稿会漏项`);
    }
    return { code, severity: rule.severity, disposition: rule.disposition, fix: rule.fix };
  });
}

export function mustChangeRuleRows() {
  return ruleRows().filter((r) => r.disposition === "must_fix" || r.disposition === "must_answer");
}

export function confirmRuleRows() {
  return ruleRows().filter((r) => r.disposition === "confirm");
}

/** 报警按设计师看到的现象分组，不按错误码墙。codes 必须盖住 RULES 全部。 */
const RULE_TOPICS = [
  {
    heading: "图层名机器不认",
    codes: [
      "N-PREFIX-SLASH", "N-PREFIX-NOT-IN-TABLE",
      "N-PARAM-EMPTY", "N-PARAM-BAD-VALUE", "N-PARAM-UNKNOWN", "N-PARAM-MISPLACED",
    ],
  },
  {
    heading: "分区 / 导航对不上",
    codes: [
      "N-SEC-NO-NUMBER", "N-SEC-DUP-NUMBER", "N-SEC-SCATTERED", "N-SEC-NESTED",
      "N-NAV-TARGET-MISSING", "N-FIX-FROM-MISSING",
    ],
  },
  {
    heading: "轮播圆点对不上",
    codes: ["N-IND-NO-CAROUSEL", "N-IND-CAROUSEL-AMBIGUOUS"],
  },
  {
    heading: "弹窗 / 滑动 / 切图",
    codes: ["N-MODAL-INLINE", "N-SCROLL-NO-TRACK", "N-IMG-FILL-NO-NAME", "N-NAME-DUPLICATE"],
  },
];

export function topicRuleRows() {
  const byCode = new Map(ruleRows().map((row) => [row.code, row]));
  const listed = new Set(RULE_TOPICS.flatMap((topic) => topic.codes));
  const missing = Object.keys(RULES).filter((code) => !listed.has(code) && byCode.get(code)?.disposition !== "confirm");
  if (missing.length) throw new Error(`报警主题漏了必须改的码：${missing.join(", ")}`);
  const extra = [...listed].filter((code) => !byCode.has(code));
  if (extra.length) throw new Error(`报警主题写了不存在的码：${extra.join(", ")}`);
  return RULE_TOPICS.map((topic) => ({
    heading: topic.heading,
    rows: topic.codes.map((code) => {
      const row = byCode.get(code);
      return [row.code, row.fix];
    }),
  }));
}

export function chunkTable(header, bodyRows, maxRows = FEISHU_TABLE_LIMIT) {
  if (maxRows < 2) throw new Error("maxRows 必须 ≥ 2（含表头）");
  const bodyMax = maxRows - 1;
  const chunks = [];
  for (let i = 0; i < bodyRows.length; i += bodyMax) {
    chunks.push([header, ...bodyRows.slice(i, i + bodyMax)]);
  }
  return chunks.length ? chunks : [[header]];
}

export function expectedFacts() {
  return {
    version: SPEC_VERSION,
    prefixes: Object.keys(PREFIXES).map(prefixToken).sort(),
    params: Object.keys(PARAMS).sort(),
    rules: Object.keys(RULES).sort(),
  };
}

function collectText(node, into) {
  if (typeof node === "string") {
    into.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, into);
    return;
  }
  if (!node || typeof node !== "object") return;
  if (node.text) into.push(node.text);
  if (node.rows) {
    for (const row of node.rows) for (const cell of row) into.push(String(cell));
  }
}

export function flattenDocText(doc) {
  const parts = [];
  collectText(doc.blocks, parts);
  return parts.join("\n");
}

export function auditGeneratedDoc(doc, facts = expectedFacts()) {
  const errors = [];
  const text = flattenDocText(doc);
  if (!text.includes(facts.version)) errors.push(`缺版本号 ${facts.version}`);
  for (const prefix of facts.prefixes) if (!text.includes(prefix)) errors.push(`缺前缀 ${prefix}`);
  for (const name of facts.params) if (!text.includes(`@${name}`)) errors.push(`缺参数 @${name}`);
  for (const code of facts.rules) if (!text.includes(code)) errors.push(`缺报警码 ${code}`);
  return { ok: errors.length === 0, errors, facts };
}

export function extractFactsFromText(text) {
  const version = (text.match(/v\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)/) || [])[0] ?? "";
  const prefixes = [...new Set((text.match(/\b[a-z]+\/(?![a-z])/g) || []))].sort();
  const params = [...new Set((text.match(/@([a-z]+)/g) || []).map((m) => m.slice(1)))].sort();
  const rules = [...new Set(text.match(/N-[A-Z0-9-]+/g) || [])].sort();
  return { version, prefixes, params, rules };
}

function tableFact(table) {
  if (table?.fact) return table.fact;
  const header = String((table?.rows ?? table)?.[0]?.[0] ?? "");
  if (header === "前缀") return "prefix";
  if (header === "参数") return "param";
  if (header === "报警码") return "rule";
  return "";
}

function identityCells(tables, facts) {
  const want = new Set(facts);
  const cells = [];
  for (const table of tables ?? []) {
    const rows = table.rows ?? table;
    if (!want.has(tableFact(table))) continue;
    for (const row of rows.slice(1)) cells.push(String(row[0] ?? ""));
  }
  return cells;
}

/** 对账只扫契约表第一列，反例文案里的 txt/ icon/ 不算飞书多了前缀。 */
export function extractFactsFromTables(tables) {
  return {
    prefixes: [...new Set(identityCells(tables, ["prefix"]).flatMap((c) => c.match(/\b[a-z]+\/(?![a-z])/g) || []))].sort(),
    params: [...new Set(identityCells(tables, ["param"]).flatMap((c) => [...c.matchAll(/@([a-z]+)/g)].map((m) => m[1])))].sort(),
    rules: [...new Set(identityCells(tables, ["rule"]).flatMap((c) => c.match(/N-[A-Z0-9-]+/g) || []))].sort(),
  };
}

export function extractFactsFromDoc(doc) {
  const tables = (doc.blocks ?? []).filter((b) => b.type === "table");
  const version = flattenDocText(doc).match(/v\d+\.\d+\s*\(\d{4}-\d{2}-\d{2}\)/)?.[0] ?? "";
  return { ...extractFactsFromTables(tables), version };
}

export function diffFacts(actual, expected = expectedFacts()) {
  const missing = (want, got) => want.filter((x) => !got.includes(x));
  const extra = (want, got) => got.filter((x) => !want.includes(x));
  const errors = [];
  if (actual.version !== expected.version) {
    errors.push(`版本号不一致：飞书「${actual.version || "无"}」仓内「${expected.version}」`);
  }
  for (const p of missing(expected.prefixes, actual.prefixes)) errors.push(`飞书缺前缀 ${p}`);
  for (const p of extra(expected.prefixes, actual.prefixes)) errors.push(`飞书多了前缀 ${p}`);
  for (const p of missing(expected.params, actual.params)) errors.push(`飞书缺参数 @${p}`);
  for (const p of extra(expected.params, actual.params)) errors.push(`飞书多了参数 @${p}`);
  for (const p of missing(expected.rules, actual.rules)) errors.push(`飞书缺报警码 ${p}`);
  for (const p of extra(expected.rules, actual.rules)) errors.push(`飞书多了报警码 ${p}`);
  return { ok: errors.length === 0, errors, expected, actual };
}

export function buildDesignerDoc() {
  const facts = expectedFacts();
  const missingTips = Object.keys(PREFIXES).filter((name) => !PREFIX_TIPS[name] || !PREFIX_WHEN[name]);
  if (missingTips.length) throw new Error(`这些前缀没有设计师版文案：${missingTips.join(", ")}`);

  const blocks = [
    { type: "h1", text: "设计稿命名规范" },
    { type: "quote", text: `${facts.version}　设计师阅读版。规则与机器判定同一套。本页只读，改规则走 Git。` },
    { type: "p", text: "格式：前缀/名称[@参数]　　例：sec/1-首屏、img/装饰、btn/下载@sec=2" },
    { type: "divider" },
    { type: "h2", text: "先看这一页" },
    { type: "p", text: "只给前端真正要消费的层加前缀。纯容器、纯编组保持原名。" },
    { type: "p", text: "判断标准：前端要不要知道这层是什么，才能正确接入？" },
    { type: "bullet", text: "切成图 → img/　bg/　kv/" },
    { type: "bullet", text: "点击 / 滑动 / 切换 → btn/　hot/　scroll/　switch/　tab/　ind/　modal/　dropmenu/" },
    { type: "bullet", text: "按屏拆分 / 钉在视口 → sec/　fix/" },
    { type: "bullet", text: "参考稿、示意稿 → ref/（整棵子树忽略）" },
    { type: "bullet", text: "都不需要 → 不加前缀" },
    { type: "quote", text: "漏标该消费的层、或标了机器认不出，才是问题。覆盖率低不是问题。" },
    { type: "divider" },
    { type: "h2", text: "前缀总表" },
  ];

  for (const group of prefixesByGroup()) {
    blocks.push({ type: "h3", text: group.heading });
    blocks.push({
      type: "table",
      fact: "prefix",
      rows: [["前缀", "什么时候用", "写法要点"], ...group.rows.map((r) => [r.prefix, r.when, r.tip])],
    });
    if (group.group === "视觉") {
      blocks.push({ type: "quote", text: "命名就是切图意图。Export 勾选只影响你自己导出预览或改格式/倍率，不决定这层是不是切图。" });
    }
    if (group.group === "交互") {
      blocks.push({ type: "quote", text: "点击后跳哪、开哪一态，由下游配置决定，不必写进图层名。" });
    }
  }

  blocks.push(
    { type: "divider" },
    { type: "h2", text: "文字" },
    { type: "bullet", text: "普通文案：不加任何前缀。TEXT 节点本身已说明它是字，改字就能换文案。" },
    { type: "bullet", text: "美术字切图：用 img/，例如 img/标题字。一旦加了 img/、bg/、kv/，就按图切，不再当可改文案。" },
    { type: "bullet", text: "不要写 txt/。规范不收这个前缀。" },
    { type: "divider" },
    { type: "h2", text: "写法" },
    { type: "h3", text: "约定与容错" },
    { type: "p", text: "约定写法：小写 + 半角斜杠，如 img/装饰。" },
    {
      type: "table",
      rows: [
        ["可以", "不行"],
        ["IMG/、Sec/（大小写无所谓）", "反斜杠 \\"],
        ["img / 装饰、img／装饰（半角或全角斜杠）", "自造前缀：icon/、part/、txt/ 等总表没有的词"],
        ["Figma 自动名 Group/2、文案里自带斜杠", "斜杠前是英文词、但不在总表里"],
      ],
    },
    { type: "quote", text: "总表外的「词/」机器当没标。改成总表前缀，或去掉斜杠前的英文词。" },
    { type: "h3", text: "@参数" },
    {
      type: "table",
      fact: "param",
      rows: [["参数", "可挂前缀", "作用"], ...paramRows().map((r) => [r.param, r.on, r.desc])],
    },
    { type: "divider" },
    { type: "h2", text: "按语言换图" },
    { type: "p", text: "同一张装饰图要跟页面语言换时用。" },
    { type: "bullet", text: "对：组件集 img/模块2可替换素材；变体属性名 lang；值小写 cn / tw / en / jp / kr；变体层保持 lang=cn。" },
    { type: "bullet", text: "错：写 @lang；值写成 CN / zh-CN；属性叫 Property 1；只有一个变体；把变体改成 img/标题-cn。" },
    { type: "quote", text: "没画的语言不挡清单。缺图不要回落中文图。" },
    { type: "divider" },
    { type: "h2", text: "场景对照" },
    { type: "h3", text: "分区 sec/" },
    { type: "bullet", text: "对：sec/1-首屏、sec/2-角色。编号连续、不重复。" },
    { type: "bullet", text: "错：没编号；两个分区同一个号；分区套分区；分区散在互不相干的父层里。" },
    { type: "quote", text: "中间隔着无前缀的 Frame / Group 没关系。" },
    { type: "h3", text: "轮播 switch/ · tab/ · ind/" },
    { type: "bullet", text: "对：switch/ 是容器，tab/ 是页签，ind/ 是圆点。一组 ind/ 可以同名。套在对应 switch/ 里，或旁边只有一个 switch/。" },
    { type: "bullet", text: "错：分区里没有轮播，或有多个却对不上。组件库定义不参与配对，页面上的实例要。" },
    { type: "h3", text: "滑动 scroll/" },
    { type: "bullet", text: "对：第一个子层是内容轨道；轨道里的图仍标 img/、bg/、kv/。" },
    { type: "bullet", text: "错：空容器；以为外层是 scroll/ 里面的图就不用命名。" },
    { type: "h3", text: "图文混排 mix/" },
    { type: "bullet", text: "对：只标容器。里面的图不用再标前缀，清单会自动按 img/ 切。字仍当可改文案。" },
    { type: "bullet", text: "错：整块切 mix/；scroll/ 写在 mix/ 里却整块切图。" },
    { type: "h3", text: "弹窗 modal/" },
    { type: "bullet", text: "对：做成独立 frame。" },
    { type: "bullet", text: "错：直接叠在页面稿里。" },
    { type: "h3", text: "KV 视差" },
    { type: "bullet", text: "对：同一父层有多层，各自声明 @parallax=。" },
    { type: "bullet", text: "错：只有一层还标 kv/。那种用 img/。" },
    { type: "h3", text: "有图填充但没前缀" },
    { type: "bullet", text: "对：带图像填充的叶子标 img/、bg/、kv/。ind/ 里的小圆点不用再标。" },
    { type: "bullet", text: "错：ind/ 里又套了 btn/ 却当圆点免标。那种仍按 btn/。" },
    { type: "h3", text: "同名" },
    { type: "bullet", text: "对：同一页里不同图层用能说明身份的名字。" },
    { type: "bullet", text: "错：两个图层完全同名；靠 img/头像-1、img/头像-2 区分。ref/ 子树和组件变体的强制名除外。" },
    { type: "divider" },
    { type: "h2", text: "报警对照" },
    { type: "quote", text: "P0 / P1 必须改。P2 是提醒，不改也不一定错。" },
  );

  for (const topic of topicRuleRows()) {
    blocks.push({ type: "h3", text: topic.heading });
    for (const chunk of chunkTable(["报警码", "你要做什么"], topic.rows)) {
      blocks.push({ type: "table", fact: "rule", rows: chunk });
    }
  }
  blocks.push({ type: "h3", text: "核对即可" });
  for (const chunk of chunkTable(["报警码", "你要做什么"], confirmRuleRows().map((r) => [r.code, r.fix]))) {
    blocks.push({ type: "table", fact: "rule", rows: chunk });
  }
  blocks.push(
    { type: "divider" },
    { type: "h2", text: "不要做" },
    { type: "bullet", text: "给纯容器、纯编组硬加前缀" },
    { type: "bullet", text: "给普通文案加 txt/ 或任何前缀" },
    { type: "bullet", text: "自造 icon/、part/、title/ 这类总表没有的词" },
    { type: "bullet", text: "用 Export 勾选代替 img/、bg/、kv/" },
    { type: "bullet", text: "把弹窗画在页面稿里" },
    { type: "bullet", text: "把参考/示意稿混进正稿还不标 ref/" },
    { type: "bullet", text: "在飞书上直接改这页（改了也会被 Git 覆盖）" },
  );

  return {
    title: "设计稿命名规范",
    documentId: FEISHU_DOCUMENT_ID,
    documentUrl: FEISHU_DOCUMENT_URL,
    version: facts.version,
    blocks,
  };
}
