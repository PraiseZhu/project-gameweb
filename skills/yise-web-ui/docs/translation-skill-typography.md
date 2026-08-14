# Translation Skill: Typography and Range

This is a reusable translation-skill contract. The Etheria demo is only a
fixture consumer; no rule in this directory may depend on Etheria node IDs,
page selectors, or page-specific CSS.

## Separate verification axes

1. **Copy mapping** keeps the existing A19 -> B19/C19 row correspondence and
   its provenance. It does not decide font fidelity or browser fit.
2. **Font, glyph, and weight** compares the Figma TEXT request with browser
   readiness. A missing requested family or weight is an explicit review gap;
   synthetic weight is never a typography pass.
3. **Range and fit** compares Figma `box`/`renderBox` and `autoResize` with
   measured `Range`, client, scroll, clipping, ellipsis, and step-fit data.
   Open-flow text is classified from explicit truth clip/role evidence plus
   section geometry: its font size and line height stay at the Figma request,
   width is bounded by the section's right edge, and natural vertical growth
   is reported as `open-flow-vertical-growth`. Framed/fixed UI keeps the strict
   fit and overflow policy.

### Stepped font-size fit (restored authorized policy)

Who may shrink is decided by one shared rule, `fitAuthorization` in
`scripts/lib/figma-typography.mjs` (re-exported via `translation/index.mjs`,
mirrored inline by the self-contained renderer). It never guesses from page
names or node IDs; it reads Figma `autoResize` semantics plus truth structure:

- `TRUNCATE` / `textTruncation=ENDING` -> authorized (`truncation`)
- `clipsContent` / `isMask`            -> authorized (`clip-or-mask`)
- `truth.fit === true`                 -> authorized (`explicit-fit-grant`)
- a bounded framed owner range         -> authorized (`framed-bounded-owner`)
- open-flow / unbounded `HEIGHT`       -> NOT authorized (`preserve-source-metrics`),
  keeps source font size/line-height and grows vertically as evidence

The fit itself is a discrete, floor-bounded ladder in the renderer
(100 -> 92 -> 85 -> 78 -> 75): font size and line height scale together so
leading and vertical centering are preserved, and 75% is a hard floor. A node
that still spills at the floor stops there and is stamped
`data-fit-overflow` + `data-fit-needs-review="floor-exceeded"` (surfaced in
browser evidence as `fitOverflow` / `fitFloor` / `fitNeedsReview`) for human
review; it is never shrunk further and never reported as a pass. Hugging text
(`WIDTH` / `WIDTH_AND_HEIGHT`) is never fit-shrunk, and its few-px
browser-vs-Figma line-height rounding stays `natural-vertical-growth`.

### Vertical-HUG text grows, never step-fit shrinks

A Figma text node with `autoResize:HEIGHT` AND `layoutSizingVertical:HUG`
is designed to grow vertically with its content. The official-site behavior
reference confirms the same rule across every locale: the reward-card body
group keeps one shared font size, line count grows 2/3/4 per card, and the
container height follows. `fitAuthorization` therefore returns
`hug-vertical-natural-growth` (not authorized) for `layoutSizingVertical:HUG`
text, so it keeps its source font size and grows; the HUG owner container is
released to follow content height (`min-height` keeps the source height as a
floor). Shrinking such a node would give the longest sibling a visibly smaller
font than its group, which is the defect this rule removes.

### Component-group typography fit (uniform size across a sibling group)

Sibling titles (or sibling body texts) inside one component group are NOT
fitted independently per node. The official reference shows one shared font
size per group (reward-card title group, body group, character-name group,
list group) with the longest item wrapping rather than shrinking.

- **Group key** (`buildFitGroupKey`): the innermost shared container ancestor
  (`ancestorNames` last entry) + semantic role + source font size. Sibling
  cards share the same innermost component container, so they cluster into one
  group regardless of nesting depth; title and body groups stay separate
  because role/size differ. No node id or copy string participates.
- **Uniform fit** (`unifyGroupFitScales`, mirrored in the renderer's
  `runFit`): after each node measures its own stepped fit, a multi-member
  group that produced divergent scales is unified to the strictest (smallest)
  scale, applied to every sibling, and stamped `data-fit-group-unified`.
  Single-member groups and already-uniform groups are left untouched.
