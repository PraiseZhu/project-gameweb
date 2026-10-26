# Etheria-ews 契约

基线 SHA：`da048b61f86af9cd35940a5287aca240bcbcd729`。

## 入口

```bash
cd skills/ews-web
npm run ewsweb -- --handoff <dir> --assets <asset-map.json> --config <ews-config.json> --out <out> [--lark <json>] [--designations <json>]
```

相对路径：CLI 文件相对 cwd；配置内部相对配置文件。输入验证失败非零且不生成页面。`--out` 不得与输入/Skill 源码碰撞；已有非空目录必须带有效 `.ews-generated` 标记。拒绝输出树内符号链接和多硬链接文件，拒绝媒体键路径穿越。文件系统 I/O 失败不能视为成功；已有输出不具备事务回滚保证。

## handoff/v1

核 `schema`、`kind=ready`、`ready=true`、官方 fingerprint、`ends`、`pages`、`consume.*.snapshotHash` 声明 vs 清单 `snapshot.hash`、切图 ids、**auditLikeCli completeness**、**auditDeclaredStructure**。fingerprint 算法与 `standards/figma-naming/tool/src/handoff.mjs` 的 `fingerprintInventories` 一致。`snapshot.hash` 非空且与 consume 声明一致；未重算远端 Figma，不得声称已核远端。

同一输入官方 `validateHandoffPack` 拒绝时，EWS `loadReadyPack` 也必须拒绝。

## 五文件闭包

`ready-handoff-truth` 等只做 truth 适配。外层拒绝 draft / green-draft，不暴露 allowDraft。

## 文案

Lark `{_meta:{langCols,phaseRows},rows}`。传入 extractCopy 的是 phaseRows 限定视图。指认必须命中本端实际 TEXT；推断拆句 `takeCount` 默认为 1。unresolved / 缺 locale 不得 `translationAccepted=true`。来源 hash：有文件时用字节 sha256（`hashKind=file-bytes`）。

## 资源

测试用 PNG 是按 fixture 坐标生成的纯色图，不是 Figma 导出或旧素材放大。fixture 字体文件内部名称为 Noto Sans，版权为 The Noto Project Authors（2022），附 OFL.txt；测试中的 Source Han Sans 只是 CSS 别名，不证明真实思源字体或中文覆盖已验收。真实赛季必须提供实际字体与媒体。

asset-map 路径相对 map 目录；校验全部 slice ids、sha256、PNG 尺寸、字体登记。CLI 复制到 `out/assets|fonts|media` 后写入相对 URL。

## 运行时

见 `DESIGN.md`。短屏屏内滚动到边界再翻页。resize 跨 750 重挂端树并保留 locale/screen。锁覆盖 `goTo`/导航。

跨端重挂按唯一 modal 名称恢复弹窗与锁；关闭动作只来自 determined 的 btn/close，不按节点 ID 后缀猜测。TouchEvent 与 Chromium CDP 触摸分别验证，横向轮播不翻主屏，destroy 移除所有手势监听。
