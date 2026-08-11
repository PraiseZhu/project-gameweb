# Typography Diagnostics

`yise-web-ui` 将多语言文字验收拆成三条独立链路：

1. **copy mapping**：Figma TEXT 与 Lark row 的对应、值来源和 provenance。它只回答“采用了哪一行”，不回答字重、字宽或换行是否正确。
2. **font/glyph/weight**：Figma 的 `fontFamily`、`fontWeight`、`fontSize`、`lineHeight`、`letterSpacing`、`autoResize` 是请求真值；浏览器需要报告字体是否加载、请求字重是否可用、是否发生 synthetic weight、字形是否回退。
   字重判定区分两个来源：Figma 源字重（保留在 `source.style`，如 en 标题 700）与 font routing 的【路由后请求字重】
   （如 en 标题被路由到仅 400 的 Bebas Neue，官网实测该字体只有 400）。synthetic-weight 判【路由后请求】是否落在
   实际加载字体的可用字重里：en Bebas 请求 400、可用 [400] → requested-weight，不是 synthetic；源 700 仅作对照，
   不假装 400 满足了 700。只有路由后请求的字重字体文件里真没有时，才如实报 synthetic-weight。
3. **browser range**：用真实 DOM 的 computed style、`Range.getBoundingClientRect()`、`client/scroll` 尺寸和裁切属性，分类为正常适配、正常换行、step-fit、溢出、预期截断或未验证。

## Generic contract

`scripts/lib/translation/index.mjs` 是可复用翻译 Skill 的稳定入口；旧的
`scripts/lib/figma-typography.mjs` 仍保留兼容导出。分类器不依赖页面节点 ID：

- `classifyFontWeight`：请求字重不可用时返回 `synthetic-weight`，不把浏览器合成加粗当作保真通过。
- `classifyTypographyRange`：按 Figma `autoResize` 区分 hugging 文本、固定宽度换行和明确的 `TRUNCATE`；没有明确截断语义时，裁切/溢出报红。
- `classifySemanticText`：只用通用 role/name/祖先语义作证据分组，支持 `fixed-nav`、`large-heading`、`calendar-table`、`card-frame`；不接受 Etheria 节点 ID。
- `summarizeTypography`：按语言和语义类汇总，copy unresolved 不进入 typography pass/fail。

真实浏览器采集入口：

```bash
node scripts/lib/figma-typography-browser-check.mjs \
  --demo demos/yise-ss5-preview \
  --langs zh-CN,en,ja,ko,zh-TW \
  --out artifacts/typography-coverage.json
```

采集结果必须保留 language、node provenance 对应的 Figma style、computed family/weight、字体 readiness、glyph gap、Range/scroll/client 尺寸、clip/ellipsis 和 fitScale。没有 Chrome 时命令退出阻塞码，不伪造视觉通过。

## Language + role font routing (source truth)

The renderer no longer keeps the Chinese source family for every language.
`scripts/lib/translation/font-routing.mjs` maps a normalized language + a
coarse generic role to the Figma-source family, then preserves the source text
weight except for Latin display text. Current mapping: zh-CN title/button =
Alimama ShuHeiTi, zh-CN body = FontquanXinYiGuanHeiTi; en title/button = Bebas
Neue, en body = Noto Sans; ja all = Noto Sans JP; ko all = Noto Sans KR; zh-TW
all = Noto Sans HK.

The role comes from the node's own SOURCE font family (a display family means
title/button, the body family means body), not from a page/node id or selector.
So one structural role (e.g. a content card) that mixes a title and a body text
routes each correctly. zh-CN resolves to the very same families already present
in the source, so nothing changes for zh-CN.
If the source node already uses a Noto family, zh-CN keeps that exact family;
other languages route it to their target Noto body family while preserving the
source weight. This covers special source nodes such as `Noto Sans HK 700`
without degrading them into a generic Chinese body face.

The 2026-08-07 official SS5 pages show the same split for the international
routes: en body uses `"Noto Sans"` and `BebasNeue` for Latin display; ja uses
`NotoSansJP`; zh-TW uses `NotoSansHK`; ko declares `"Noto Sans"` and falls back
to the platform Korean font for Hangul in Chrome. The harness keeps the explicit
Noto Sans KR route for stable cross-machine rendering, but no longer flattens
the routed text weight to 400.

A family whose local file is absent is still routed by its truth name and is
never silently replaced: `figma-fonts` lists it in `missing`, and the browser
evidence exposes the gap (`availableWeights` empty / `loaded-weight-unverified`).
Noto Sans JP/KR/HK now use variable fonts where available so routed 400/700
weights do not silently become synthetic weight.

## Current known gap

`node scripts/figma-fonts.mjs --demo demos/yise-ss5-preview --dry-run` 应报告 `missingCount: 0`。如未来新增语言字体文件缺失，继续按缺字体清单暴露，不静默替换、不修改 Figma style，也不声称字重保真。

step-fit 只是一条带语言和节点的适配记录；`data-fit-scale`/`data-fit-overflow` 不能被隐藏。没有明确 Figma truncation 语义时不添加 ellipsis，不用固定字号掩盖缺字体或缺字形。