- Natural wrapping and container growth are always preferred; a group only
  shrinks when its members are individually authorized to fit, and then the
  whole group moves together with a recorded reason and size.

The browser evidence record carries `fitGroup` and `fitGroupUnified` so a
gate can assert that no fitted group ends with divergent sibling scales.

4. **Human semantic review** remains separate from all mechanical gates. An
   unresolved translation row must stay unresolved and cannot be hidden by a
   typography result.

## Public interface

Import `scripts/lib/translation/index.mjs` for the reusable interface:

- `routeFontFamily` / `fontRoleFor` / `FONT_SOURCE_ROUTING` (see
  `scripts/lib/translation/font-routing.mjs`): resolve the Figma-source font
  family for a normalized language + a coarse generic role (title / button /
  body). The role is derived from the node's own SOURCE font family (display
  family -> title/button, body family -> body), never from a page/node id or
  selector. A family with no local file is still routed by its truth name; the
  missing file surfaces separately via `figma-fonts` `missing` and browser
  `font.loaded`/`availableWeights` evidence. Routing and file availability are
  two independent facts and neither may fake the other.


- `buildFontFallbackPolicy`: preserves the requested family first and reports
  unavailable requested families for review; generic fallback candidates are
  evidence, not silent style replacement.
- `buildFontWeightPolicy`: preserves the requested weight and reports missing
  or synthetic weights per language; it never substitutes a different weight.
- `classifyFontWeight` and `classifyTypographyRange`: classify requested
  weight/readiness and measured browser range without changing Figma style.
- `classifyAutoResize`: records Figma `HEIGHT`, `WIDTH`,
  `WIDTH_AND_HEIGHT`, and fixed/truncate axis semantics.
- `classifySemanticText`: groups fixed-nav, large-heading, calendar-table, and
  card-frame text from generic role/name/ancestor evidence.
- `buildTypographyEvidence` and `validateTypographyEvidence`: produce and
  validate `translation-typography-evidence/v1` records.
- `buildFitGroupKey` / `unifyGroupFitScales`: cluster sibling titles/body
  texts into one component group by the innermost shared container ancestor
  (never node ids or copy), and unify divergent per-node stepped-fit scales to
  the group's strictest scale so a sibling group renders at one shared size.

The browser collector writes one evidence record per language and text node.
It must fail closed when Chrome is unavailable. DOM counts, copy coverage, or
Node tests alone do not prove visual typography fidelity.

### Truth-to-browser context contract

The extractor preserves `ancestorNames` and `ancestorTypes` as provenance
leaves on each emitted node, including descendants of passed-through pure
containers. Text evidence carries the source `parentId`, ancestor arrays, and
the source-character provenance. The renderer derives generic
`data-text-role`, `data-text-scene`, `data-text-context-key`,
`data-text-ancestor-names`, and `data-text-ancestor-types` attributes from
those truth fields; it never uses page IDs or selectors. Chrome evidence stores
the DOM context and `domMatchesTruth` separately, so an unknown role or a
context propagation regression remains visible instead of being inferred from
DOM node counts.

## Translation visual gates

`scripts/lib/translation/index.mjs` also exposes the independent locale and
component gates:

- `assessLanguageCompleteness` rejects empty bound leaves and invalid row
  provenance while preserving explicitly unresolved nodes.
- `classifyLocaleText` and `assessLocaleConsistency` detect source-language
  residuals and unexpected script mixing in the text actually rendered. When
  a meaningful source-language sequence survives inside a different-locale
  string (for example, Chinese characters followed by Japanese kana), the
  result is `source-sequence-review` with `requiresReview: true`; Japanese
  kanji remain allowed and are not rejected merely as mixed script.
- `classifyUnresolvedCopy` and `groupUnresolvedCopy` keep unresolved rows
  fail-closed while separating evidence into `true-missing-row`,
  `proper-noun/acronym-review`, `designation-review`, and
  `unresolved-no-evidence`. Designations are review metadata only; they never
  supply a translation or turn a locale failure into pass.
