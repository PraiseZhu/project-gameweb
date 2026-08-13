# figma-naming — 图层命名规范与体检工具

设计稿的图层该怎么命名，以及一套按这份规范逐层体检的工具。

分成两半，各看各的：

| 你是 | 看这里 |
|---|---|
| 设计师 —— 我该怎么给图层起名 | [`spec/naming-spec.md`](spec/naming-spec.md) |
| 想体检自己的稿 | [`tool/README.md`](tool/README.md) 的「快速开始」 |
| 要改判定逻辑 | [`tool/CLAUDE.md`](tool/CLAUDE.md) |

## 为什么分成两半

```
figma-naming/
├── spec/     规范正文 —— 人读的约定，不含代码
│   ├── naming-spec.md            前缀总表、@参数、判定边界（当前 v2.7）
│   └── consumer-assumptions.md   规则「不改会怎样」所依赖的下游假定（A-v1.5）
└── tool/     体检工具 —— 按规范查稿的实现
    ├── src/ bin/    判定代码与命令行
    ├── plugin/      Figma 插件（主要交付形态）
    ├── test/        379 项测试
    └── scripts/     构建、闸门、台账
```

**规范能独立成立，工具不能。** 规范正文里全是通用约定，拿掉工具照样能用来指导命名；
工具的每一条判据都指向规范里的某一条，没有规范它不知道该判什么。

依赖方向因此是单向的：`plugin/ → src/ → spec/`，反向零依赖。
`tool/src/spec.mjs` 是规范的机器可读镜像，两者由 `tool/test/spec-drift.test.mjs`
锁住一致——改了规范正文不同步镜像，测试立刻红。

## 规范升版

改规范不是改一个文件的事，顺序不能反：

1. 改 `spec/naming-spec.md`，更新版本行与 §8 变更表（附证据，别只写结论）
2. 在 `tool/` 下跑 `npm test` —— **应该立刻因漂移测试失败**。这一步在验证门禁本身有效
3. 同步 `tool/src/spec.mjs` 的版本号与相关表
4. 涉及新判定 → 先进规范 §6 清单表，再在 `tool/src/rules.mjs` 补 `why` / `fix`
5. 涉及新后果 → 先看 `spec/consumer-assumptions.md` 有没有对应假定，没有就先加假定并升版
6. 两头测：故意犯一次要触发，干净稿要保持 0 报警
7. `npm run rules` 重新生成 `tool/docs/RULES.md`

## 与 skills/ 的关系

`skills/` 下各个游戏页 skill 按这份规范解析图层名。
`tool/scripts/check-skill-sync.mjs` 检查它们用的角色词表与规范总表是否一致：
用了总表没有的角色 → 硬拦；已登记待复审的 → 警告，过期自动升级为硬拦。

在 `tool/` 下跑 `npm run check:skills`，或 `npm test` 时自动跑到。
