---
name: design-policy
description: >
  解析伊瑟/火炬 DESIGN.md 文首 YAML（schema gameweb-design-policy/v1），
  并对照做页实现做数字镜像。不是做页入口，没有用户触发词。
disable-model-invocation: true
---

# DESIGN.md 政策 YAML

本包只做两件事：把文首 YAML 解析成政策对象；拿实现里的数字来对。对不上就红。

不量 DOM。绿只表示数字同源，不表示整份 DESIGN.md 已上屏。

## 入口

```bash
cd standards/design-policy/tool
npm test
node src/parse-design-policy.mjs <path-to-DESIGN.md>
node src/mirror-design-policy.mjs --design <path-to-DESIGN.md> --impl <implementation.json>
```

做页运行时 import 包内 `scripts/lib/design-policy.generated.mjs`（由本工具从 DESIGN.md 生成），禁止把 parse/mirror 源码拷进 `skills/`。改 YAML 后同一批跑：

```bash
node standards/design-policy/tool/src/write-skill-policy.mjs skills/<pkg>/DESIGN.md skills/<pkg>/scripts/lib/design-policy.generated.mjs
```

出页闸仍直接 parse DESIGN.md 并对 generated 快照做镜像。