- `classifyTranslationTextRole` and `assessComponentTextRange` cover generic
  `nav`, `activity-calendar`, `heading-content-card`, and
  `character-skill-label` roles. Name/ancestor hints include UTF-8 Chinese via
  Unicode-safe patterns, with no page-specific identifiers. Strict roles report
  text outside its truth range. Hard overlap uses the browser text `Range`,
  while element-box intersections without a truth `parentId` are retained as
  `unscopedOverlap`; legal element-box composition therefore does not become
  a text-overlap failure.
- `groupTypographyFailures` groups failed records by unique node, language,
  Figma `autoResize`, and measured range status. It is diagnostic only and
  does not relax thresholds or change font/range policy.
- `classifyTextContainerConstraint` exposes `open-flow` versus
  `framed-fixed`, including the evidence source, section width, owner width,
  and expected vertical-growth semantics. The renderer must pass the computed
  truth semantic role and nearest rendered owner box into this policy. A
  bounded card/nav/calendar/label owner uses its local right edge; only text
  with no bounded owner may use the section right edge. This prevents a
  translated card description from becoming a section-wide horizontal line.
  A direct Figma owner takes precedence over a broad locator-stack parent;
  geometric "parent is 1.5x wider" heuristics must not relabel that owner as
  section-wide. This keeps compact status-tag evidence attached to its real
  yellow host.
  A bare Figma `Frame` ancestor is not treated as a fixed UI proof; explicit
  clips, masks, truncation, semantic frame evidence, or a bounded owner are
  required. Browser evidence records `data-text-owner-width` separately from
  `data-text-section-width` so the two constraints cannot be conflated.
- `classifyTextLayoutIssue`, `buildTextLayoutRepairPlan`, and
  `assessTextLayout` provide deterministic layout adaptation. Chrome supplies
  `Range.getClientRects()` line boxes and grapheme counts; the policy detects
  `single-tail-line`, `bad-line-break`, `horizontal-overflow`, and expected
  `vertical-growth`. Plans preserve Figma font metrics first, permit pretty
  wrapping or truth-authorized movement only when supported, and otherwise
  return `human-review`. No translation value is guessed and open-flow text is
  never arbitrarily shrunk.
- The browser collector preserves per-leaf Figma provenance and source
  characters while reading `text.characters`; it also records whether an
  adopted language leaf was consumed by the renderer. `WIDTH` and
  `WIDTH_AND_HEIGHT` text follows Figma content-hugging semantics in the
  generic renderer (`max-content` with the source box as a minimum anchor).
- Multilingual compact labels use a separate owner-sizing policy. A direct
  `FRAME` owner with truth `HUG` sizing, centered alignment, no clip, and no
  truncation/fit constraint may grow on its HUG axis. The renderer preserves
  source font size and line height, applies source padding, and centers text
  with the owner background so one-line and multi-line Japanese/Korean labels
  stay synchronized. Fixed, clipped, truncated, or unproven owners remain
  review-only; the policy never shrinks text or hides overflow.
- `buildTranslationChromeEvidence` records viewport, optional screenshot
  path/hash/crop, per-node records, and separate copy/locale/typography/
  component/context/layout gate results. The context gate fails on missing source
  provenance or a truth-to-DOM ancestor/role mismatch. Without a screenshot, `visualClaims.status` remains
  `unverified`.

Copy coverage passing therefore does not imply locale consistency, font weight
readiness, or range fit. Those axes must be reported independently.

Official behavior reference is documented in
`docs/translation-official-reference.md`. It supplies reusable section and
content categories plus observed compact/expanded text forms only; it does not
provide locale-selector truth and cannot override Figma or Lark provenance.

## Current fixture evidence

The local Etheria fixture is useful for exercising the interface. On the
current Windows environment Chrome is discovered through `CHROME_PATH` or
common `ProgramFiles`/`LOCALAPPDATA` locations, so five-language browser runs
are executable; failures must be reported as gate findings rather than
"browser missing". The font dry-run explicitly reports `Noto Sans HK` weight `700` missing
for source node `12:49492`. Do not silently replace that source font or claim
full fidelity until a reviewed, licensed source is available.

### 2026-08-06 Chrome audit snapshot

