# Agentic Waterfall 方法集中目录

2026-10-29。这个目录是方法部署的独立入口：每个子目录集中指向现有作者源码、适配器和对应数据；原始实验、数据和 demo 没有搬迁。ClawRec skills、i²Agent 作者源码和 RecAgent 作者文件另存了独立 `source-snapshot`，哈希见 `source-manifest.json`。**其余中文名称入口是链接，不是副本：通过链接修改文件会改到原位置。新增实现和输出应直接放在本目录自己的子目录，不要覆盖链接目标。**

## 对照方法与状态

| 方法 | 对应实验数据 / 用途 | 目前状态与缺口 |
|---|---|---|
| Waterfall | 五套公开数据；真人内容评分及消融 | 已有统一核心和各数据入口；真实模型的早期单样本记录不等于所有入口均用当前核心复验。 |
| ClawRec | ClawRec-SimBench、KuaiRec；后续候选池诊断与真人比较 | 官方 skills 和数据已在本地；KuaiRec 的78条公开事件已转换。KuaiRec 单样本 adapted 链路完成状态、规划、BM25 获取和筛选；MIND 和 KuaiRand 固定候选排序已做单样本实测；新入口支持选择用户及独立历史状态；连续反馈、正式同条件评分与共同内容环境仍需完善。 |
| i²Agent | 公共检索之后的候选重排；可适配各数据集 | 作者源码在本地；独立适配器已用合成响应贯通五阶段，AgentRecBench 一个公开样本的9条历史和20候选、MIND 一个样本的14条点击和4候选已接线。AgentRecBench、MIND、KuaiRand、KuaiRec 各1条真实模型冒烟已返回完整候选；冷启动、长期状态、正式评分和公共检索尚未完成；作者仓库许可证状态未确认。 |
| RecBot | 原方案中的固定候选诊断 | 已按论文自写无 AIA 语义变体；Parser/Planner、记忆、语义评分和过滤可运行，MIND、KuaiRec 和 KuaiRand 各一个单样本真实链路已核验。缺训练过的 AIA，不能称完整 RecBot。 |
| MARS | 原方案中的固定候选诊断 | 已按论文自写三级记忆、更新和排序；MIND、KuaiRec 和 KuaiRand 各一个单样本真实回顾链已核验，多轮为合成验证。 |
| 通用工具 Agent | ClawRec-SimBench、KuaiRec、真人内容评分 | 单轮原型已在 KuaiRec 真实模型冒烟；新入口支持选择用户和独立记忆，第二位用户的单轮真实检索已验证；多轮真实运行、自主补查及正式评价尚缺。 |
| RecAgent | AgentRecBench | 作者代码和 Amazon 短历史数据已在本地；候选信息漏传修复版已完成合成检查和1条真实模型冒烟，尚未与 Waterfall 正式比较；按用户决定，不设置共同模型调用上限，单独记录资源消耗。 |
| 固定检索/排序 | MIND TF-IDF；KuaiRec 检索等 | MIND 有原 TF-IDF 入口；BM25+BGE-M3 融合与 BGE reranker 已在完整 KuaiRec 公共目录单样本跑通，正式效果仍待验证；KuaiRec 使用主方案的观察掩码，向方法暴露是否存在观察记录，须披露并确保各方法一致。 |
| [NRMS](nrms/README.md) | MIND | 源码在 `nrms/`；之前长训已中止，不将短训权重当作正式实验可用权重。数据与权重不在本目录。 |
| SASRec | KuaiRand | 有作者源码及已有短训适配；未确认有满足正式数据切分的收敛权重。 |
| LLM-SRec | KuaiRand | 有作者源码；训练与可用权重未完成。 |
| LightGCN | KuaiRec | 有作者源码和数据适配；旧短训仅覆盖小子集，未确认有完整协议的匹配权重。 |

Baseline666 因未找到可核实作者代码，按用户决定移出当前实验；模拟用户增益用的小排序器仍需另行准备；没有把某个占位接口称作已部署。真人内容评分需真实用户与内容环境；盲选保持暂停。五组 Waterfall 消融沿用现有研究设计，只有合成检查，没有效果结论。

## 既定数据与方法对应关系

- ClawRec-SimBench：Waterfall、ClawRec、通用工具 Agent。
- KuaiRec：Waterfall、ClawRec、LightGCN、固定检索；RecBot/MARS 如适配则只做固定候选重排。
- AgentRecBench：Waterfall、作者 RecAgent；Baseline666 已按用户决定移出当前实验。
- MIND-small：Waterfall、NRMS、TF-IDF；其他 Agent 作为候选排序适配，正式扩跑前统一可见信息和评测设置，并分别报告实际调用与成本。
- KuaiRand-1K：Waterfall、SASRec、LLM-SRec；其他 Agent 作为候选排序适配，正式扩跑前统一可见信息和评测设置，并分别报告实际调用与成本。
- 自采内容评分：先 Waterfall 与 ClawRec，再按既定方案接其他对照；各方法有各自状态，不共享 Waterfall 总结的画像。

