# 做页：切页面语言时同步切 img/ 的 lang 变体

给詹欣仪 / `zhanxinyi-lab`。本仓不改 `skills/yise-web-ui`。

GitHub：https://github.com/PraiseZhu/project-gameweb/issues/62

## 契约

只有同时满足才跟页面语言换图：

1. 组件集前缀 `img/`
2. 变体属性名 `lang`
3. 至少两个不同的精确小写 `cn` / `tw` / `en` / `jp` / `kr`；只有这些合法变体根切图

映射：

| 页面 `prefs.lang` | 变体 |
|---|---|
| `zh-CN` | `cn` |
| `zh-TW` | `tw` |
| `en` | `en` |
| `ja` | `jp` |
| `ko` | `kr` |

整页语言 key 仍是 `zh-CN`。`region=cn` 是国服，不是语言。

## 不要做

- 没有 `lang` 轴、单变体、普通 `img/`、`Property 1=cn` 的 logo：当普通图，不跟语言
- 缺变体不要回落默认中文图，fail-visible（对齐文案 `data-copy-missing`）
- 不要改 `skills/yise-web-ui` 以外的命名规范仓职责

## 做页漏洞（实现时要避开）

- 空 INSTANCE 现在挂稿上选中的那棵 `componentId`，切语言后要按页面语言重选变体树
- 变体树宽高差 >0.5px 会丢掉整棵图；语言变体允许高度跟着字走
- PC / mobile 各切各的，不要拿 PC 的 `tw` 填手机框

## 清单侧已锁

页上用到的 `img/` + `lang` 组件集，至少两个不同的精确小写合法值时，这些合法变体根带 `sliceExport`。单变体、`CN` / `xx` 当普通图。未画的语言不挡出清单 ready。
