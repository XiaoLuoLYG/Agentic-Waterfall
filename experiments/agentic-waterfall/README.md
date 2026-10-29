# Waterfall 数据集接入

线上 demo 的统一核心位于 `demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs`；数据集通过 `demos/agentic-feed/waterfall-core.mjs` 引用同一文件。用户表达、行为和状态是独立输入，Agent 决定获取、推荐和状态更新。

| 数据 | 入口 | 主要前置条件 |
| --- | --- | --- |
| MIND | `unified/run.mjs` | 预先转换为统一 observation JSONL，固定候选模式；旧 1000 条运行器有独立版本锁。 |
| KuaiRand | `kuairand/scripts/run_waterfall.mjs` | 已处理的公开输入 JSONL；`--fixture` 只检查接线，不调用真实模型。 |
| KuaiRec | `kuairec/scripts/run_waterfall.mjs` | `data/processed` 下已处理输入、目录和资格矩阵，以及该目录 `.venv` 中的 NumPy、rank-bm25。 |
| AgentRecBench | `agentrecbench/scripts/waterfall_bridge.mjs` | 官方任务及目标屏蔽后的工具包；工具包生成依赖官方代码和对应数据。 |
| ClawRec-SimBench | `clawrec/scripts/run_waterfall.mjs` | 官方公开轨迹及可用的 B 站或知乎来源；当前接入使用实时内容，缺少小红书，内容未冻结。 |

数据集、第三方源码、模型密钥、账号数据、运行日志和本机额度账本没有放入本仓库。准备数据及环境后才能运行各入口。历史烟雾测试中五套数据各有一个真实模型样本成功，但那次运行使用先前的核心文件指纹；新核心的线上 demo 已验证，正式全量数据集运行和效果对比仍需单独验证。

模型调用由 `shared/model-client.mjs` 统一控制。运行前使用 `MODEL_CONFIG_FILE` 指向本机配置，并为所选实验准备自己的 `CONTROL.json`（包括 `model_calls_enabled` 和 `model_request_limit`）及调用额度。不要将配置、密钥或真实运行记录提交到仓库。该目录的 `.gitignore` 排除这些本地文件。

可以先执行不需要数据或模型的核心测试：

```sh
node --test experiments/agentic-waterfall/unified/runtime.test.mjs
```

线上 demo 的配置与测试见 `demos/agentic-feed-site/README.md`。其中旧版 `demos/agentic-feed` 目录保留作历史原型；使用线上 demo 时运行 `demos/agentic-feed-site`。
