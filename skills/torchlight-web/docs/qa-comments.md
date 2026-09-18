# QA 页面评论

在 QA 工具栏点击气泡「评论」，点选内容或从一个元素拖到另一元素，弹层会显示蓝色范围框。下拉框可以把文字扩大到父级内容块；确认蓝框后输入评论并发布。点图钉查看，修改页面后刷新，点击「✓ 标记已解决」隐藏图钉。已解决条目仍能从列表恢复。

「全部评论」默认汇总当前页面所有语言、地区、状态、版式的未解决条目。点击条目会切回对应组合并滚动到内容。也可筛选当前组合和已解决条目。平铺状态下须先退出平铺才能创建；从列表打开条目会自动退出平铺。

## 存储和同步范围

- IndexedDB 数据库：`gameweb-qa-comments`，版本 1，对象仓库 `comments`。事务提交成功后才提示保存成功；失败时保留输入。
- 页面键：`__qaDemo.commentPageId`，可选且须持久稳定；默认使用移除末尾 `index.html` 后的 pathname。origin 由浏览器隔离。不同页面使用相同 pathname、靠 query 区分时必须声明不同 pageId。
- 每条记录包含语言、地区、页面状态、PC/mobile 版式、内容的完整 `data-node` 路径、块内相对位置、创建时视口、正文、创建/更新时间和解决状态。
- 没配置 commentApi 时，同一浏览器、同一 origin、同一存储分区的标签页用 BroadcastChannel 通知重新读取；不同同事、浏览器、配置文件或设备不共享本地库。
- 配置 commentApi 后，IndexedDB 是本地缓存，Worker API 是共享源；POST 保存，GET 每秒轮询。轮询间隔不代表实际同步延迟。
- Worker 使用 @xd-cell/worker-sdk 的托管 KV 与平台 SSO。每条评论写入独立键；读取分页枚举 v2/v3 并合并重复 ID，历史共享索引不再参与判断，也不在 GET 中写入索引。缺少 KV 时返回 503。
- 每次扫描采用 100–199 条的合法分页大小，每秒轮换一次、同一次完整扫描固定不变，避开实测约 30 秒的相同查询陈旧结果；这是平台兼容措施，不是强一致性或固定时延 SLA。响应附带 listMs/getMs/pages/keys/limit/readMs，便于复查。
- SDK 当前未提供 CAS/原子追加，不能用“写后读校验”保证共享索引不被后来的写入覆盖。不同评论独立存储避免这个问题；同一评论解决/恢复仍为最后写入胜出。
- XD Sites 验收包：skills/torchlight-web/deploy/qa-comments-realtime/worker.js + assets/index.html（由 scripts/build-qa-comments-site.mjs 生成）。线上站点为 https://qa-comments-realtime.workers.xd.team，访问权限是心动 SSO，未加入公开站点列表。
- IndexedDB 打不开时禁用创建并显示错误，不静默改用内存存储。

## 失败自动重试与署名

配置共享服务后，新建评论、解决和恢复操作会在同一 IndexedDB 事务中写入评论和 `_sync` 待发送状态；本地事务失败不会发送请求。网络错误、10 秒请求超时、408、429 和服务端错误会按 1、2、4、8、16、30 秒间隔重试，之后最多每 30 秒一次（加上轮询调度和请求耗时）。刷新保留队列和退避时间；断网时保留，恢复网络后继续。关闭所有页面期间不在后台发送，再打开页面恢复。

同一浏览器多标签页通过 IndexedDB 事务领取 30 秒发送租约，避免同时发送同一条；若发送途中关闭标签页，其他标签页最多等到租约到期再接手。每次本地操作带独立版本，旧回执只能确认它对应的版本，不能抹掉后来的解决/恢复操作。共享 GET 不覆盖待发送行，POST 明确返回持久化成功且本地回执事务成功后，才显示“已同步”。重试沿用评论 ID，不重复创建评论。多人同时解决/恢复同一评论仍按共享服务最后写入胜出；本地发送租约不是服务端跨同事锁。

401/403 等非临时 4xx 错误会暂停自动重试，保留评论并显示原因；处理登录、权限或请求错误后，在评论详情点击“立即重试同步”。列表新增“待同步（含已解决）”，避免已隐藏的图钉掩盖发送失败。旧版本没有记录待发送状态的纯本地评论不会被擅自批量上传。清除网站数据仍会丢失尚未发送的本地队列。

评论详情和全部评论列表显示作者、发布时间，以及发生更新后的更新时间。共享署名和时间来自服务端，按浏览器本地时区显示；时间元素保留 ISO 时间值。尚未同步的新增评论显示“作者待确认”，旧无署名记录显示“作者未记录”，不伪造当前同事姓名。正文和作者都按纯文本渲染。

## 定位规则

蓝框显示实际绑定对象，允许文字、按钮或整个内容块。身份使用完整 data-node 祖先路径；正文修改不改变身份。图钉使用块内归一化位置和当前真实 DOM 几何，跟随缩放、滚动、CSS 动画及 DOM 重建；裁切范围外隐藏。PC/mobile 独立保存，避免不同设计树误配。

