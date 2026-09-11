---
name: skill-shared
description: >
  伊瑟/火炬 skill 公共文件清单：预览、校验漂移、按清单拷贝。
  默认不覆盖已经分化的文件。不是做页入口，没有用户触发词。
disable-model-invocation: true
---

# skill 公共文件同步

两个做页 skill 自包含、互不 import。公共脚本现在是各拷一份。
本包只做一件事：按清单看两边是否还一致，必要时从一边拷到另一边。

不把公共代码抽成第三个包。skill 仍然各自发布。

## 入口

```bash
cd standards/skill-shared/tool
npm test
node src/sync-shared-files.mjs preview
node src/sync-shared-files.mjs check
node src/sync-shared-files.mjs apply --from torchlight-web --to yise-web-ui --dry-run
```

- `preview`：列出一致 / 漂移 / 缺失 / 未进清单
- `check`：清单内漂移或缺失则红
- `apply`：跨 skill 默认只 dry-run，打印将写入的路径，不落盘
- `apply --write`：才真正拷贝；只补缺失；清单内已经不一样的文件默认跳过
- `apply --write --copy-drift`：才把清单内漂移从 `--from` 覆盖到 `--to`

未进清单的同路径文件一律不碰。那是各 skill 已经特化过的副本。火炬固定链路不得对伊瑟执行 `--write`。
