/**
 * lint.mjs — 遍历 Figma 节点树，产出命名 findings。
 *
 * 纯函数：输入一棵 Figma 节点（`/v1/files/:key/nodes` 里的 document），输出 { findings, stats, counts }。
 * 不碰网络、不碰文件系统 —— 测试直接喂 fixture。
 *
 * 「体检根」= 传入的这个节点。`sec/` 在整棵体检根子树内收集（规范 §1），
 * 所以传错节点仍会让分区类判定整体偏移 —— 调用方负责选对根。
 */
import {
  PREFIXES, PARAMS, PARAM_NAMES, NON_PREFIX_WORDS, FIGMA_DEFAULT_COMPOUND_NAMES,
  FIGMA_DEFAULT_CN_NAMES, FIGMA_COPY_SUFFIX_RE, isSlicePrefix, parseLangCodes,
} from "./spec.mjs";
import { parseName, usesPrefixSyntax, nearestParam } from "./parse.mjs";
import { RULES, severityOf, dispositionOf, basisOf, SEVERITIES } from "./rules.mjs";
import { DISPOSITIONS } from "./spec.mjs";
import { unprefixedLangShellSet } from "./lang-axis.mjs";

export function lint(root) {
  const findings = [];
  const stats = {
    nodes: 0, prefixed: 0, byPrefix: {}, texts: 0,
    sliceIntents: 0, refSubtrees: 0, refNodesSkipped: 0, inInstance: 0, secTotal: 0,
  };

  // 跨节点检查的收集器
  const secNodes = [];  // 体检根子树内的全部 sec/（含嵌套项，后续按规则分流）
  const namedNodes = [];  // 全部带合法前缀的层，供 N-NAME-DUPLICATE 跨节点比对
  const parentSiblingCount = new Map();  // 父层 → 它下面有几个带前缀的子层
  const secRefs = [];   // @sec=N 引用
  const fromRefs = [];  // fix/@from=N 引用
  const kvByParent = new Map();
  const indNodes = [];  // ind/ 与其作用域、祖先链信息（遍历结束后统一判定）
  const switchesByScope = new Map(); // 最近 sec/（无则体检根）作用域内的全部 switch/
  const nodeContexts = new Map(); // 唯一 DFS 已知的豁免上下文，供即时与跨节点 finding 共用
  const rootScope = root;

  /**
   * instance 携带最近的 INSTANCE 祖先。实例内部的层名继承主组件，
   * 在每个实例里逐个改名不现实 —— 报告按主组件归并，改一次消一批。
   */
  const push = (code, node, path, detail, suggestion, instance) => {
    if (!RULES[code]) throw new Error(`未登记的错误码: ${code}`);
    const context = nodeContexts.get(node);
    if (!context) throw new Error(`finding 缺豁免上下文: ${code} @ ${node?.id ?? "?"}`);
    findings.push({
      code, severity: severityOf(code),
      disposition: dispositionOf(code), basis: basisOf(code),
      nodeId: node.id, name: node.name,
      type: node.type, path, detail, context,
      ...(suggestion ? { suggestion } : {}),
      ...(instance ? { instance } : {}),
    });
  };

  const visit = (n, ctx) => {
    const parsed = parseName(n.name);
    const path = ctx.path ? `${ctx.path} / ${n.name}` : n.name;

    // ref/ 子树整体忽略：不检查、不报警（§1）
    if (parsed.prefix === "ref") {
      stats.refSubtrees++;
      stats.refNodesSkipped += countNodes(n);
      return;
    }

    stats.nodes++;
    const prefix = parsed.prefix;
    if (prefix) {
      stats.prefixed++;
      stats.byPrefix[prefix] = (stats.byPrefix[prefix] ?? 0) + 1;
    }
    if (n.type === "TEXT") stats.texts++;
    if (ctx.instance) stats.inInstance++;
    if (prefix === "sec") stats.secTotal++;

    const hasExport = (n.exportSettings ?? []).length > 0;
    const children = n.children ?? [];
    const isLeaf = children.length === 0;
    nodeContexts.set(n, findingContext(n, ctx, hasExport));

    /* 本节点在其最近 INSTANCE 祖先内的相对位置。
       path 用**子层序号**而不是图层名——真稿里同一实例内有两个同名的「小钻石 1」，
       用名字拼路径会撞成同一个键，把两个修复点合成一个、动作数少报。
       序号在同一主组件的各实例间是稳定的（结构相同），名字只留作显示用。
       ctx.instance.path 记的是「到父节点为止」，落在本节点上的 finding 必须把自己接上。 */
    const selfInstance = ctx.instance
      ? {
        ...ctx.instance,
        path: [...ctx.instance.path, ctx.index ?? 0],
        pathNames: [...ctx.instance.pathNames, n.name],
      }
      : null;

    /** 本节点上报一条 */
    const add = (code, detail, suggestion) => push(code, n, path, detail, suggestion, selfInstance);

    const structuralNonPrefix = isStructuralNonPrefix(n);

    /* ── 前缀语法 ── */
    if (!structuralNonPrefix) {
      if (parsed.unknownPrefix) {
        add("N-PREFIX-NOT-IN-TABLE",
          parsed.suggestion
            ? `\`${parsed.unknownPrefix}/\` 不在总表内，最接近的是 \`${parsed.suggestion}/\``
            : `\`${parsed.unknownPrefix}/\` 不在总表内（自造前缀，机器不认识）`,
          parsed.suggestion
            ? `${parsed.suggestion}/${parsed.body}${parsed.params.map((p) => p.raw).join("")}`
            : undefined);
      }
      if (usesPrefixSyntax(parsed) && parsed.slash !== "/" && parsed.slash !== "／") {
        add("N-PREFIX-SLASH", `分隔符是 \`${parsed.slash}\`，必须是半角 \`/\` 或全角 \`／\``,
          `${parsed.prefixRaw}/${parsed.body}${parsed.params.map((p) => p.raw).join("")}`);
      }
    }

    /* ── @参数（仅在前缀已识别时校验，避免在自造前缀上叠加噪音）── */
    if (prefix) {
      const seenParams = new Set();
      for (const p of parsed.params) {
        if (!p.key) {
          add("N-PARAM-UNKNOWN", "出现空的 `@` 参数");
          continue;
        }
        if (seenParams.has(p.key)) {
          add("N-PARAM-BAD-VALUE", `\`@${p.key}\` 重复声明`);
          continue;
        }
        seenParams.add(p.key);
        const ps = PARAMS[p.key];
        if (!ps) {
          const near = nearestParam(p.key, PARAM_NAMES);
          add("N-PARAM-UNKNOWN",
            `\`@${p.key}\` 不在参数表内${near ? `，最接近的是 \`@${near}\`` : ""}`,
            near ? n.name.replace(`@${p.key}`, `@${near}`) : undefined);
          continue;
        }
        if (!ps.on.includes(prefix)) {
          add("N-PARAM-MISPLACED",
            `\`@${p.key}\` 只能用在 ${ps.on.map((x) => `\`${x}/\``).join(" / ")} 上，当前是 \`${prefix}/\``);
        }
        if (p.key === "lang" && (prefix === "btn" || prefix === "hot") && langParamForbidden(ctx)) {
          add("N-PARAM-MISPLACED",
            `\`@lang\` 不能写在 A10 语言壳变体内的 \`${prefix}/\``);
        }
        if (ps.value === "none") {
          if (p.hasEq) add("N-PARAM-BAD-VALUE", `\`@${p.key}\` 是纯标记，不能带 \`=值\``, n.name.replace(p.raw, `@${p.key}`));
        } else if (!p.hasEq || !p.value) {
          add("N-PARAM-EMPTY", `\`@${p.key}=\` 缺值（${ps.desc}）`);
        } else if (ps.value === "int" && !/^[1-9]\d*$/.test(p.value)) {
          add("N-PARAM-BAD-VALUE", `\`@${p.key}=${p.value}\` 必须是正整数`);
        } else if (ps.value === "ratio") {
          const v = Number(p.value);
          if (!Number.isFinite(v) || v < 0 || v > 1)
            add("N-PARAM-BAD-VALUE", `\`@${p.key}=${p.value}\` 必须是 0–1 之间的数`);
        } else if (ps.value === "langs") {
          if (parseLangCodes(p.value) == null) {
            add("N-PARAM-BAD-VALUE",
              `\`@${p.key}=${p.value}\` 必须是逗号分隔的精确小写 cn/tw/en/jp/kr，不能重复、不能写 zh-CN/CN`);
          }
        }
      }

      /* ── 前缀与位置的约束 ── */
      if (prefix === "modal" && !ctx.isRoot) {
        add("N-MODAL-INLINE", "弹窗应是页面稿外的独立 frame，当前画在页面稿内");
      }
      if (prefix === "scroll" && isLeaf) {
        add("N-SCROLL-NO-TRACK", "滑动容器内没有任何子层，产不出内容轨道与 items");
      }
    }

    // Export 是人工导出设置，不是资产身份契约；切图意图只由视觉前缀声明。
    const sliceIntent = isSlicePrefix(prefix);
    if (sliceIntent) stats.sliceIntents++;
    const sliceAncestor = ctx.sliceAncestor ?? (sliceIntent ? { name: n.name, id: n.id } : null);

    /* ── 语义层：文字烙图 / 该切没命名 ── */
    if (!ctx.namingExempt) {
      // 已有任何识别前缀的节点不报：设计师已经声明过这层是什么，再报就是噪音。
      if (isLeaf && n.type !== "TEXT" && !ctx.sliceAncestor && !prefix
        && ctx.semanticAncestor?.prefix !== "ind" && hasImageFill(n)) {
        add("N-IMG-FILL-NO-NAME", "叶子节点带图像填充但未命名 `img/`，切图边界只能靠结构推断");
      }
    }
    // §3 / A6：仅紧凑控件内的固定文本框需要定宽定高；长段落按定宽自动换行。
    const compactTextAncestor = ["btn", "tab", "switch", "ind"]
      .some((p) => ctx.ancPrefixes.has(p));
    if (n.type === "TEXT" && compactTextAncestor
      && (n.style?.textAutoResize ?? "NONE") === "NONE") {
      add("N-TEXT-FIXED-SIZE", "紧凑控件内文本框是固定尺寸，页面按定宽定高还原，换语言后可能溢出或被裁");
    }

    /* ── 跨节点检查的素材 ── */
    // 重名素材：只收「前缀合法且 body 非空」的层。
    // 组件变体名（Property 1=Default）里没有斜杠，prefix 恒为 null，天然不会进来。
    // ref/ 子树在上游已整棵跳过。
    if (prefix && parsed.body) {
      namedNodes.push({ node: n, path, name: n.name, instance: ctx.instance, parentId: ctx.parentId ?? "__root__" });
      const pid = ctx.parentId ?? "__root__";
      parentSiblingCount.set(pid, (parentSiblingCount.get(pid) ?? 0) + 1);
    }
    if (prefix === "sec") {
      const nestedAncestor = ctx.semanticAncestor;
      if (nestedAncestor) {
        add("N-SEC-NESTED",
          `位于带语义前缀节点 \`${nestedAncestor.name}\` 内，分区归属不明确；该节点不参与同父层分散判定`);
      }
      secNodes.push({
        node: n,
        path,
        body: parsed.body,
        instance: ctx.instance,
        parentId: ctx.parentId ?? "__root__",
        parentName: ctx.parentName ?? root?.name ?? "?",
        nested: Boolean(nestedAncestor),
        order: secNodes.length,
      });
    }
    const componentDefinition = isComponentDefinition(n);
    if (prefix === "switch" && !componentDefinition) {
      const list = switchesByScope.get(ctx.scopeRoot) ?? [];
      list.push({ node: n, path, instance: selfInstance });
      switchesByScope.set(ctx.scopeRoot, list);
    }
    if (prefix === "ind" && !componentDefinition) {
      indNodes.push({
        node: n,
        path,
        instance: selfInstance,
        scopeRoot: ctx.scopeRoot,
        hasSwitchAncestor: ctx.ancPrefixes.has("switch"),
      });
    }
    if (prefix) {
      for (const p of parsed.params) {
        if ((p.key === "sec" || p.key === "from") && p.hasEq && /^[1-9]\d*$/.test(p.value)) {
          const bucket = p.key === "sec" ? secRefs : fromRefs;
          bucket.push({ node: n, path, n: Number(p.value), instance: ctx.instance });
        }
      }
    }
    if (prefix === "kv") {
      const pid = ctx.parentId ?? "__root__";
      if (!kvByParent.has(pid)) kvByParent.set(pid, []);
      kvByParent.get(pid).push({ node: n, path, instance: ctx.instance });
    }

    /* ── 递归 ── */
    const childExempt = ctx.namingExempt || PREFIXES[prefix]?.exemptSubtree === "NAMING";
    const ancPrefixes = prefix ? new Set([...ctx.ancPrefixes, prefix]) : ctx.ancPrefixes;
    const ancestorPrefixes = prefix ? [...ctx.ancestorPrefixes, prefix] : ctx.ancestorPrefixes;
    /* 传给子层的实例上下文。实例内相对路径是归并键的一段：同一主组件内可能有多个同名图层
       （真稿里一个实例内有 2 个「小钻石 1」），只靠 componentId + 图层名会把它们合成一个
       修复点，导致动作数系统性少报。落在 INSTANCE 节点自身的 finding 不算「在实例内」。 */
    const instance = selfInstance
      ?? (n.type === "INSTANCE"
        ? { id: n.id, name: n.name, componentId: n.componentId ?? null, path: [], pathNames: [] }
        : null);
    const semanticAncestor = prefix
      ? { id: n.id, name: n.name, prefix }
      : ctx.semanticAncestor;
    const childScopeRoot = prefix === "sec" ? n : ctx.scopeRoot;
    children.forEach((c, index) => {
      const structuralPath = ctx.structuralPath
        ? `${ctx.structuralPath}/${n.type}@${index}`
        : `${n.type}@${index}`;
      visit(c, {
        path, parentId: n.id, parentName: n.name, isRoot: false, index,
        isTopLevel: ctx.isRoot, // 体检根的直接子层
        namingExempt: childExempt,
        sliceAncestor, ancPrefixes, ancestorPrefixes, instance, semanticAncestor,
        scopeRoot: childScopeRoot, structuralPath,
        ancestorNodes: [...(ctx.ancestorNodes || []), n],
      });
    });
  };

  visit(root, {
    path: "", parentId: null, parentName: null, isRoot: true, isTopLevel: false, index: 0,
    namingExempt: false, sliceAncestor: null, ancPrefixes: new Set(), instance: null,
    ancestorPrefixes: [], semanticAncestor: null, scopeRoot: rootScope, structuralPath: "",
    ancestorNodes: [],
  });

  /* ── 跨节点：分区编号 ── */
  const numbered = [];
  for (const s of secNodes) {
    const m = /^(\d+)/.exec(s.body ?? "");
    if (!m) push("N-SEC-NO-NUMBER", s.node, s.path, "分区名未以编号开头，应形如 `sec/1-首屏`", undefined, s.instance);
    else numbered.push({ ...s, num: Number(m[1]) });
  }
  const byNum = new Map();
  for (const s of numbered) {
    if (!byNum.has(s.num)) byNum.set(s.num, []);
    byNum.get(s.num).push(s);
  }
  for (const [num, group] of byNum) {
    if (group.length > 1) {
      for (const s of group) {
        push("N-SEC-DUP-NUMBER", s.node, s.path,
          `编号 ${num} 被 ${group.length} 个分区共用：${group.map((g) => `\`${g.node.name}\``).join("、")}`,
          undefined, s.instance);
      }
    }
  }
  /* ── 跨节点：两个图层同名 ──
     命名是资产身份的来源（A1）。同名意味着下游按名字取用时拿到哪一个不确定，
     切图互相覆盖、引用指向错误对象，而且全程不报���。
     同一个组件的多个实例天然同名，那是 Figma 的机制不是设计失误，所以按
     「同一主组件内的同路径」折叠：只有真正不同的资产同名才报。 */
  // 按「父层 + 名字」分组，不是全稿同名就报。
  // 规范稿实测：img/按钮背景 出现 4 次，但分别在 btn/下载按钮、btn/立即领取…… 里，
  // 路径不同、下游按路径取用不会混淆，全稿去重会在合规稿上报 70 条假问题。
  // 真正有害的是同一个父层下两个孩子同名——那时连路径都分不开它们。
  const byName = new Map();
  for (const item of namedNodes) {
    const key = `${item.parentId}\u0000${item.name}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(item);
  }
  for (const [key, group] of byName) {
    const name = key.split("\u0000")[1];
    if (group.length < 2) continue;
    // 组件实例里的同名层：同一份母版被摆了多次，不是两个资产
    const distinct = new Map();
    for (const item of group) {
      const k = item.instance ? `${item.instance.componentId ?? "?"}::${item.instance.path ?? ""}` : item.node.id;
      if (!distinct.has(k)) distinct.set(k, item);
    }
    if (distinct.size < 2) continue;
    // 同一控件的重复项允许同名。§1 明写「ind/ 全组同名是允许的，序号按同级顺序推定」，
    // tab/ 的页签、ind/ 的圆点同理——它们是一组等价构件，序号由位置决定，
    // 逐个起名反而制造无意义的差异。实测规范稿上 btn/源器 ×6、ind/进度条 ×3 都属这类。
    // 判据：这一组占了父层绝大多数子层（≥3 个且 ≥60%），说明父层就是装它们的容器。
    const siblingCount = parentSiblingCount.get(group[0].parentId) ?? 0;
    if (distinct.size >= 3 && siblingCount > 0 && distinct.size / siblingCount >= 0.6) continue;
    for (const item of distinct.values()) {
      push("N-NAME-DUPLICATE", item.node, item.path,
        `名字「${name}」被 ${distinct.size} 个不同的层共用`,
        undefined, item.instance);
    }
  }

  /* ── 跨节点：分区是否分散在多个父层 ──
     先剔除已经被 N-SEC-NESTED 命中的项；再取最多的一组为基准。
     order 明确锁住平票时的文档顺序，不把结果寄托在 Map 的偶然迭代细节上。 */
  const byParent = new Map();
  for (const s of secNodes) {
    if (s.nested) continue;
    if (!byParent.has(s.parentId)) byParent.set(s.parentId, {
      parentName: s.parentName, items: [], firstOrder: s.order,
    });
    byParent.get(s.parentId).items.push(s);
  }
  let baseline = null;
  for (const group of byParent.values()) {
    if (!baseline
      || group.items.length > baseline.items.length
      || (group.items.length === baseline.items.length && group.firstOrder < baseline.firstOrder)) {
      baseline = group;
    }
  }
  if (baseline && byParent.size > 1) {
    for (const group of byParent.values()) {
      if (group === baseline) continue;
      for (const s of group.items) {
        push("N-SEC-SCATTERED", s.node, s.path,
          `该分区位于逻辑父层 \`${group.parentName}\`，而多数分区位于 \`${baseline.parentName}\`；两组之间的竖排顺序没有定义`,
          undefined, s.instance);
      }
    }
  }
  const nums = [...byNum.keys()].sort((a, b) => a - b);
  if (nums.length) {
    const missing = [];
    for (let i = nums[0]; i < nums[nums.length - 1]; i++) if (!byNum.has(i)) missing.push(i);
    if (missing.length) {
      push("N-SEC-GAP", root, root.name,
        `分区编号为 ${nums.join("、")}，缺 ${missing.join("、")}（确认是有意跳号还是漏了屏）`);
    }
  }

  /* ── 跨节点：@sec 指向的分区是否存在 ── */
  for (const r of secRefs) {
    if (!byNum.has(r.n)) {
      push("N-NAV-TARGET-MISSING", r.node, r.path,
        `\`@sec=${r.n}\` 指向的分区不存在（现有分区：${nums.length ? nums.join("、") : "无"}）`,
        undefined, r.instance);
    }
  }

  /* ── 跨节点：fix/@from 指向的分区是否存在 ── */
  for (const r of fromRefs) {
    if (!byNum.has(r.n)) {
      push("N-FIX-FROM-MISSING", r.node, r.path,
        `\`@from=${r.n}\` 指向的分区不存在（现有分区：${nums.length ? nums.join("、") : "无"}）`,
        undefined, r.instance);
    }
  }

  /* ── 跨节点：ind/ 与 switch/ 的作用域联动 ──
     作用域是最近的 sec/ 祖先；没有 sec/ 祖先时使用体检根。先处理祖先链
     中已有 switch/ 的短路，再区分「无候选」与「候选不唯一」两种后果。 */
  for (const i of indNodes) {
    if (i.hasSwitchAncestor) continue;
    const candidates = switchesByScope.get(i.scopeRoot) ?? [];
    const scopeName = i.scopeRoot === rootScope
      ? `体检根 \`${root?.name ?? "?"}\``
      : `分区 \`${i.scopeRoot?.name ?? "?"}\``;
    if (candidates.length === 0) {
      push("N-IND-NO-CAROUSEL", i.node, i.path,
        `作用域（${scopeName}）内没有任何被声明的 \`switch/\`，指示器没有可绑定的轮播对象`,
        undefined, i.instance);
    } else if (candidates.length >= 2) {
      push("N-IND-CAROUSEL-AMBIGUOUS", i.node, i.path,
        `作用域（${scopeName}）内有 ${candidates.length} 个候选轮播（${candidates.map((c) => `\`${c.node.name}\``).join("、")}），且指示器不在任一 \`switch/\` 内，无法确定联动对象`,
        undefined, i.instance);
    }
  }

  /* ── 跨节点：kv/ 单层 ── */
  for (const list of kvByParent.values()) {
    if (list.length === 1) {
      push("N-KV-SINGLE-LAYER", list[0].node, list[0].path,
        "同一父层下只有这一个 `kv/`，视差分层无从体现", undefined, list[0].instance);
    }
  }

  findings.sort((a, b) =>
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
    a.code.localeCompare(b.code) || a.path.localeCompare(b.path));

  const counts = { P0: 0, P1: 0, P2: 0 };
  for (const f of findings) counts[f.severity]++;

  const byDisposition = Object.fromEntries(DISPOSITIONS.map((d) => [d, 0]));
  for (const f of findings) byDisposition[f.disposition]++;

  /* 体检根自检（§1：`sec/` 在体检根子树内收集）。三个信号互相独立：
       ① 类型不是 FRAME —— 选了画布 / 组件定义 / 整个文档。真稿实测选整个 CANVAS
          会把组件定义与游离碎片一起算进来（526 条 vs 页面 frame 的 141 条）
       ② 子树里根本没有 sec/ —— 选了页面里的某个组
       ③ directSec=0 但 secTotal>0 —— 根选对了，分区可能由纯布局容器承载。
          这不是选根错误，也不应单独产生警告。
     真稿的 pc / mobile 都属于第 ③ 种，所以只看 directSec 会让正常基线永远报选根错误。 */
  const rootType = root?.type ?? null;
  const rootCompKids = (root?.children ?? []).filter((c) => c.type === "COMPONENT" || c.type === "COMPONENT_SET").length;
  const warnings = [];
  if (rootType && rootType !== "FRAME") {
    warnings.push(`体检根类型是 ${rootType}，应为页面 frame（FRAME）。选画布或组件定义会把组件库与游离碎片一起算进来`);
  }
  if (stats.secTotal === 0) {
    warnings.push("这棵子树里没有任何 `sec/` 分区，分区类判定会整体失效");
  }
  /* 工作区画板与页面稿都是 FRAME、子树里都有 sec/，前两个信号分不开。
     可靠的区分点：页面稿不会把组件定义直接放在自己的子层里。
     真稿实测 cn_pc 18 个 / cn_mobile 10 个，而 pc 与 mobile 都是 0。 */
  if (rootCompKids > 0) {
    warnings.push(`体检根的直接子层里有 ${rootCompKids} 个组件定义（COMPONENT / COMPONENT_SET），这看起来是工作区画板而不是页面稿`);
  }
  const root_ = {
    name: root?.name ?? null,
    type: rootType,
    directSec: (root?.children ?? []).filter((c) => parseName(c.name).prefix === "sec").length,
    secTotal: stats.secTotal,
    warnings,
    looksLikeWrongRoot: warnings.length > 0,
  };

  return { findings, stats, counts, byDisposition, root: root_ };
}

