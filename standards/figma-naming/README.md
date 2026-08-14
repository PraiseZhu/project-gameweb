# figma-naming — 图层命名规范与做页前清单

设计稿图层怎么命名，以及把**已规范命名稿**编成做页前 `inventory/v2` ready 清单。
体检命令和 Figma 插件仍在，但不是本轮交接入口。

分成两半，各看各的：

| 你是 | 看这里 |
|---|---|
| 设计师 —— 我该怎么给图层起名 | [`spec/naming-spec.md`](spec/naming-spec.md) |
| 要把已规范命名稿交给做页 | [`tool/README.md`](tool/README.md) 的「做页前交接：inventory/v2」 |
| 想体检自己的稿 | [`tool/README.md`](tool/README.md) 的「命名体检快速开始」 |
| 要改判定逻辑 | [`tool/CLAUDE.md`](tool/CLAUDE.md) |

现行交接：人给已规范命名、带 `node-id` 的货架链接 → `npm run inventory` → `_tmp/inventory-<page>.json`（`schema=inventory/v2`、`status=ready`）→ 做页先消费已确定项。不写回 Figma，不用插件交接。做页接入见 issue #5（指派 `zhanxinyi-lab`）。

## 为什么分成两半

```
figma-naming/
├── spec/     规范层 —— 人读正文 + 机器表
│   ├── naming-spec.md            前缀总表、@参数、判定边界（当前 v2.8）
│   ├── consumer-assumptions.md   规则「不改会怎样」所依赖的下游假定（A-v1.6）
│   ├── spec.mjs                  机器可读镜像（插件 / 体检 / skill 都读这里）
│   └── inventory.mjs             inventory/v2 取值表
└── tool/     工具层 —— 按规范查稿、抽取 inventory/v2、人工核对
    ├── src/ bin/    判定代码与命令行（含 inventory）
    ├── plugin/      Figma 插件（既有命名实现，非本轮交接入口）
    ├── test/        测试
    └── scripts/     构建、闸门、inventory 核对页
```

**规范能独立成立，工具不能。** 规范正文里全是通用约定，拿掉工具照样能用来指导命名；
工具的每一条判据都指向规范里的某一条，没有规范它不知道该判什么。

依赖方向因此是单向的：`plugin/ → tool/src/ → spec/`，反向零依赖。
`spec/spec.mjs` 是规范的机器可读镜像，两者由 `tool/test/spec-drift.test.mjs`
锁住一致——改了规范正文不同步镜像，测试立刻红。
`tool/src/spec.mjs` 只做兼容转发，新代码不要再从那里读。

## 规范升版

改规范不是改一个文件的事，顺序不能反：

1. 改 `spec/naming-spec.md`，更新版本行与 §8 变更表（附证据，别只写结论）
2. 在 `tool/` 下跑 `npm test` —— **应该立刻因漂移测试失败**。这一步在验证门禁本身有效
3. 同步 `spec/spec.mjs` 的版本号与相关表
4. 涉及新判定 → 先进规范 §6 清单表，再在 `tool/src/rules.mjs` 补 `why` / `fix`
5. 涉及新后果 → 先看 `spec/consumer-assumptions.md` 有没有对应假定，没有就先加假定并升版
6. 两头测：故意犯一次要触发，干净稿要保持 0 报警
7. `npm run rules` 重新生成 `tool/docs/RULES.md`

## 与 skills/ 的关系

做页 skill 吃的是 `inventory/v2` ready 清单里的已确定项，不是再从裸图层名猜角色。
`tool/scripts/check-skill-sync.mjs` 仍检查各 skill 用的角色词表与规范总表是否一致：
用了总表没有的角色 → 硬拦；已登记待复审的 → 警告，过期自动升级为硬拦。

在 `tool/` 下跑 `npm run check:skills`，或 `npm test` 时自动跑到。
本工具不改 `skills/yise-web-ui/**`。
