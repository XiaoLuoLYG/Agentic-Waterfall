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

## 离线核验

从仓库根目录执行。需要团队保存的冻结数据、两轮评测归档和新轮各次续跑归档，按原目录名放在同一归档目录。代码、校验值和汇总指标在仓库内，归档、权重和密钥由有权限的运行方提供。

```sh
repo=$(pwd -P)
archive=/path/to/output/agentic-waterfall
src=experiments/agentic-waterfall/synthetic-collection
old="$archive/comparison-20261110-dual-50-rc8"
new="$archive/comparison-20261112-independent-recall-gateway-final-retry"
(cd "$archive" && shasum -a 256 -c "$repo/docs/research/agentic-waterfall/synthetic-independent-recall/SHA256SUMS")
python3 "$src/review-results.py" "$old" "$new"
node --test "$src/api.test.mjs" "$src/bge-recovery.test.mjs" \
  experiments/agentic-waterfall/shared/request-gate.test.mjs
```

复算脚本只读存档，逐一核对两轮各 1,500 份方法记录的哈希、同一截点输入、模型配置和失败去向，并按分组复算 DCG@5、兴趣均分及盲选票。正式汇总包含行为歧义和交互修订子集。运行时的预算、候选来源和状态链验证由 `comparison.mjs` 执行。

## 运行与回归测试

使用 Node.js 22。将冻结基线目录 `comparison-20261106-synthetic-10x20-all-methods-v4` 放在仓库下的 `output/agentic-waterfall/`，或在该位置建立指向团队归档的符号链接。它包含固定版本的 `source/site`、`author-methods` 和 BGE 权重清单。Python 环境和模型位置见 [BM25+BGE 的依赖说明](../../../../methods/agentic-waterfall/fixed-retrieval/README.md)。RecAgent 还需要 `experiments/agentic-waterfall/agentrecbench/.venv`（含 `tiktoken==0.12.0`）、[固定的上游实现](../results-20261111/REPRODUCE.md#agentrecbench) 和 `methods/agentic-waterfall/recagent/cache/` 下匹配哈希的 tokenizer 缓存。

```sh
dataset="$archive/synthetic-single-card-20261110-starter-repair/rc8"
node "$src/check-dual-dataset.mjs" "$dataset"
AWF_LOCAL_BGE_CHECK=1 node --test "$src/"*.test.mjs \
  experiments/agentic-waterfall/shared/request-gate.test.mjs
```

完整测试使用小规模夹具、真实本地 BGE 和 RecAgent 代码，模型 API 响应用夹具模拟。数据清单和历史续跑清单保留了原运行的绝对路径。恢复历史运行时须保留原路径，或在副本中按实际位置重建清单引用并验证哈希。旧轮归档、模型/数据版本和先前文件的 SHA-256 由运行入口检查。

[正式运行入口](../../../../experiments/agentic-waterfall/synthetic-collection/run-main-comparison.mjs)会发起付费请求。参数为旧轮目录、新输出目录和百炼密钥文件，或 `--gateway CONFIG INTERRUPTED_RUN_DIR PAUSED_MIND_DIR`。网关分支要求 MIND 已停止且请求已排空。续跑应写入新的目录，`--retry-failed` 会重跑失败点和同一方法之后依赖其状态的截点，并使相关盲选评分重新生成。
