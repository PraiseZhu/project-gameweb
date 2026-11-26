# B2-Font 真实容器测试夹具

这些文件由本项目测试用的原创几何路径生成，不来自下载、系统字体或游戏 Skill。中文和字母码位映射到诊断轮廓，不用于产品排版。

| 文件 | 轮廓及覆盖 |
| --- | --- |
| `one-page-variable.otf` | 带真实插值的 CFF2 OpenType，`wght` 100–900（默认 400），覆盖「首页金币」与 `A`。 |
| `one-page-static.otf` | CFF OpenType，静态 400，用于与静态 TTF 的排序对照。 |
| `one-page-variable.woff` | 独立生成的 WOFF 1，内层为有 `glyf`/`gvar` 的 TrueType，不是 OTF 或游戏字体的包装变体；`wght` 300–800（默认 400），覆盖「首页金币」与 `BC`。 |

生成时使用了本机既有 FontTools；并用 FreeType 直接打开这三个文件、栅格化字形，核对可变字重两端的轮廓和位图不同。测试直接读取仓内二进制，只用 Node 和 one-page 既有解析器，不需要字体生成或渲染工具。
