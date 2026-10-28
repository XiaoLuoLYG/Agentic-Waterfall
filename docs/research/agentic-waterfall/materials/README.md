# 辅助材料：按需查阅

日常只看 [研究主方案](../01-研究主方案.md) 和 [输入输出与数据流](../02-输入输出与数据流.md)。本目录不再维护第三份总方案。

| 材料 | 用途 |
|---|---|
| [完整例子](example/episode.json) · [逐步 JSON](example/all-step-json.md) | 核对每次输入、模型输出示例、依赖、工具回执与状态 |
| [场景定义](example/scenario.json) · [选择题样例](example/next-item-choice.json) · [回放脚本](example/replay.py) | 同一例子的可编辑源、匿名盲选记录与本地验证 |
| [完整评测协议](references/evaluation-details.md) | 三组实验、传统数据切分、方法双向适配、真人采集、指标与统计；当前有效 |
| [数据集字段](references/dataset-fields.md) · [相关工作一手核查](references/prior-work-check.md) | 已核对来源与采用依据；核查日期保留在文内 |
| [旧稿归档](archive/) | 早期方案、长规格、审核记录与旧 schema。保留历史，不覆盖现行两个文件 |

运行：`python3 docs/research/agentic-waterfall/materials/example/replay.py`。

回放复用 [早期回放器中的校验函数](archive/agentic-feed-v1/replay_complete_example.py)；早期 schema 不作为当前接口的完整校验器。所有例子为作者编写，本目录没有真人实验结果。

整理日期：2026-10-28。原有研究文件已移动保留；当前口径统一为“下一条盲选＋完整体验后的再次使用选择”，旧稿中的其他评分方案仅供追溯。
