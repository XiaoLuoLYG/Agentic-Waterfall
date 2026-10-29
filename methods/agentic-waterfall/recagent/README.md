# AgentRecBench RecAgent

`source-snapshot` 是作者仓库 `3f575247a5778d34c3ae6b0297139c7d4a3597fd` 的 `RecAgent_baseline.py` 独立副本；其他作者组件与官方数据工具通过原实验目录只读引用。作者源码中，候选详情追加语句在循环外，模型只收到最后一个候选的详情。这里调用既有独立修正版 `recagent_all_candidates.py`，只修正该循环缩进，保留其余作者 workflow 和提示词；不把结果写成未修改作者原版。

`agentrecbench_smoke.py` 对 Amazon short-term 第0题调用官方工具及修正版：1次真实 DeepSeek-V4.1-Flash 请求，20个候选均进入流程，返回完整20项排列，10,411 tokens。该工具遮蔽目标用户–物品对；评测答案不交给方法。输出在 `runs/amazon-short-task0-live-20261029/`。

这是一条接线检查，没有读标签计算效果。现有 Waterfall 和其他方法若要比较，需事先统一样本、可见信息、工具限制和评分器；按用户决定不设共同模型调用上限，并分别报告实际调用和成本；其他领域/情境也尚未接齐。
