# Figma Prototype Truth

`figma-prototype-truth/v1` is an optional, reusable, read-only evidence audit
for prototype interactions and motion claims. It is not a prerequisite for the
Main, Translation, Interaction, or Resize Skill workflow.

This conclusion is scoped to the optional Prototype Truth Audit. It does not
block the normal demo, Translation, Interaction, or Resize workflow. Use
`npm run prototype:audit -- --fixture <snapshot.json>` only when an explicit
observed-prototype gate is required.

## 证据等级

- `observed`: fixture/API node JSON contains a non-empty `interactions` or
  `reactions` list, or explicit `transition`/overlay transition fields.
- `explicit-empty`: the snapshot contains a prototype field, but its value is
  empty. This proves only what this snapshot returned; it does not prove that
  the design has no motion.
- `static-component-metadata`: only `componentProperties`,
  `variantProperties`, or `componentId` is present. These describe component
  state/variants and are not timing/easing or interaction evidence.
- `field-absent`: the inspected node has none of the supported prototype
  fields. Keep motion `unverified`.
- `unavailable`: no node/snapshot was available. Keep an explicitly requested
  audit fail-closed; do not block ordinary demo construction or release.

Use `inspectPrototypeTruth()` for one node,
`inspectPrototypeSnapshot()` for a fixture, and
`buildPrototypeTruthGate({ requireObserved: true })` when a task explicitly
requires actual Figma prototype evidence. The default
`buildPrototypeTruthGate(snapshot)` is non-blocking and reports `unverified`
when no observed evidence exists. `extractPrototypeLeaves()` is the generic
truth adapter; it wraps source fields with the existing fixture provenance and
does not infer values from names, variants, screenshots, or the official site.

## Properties 面板边界

Figma Properties/Design 面板展示静态节点信息、组件属性和导出设置。单张
Properties 截图不能证明页面存在时间动画、easing、scroll trigger 或 overlay
transition。Prototype 面板的 interaction/reaction，或 Figma API 返回的对应
字段，才是 Figma motion truth。官网只能补充可观察行为，不能替代缺失的
Figma prototype 数据。

## 当前 fixture 结论（2026-08-06）

`figma-page.json`、`figma-mobile-probe.json`、`figma-sec3.json` 和
`_probe-sections.json` 都包含 `interactions`，但机械统计得到的数组全部为空；
它们含有非空 `componentProperties`。当前快照没有发现非空 `reactions`、
`transition`、`prototypeStartNodeID`、`overlayPosition` 或
`preserveScrollPosition`。因此 Etheria fixture 的 Figma prototype motion
状态必须标记为 `unverified`，不能从 Properties 截图或 component variants
推断 motion。

当前抽取器已能在需要时保留 `extractPrototypeLeaves()` 支持的源字段；若字段
不在 fixture，就不会伪造 truth。没有真实 API/Prototype 数据时，Chrome motion
行为证据只能标记为行为观察，不能升级为 Figma truth。
