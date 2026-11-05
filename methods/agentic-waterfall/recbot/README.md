# RecBot 论文复现版：无 AIA 语义变体

2026-11-05 本批验收：按用户批准采用无 AIA 语义变体，不等待 AIA。KuaiRand 617 题已逐题核对当前输入，复用全部相同的 Parser 请求与成功回复，只补变化的 Planner 和必要的本地 BGE 排序；617 题均为合法排序，Hit@10 为 11.183144%，NDCG@10 为 0.05418050065。实际源码、依赖和测试见[本批源码快照](../../../output/agentic-waterfall/contract-repair-20261103/README.md)，完整结果见[结果表](../../../docs/research/agentic-waterfall/results-20261105/README.md)。以下早期运行说明作为历史记录保留，缺少 AIA 不阻塞本批变体的记录。此次仅更新文档，不改方法入口或算法。

基于 [Interactive Recommendation Agent with Active User Commands](https://arxiv.org/html/2509.21317v2) 自行实现 Parser、偏好记忆、Planner、硬条件过滤、语义匹配、负向衰减和聚合；使用本地 BGE-M3 余弦相似度。**没有训练过的 AIA 协同组件和蒸馏后的 Parser/Planner，不能标作原论文完整 RecBot。** 输出固定标识 `semantic-only-no-trained-AIA`，并分别记录模型规划工具和实际执行工具。论文未给出可核验的全部实现细节，本版本不能宣称复现其论文数值。

当数据没有用户命令时，显式偏好保持空；为避免所有候选得分相同，使用公开正向浏览历史文本作为语义匹配代理，这是本实验适配而非作者的 AIA。KuaiRec 只将 `watch_ratio>2` 的长观看作为该代理，不把其他观看判为不喜欢；MIND 以历史点击作为代理。硬条件由模型根据公开候选进行语义过滤，限制外候选不会进入结果。多轮状态按用户隔离，失败时不提交新状态；合成多轮检查已通过。

MIND 真实调用见 `runs/mind-0-paper-based-20261029/`：两个模型调用和本地 BGE-M3 返回4个候选。之后核查发现原输出的规划工具与实际语义代理执行不同，新版现已明确两条轨迹；`runs/mind-0-recorded-replay-20261029/` 使用当时真实响应加本地 BGE 重放了修正后的实现，没有新 API 调用。KuaiRec 的 78 条历史和 100 候选、KuaiRand 的 64 条历史和 101 候选分别以两次真实模型调用与本地 BGE 完整跑通。记录分别在 `runs/kuairec-0-paper-based-20261029/` 和 `runs/kuairand-0-paper-based-20261029/`。

```sh
node methods/agentic-waterfall/paper-reproductions-run.mjs recbot \
  experiments/agentic-waterfall/mind/runs/benchmark-1000-v1/inputs.jsonl 0 \
  methods/agentic-waterfall/recbot/runs/RUN_ID
```

KuaiRand 在上述参数后追加 `kuairand`。KuaiRec 在上述参数后追加 `kuairec POOL_JSON CATALOG_JSON`，参见总目录。尚未有多用户效果对比和原论文完整 AIA；不得把该变体的结果称为完整 RecBot。
