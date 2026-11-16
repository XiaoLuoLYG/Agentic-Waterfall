# Reproduce the results

The Waterfall Dataset release has the 50 simulated trajectories, 300 checkpoints, two content pools, and the model judgments. Use the score replay archive to recalculate the shared-shortlist table in the paper or the independent-recall comparison. Both use the saved rankings and judgments. [Waterfall Dataset downloads](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset)

The dataset repo has the paper's benchmark and ablation tables and the download links for AgentRecBench, KuaiRand-1K, KuaiRec, ClawRec-SimBench, and MIND-small. Its score pack gives the cases and outputs available for offline reproduction. [Public benchmark setup](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset/blob/main/dataset/docs/public-benchmarks.md)

## Evaluation code

| Run | Code |
| --- | --- |
| Public benchmarks | [Input builders, runners, and scorers](../experiments/agentic-waterfall/README.md) |
| Waterfall Dataset independent recall | [Runner and frozen protocol](research/agentic-waterfall/synthetic-independent-recall/README.md) |
| RecAgent on MIND-small | [Adapter, runner, and local dependencies](../methods/agentic-waterfall/recagent/README.md) |
| Ablation input checks | [Shared runtime tests](../experiments/agentic-waterfall/unified/runtime.test.mjs) |

For research runs, the core and its SHA-256 live together in `demos/agentic-feed-site/lib/waterfall/`. The independent-recall runner copies that core into each run directory. It uses the included historical adapters and pinned retrieval dependencies. Running a new model sweep requires your own model configuration and the listed data and weights.

```sh
node examples/run-core.mjs
node --test experiments/agentic-waterfall/unified/runtime.test.mjs
```