The five-language run (`zh-CN,en,ja,ko,zh-TW`) started real Chrome and was
not blocked. It recorded 870 text records: 141 typography failures (42 unique
nodes; 136 range-overflow/step-fit-overflow cases), 571 locale failures, and
458 component range failures. Text overlap was 0; 34 element intersections
remained explicitly unscoped. Source provenance/context failures were 0.
The 570 unresolved records grouped to 96 missing-row review nodes, 17 with
no additional evidence, and 1 proper-noun/acronym review node. Node
`12:39106` English remains `mixed-script` plus `designationReview`; its Lark
value is preserved and requires human confirmation. These are audit results,
not visual completion claims. Role classification left 60 records (12 unique
nodes) as `unknown`; their truth names/ancestors provide no generic semantic
role evidence, so the policy keeps them unknown instead of inventing roles.

The open-flow Chrome rerun recorded 870 records: 260 records (52 unique
nodes) used open-flow; none had `fitScale < 100`, six showed expected natural
vertical growth, and none spilled horizontally beyond section bounds.
Typography failures fell from 141 to 104 without changing font thresholds;
the remaining failures are fixed/framed range or other independent evidence
findings. A Korean long-description example (`I13:49912;13:49822`) kept the
Figma 30px/36px request, used section width 1915, and reported
`open-flow-vertical-growth` with no horizontal overflow.

The layout-policy rerun captured line evidence for all 870 records. It found
24 layout findings: 18 `bad-line-break` cases where a translated leaf omitted
an explicit source break (including Unicode line separators), and 6
`single-tail-line` cases. They remain
human-review because this fixture does not authorize a width or movement
change. Natural open-flow vertical growth is expected; horizontal spill still
fails independently from locale and typography gates.

### Stable-frame audit after motion settle

The browser collector must distinguish a transient motion frame from the
layout frame used for Translation verification. The 2026-08-06 audit waited
`1300ms` after load and after each locale change, then recomputed line ranges,
rectangles, and ancestor anchors. At `1920x1080` and `1600x900`, the fixed
directory anchor stayed at approximately `x/frameWidth=0.03` and
`y/frameHeight=0.199`; the stable screenshots showed no severe global text
shift. The same five-language stable run was also captured at `768x1024` and
`390x844`.

Stable results were `104` typography, `571` locale, and `426` component
failures at desktop (`354` component failures at `768x1024`, `106` at
`390x844`). Layout diagnostics remained `18` `bad-line-break` and `6`
`single-tail-line` findings at desktop/tablet; the mobile capture had `11`
single-tail findings. Six open-flow records showed expected natural vertical
growth, not a global positional shift. Representative unresolved layout
evidence includes `12:48303` (translated line-break mismatch), `2:31229`
(open-flow description), and `1:934` (single-grapheme tail line). These remain
auditable findings; no translation value, Motion rule, or page CSS was changed.

The authoritative artifacts are the four `artifacts/translation-chrome-stable-*.json`
reports and the corresponding stable screenshots. A final
`figma-inline --check` is intentionally not claimed here: after the Motion
worker finishes, the generated demo owner must run
`node scripts/figma-inline.mjs --demo <demo-dir>` and then rerun the inline
check.


## 通用容器归属与 step-fit 授权（2026-08-06 修复）

三个根因与修复（全部在 Skill 层，不含页面 ID/选择器）：

1. **直接容器归属（truth→renderer）**：文本叶子的直接 Figma 父级常是被提取器穿透的纯容器。渲染器现在沿 truth `parentId`/`ownerPath` 找最近的真实祖先框作约束；当 locator 栈父级是 section（其框宽超过文本自身框 1.5 倍）时，**失去归属资格**，回退到文本自身源框宽 —— section 永远不能当 owner。证据值：`nearest-rendered-owner-box` / `truth-direct-owner-box` / `source-box-after-section-parent` / `source-box-fallback`。

2. **open-flow 改为显式资格**：只有 `truth.openFlow === true`（或 text style 显式标记）才进入 open-flow。原先 `HEIGHT && !framedHint` 的启发式会把固定卡/多列/滑块里有界文本误判成 open-flow 并扩到 section 宽。HEIGHT/FIXED 无显式 openFlow 时保持 framed-fixed，用最近 owner 框或源框宽。

