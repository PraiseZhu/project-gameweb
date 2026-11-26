## 问题 / 背景

归属 C 环节总 Issue（发布时挂接父子关系），追踪 #151。前置 B3 #166 已合入；在独立工作树以 B4 合并后的 main 为基线。

## 方案

1. **入口**：调用 `checkHandoff`，以外部 `--expect-version` / `--scope-version` / `--consumer-contract` 验证已放行的 B3 包；篡改、过期、范围或契约不符直接阻断，不留正式产物。
2. **导出**：仅纯矢量且无位图填充、复杂滤镜、模糊混合等超限特性可导 SVG。超限自动走无损位图并在 manifest 记原因。使用 mock Figma 覆盖 SVG 与降级路径，不写回 Figma；令牌不进日志、错误正文或清单。
3. **WebP**：以 Pillow 对 PNG 逐像素查 Alpha，任意像素 Alpha <255 必须无损，全不透明（含 RGBA）走有损。统一 quality=90、method=6，不裁不缩；复验合法 WebP、原尺寸和画质，无损像素零失真，编码器缺失明确阻断。只读参考仓内旧算法，复制适配至 one-page 自维护，不新增第三方依赖。
4. **字体**：只从已核验 B3 的 resources/fonts/ 复制基础语言实际使用的字体和许可至 css/font/，核对 SHA-256；断开原 B 运行目录和宿主库仍可生成与校验。
5. **H23 与体积**：原始、备用及既有历史素材保留且准确登记，绝不删除或覆盖历史轮次；单视频 >15 MB、目录总量 >120 MB 仅计量告警，不改画质、不删图。
6. **产物**：新增 c:assets；原子发布 runs/<run>/c1.rN/，禁止覆盖旧版。assets/manifest.json 为 onepage-c-assets/v1，记录 module、layer、nodeId、box、visualFingerprint、sha256、format、lossless、hasAlpha、fallbackReason、path 等；包内路径为 POSIX 相对路径。统一 stage-record.json 使用 c-assets，checkEntry 核验迁移、完整性及篡改反例；同输入稳定摘要一致。
## 验收条件

真实 Pillow PNG→WebP 和 Alpha 像素、mock Figma 导出、基础语言字体及许可、断源迁移、历史素材、原子失败、体积告警与确定性均覆盖正反例。单测不依赖宿主字体目录；在真实 HOME 不外设 ONEPAGE_FONT_DIRS 跑 one-page 全量、figma-naming 771/771、B3/B4 回归、release:audit 与 git diff --check。

## 不做

- 不生成 HTML/CSS/JS 页面（C2）、不执行 D01～D13 或像素门（C3）、不做点对点改稿（C4）。不改 Figma/飞书；不修改或在运行时导入旧游戏 Skill。
- 开发、测试、推送任务分支、开 Draft PR、CI 全绿后转 Ready；独立复审与验收通过后才提交，不绕过钩子。不自动合并，不关 C 总 Issue 或 #151，不提前启动 C2。

## 未决项

无。
