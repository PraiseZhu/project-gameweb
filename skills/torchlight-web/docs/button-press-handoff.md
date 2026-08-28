# Button hover / press — Interaction Skill handoff

合入范围只在 Interaction。不要改 Main / Resize / 翻译 / 切图。

## 改了什么

程序态手感，不是 Figma 变体：

- hover：`filter: brightness(1.12)`，仅 `@media (hover: hover)`
- press：`filter: brightness(0.88)`，`:active`，无过渡
- 键盘：`role=button` 上 Enter / Space → `click()`
- `disable`：`data-btn-press="inert"`，无手感

和稿内 `Property 1=highlight`、导航选中不是同一套。

## 文件

- `scripts/lib/figma-button-press-contract.mjs` 新增
- `scripts/lib/figma-interaction-contract.mjs`
- `scripts/lib/figma-render-interaction-adapter.mjs`
- `templates/figma-render.js` 只加 CSS / role / press 标记
- `docs/interaction-skill.md`
- `SKILL.md`
- `scripts/__tests__/figma-button-press-contract.test.mjs` 新增
- `scripts/__tests__/figma-interaction-contract.test.mjs`

## 验证

```text
cd skills/torchlight-web
node --test scripts/__tests__/figma-button-press-contract.test.mjs scripts/__tests__/figma-interaction-contract.test.mjs scripts/__tests__/figma-render-interaction-adapter.test.mjs scripts/__tests__/figma-render-interaction-seam.test.mjs
```

31 passed.

## 接着合入的 v2.13 运行时

老师仓 `d9cb707` / PR #59：命名规范补 `@from` 与按弹窗名接线的 `@go`。这是 Interaction，不是 Resize。

- `@go=modal/名字`：按弹窗图层名唯一命中才开窗，多入口可共用
- `fix/导航@from=2`：滚到第 2 屏及以下才出现并钉视口
- 对不上或同名弹窗保持 unresolved，不猜

## 合入后页面应出现

- 下载 / 充值 / 官网 / 播放 / 关闭 / 箭头 / tab / indicator：手型 + 提亮 + 压暗
- 没有 `@link=` 的按钮：有手感，点了不跳，带 `data-btn-action="unresolved"`
- `btn/角色头像` disable：不提亮、不能点
- 多语言 / 导航 / 角色头像的 highlight 仍走组件变体，不是 CSS 滤镜
