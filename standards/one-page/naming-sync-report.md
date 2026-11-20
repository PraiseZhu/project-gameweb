# 命名与绑定同步验证记录

日期：2026-11-19。范围：用户确认稿 ee6d5d260f3b 的本地规范、解析/校验、清单和交接工具；不提交、不推送，不改两套游戏 Skill、Figma 或全局规则。

当前阶段：实现与作者自测完成，独立 Review 尚未运行。此记录不能作为审查通过或真实页面完成凭据。

## 成功条件

| 条件 | 当前状态 | 已有证据与限制 |
|---|---|---|
| SC1 19词、新参数和旧mix兼容 | pass（自测） | 正式正文、onepage.mjs、生成速查及镜像测试；旧入口规则不变 |
| SC2 前景、页码值、空状态身份 | pass（自测） | 保留节点/几何；独立scope、pagerPolicy、emptyPolicy；不生成额外图层 |
| SC3 数据声明与类型反例 | pass（自测） | 相对/根路径、特殊字符、自然TEXT、唯一模板、槽位映射与溢出、设计状态校验 |
| SC4 目标与动作 | pass（自测） | for作用域、跨屏、结构省略、一对多、冲突、next可见屏顺序和末屏回首页 |
| SC5 动效引用 | pass（自测） | 已定规则目录、对象/单元/触发、未覆盖组合阻断、减少动画和隐藏合同；未验证实际播放 |
| SC6 新旧隔离 | pass（自测） | 新schema、能力声明、摘要检查；旧验包拒绝新清单，旧mix回归 |
| SC7 测试与来源对账 | pass（发布审计例外单列） | 工具764项、one-page文档12项；发布审计仍fail，见下文 |
| SC8 来源与消费者责任 | pass（文档） | 正式规范明确输入、清单字段、能力和未实现页面消费者 |

## 命令与日志

日志保存在仓根 _tmp/naming-sync-20261119/，完整输出不贴入对话。

- npm --prefix standards/figma-naming/tool test：pass，tool-tests.log；含21项新规则测试及旧链回归。
- npm --prefix standards/one-page test：pass，standard-tests.log；来源正文、数值和引用对账。
- git diff --check：pass，diff-check.log。
- git status --short -- skills/yise-web-ui skills/torchlight-web：pass，无改动，protected-paths.log。
- npm --prefix standards/figma-naming/tool run release:audit：fail，release-audit.log；本轮新增文件的项目专名违规已修正，剩原有发布边界8项：build-naming-guide.py、tool/_tmp/naming-guide-20261027 下6张截图未分类，naming-guide.png 未做文本扫描。本轮未修改这些文件或发布边界。

旧工具自带的跨目录检查仍报告两套游戏 naming-contract 版本落后及已知名单备注；原基线也有该警告。不把它视为新契约已有消费者，不扩大范围修改游戏包。

## 持久状态与待办

已新增 one-page 规范/机器表、解析编译器、验包 API、CLI、配置说明和测试。已同步相关 README、消费者合同及来源指针；批准草案原字节保持不变。正式入口为 npm --prefix standards/one-page run inventory；只接已有快照，成功交付 handoff.json。

独立 Review：not_run。下一步审核当前改动，若有问题修复并重跑相关测试。审核材料为 _tmp/naming-sync-20261119/review.diff 与 review-files.json，按本轮开始前的文本基线比较，避免把既有未提交改动纳入本次。

真实项目接口、分层导图、HTML生成、浏览器交互和像素验收：not_run。消费者目前仅有验包合同，尚无新版页面生成器。新包不能交给旧游戏入口。

规则文件、全局 Skill、长期记忆：未修改。提交/推送/站点发布/外部消息：未执行。保留原有未提交改动、测试日志和审查材料；未执行清理或删除。

知识收尾：pending，待独立 Review 后核对最终代码与说明。不将本记录的作者自测升级为 APPROVED。
