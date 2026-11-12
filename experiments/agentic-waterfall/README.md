# Waterfall 数据集接入

[2026-11-11 实验结果](../../docs/research/agentic-waterfall/results-20261111/README.md) · [复现说明](../../docs/research/agentic-waterfall/results-20261111/REPRODUCE.md)

线上 demo 的统一核心位于 `demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs`；数据集通过 `demos/agentic-feed/waterfall-core.mjs` 引用同一文件。用户表达、行为和状态是独立输入，Agent 决定获取、推荐和状态更新。

| 数据 | 入口 | 主要前置条件 |
| --- | --- | --- |
| MIND | `unified/run.mjs`，`mind/scripts/score_waterfall.py` | 统一 observation JSONL、官方评分器和独立的评价标签；旧 1000 条运行器有独立版本锁。 |
| KuaiRand | `kuairand/scripts/run_waterfall.mjs`，`kuairand/scripts/score.py` | 完整历史由 `unified/prepare_kuairand_full.py` 准备，正式输入由 `unified/prepare_kuairand_window.py` 生成最近 512 条窗口。评价标签单独保存。 |
| KuaiRec | `kuairec/scripts/build_waterfall_inputs.py`、`run_waterfall.mjs`、`evaluate.py` | 已处理的目录、历史、划分和资格矩阵，以及该目录 `.venv` 中的 NumPy、rank-bm25。 |
| AgentRecBench | `agentrecbench/scripts/waterfall_tool_server.py`、`waterfall_bridge.mjs`、`score_waterfall.py` | 官方源码、任务和数据，工具服务按官方实现屏蔽目标交互。 |
| ClawRec-SimBench | `clawrec/scripts/run_waterfall.mjs`、`export_pool.py`、`judge_waterfall.mjs`、`score_rankings.py` | 官方公开轨迹。正式结果使用五法冻结榜单和共同池评分，见复现说明。 |

数据集、第三方源码、模型密钥、账号数据、运行日志和本机额度账本没有放入本仓库。准备数据及环境后才能运行各入口。2026-10-29 使用当前统一核心对五套数据各完成一个真实样本及对应评分链路检查；KuaiRand 首次生成非法排名后单独复核成功，原失败保留。ClawRec 两个连续事件验证了状态传递，其单样本模型判分不构成公平比较或效果结论。这批单样本记录对应 10 月 29 日的接线验证。

模型调用由 `shared/model-client.mjs` 统一控制。运行前使用 `MODEL_CONFIG_FILE` 指向本机配置，并为所选实验准备自己的 `CONTROL.json`（包括 `model_calls_enabled` 和 `model_request_limit`）及调用额度。不要将配置、密钥或真实运行记录提交到仓库。该目录的 `.gitignore` 排除这些本地文件。

可以先执行不需要数据或模型的核心测试：

```sh
node --test experiments/agentic-waterfall/unified/runtime.test.mjs experiments/agentic-waterfall/unified/dataset-cli.test.mjs
```

需要官方源码和数据环境的评分器检查，在依赖尚未准备时会标记为跳过。数据入口可以按以下方式使用；输入、输出及运行预算均需预先选定，示例不会自动准备数据或开启模型调用。

- **MIND**：`node experiments/agentic-waterfall/unified/run.mjs --experiment mind --input INPUT.jsonl --output OUTPUT.jsonl`。生成结果后，用该数据集环境的 Python 运行 `mind/scripts/score_waterfall.py --truth TRUTH.json --input INPUT.jsonl --predictions OUTPUT.jsonl --output SCORE.json`；未生成的已分配样本仍计失败，不得把评价标签交给模型。旧 1000 条运行结果和其冻结协议独立保留。
- **KuaiRand**：`node experiments/agentic-waterfall/kuairand/scripts/run_waterfall.mjs --input INPUT.jsonl --output OUTPUT.jsonl`，再用 `kuairand/scripts/score.py --tasks PRIVATE_TASKS.jsonl --predictions OUTPUT.jsonl --output SCORE.json`。未交付和无效榜单在原分母内计零。
- **KuaiRec**：`python3 experiments/agentic-waterfall/kuairec/scripts/build_waterfall_inputs.py --split dev --output INPUT.jsonl` 可从已有历史生成指定划分；再运行 `node experiments/agentic-waterfall/kuairec/scripts/run_waterfall.mjs --input INPUT.jsonl --output OUTPUT.jsonl --predictions PREDICTIONS.jsonl`，通过 `kuairec/scripts/evaluate.py --input INPUT.jsonl --predictions PREDICTIONS.jsonl --output SCORE.json` 评价预测，缺失用户保留在分母中。输出文件须不存在。
- **AgentRecBench**：先用 `waterfall_tool_server.py --data-dir CORPUS --task-dir TASK_DIR` 启动仅监听本机的官方工具服务，使用返回的端口为每个任务运行 `waterfall_bridge.mjs --task TASK.json --tool-url http://127.0.0.1:PORT --scenario SCENARIO --task-id ID --output RESULT.json`；全部预测完成后，用 `score_waterfall.py --task-dir TASK_DIR --task-ids 0,1 --output SCORE.json RESULT.json ...` 评价，按实际分配 ID 指定 `--task-ids`，缺失结果计失败。结束后停止本地工具服务。
- **ClawRec-SimBench**：事件 1 运行 `run_waterfall.mjs --workspace WORKSPACE --event 1 --output EVENT1.json`；事件 2 加 `--state-in EVENT1.json`，后续事件依次引用前一事件结果。`export_pool.py`、`build_blind_pool.py`、`judge_waterfall.mjs` 和 `score_rankings.py` 是该数据集模型评判的离线评价链，评价目标只在被测系统输出完成后进入评价侧；这不是真人盲选功能。评判模型和内容环境需在实验前固定。

线上 demo 的配置与测试见 `demos/agentic-feed-site/README.md`。其中旧版 `demos/agentic-feed` 目录保留作历史原型；使用线上 demo 时运行 `demos/agentic-feed-site`。