/** 图像填充判定。fills 在 Figma 插件 API 里可能是 figma.mixed 或不存在，一律归一成空数组。 */
export function hasImageFill(n) {
  const fills = Array.isArray(n.fills) ? n.fills : [];
  return fills.some((f) => f.visible !== false && f.type === "IMAGE");
}

/** §4.2：Figma 用文字内容作为 TEXT 默认图层名时，不存在设计师声明的前缀。 */
export function isStructuralNonPrefix(n) {
  return n?.type === "TEXT"
    && typeof n?.name === "string"
    && typeof n?.characters === "string"
    && n.name.trim() === n.characters.trim();
}

/** §7：finding 上供豁免匹配使用的只读上下文；只暴露本次 DFS 已经知道的事实。 */
function findingContext(n, ctx, hasExport) {
  const box = n?.absoluteBoundingBox;
  const maxEdge = Number.isFinite(box?.width) && Number.isFinite(box?.height)
    ? Math.max(box.width, box.height)
    : null;
  return {
    nearestPrefix: ctx.semanticAncestor?.prefix ?? null,
    ancestorPrefixes: [...ctx.ancestorPrefixes],
    maxEdge,
    hasExport,
    namePattern: namePatternOf(n?.name),
    structuralPath: ctx.structuralPath,
  };
}

