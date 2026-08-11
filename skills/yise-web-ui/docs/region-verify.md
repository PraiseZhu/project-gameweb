# 区域级视觉验收 + provenance 诊断（figma-region-verify）

## 解决什么
现有三道验收各有盲区：
- `figma-render-check.mjs`：整页结构断言（节点数/坐标/嵌套）——粗粒度，管不了"那一块"。
- `figma-chrome-check.mjs`：壳冒烟（控件/合约）——不看产品层区域。
- `pixel-compare.mjs`：整页像素 diff——给一张红图，不说"为什么"。

用户/设计报的常是"**那块**漏层 / 错框 / 被裁 / 层级压错"。本框架把验收粒度从整页收到**一个 Figma 区域/节点**，把诊断从"像素不同"升到"结构原因"。

## 数据流（end-to-end provenance）
```
Figma 参考区域/节点
  ──truth──▶ 该区域该有哪些节点、在哪、多大（来自 truth.json = Figma 静态稿）
  ──DOM────▶ 现测：可见性 / clip / z-index / computed background·border·shadow / 尺寸
  ──Chrome─▶ 该区域局部截图（结构证据的图证）
```
真值只来自 `truth.json`。子树归属用节点 id 叶子的 `provenance.locator`（被门 A 校验过的 Figma 树位置），**不手填参考、不伪造基线**。

## 调用方式
```js
import { runRegionVerify, formatRegionReport } from '<skill>/scripts/lib/figma-region-verify.mjs';

const report = await runRegionVerify({
  demoDir: 'demos/<demo>',
  viewport: { w: 1920, h: 1080 },
  screenshotDir: 'artifacts/region-verify',   // 可选；给了才截图
  regions: [
    { name: 'sec3-卡片边框背景', sectionId: '1:467', nodeId: '1:469' },   // 按节点
    { name: 'sec1-首屏',         sectionId: '1:952', box: { x: 0, y: 0, w: 3840, h: 2160 } }, // 或按区域框(truth 设计 px，相对 section)
  ],
});
console.log(formatRegionReport(report));   // 可操作诊断文本
// report.ok / report.regions[].diagnosis{missing,hidden,zeroSize,clipped,zIndexed} / .nodes(有问题的) / .screenshot
```

挂进 verify：在 `spec.customGates` 加一个薄壳脚本（同 `_chrome-browser-rail-gate.mjs` 先例），内部 `runChromeRegionVerify` 后按 `report.ok` 退出 0/1。**本框架本身不改 verify.mjs / gates.mjs 内核。**

## 诊断维度（每个节点现测）
| 维度 | 判定 | 含义 |
|------|------|------|
| missing-in-dom | DOM 里查不到 data-node | 漏渲染 |
| not-visible | display/visibility/opacity | 被隐藏 |
| zero-size | 宽高<0.5 且无图无字 | 漏层/被压没 |
| clipped-by:X | 被某 overflow:hidden 祖先裁到**完全不可见** | 真漏层（宿主 id 给出） |
| z-index / position / overflow / background / border / shadow / clip-path | computed 现测 | 层级与样式取证 |

## 一条纪律
局部截图只是"让诊断可被肉眼复核"的图证，**不做像素 pass/fail**。像素对账仍归 `pixel-compare.mjs`（它才有 baseline 纪律）。这里若引入像素判定就得自带 baseline 真源，必然漂移。

## 局限（诚实边界）
- **坐标系**：clip 判定用 getBoundingClientRect（屏幕 px，含 zoom），在 frame 1:1 时最准；壳视图缩放(fit)时几何仍对（同系相比），但截图 clip 用 scale() 换算，极端缩放下截图边缘可能差 1px。
- **clip 只报"完全不可见"**：越出卡片/列表框但仍部分可见是 Figma 允许的设计（clipsContent 只裁超界部分），不报——避免把设计当 bug。这意味着"部分被裁但还能看见"的软问题不在本框架射程，归 pixel-compare。
- **z-index 只现测数值**，不判断"压错没"——层级对错需要参考顺序，truth 的 DFS 顺序是绘制序，但"谁该压谁"的语义判定未做（待有真实层级回归案例再补，不预先伪造规则）。
- **asset bounds**：节点的 `data-asset-bounds`/`exportBox` 越界检查在 renderer 已有 `data-asset-bounds` 留痕，本框架读取但未对 exportBounds 做独立阈值断言（与 render-check 的坐标门重叠，避免双份规则漂移）。

## 演示（真实页面，非伪造参考）
`artifacts/hero-breakpoints/region-demo.mjs` 跑 sec/3-赛季奖励 两个真实节点：
- `1:469`（卡片边框背景）：✓ 期望 1 节点，无问题。
- `2:31284`（卡片容器，131 节点）：✗ 抓到 **30 条 clipped-by**——如 `12:48615`（2.5×2.5px 小节点）中心虽在宿主 `1:475`(overflow:hidden) 内却被裁到完全不可见（probe5 实测取证）。这正是"漏层/裁切"类问题被结构化定位、并附局部图证（`artifacts/region-verify/sec3-_-2_31284.png`）。

## 文件
- 新增 `scripts/lib/figma-region-verify.mjs`（通用，唯一实现）
- 新增 `docs/region-verify.md`（本文档）
- 演示 `artifacts/hero-breakpoints/region-demo.mjs`、取证 `artifacts/hero-breakpoints/probe5.mjs`
- 未改 verify.mjs / gates.mjs / pixel-compare.mjs / render-check / chrome-check / 任何 demo 产物 / geo3 在改文件
