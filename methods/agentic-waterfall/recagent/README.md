# AgentRecBench RecAgent

`source-snapshot` 是作者仓库 `3f575247a5778d34c3ae6b0297139c7d4a3597fd` 的 `RecAgent_baseline.py` 独立副本；其他作者组件与官方数据工具通过原实验目录只读引用。作者源码中，候选详情追加语句在循环外，模型只收到最后一个候选的详情。这里调用既有独立修正版 `recagent_all_candidates.py`，只修正该循环缩进，保留其余作者 workflow 和提示词；不把结果写成未修改作者原版。

`agentrecbench_smoke.py` 对 Amazon short-term 第0题调用官方工具及修正版：1次真实 DeepSeek-V4.1-Flash 请求，20个候选均进入流程，返回完整20项排列，10,411 tokens。该工具遮蔽目标用户–物品对；评测答案不交给方法。输出在 `runs/amazon-short-task0-live-20261029/`。

这是一条接线检查，没有读标签计算效果。现有 Waterfall 和其他方法若要比较，需事先统一样本、可见信息、工具限制和评分器；按用户决定不设共同模型调用上限，并分别报告实际调用和成本；其他领域/情境也尚未接齐。

## MIND-small 固定候选适配

`mind.py` 用一条冻结的公开曝光构建作者的推荐任务。点击新闻按原顺序映射为历史证据，候选标题和摘要按原池顺序送入一次排序请求。保留作者的历史前缀规则，上限为 32,768 个 cl100k_base tokens，输出上限为 8,192，温度为 0.1。每个候选带有按冻结顺序分配的编号。模型提交编号全排列，程序核验后映射回原新闻 ID。 若原回复已经先给出完整排列，之后只多出已出现的编号，则截去末尾重复，保留完整排列的原顺序。

运行小批时，先准备 2–32 条公开曝光 JSONL 和带 `input_sha256`、`decision_ids` 的冻结清单，把最大候选和最长历史样本放在开头。使用已准备的 AgentRecBench Python、固定上游源码和本地 tokenizer 缓存。网关模块复用原实验的 `installMeteredFetch` 接口。

```sh
TIKTOKEN_CACHE_DIR=/path/to/recagent/tokenizer-cache \
node methods/agentic-waterfall/recagent/mind-pilot.mjs \
  --inputs /path/to/public-inputs.jsonl --manifest /path/to/manifest.json \
  --python /path/to/agentrecbench-venv/bin/python \
  --transport /path/to/approved-gateway-transport.mjs \
  --config /path/to/approved-local-config.json --out /path/to/new-run
```

按顺序复验前两条边界曝光，两条都交出完整榜单后，剩余曝光进入并行队列。运行目录保存每题请求、模型回复、排名校验结果和网关回执。小批验收仅使用公开输入。
