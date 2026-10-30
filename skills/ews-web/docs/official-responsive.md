# 官网响应式 → Etheria-ews 消费映射

真源：`https://yise.xd.cn/esports/ews2025` 实测 + `.keel/ews-official-responsive-investigation.md`。本期只映射规则，不替换官网素材/文案。IND 仍用本稿 Hug，不用官网外层全宽 pagination。

| 官网 | EWS |
|---|---|
| `@media (max-width: 750px)` | `DESIGN.md` `mobileMaxWidth=750`；751 走 PC |
| `--vh = innerHeight/100`，屏高 `calc(var(--vh)*100)` | `--ews-screen-h = innerHeight`，不用 CSS `100vh` |
| `html { font-size: 10vw }` | `rootFontVw=10` |
| 宽高比 `>= 1920/1000` 时 `19.2vh` | `wideAspectMin=1.92`，`wideRootFontVh=19.2` |
| 内容尺寸走 rem | `canvasScale = 根字号 / (designWidth * 10vw/100)`；world 仍用稿 px + 该 scale |
| 内页 `.i_7o2gur` flex-grow + `justify-content:center` | 非 kv 屏：`--ews-world-y = (innerHeight - scaledH) / 2`；kv 首屏 `start` 贴顶。高于屏不负偏移 |
| page1 wrap `i_ld68um3u` 不走内页居中 | `img/kv` / `kv` bleed 的屏 `data-content-align=start` |
| PC 整屏背景 `cover` + `center` | 满铺 `bg/`/`kv` 抽到 `.ews-screen-bleed`，`object-fit:cover; object-position:center center` |
| 手机独立图 `cover` + `center 0` | 手机 `object-position:center top` |
| 固定控件 `left/right/top` rem | `fix/` 用 `pinEdges` / constraints 钉视口 rem |
| 短宽屏 cover 裁切、swiper 不露底 | 已确认方案 A：背景 cover；边缘前景独立贴边、按视口高度缩放；短屏整屏翻页，不先屏内滚动 |

2026-10-29 官网实测：选手页 `.i_gyy0v9s2` 为 `left center / auto 100%`，`.i_k9pb1gax` 为 `right center / auto 100%`；底部 `.i_i6ouusv6` 为 `center bottom / contain`。不可把边缘装饰合并为一张居中 cover。证据：`.keel/r31-official.json` 及对应截图。
| QA `.frame` 与 `?product=1` | 同一张政策表，只换 innerWidth/innerHeight 来源 |
| 纵向 Swiper speed:300 ease threshold:30 | 轨道 transform 300ms ease；触摸过 30px 后跟手；默认整屏模式非零滚轮输入触发翻屏；动画锁 |
| 横向 IND 两态 300ms ease-in-out | 点宽/贴图随 current 切换，Hug 容器从 LEFT 收缩 |
| `.topBar` 全程 y=0，不跟纵向 swiper | 当前屏 `fix/顶部导航栏|通栏` 抽到 track 外 `.ews-nav`，绑定产品视口 / QA `.frame` |
| active 在转场开始附近切换，背景 opacity 300ms ease-in-out | `data-nav-active` 在 `goTo` 开始同步；`.ews-nav-layer` 用 `--ews-nav-fade`/`--ews-nav-fade-easing`（默认 300ms ease-in-out）。中途必须能采到 0–1 之间的 computed opacity。各屏仍用该屏稿实例，不复用首屏 |
| `.topBar .mediaGroup` 另有 fixed / 50vh 规则 | 本期不提升底部装饰或侧社媒 |

998×1080 旧空洞：PC world 只按宽缩到约 561px，屏壳仍 1080，底部露出 QA/壳底色。现背景 cover 铺满，内容保持根字号缩放。

官网 1920×700 本就 cover 裁切背景。用户于 2026-10-28 确认短屏方案 A；默认整屏翻页，超高正文会被裁切，不把该裁切说成“无溢出”。
