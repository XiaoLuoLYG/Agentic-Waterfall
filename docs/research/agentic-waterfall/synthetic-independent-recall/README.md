# 自采合成轨迹五法对比 · 2026-11-13

五法在同一批 50 条轨迹的 300 个评测点运行。两轮的公开输入、历史截点、冻结内容池、方法预算与盲评规则一致。每个方法独立保存和更新自己的状态。隐含目标和硬约束由评分端读取，方法端只用当前截点已公开的输入。

| 方法 | 旧轮 DCG@5 | 独立召回 DCG@5 | 新轮评分分母 |
| --- | ---: | ---: | ---: |
| Waterfall | 7.856 | **7.576** | 300 |
| ClawRec | 7.534 | 7.401 | 300 |
| i²Agent | 7.425 | 7.374 | 294 |
| RecAgent | 7.331 | 7.330 | 300 |
| BM25+BGE | 6.424 | 5.597 | 300 |

新轮 1,500 个方法槽位全部结案，交付了 1,494 份 Top 5，方法和评分的最终失败数均为 0。i²Agent 有 6 个截点缺少两条有效的正反馈，按运行协议记为不适用。相应的 30 张五方盲选票不可评分。盲选只在五法都交付 Top 5 的截点进行，有相同内容时分票。两轮实际选出卡片的票数分别为 1,360 和 1,463。只在新轮五法都有评分的 294 个共同截点上复算，Waterfall、ClawRec、i²Agent、RecAgent、BM25+BGE 的 DCG@5 分别为 7.582、7.456、7.374、7.348、5.600。

## 候选访问

- Waterfall 和 ClawRec 从空候选开始，用自己的查询检索冻结小池（10,446 条）。发起小池查询后，可以用 `[expansion]` 前缀查询冻结扩展池（50,228 条）。最终记录中，两法分别在 45 和 9 个截点请求过扩展池。
- BM25+BGE 只在小池做全量召回。按公开历史排除已浏览内容后，每个截点实际搜索 10,383 至 10,445 条。
- RecAgent 和 i²Agent 各自排序同一份 20 条小池候选。实验适配层用公开画像、历史和已发出的指令构造短名单。i²Agent 另有一条不参与排序的对照卡。

结果对应上述端到端设置。它包含检索和排序的共同影响。两池在跑分前按当前轨迹的主题和模态缺口定向补入 256 条卡，小池 116 条、扩展池 140 条。短名单的主题规则也在这批评测场景上调整过，外推到新轨迹或自然采样内容池还需验证。

新轮跨百炼与原网关，两边的回执模型名均为 `DeepSeek-V4.1-Flash-1017`。最终计入汇总的评分答复中，百炼 1,145 条，原网关 5,299 条。服务端行为是否一致未经控制验证。评分由模型完成。前后变化同时涉及候选协议、运行失败恢复与服务端点，不能据此估计候选协议单独造成的变化。

## Recalculate the scores

Download the score replay archive from the [Waterfall Dataset release](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset/releases/tag/waterfall-dataset-v1). From the extracted directory, run `python3 replay.py --protocol independent-recall`. This uses the saved rankings and model judgments and reports how many checkpoints each method could score.

With the complete original run archives, `review-results.py SHARED_RUN INDEPENDENT_RUN` also verifies both runs and all intermediate retries. Keep the retry directories next to the original final run so the audit can follow their lineage. `SHA256SUMS` uses the archive labels `waterfall-dataset/shared-shortlist`, `waterfall-dataset/independent-recall`, `waterfall-dataset/inputs`, and `waterfall-dataset/catalog`.

## Run the experiment code

Use Node.js 22.13 or later. The frozen source adapters are in `output/agentic-waterfall/comparison-20261106-synthetic-10x20-all-methods-v4/`. The candidate policy and runner live in `experiments/agentic-waterfall/synthetic-collection/`.

For a full model run, set up the frozen input manifests and the original model and catalog configuration. The fixed-retrieval Python environment goes in `methods/agentic-waterfall/fixed-retrieval/.venv`, with the model weights at the paths in the frozen BGE manifest. Set up [the BGE dependencies](../../../../methods/agentic-waterfall/fixed-retrieval/README.md) and [the RecAgent dependencies](../../../../methods/agentic-waterfall/recagent/README.md). Fetch the pinned i²Agent source with `python3 methods/agentic-waterfall/i2agent/fetch_author.py`, then copy the resulting `model.py` to `author-methods/i2agent/source-snapshot/` in the frozen adapter directory.

```sh
node --test experiments/agentic-waterfall/synthetic-collection/*.test.mjs
```

The [original run entry](../../../../experiments/agentic-waterfall/synthetic-collection/run-main-comparison.mjs) sends model requests. Its archived gateway continuation uses the same configured model service and existing run state. The score replay archive works with Python alone.