3. **step-fit 改为授权制**：只有 Figma 显式固定高+裁剪/截断/授权（`TRUNCATE`、`truncation: ENDING`、`clipsContent`、显式 `fit:true`）才允许缩字号。无显式截断的 HEIGHT 译文文本保留源 fontSize/lineHeight，可纵向生长；若影响兄弟节点则 human-review，不再一律压到 75%。

### 范围判定新增
- `natural-vertical-growth`：未授权缩放的折行文本纵向生长（HEIGHT），或 WIDTH_AND_HEIGHT 单行因浏览器与 Figma 行高取整产生的 ≤25% 行高的微小漂移（`hugMetricDrift`）。记为证据、非失败。
- 单行/少行 HEIGHT 文本行框取整容忍（`singleLineHeightDrift`，2026-08-06）：Chrome 对 `fontSize==lineHeight` 的单行 HEIGHT 框按近似 normal 度量行高，比稿值大 2~3px。渲染层 `_fitText` 与分类器同步按【源行数】（`box.h/lineHeight`，非测量行数）累计容忍，每行 `max(2, lineHeight*0.25)`，与 `hugMetricDrift` 同一标准。防止把度量能差误缩字号（曾致 233 条集体误缩、含 46 条源语言 zh-CN）；按源行数而非测量行数，避免译文多折行自己抬高容忍。真多行溢出（超额远超累计容忍）仍正常 step-fit。
- auto-layout 消费（`data-auto-layout`，2026-08-07）：truth 的 `layoutMode=HORIZONTAL/VERTICAL`（按钮/标题装饰/技能行标签/日历等）此前只提取未消费（knownGap `layout-not-consumed`），渲染层按源坐标绝对定位子节点，译文变宽后按钮 icon 顶出框、跟随标签（如状态徽章）压住文字、左-标题-右装饰不再居中。现渲染层把 auto-layout frame 变成 flex 容器（gap/padding/对齐用 truth 原值），子节点改 flex item（relative + auto），并对 auto-layout item 跳过 hugging 文本的手动 left+translateX 居中。通用规则只认 layoutMode，不认 node id。
- 水平溢出（`horizontalOverflow`）任何情况下都是失败，不被 natural growth 掩盖。

### 已知缺口（保持显式，不得静默放行）
- `Noto Sans HK` 请求 700 字重无可用字重源（如节点级 fixture 所示），渲染为 700 但无法验证 → `loaded-weight-unverified`，五语言各 1 条，属待补字体源的人工项。
- 移动端窄框（92px）下英文 `Ignited`（源 `已觉醒`，fontSize 28）宽出约 3px → `wrap-or-overflow` 真溢出，3 条（`1:782`/`11:36882`/`11:36885`），需缩字号授权或框宽调整，保持失败。

## 组级最小统一字号 / required-scale prepass（2026-08-10 落地）

通用规则（无 section/node ID/文案特判）：同一组件组的同级标题/正文必须统一字号，
最严格（最长/最易折行）成员决定全组等级，其余兄弟跟随；真实产品线五语言实测基线
（私有证据，见 artifacts/）证实所有组件组（02 奖励卡标题组、03 特别活动标题组、
角色名组、06 列表组、正文组）都组内同字号，最长项折行也不单独缩小。

实现：
- buildFitGroupKey：组标识 = 直接父容器名 + 语义角色 + 源字号。同级同位文本（各卡标题位/
  正文位）共享同一个直接父容器名（02/03 标题槽复用同一组件 Frame 名），比 ancestorNames
  末项稳。parentName 缺失时退回 ancestorNames 末项。
- computeGroupRequiredScales（truth 源 scripts/lib/translation/typography-policy.mjs）+
  renderer runFit 镜像：组内逐成员量所需 scale（未缩=100），取最严格（min）。确有成员溢出
  才统一降全组（含本来不缩的短项）；无溢出则保持源字号（trigger=all-fit-source），保住
  zh-CN 保真与本就合适的语言。

