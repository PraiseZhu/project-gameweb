/**
 * triage.mjs — 把「需要确认」那一档分流：哪些该 agent 看图定，哪些只有人知道。
 *
 * 起因（用户 2026-08-11）：插件在火炬页给出「可直接改 154 · 需确认 93」，
 * 那 93 条全推给人。但其中大部分不是真两可，是判据没把握——而「没把握」
 * 恰恰是看图能解决的：渲一张图、跟周围环境一对照，多数当场能定。
 *
 * 这个模块不做判定，只做分流和归组。判定还是三层：
 *   脚本判据 → 判不出的给 agent 看图 → agent 也定不了的给人
 *
 * 硬约束：不许 import fs/path/url/node:*，不许碰 process——要能整块搬进插件沙箱。
 */

/**
 * 每个档位「该谁定」。
 *
 * 这张表是需要人复核的分类主张，所以摊开写死，不埋进代码逻辑里：
 * 谁都能一眼看出「我把 sec 归给了人、把 btn 归给了看图」，不同意就改这张表。
 *
 * 判断依据是「这个档位判不准的原因是什么」：
 *   原因是「静态数据里没有这个信息，但画面上有」   → 看图
 *   原因是「画面上也没有，只有做这稿的人知道」     → 人定
 *   原因是「其实判得挺准，是保守才落进来的」       → 直接用
 */
export const TIER_OWNER = {
  // —— 看图能定：画面上有、静态数据里没有 ——
  btn: { owner: "vision", why: "按钮的形状、位置、图标在渲图上一看就知道，静态数据分不出「带底色压着字的方块」和按钮" },
  functionWord: { owner: "vision", why: "名字写着功能词但拿不准是哪一种（实测反例：名字含「切换」的层正确答案是 ind/），看图能定" },
  switch: { owner: "vision", why: "重叠子层到底是切换态还是美术叠加，渲图对比就知道" },
  tab: { owner: "vision", why: "页签条形态明显，看图确认哪个是选中项即可" },
  img: { owner: "vision", why: "多半是「这块该整块切还是拆开」的粒度问题，看图能定" },
  ind: { owner: "vision", why: "轮播指示点在图上一眼可见，而且「当前页那个更大」这种语义标记恰好破坏了判据要的一致性" },
  scroll: { owner: "vision", why: "能不能滑动看不出来，但内容是否溢出容器看图能判" },
  carousel: { owner: "vision", why: "轮播结构在图上直接可见：有没有左右箭头、有没有一排指示点，静态数据里这些和普通并排布局没区别" },
  bg: { owner: "vision", why: "是不是背景看图最直接：满幅铺底还是一块装饰，画面上一眼分得清" },
  statePair: { owner: "vision", why: "选中/未选中两态在图上能看出是同一个控件还是两个东西" },

  // —— 只有人知道：画面上也没有 ——
  sec: { owner: "human", why: "分区怎么划分涉及业务含义（这一屏算不算一个独立模块），机器和看图都定不了" },

  // —— 其实不该落进「需要确认」 ——
  alreadyNamed: { owner: "auto", why: "设计师已经写了合法名字，原样保留" },
  masterFollowsInstance: { owner: "auto", why: "母版跟随实例，来源已经确认过" },
  userConfirmed: { owner: "auto", why: "人已经当面裁决过这一层，不该再问第二遍——重复问会让人怀疑上次的答案没被记住" },
  wholeGroupArt: { owner: "auto", why: "整组无文字无交互，判据本身很硬" },
  artBesideText: { owner: "auto", why: "图文并列，美术块边界清楚" },
};

/**
 * 归组：同档 + 同原名 + 同类型 + 同尺寸的条目，看一张图能一次判掉一整组。
 *
 * 这是减负的主力，不是锦上添花：火炬页 87 条「看图」归成 25 组，
 * 意味着要渲的图从 87 张降到 25 张。
 *
 * 尺寸取整到 1px：同一个组件的多个实例常有亚像素差异（364.6 vs 364.7），
 * 不取整会把本该同组的拆散。
 */
export function visionGroupKey(entry) {
  const w = entry.width == null ? "?" : Math.round(entry.width);
  const h = entry.height == null ? "?" : Math.round(entry.height);
  return `${entry.tier}|${entry.oldName}|${entry.nodeType}|${w}x${h}`;
}

/**
 * 分流「需要确认」的条目。
 *
 * @param entries 需要确认档的条目（report.needsRecheckGroups 摊平）
 * @returns { vision, human, auto, groups } —— groups 是看图那批归组后的结果，
 *          每组 { key, tier, sampleNodeId, count, entries }
 */
export function triageRecheck(entries) {
  const vision = [];
  const human = [];
  const auto = [];
  const unknownTiers = new Set();

  for (const entry of entries) {
    const rule = TIER_OWNER[entry.tier];
    if (!rule) {
      // 没归过类的档位一律给人——宁可多问，不可让 agent 替人默认一个答案。
      unknownTiers.add(entry.tier ?? "(无档位)");
      human.push(entry);
      continue;
    }
    if (rule.owner === "vision") vision.push(entry);
    else if (rule.owner === "human") human.push(entry);
    else auto.push(entry);
  }

  const grouped = new Map();
  for (const entry of vision) {
    const key = visionGroupKey(entry);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }

  const groups = [...grouped.entries()]
    .map(([key, list]) => ({
      key,
      tier: list[0].tier,
      oldName: list[0].oldName,
      nodeType: list[0].nodeType,
      width: list[0].width,
      height: list[0].height,
      // 渲图只渲这一个，判定结果套用到整组
      sampleNodeId: list[0].nodeId,
      count: list.length,
      nodeIds: list.map((e) => e.nodeId),
      candidatePrefixes: list[0].candidatePrefixes ?? null,
      proposedName: list[0].newName ?? null,
      why: TIER_OWNER[list[0].tier]?.why ?? "",
    }))
    .sort((a, b) => b.count - a.count || String(a.oldName).localeCompare(String(b.oldName)));

  return { vision, human, auto, groups, unknownTiers: [...unknownTiers] };
}