同一路径重复、原节点删除、类型改变时不放置图钉；评论保留在列表并说明原因。不能复用一个既有 ID 表示无关内容。此版绑定内容块，不是字符级选区；文字重排时锚点跟随该文字元素框。任意手绘形状及图片附件不在本版范围。

主功能接入 templates/figma-chrome.js；现有机械内联/生成链会携带功能。已部署的旧 HTML 不会自行升级。?product=1 和 ?inventory-static-gate=1 不注入评论界面。

## 2026-09-18 验证

```sh
node --test skills/torchlight-web/scripts/__tests__/qa-comments-worker.test.mjs skills/torchlight-web/scripts/__tests__/qa-comments-browser.test.mjs skills/torchlight-web/scripts/__tests__/qa-comments-shell.test.mjs
```

25 项评论专项测试通过，0 失败、0 跳过。覆盖点选、父块、拖选、定位、语言/地区/状态隔离、解决恢复、IndexedDB 失败、标签页同步、QA 壳和产品模式排除、API 存取/认证，以及独立模块实例并行写入、缓存空列表后新评论发现、跨秒翻页和 250 条旧记录恢复。旧 v2 评论解决操作保留原正文和作者。

新增浏览器验收覆盖：503 失败后刷新续传、离线恢复及已写入但回执丢失后的去重、多标签页发送领取与旧回执保护、401 暂停及人工重试、真实 10 秒请求超时恢复、本地事务中止不发送，以及独立浏览器上下文作者/时间一致和署名纯文本安全渲染。测试通过真实 HTTP 调用生产 Worker 的 handleComments，测试后端 KV 使用内存实现；它验证行为，不替代 XD Sites 在线延迟验收。此次重试和署名增强尚未部署，实际游戏站点待确认管理入口后接入。

### 延迟定位

修复前的控制测量：两个独立 Chrome 进程，各自 IndexedDB，禁用 BroadcastChannel；POST 全部 200。接收方持续每秒请求，Worker 每次读取最多 667ms，但 v3 列表约 30 秒只返回旧的 14 个键，随后一次变成 34 个；20 条新评论显示延迟 20.138–31.100 秒。因此延迟发生于列表发现新键，不能靠缩短前端轮询解决。

将分页大小按秒轮换后，相同独立键模型恢复逐轮发现新评论。对照结果支持“相同 list 查询复用约 30 秒的陈旧结果”的判断；未访问平台内部实现，不能断言缓存位于哪个内部组件。没有使用共享可变索引、单机锁或后台补扫来掩盖并发漏项。

### 最终线上验收

部署版本 ver_68fcaa95a9d07b7e76459de9d2c836c5，保留心动 SSO 访问权限。两轮验收相隔超过 100 秒查询轮换周期；每轮两个独立 Chrome 并行从 UI 发布，共 40 条，所有 POST 均重叠且返回 200。每轮双方都看到 20 条图钉，再用独立空本地缓存的上下文复读，UI/API 均读到 20 个唯一 ID。

发布到对端图钉显示：40 个样本，最短 1.235 秒，中位数 2.297 秒，P95 3.437 秒，最长 4.021 秒。批量解决第二轮 20 条后，两端全部隐藏分别用了 2.707、4.159 秒（包含提交本轮解决请求的时间）。40 条测试评论均已标记解决。测试使用同一授权 SSO 身份的独立浏览器，未模拟另一员工身份或异地网络。

这是轮询式秒级同步，不是 WebSocket 推送。平台查询缓存策略改变、大量评论、后台浏览器节流、离线或跨地域网络会影响实际延迟；同一评论并发解决/恢复为最后写入胜出。原始本机证据为 _tmp/qa-comments-concurrency/ 下的 independent-timed-1789717998449.json、rotating-list-1789718284674.json、rotating-list-resolve-1789718415728.json。

完整壳测试输出 _tmp/qa-comments-browser/qa-comments-shell-example.html 和截图，可检查交互；这是测试内容，不是线上游戏页。XD Sites 对 ss14-season-phase1-global 的查询返回 SITE_NOT_FOUND，所以没有覆盖该 URL，而是新建了上面的验收站点。验收站点当前部署成功，且需要心动 SSO 登录；没有登录态的匿名请求不会进入评论 API。

原公开套件 1123 项中 928 通过、11 失败、184 跳过。失败涉及缺少 pngjs、odiff、tailwind 等依赖/环境；未安装依赖或放宽检查，不能把全套标绿。

## 调查来源

- [Figma：添加评论和范围评论](https://help.figma.com/hc/en-us/articles/360041068574-Add-comments-to-files)
- [Figma：评论列表、导航和解决](https://help.figma.com/hc/en-us/articles/360041547593-View-and-manage-comments)
- [MDN：IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
- [MDN：Broadcast Channel](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)
- [WHATWG：广播任务队列，没有固定时延上限](https://html.spec.whatwg.org/multipage/web-messaging.html#broadcasting-to-other-browsing-contexts)
- [MDN：浏览器存储配额与清理](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