更完整的待确认补充及指标见 [研究主方案](../../docs/research/agentic-waterfall/01-研究主方案.md) 和 [评测细则](../../docs/research/agentic-waterfall/materials/references/evaluation-details.md)。方法可接入某个数据集不代表已完成公平比较，也不要求每个方法跑所有数据。

## 本次离线核验

- `node --test experiments/agentic-waterfall/unified/clawrec-adapter.test.mjs experiments/agentic-waterfall/unified/dataset-contract.test.mjs`：8/8 通过；验证 Waterfall 的数据入口与合成执行，不验证 ClawRec 自身的完整推荐链。
- `experiments/agentic-waterfall/agentrecbench/.venv/bin/python experiments/agentic-waterfall/agentrecbench/scripts/check_recagent_all_candidates.py`：通过，20 个合成候选进入提示词，测试答案未进入。
- 直接以合成输入调用现有 `i2agent_offline.run_fixture`：正常五阶段及故意提供无效排序后的修复均通过，0 次真实模型请求。

目前没有方法可据以上检查一概标为“所有实验 ready”。真实模型冒烟的输入、请求和输出放在各方法 `runs/` 下；仍需多用户适配、独立状态、隐藏答案隔离、资源计量及对应评测器的端到端验证。没有启动训练或正式效果实验。

## 本次部署的边界

- 真实测试累计 31 次 API 请求、157,956 tokens；其中 KuaiRand 的一次输出被截断，保留原记录并在提高该阶段输出上限后补跑成功。这些记录均为小样本检查，不是效果结果。
- 复用共享模型账本进行调用预算控制，新增 `experiments/agentic-waterfall/method-deployment` 链接指向本目录的控制文件，并向现有账本追加了本次调用记录；没有改动已有实现代码或数据。当前模型调用开关已关闭、训练禁用。
- 2026-10-29 复核：i²Agent 11 项 Python 测试、固定检索 7 项 Python 测试（使用本目录 `.venv`）、ClawRec 2 项 Python 测试、ClawRec 与通用 Agent 7 项 Node 测试通过。检查侧重输入隔离、候选合法性和组件行为，不等价于效果对照或多轮验收。

## 2026-10-29 继续部署

- [RecBot 无 AIA 论文复现版](recbot/README.md) 与 [MARS 论文复现版](mars/README.md) 新增各自状态与排序，分别完成 MIND 真实单样本检查。不能把 RecBot 语义变体称为完整 RecBot。
- `paper-reproductions-run.mjs` 可指定 MIND 的公开输入行号；KuaiRand 在基础参数后追加 `kuairand`（两个复现版各已真实验证一个样本）；KuaiRec 在四个基础位置参数后追加 `kuairec POOL_JSON CATALOG_JSON`。`POOL_JSON` 需含 `context_id` 和 `acquired_ids`，严格匹配输入决策；公共目录见 `fixed-retrieval/data/kuairec-catalog-public.json`。已将上一轮检索池按上下文绑定到 `fixed-retrieval/fixtures/kuairec-example-pool-bound.json`。KuaiRec 的可评掩码会透露观察是否存在，须向所有方法一致披露。
- `paper_predictions.py --dataset mind|kuairand|kuairec --runs RUN_DIR ... --output OUT.jsonl` 将匹配公共输入的复现版结果转换为评分器输入；不读取标签，未运行效果评测。MIND 和 KuaiRand 保留完整排列及失败状态，KuaiRec 按协议输出前10和实际候选池，并拒绝导出失败记录（该评分器尚无声明的失败回退）。
- i²Agent 的 MIND、KuaiRand、KuaiRec 数据脚本支持 `--line` 选择公开样本。作者流程至少要求两条正向历史，MIND 1000 个输入中 33 个不满足；当前 KuaiRand 公开小样本两条中一条不满足。不能补造历史，用户已决定主要比较统一使用967条，并另报33条不满足情况。
- ClawRec 的 `clawrec/kuairec_run.mjs` 和通用 Agent 的 `generic-agent/kuairec_run.mjs` 支持输入行号和可选的同用户独立状态；第二位用户分别完成真实单轮检索和推荐，各有独立状态；跨用户状态读取会拒绝。尚未验证真实连续反馈。
- 本轮 MARS/RecBot 共 34 次、ClawRec 和通用 Agent 共 5 次真实模型调用；不训练、不运行正式效果实验。共享账本接近其既有全局限制，本目录的调用开关目前已关闭。

### MIND 1000 样本评分入口

`mind_comparison.py` 接收一个冻结的公开输入 JSONL 和一个或多个 `方法名=预测JSONL`，要求每个方法对每一条输入均有输出记录，先在全新的输出目录写入输入和各方法预测的 SHA-256 收据，再读取指定 MIND behaviors 文件中的评测标签，调用作者原始评分器计算 AUC、MRR、NDCG@5/10，按用户聚类 bootstrap 1000 次并输出配对差异。非法输出保留在分母，按既有协议使用全 1 名次回退并报告。仅用合成数据完成端到端测试，本次没有计算真实数据效果。