/** §7：figma-default 比 numeric-suffix 信息量更大，因此优先返回。 */
export function namePatternOf(name) {
  if (typeof name !== "string") return null;
  const withoutCopy = name.replace(FIGMA_COPY_SUFFIX_RE, "");
  const withoutTrailingNumber = withoutCopy.replace(/\s+\d+$/, "").trim().toLowerCase();
  if (NON_PREFIX_WORDS.has(withoutTrailingNumber)) return "figma-default";
  if (FIGMA_DEFAULT_COMPOUND_NAMES.has(withoutTrailingNumber)) return "figma-default";
  if (FIGMA_DEFAULT_CN_NAMES.has(withoutTrailingNumber)) return "figma-default";
  if (/[\s_-]\d+$/.test(withoutCopy)) return "numeric-suffix";
  return null;
}

/** A4/D6：库里的 COMPONENT / COMPONENT_SET 没有页面使用现场，不参与 ind/switch 联动判定。 */
export function isComponentDefinition(n) {
  return n?.type === "COMPONENT" || n?.type === "COMPONENT_SET";
}

/** A11：A10 语言壳变体内那颗 btn/hot 禁止再挂 @lang。判定与清单同一份。 */
function langParamForbidden(ctx) {
  return (ctx?.ancestorNodes || []).some((item) => unprefixedLangShellSet(item));
}

function countNodes(n) {
  let c = 1;
  for (const ch of n.children ?? []) c += countNodes(ch);
  return c;
}
