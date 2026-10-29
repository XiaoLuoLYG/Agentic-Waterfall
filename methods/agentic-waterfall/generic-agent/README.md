# 通用工具 Agent：单轮原型

该方法是研究方案中的通用 Agent 对照，独立根据用户的原始播放事件决定检索词和自己的简短记忆；不读取 Waterfall 或 ClawRec 的画像。它使用与 ClawRec 适配版相同的 KuaiRec BM25 目录工具、最多10次查询与100条候选，再从实际取得的候选中选择最多10条。

KuaiRec 同一公开样本上已做一次真实模型冒烟：10次查询取得100条，返回10条，2次 DeepSeek-V4.1-Flash 请求共12,609 tokens。输出在 `runs/kuairec-public-0-live-20261029/`。所有推荐 ID 均在实际获取的候选中；没有读取目标评分或计算效果。

这是明确标记的**单轮原型**：还不支持搜索后再次自主查询、持久多轮记忆和错误恢复，不能当作完整通用工具 Agent 或正式强对照。正式比较前还需审核 KuaiRec 的用户候选可见范围、统一可见信息和评分，分别报告实际模型调用与成本。

离线合同测试：`node --test methods/agentic-waterfall/generic-agent/contract.test.mjs`。

### 可选择用户的 KuaiRec 入口

`node methods/agentic-waterfall/generic-agent/kuairec_run.mjs RUN_ID PUBLIC_INPUT.jsonl 行号 [上轮state.json]`。行号从零开始；状态绑定用户。2026-10-29 对第二位公开用户完成 2 次真实模型调用、10 次查询、100 个真实取得的候选、10 条推荐，记录在 `runs/user-1-live-20261029/`；使用其他用户状态会拒绝。尚未验证真实连续反馈或搜索后自主补查。