实证边界（重要）：02/03 标题组在 Figma 源稿同为 Alimama ShuHeiTi 60px/700、686x72、
FIXED宽 x HUG高。真实 Chrome 实测（1920x1080 稳定态）五语言下标题元素 offsetWidth=686px
（用满 Figma 槽）、最长行仅占约 38% 宽、无溢出、五语言全部同字号无发散。因此 required-scale
prepass 对 02/03 正确保持源字号 60px——本地渲染忠实 Figma 静态 truth。官网线上版标题约 25px，
是不同设计版本的字号基准，不属于同一 Figma truth 的排版规则；本地不以线上版本覆盖 Figma 源指标。

## 双真源 typography（2026-08-10 用户最终决策落地）

zh-CN 严格遵守 Figma 静态视觉指标（字号/行高/几何），是唯一静态视觉真源；
非 zh-CN 翻译语言以 Figma owner/位置/组件结构为底，组级视觉等级遵守实测归纳的
locale typography 逻辑。证据来自真实产品线五语言 Chrome 实测基线（2026-08-10；
私有证据，见 artifacts/），跨 02 奖励卡、03 特别活动卡、角色名、06 列表等组件组，
按语义角色归纳，不硬编码文案/节点。

关键实证：本地是 2× 高清稿（标题源 60px、正文源 30px），经 stage zoom≈0.398 缩放后的
视觉字号已与官网对齐（标题≈24≈官网25、正文≈12=官网12）。因此本策略**不是盲目缩放源字号**，
而是声明各角色/语言的官网目标视觉等效字号（OFFICIAL_VISUAL_FONT_PX），并由
figma-typography-browser-check 计算每节点的视觉字号（computed × stage zoom）做 on/off-target
诊断（assessLocaleVisualLevel）。

边界与现状（诚实）：
- 该评估是**诊断 evidence**，不进 pass/fail gate；未知角色/语言一律 unverified，不假绿。
- 02/03 标题组（heading-content-card, 源 60px）五语言视觉≈24px，已 on-target，无需缩放。
- 角色分类当前较粗（同 role 下混 60/40/30/28px 多源字号档），对未精细建模的档会误报
  off-target；这些档一律视为待细化/unverified，不作为失败依据。
- zh-CN 不被缩放，任何 non-zh-CN 的 target 都不覆盖 Figma zh-CN 静态指标。
## 非简中官方目标字号落地（2026-08-10 用户最终裁决实施）

zh-CN 严格保 Figma 静态指标；非 zh-CN 在保留 Figma 结构/位置/owner 的前提下，
按官网实测的 locale+角色目标等级重算设计坐标字号/行高，并组内统一。

模型（证据 artifacts/official-locale-typography-20260810.json，真实产品线五语言实测基线；私有）：
本地是 2× 高清稿，线上运行时布局约为一半，故 语言比 = 线上该语言视觉字号 / 线上 zh-CN 视觉字号，
可作用于任意源字号档，不硬编码绝对像素/文案/node。实测：标题粗体(≥600)各语言同级
（en 拉丁略 0.93）；正文常规(<600) ja/en/ko = zh 的 0.8（线上 12/15），zh-TW = 1.0。
该基线表是默认数据源：其它产品线可经 `localeFontScale({ overrides })` 注入自有实测表。

实现：
- policy `officialTargetDesignSize`/`localeFontScale`（truth 源 typography-policy.mjs）
  + renderer `_officialTargetDesignSize` 镜像。同一 role 下用 fontWeight 区分标题/正文
  （标题/正文可能同 role，如 heading-content-card）。
- renderer 在译文渲染处（有真实 locale copy、非 zh-CN）按目标重设 fontSize/lineHeight，
  打 data-official-typography-scale；缺译走 fallback 原文不进此分支（保 Figma 字号 +
  data-copy-missing），绝不拿缺译当目标语言视觉通过。
- 之后仍走组级 required-scale prepass 与容器自然增长；浏览器 evidence
  `localeVisualLevel`（诊断性）记录 ratio/视觉字号。

实测（1920×1080 稳定态，03 特别活动五卡组）：
- zh-CN：标题 60、正文 30（Figma 不动）
- ja/ko：标题 60（同级）、正文 24/28.8（0.8×，对齐官网 12px），五卡同字号
- en：标题 55.8（0.93×）、正文 24
- zh-TW：标题 60、正文 30（与 zh 同级）
- 组内长/短标题同字号，正文组同步，无裁切。截图 artifacts/03-ja-groupfit.png。