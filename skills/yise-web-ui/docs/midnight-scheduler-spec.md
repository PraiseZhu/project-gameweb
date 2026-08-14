# 午夜调度接入规格（v3.1 晨报就绪）

> 治理立法：**v3.1**。本规格供调度系统接入已就绪的晨报命令与 pre-run guard。
> 调度器只生成本地报告/建议，**不修改** Figma、页面/demo、验收阈值、长期 ledger、Git commit/push、GitHub。

## 调度任务（保留现有配置）

- 任务 ID：`caacdf00-2f73-481a-89f5-3195f25699e1`
- 时间：`0 0 * * *`，时区 `Asia/Shanghai`（保持不变）
- 空闲：无事项时静默（silent idle，保持不变）
- 工作目录：`<project-root>/demos/<verified-demo>`（由当前宿主项目在部署时提供；不要把某台本机的绝对路径写入调度配置）

## 报告命令（已就绪并测试）

```
node scripts/daily-ledger.mjs --demo demos/yise-ss5-preview --run --morning
```

- `--run`：执行本地可复跑验收命令（inline / device-presets / render-smoke / chrome-smoke / chrome-browser / reward-card），把输出作为当天证据。
- `--morning`：v3.1 晨报模式。先跑 pre-run guard，再生成六节晨读报告。
- 产物：`evolution/daily/<YYYY-MM-DD>.json`（台账）、`<date>.md`（台账明细）、`<date>-morning.md`（v3.1 晨报）。

## pre-run guard（已就绪并测试）

- `--morning` 在 CLI 最前（跑验收/写盘**之前**）校验 `evolution/policy-manifest.json`：
  - 规则版本须等于 `v3.1`；
  - `docs/ledger-legislation.md` 的 SHA-256 须等于 manifest 记录值。
- 不匹配 → **exit=3，fail-closed**：不跑验收、不写任何文件，只输出 `{ ok:false, drift:true, reason }` 报「规则漂移」。
- 调度器应把 exit=3 视为「规则漂移」通知项（不静默），提示 owner 规则已被改动、需重新确认 manifest。

## 通知条件（满足其一才通知，否则静默）

- 出现新高价值收尾候选（晨报 §2 非空）；
- 重复根因（晨报 §5 非空）；
- owner 决策待办（晨报 §4 非空）；
- 验收命令失败（exit≠0）；
- 规则漂移（exit=3）。

## 已验证

- 正常 `--morning`：exit=0，晨报六节齐全、声明 v3.1、扩权项进 §4 不自动落地。
- hash 漂移：exit=3、不写任何文件、报规则漂移。
- 版本不一致：exit=3、fail-closed。
- 全部测试：ledger-policy 12/12、morning-report 5/5、evolution-note-terminal 4/4、daily-ledger 7/7。

## 说明 / 限制

- 本工作不含调度器写操作（无调度器写工具，且边界要求不改调度器本身）；以上命令与 guard 已就绪，待调度系统按本规格接入。
- 晨报 §6「main 当前版本」按边界不读 Git，显示「未提供」；如需真实版本号，需 lead 提供只读来源。
