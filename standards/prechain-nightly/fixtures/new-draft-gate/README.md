# newDraftGate fixtures

这四份压缩 JSON 是 PC/mobile 的固定 gold 与 baseline，只用于
`eval-hybrid-nameless.mjs` 的可复现四页门禁。压缩使用 `gzip -n -9`，不写入源文件名或时间戳，
因此同一 JSON 会得到稳定字节。

运行产物仍写入被忽略的 `reports/`；不要把某次报告目录复制回来替代这些固定输入。
