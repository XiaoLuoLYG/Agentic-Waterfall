# Agentic Feed v1：归档结构与示例

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../../01-研究主方案.md) 和 [输入输出与数据流](../../../02-输入输出与数据流.md) 为准。

Agent 决策的字段和动作参数以 [输入输出 v0.1](../2026-10-27-agentic-feed-io.md) 为准；本目录的 schema 是早期归档草案，尚不是该接口的运行时校验器。

当前完整样例见 [complete-example.json](complete-example.json) 与[人话说明](../2026-10-27-agentic-feed-complete-example.md)。它使用独立的 `awf-complete-example/0.1` 归档，不套用下方的旧 schema；运行 `python3 docs/research/agentic-waterfall/materials/archive/agentic-feed-v1/replay_complete_example.py` 可验证并回放。全部内容与评分为作者示例，未调用模型或采集真人。

- [episode.schema.json](episode.schema.json)：JSON Schema Draft 2020-12，定义归档 bundle。
- [example-episode.json](example-episode.json)：作者编写的“买电脑 → 已买 → 使用教程”3 轮示例，包含一次未交付及结束后的回顾式盲选。
- [研究协议](../2026-10-27-agentic-feed-data-evaluation.md)：采集、冷启动、真人校准和指标口径。

**所有人物、文章、事件、时间和评分均为虚构。没有模型调用、真人采集或效果结果。** `eligible_for_analysis=false`；成本为 null；不能用此文件计算正式 U@40。文章是作者写的占位教学文本，`urn:` 来源不是真实网页证据。

动作协议为 `update_state`、`acquire`、`recommend`、`respond`、`idle`。最后一项的 `arguments.mode` 为 `keep|wait|end_task`；动作参数与工具返回当前保留为对象，由执行器做相应工具的边界验证。`executed` 是故事中实际展示的分支；`shadow` 只产出替代列表，其行为不回流主轨迹。

`evaluator_private` 仅供评测归档。不要把整份 JSON 交给推荐器或模拟器。运行时需要白名单投影、独立权限/存储与时间截断；schema 本身不能实现这些隔离。模拟器不得读取待预测真人选择、评分、未来原话或终局答案。回顾式盲选保存的是判断时已知信息，不能混称前瞻预测。

验证示例（环境已有 `jsonschema` 时）：

```python
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

root = Path("docs/research/agentic-waterfall/materials/archive/agentic-feed-v1")
schema = json.loads((root / "episode.schema.json").read_text())
episode = json.loads((root / "example-episode.json").read_text())
Draft202012Validator.check_schema(schema)
Draft202012Validator(schema, format_checker=FormatChecker()).validate(episode)
```

仅通过 schema 还不够。执行器还必须检查 ID 唯一/引用存在、内容 hash、事件收到时间不晚于决策、动作依赖顺序、memory 证据在当时可见、曝光与列表位置一致、行为只指向已展示项、隐藏标签不进入输入。正式采集前还需覆盖真正的失败、拒答、退出、提前完成和无目标探索路径。

本轮已用现有 bundled Python 的 `jsonschema` 校验 schema/示例，并做引用、时间和 hash 自检；这验证设计样例的一致性，不验证产品运行时或研究有效性。
