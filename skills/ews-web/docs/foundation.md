# Etheria-ews 基础闭包

合成 fixture 只证明机制，不是新赛季验收。

## 命令

```bash
cd skills/ews-web
npm test
npm run release:audit
npm run test:browser
```

## 证据边界

- Node 单测覆盖官方闸正反例、资源相对 URL、英文绘制树、指认拒绝、锁/节流。
- `test:browser` 复用仓内已装 playwright-core（测试驱动路径，不写入发布运行时代码）。通过不等于真实赛季页。
- 未提供：新赛季稿、翻译、Figma `1429:3019` / `392:24201`、透明按钮、日历命名、远端 snapshot 重算。