这一区分很重要：`experiments/agentic-waterfall/mind/scripts/evaluate_rankings.py` 使用旧的32条样本私有标签；1000条公开输入应该对应 `data/MINDsmall_dev/behaviors.tsv`，不能混用。运行前应固定方法集合和用户选定的967条共同样本，准备好各方法的完整预测记录；禁止只挑成功样本。

`batch_public.py` 为 MARS/RecBot 的 MIND、KuaiRand 固定候选输入提供批量入口：先固定输入哈希、样本顺序、方法源码哈希和预计调用次数；不带 `--execute` 仅准备，不请求模型；带 `--execute` 才逐条运行并单独保存结果。预算不足或调用关闭时停止，不能把未提交的样本记作成功。按用户决定，正式比较不设共同模型调用上限，并逐方法报告实际调用次数、token 和耗时；例如 MARS 在100候选下按10条一批需要12次模型调用，RecBot 语义版通常为2次。运行时的保护额度是操作保险，不是实验协议中的统一上限。

批量准备示例（不会调用模型）：

```sh
python3 methods/agentic-waterfall/batch_public.py \
  --input methods/agentic-waterfall/protocols/mind-common-i2agent-967-20261029/inputs-eligible.jsonl \
  --method mars --dataset mind --start 0 --count 967 \
  --output methods/agentic-waterfall/mars/runs/mind-967-preflight
```

将 `--method` 改成 `recbot` 可准备其同一组输入。准备输出中的 `max_expected_calls` 是上限估算；执行须使用已确定的共同样本、合理配置运行时保护额度，再使用新的输出目录并显式加 `--execute`。结果通过 `paper_predictions.py` 导出，MIND 多方法比较使用 `mind_comparison.py`。当前模型调用开关关闭，预算和训练设置不自行放开。批量执行入口已验证准备、预算关闭时停止；尚未进行全量模型执行。

## 用户确认的比较协议（2026-10-29）

- MIND 的主要比较统一使用 [967 条共同样本](protocols/mind-common-i2agent-967-20261029/inputs-eligible.jsonl)，对应 963 位用户；[另外33条不可用情况](protocols/mind-common-i2agent-967-20261029/ineligible.json) 单独报告，不为 i²Agent 编造历史。[冻结清单与哈希](protocols/mind-common-i2agent-967-20261029/manifest.json) 仅使用公开历史，未读取标签。
- 不设置跨方法统一模型调用上限；逐方法报告实际请求数、token 和模型调用耗时。当前没有可核验的 API 单价或账单，货币成本保持未知。运行保护额度与该比较原则分开。
- `filter_predictions.py` 可按照共同样本顺序筛选已有预测；`paper_predictions.py` 会保留收据中的非敏感用量元数据，`mind_comparison.py` 输出各方法资源统计。用量不完整时明确标未知，不用0代替。
- 先前中断的 Waterfall 1000 条旧记录在共同样本中有669条提交、298条失败；不能把它当成已完成的新核心结果。当前没有执行正式评测或重跑。

- 已依据原 TF-IDF 的冻结收据和源码核对，得到共同样本的 [TF-IDF 预测](/Users/luoyige/Documents/ChatGPT/waterfall/methods/agentic-waterfall/protocols/mind-common-i2agent-967-20261029/tfidf-predictions-eligible-metered.jsonl)，记录其模型调用数为0；本地计算耗时尚无逐样本记录。
- `resource_report.py --method NAME --runs RUN_DIR ... --output REPORT.json` 可读取各方法已保存的模型收据，汇总实际请求、token 和模型调用耗时；它去重请求 ID、不把 i²Agent 重放的响应算作新调用，不导出提示词。缺少收据、用量、价格或账单时会保留未知。`mind_comparison.py` 也可对预测里已有的用量字段输出同样统计；均不等于完整端到端墙钟耗时或已核验金额。
- 基于当前实现、一遍且不重试的调用量预估：967 条 MIND 输入的 MARS 最多约 6,163 次、RecBot 语义版约 1,934 次、i²Agent 约 4,835 次；见 [预估记录](protocols/mind-common-i2agent-967-20261029/call-volume-estimate.json)。这些是工作量预估，不是方法比较上限；实际次数、用量和费用以运行收据和账单为准。


2026-10-29 补充：三领域 AgentRecBench、SimBench 受限共同快照、Yelp 缺失资料处理和重新验证后的最新状态，以 [实验就绪报告](实验就绪报告-20261029.md) 为准；上方旧状态保留作历史记录。

版本库仅保存代码和文档，不包含本地数据、日志、权重或凭据；安装与固定上游来源见 [版本库使用说明](版本库使用说明.md)，实验边界见 [实验限制与解读](实验限制与解读-20261029.md)。
