# Etheria-ews QA 评论

运行时是 `assets/runtime/qa-comments.mjs`。HTTP 契约对齐火炬 `docs/qa-comments.md`，不自创服务协议：

- IndexedDB 库名 `gameweb-qa-comments`，对象仓库 `comments`
- 没配 `commentApi`：本机 IndexedDB；同 origin 标签页用 BroadcastChannel 通知重读
- 配了 `commentApi`：IndexedDB 是本地缓存，同站 Worker 是共享源。用标准 URL 合并 query：保留 commentApi 已有参数，`pageKey` 由本页稳定键设置且覆盖已有 `pageKey`，fragment 不进 HTTP 请求。禁止再拼第二个 `?`。`credentials: include`，10 秒超时。GET 成功体必须 `{ comments, durable: true }`；POST 成功体必须 `{ comment, durable: true }`。前端每秒轮询，间隔不是 SLA
- 失败：网络 / 超时 / 408 / 429 / 5xx 按 1、2、4、8、16、30 秒退避重试；刷新保留队列；401/403 暂停并显示「立即重试同步」
- `?product=1` / `?inventory-static-gate=1` 不注入评论界面

这不是页面里写死的静态留言。

## 出页配置（现在写入 Skill / 生成页）

`ews-config/v1` 可选字段，也可由 CLI 覆盖（CLI 优先）：

```json
{
  "schema": "ews-config/v1",
  "commentApi": "/api/qa-comments",
  "commentPageId": "etheria-ews-season-qa"
}
```

```bash
npm run ewsweb -- --handoff <dir> --assets <map> --config <config> --out <out> \
  --comment-api /api/qa-comments \
  --comment-page-id etheria-ews-season-qa
```

| 字段 | 缺省 | 规则 |
|---|---|---|
| `commentApi` | `null`（本机库） | 必须是同站绝对路径，通常 `/api/qa-comments`，可带既有 query。禁止 `http(s)://`、`//host`、外部主机。fragment 出页时丢弃。出页不填线上地址 |
| `commentPageId` | 去掉末尾 `index.html` 的 pathname | 1–300 字稳定页键，不是 Figma id。同一 pathname、不同稿必须换 pageId，否则库会串 |

生成页把这两个字段写进 `model.config`，`boot.mjs` 交给 `__qaDemo`，QA 壳再交给 `createQaComments`。没配就是本地模式，不会去打 Worker，也不该出现黄字 `Failed to fetch`。

本期赛季 demo **不填** `commentApi`。部署网站时再配。

## 部署时怎么接服务

Skill 只出页。共享评论是另一次部署：把带新壳的 HTML 发到站点，再把实现火炬协议的 QA 评论 Worker 接到**同一 origin** 的 `/api/qa-comments`。只改 Skill、只发 Worker、线上还是旧 HTML，同事看不到新点选。

前提（与火炬 Worker 相同，EWS 不另写协议）：

1. 站点同源提供 `GET/POST /api/qa-comments?pageKey=`
2. Worker 使用托管 KV；缺少 KV 返回 503
3. 访问走心动 SSO（`@xd-cell/worker-sdk` `getCurrentUser`）。未登录的匿名请求不得进入评论 API
4. 页上声明稳定 `commentPageId` + 同站 `commentApi`
5. 壳随页走，API 随 Worker 走，两套部署，不要混成一次

缺省本地范围：同一浏览器、同一 origin、同一存储分区。不同同事、浏览器、配置文件或设备不共享本地库。IndexedDB 打不开则禁用创建并显示错误，不改用内存假库。清除网站数据会丢掉尚未发送的本地队列。

参考实现仍在火炬 `skills/torchlight-web/deploy/qa-comments-realtime`。EWS 不 import 该 Skill，也不在出页时连接、登录或发布 Worker。
