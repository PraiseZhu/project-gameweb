---
name: stop1-figma-pixel
description: >
  停1像素门真源：每屏截已有页对规范稿分区图。不是做页入口，没有用户触发词。
disable-model-invocation: true
---

# 停1像素门

做页 skill 只转口本包。改口径只改 `tool/src/`。

Callers: 各做页 skill 的 `stop1-figma-pixel-*.mjs` 转口；`figma-html-from-handoff` 出页闸。共享默认 skip 仍是 mobile `949:6041`，给伊瑟纯 re-export 用。火炬转口另有自己的 skip，并强制覆盖 `STOP1_PIXEL_SKIP_JSON`。Playwright 从当前 demo / skill 根解析，不再同时候选两个做页包；火炬转口会写入 `PLAYWRIGHT_MODULE_ROOT`。坏的 skip JSON fail-closed，形状必须是平台到字符串数组。
Schema: `stop1-figma-pixel-gate/v1`。
User: 「按照选项优化，优化完告诉我能提速多少」

## 入口
产品 probe 的 mobile 视口使用 section 列宽，不使用横向货架 page 宽。

```bash
cd standards/stop1-figma-pixel/tool
npm test
node src/stop1-figma-pixel-probe.mjs --demo <dir> --handoff <dir>
```

不重编 Main。标准图按分区用节点导出拼 CN 快照：`img/` 语言轴用 CN 母版贴进实例框，不抠韩文。关合 `dropmenu/` 只贴 `img/icon`，不拿 370 高实例框。活字 TEXT 由清单静态闸对字符/字号/框，像素门遮掉这些区，不拿 Figma 栅格当字。后几屏 Figma 不给 URL 时，复用已缓存的同组件同尺寸层。缓存文件：`demo/artifacts/stop1-pixel/figma-cache/<fileKey>.<id>.s<scale>.<snapshot>.png`。`<snapshot>` 来自 inventory `snapshot.hash`（没有 hash 才用 `lastModified`）。换稿会换文件名；强制重下加 `--refresh-figma-cache`。读缓存 PNG 失败当 miss，不整轮红；写入先写临时文件再 rename。

阈值 0.005。skipPreview 不许绿。
