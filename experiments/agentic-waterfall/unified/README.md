# Waterfall 统一运行与验证

最新正式成绩与跑分口径见 [2026-11-11 实验结果](../../../docs/research/agentic-waterfall/results-20261111/README.md)。

## 全量运行

用户已授权扩展至全部合格样本。新的隔离运行覆盖五套数据共 75,690 项，共享核心、资源约束、恢复规则及评价边界见 [FORMAL_RUN.md](FORMAL_RUN.md)。以下是此前的接线验证记录，不能当作全量完成或效果结论。

## 2026-10-29 前期统一核心数据接线（历史）

本机与线上 demo 当时共用的核心 SHA-256 为 `d8162c65296d0b2bec6ef99ec8fb4ee721e37950b9ac8118b2739caaea60a09b`。MIND、KuaiRand、KuaiRec、AgentRecBench 和 ClawRec-SimBench 各完成一个当前核心的真实样本；MIND 另用已评测过且不属于冻结 1000 题的旧 32 题首个样本验证评分链路。四个有现成标签的数据均运行了对应评分器。ClawRec 基于当前公开输出建立模型判分池并运行官方轨迹评判提示和现有汇总器，判分调用与被评输出使用同一模型服务，不是独立效果验证。

KuaiRand 首次返回了混合视频 ID 与候选序号的非法排序，原结果 `verification/kuairand-final-core-v5-smoke.jsonl` 保留为失败；一次单独复核 `verification/kuairand-final-core-v5-recheck.jsonl` 成功。不能将复核记为第一次成功，也不能将单样本计分当作效果结论。ClawRec 第一事件交付 15 条、第二事件在继承第一事件状态后交付 17 条；实时内容未冻结，且缺少小红书，不代表公平跨系统比较。

KuaiRand 不再被硬限制为 3 个输入；KuaiRec 可指定输入、输出和预测文件，输入生成器可选择已存在的 dev/test 划分且不覆盖旧文件。MIND 增加独立评分入口，AgentRecBench 增加官方工具本地服务及独立评分入口；ClawRec 支持通过 `--state-in` 读取同一工作区上一事件的结果，并补充其数据集评分侧的输出转换与判分入口。运行前仍须明确样本、预算和内容环境；不自动启动实验、训练或下载。

本轮调用与结果见 `verification/final-dataset-smoke-v5-receipt.json`、`verification/final-dataset-recheck-v5-receipt.json`、`verification/clawrec-event2-v5-receipt.json` 和 `verification/evaluator-only/`。按各运行器报告，五套首轮共 12 次模型调用，MIND 已评测样本和 KuaiRand 复核各 1 次，ClawRec 数据集模型判分 1 次，第二事件 3 次；合计 18 次。所有运行均为验证接线，非正式效果实验。

Demo 真实模型信息流和这里列出的数据集入口使用同一份 [waterfall-core.mjs](../../../demos/agentic-feed/waterfall-core.mjs)。核心的输入仍是独立的用户表达、用户行为、用户状态与环境，Agent 选择获取、排序、更新状态、回答或等待；Demo 可按需回查同账号的历史表达和行为。没有修改研究主文档或旧实验结果；模型调用按原有账本记录。

Demo 继续使用原有模型配置、来源与本地存储。新行为和命令优先，旧任务尚在执行时会阻止其结果覆盖新反馈；已有候选和新获取内容可共同重排，已展示卡片保留。来源可并发，先返回的内容可以先推荐。模型接收完整可见历史与候选正文，不再按 100KB 自动分批或省略正文；服务拒绝超长输入时保留真实错误，不截短后伪装成功。旧状态以兼容映射保留；历史记录不因新会话自动删除。

## 数据入口

| 数据 | 入口 | 本次验证 |
| --- | --- | --- |
| MIND | `unified/run.mjs` | 1 个原始公开候选样本、真实模型、完整排名；最终核心版本复跑成功。官方评分器用独立的合成例子校验，未提前读取冻结的 1000 样本答案。 |
| KuaiRand | `kuairand/scripts/run_waterfall.mjs` | 1 个公开样本的真实模型排序和原评分器检查；曾有三次长 ID 不在候选集中导致失败，均保留。最终版本按模型选择的候选序号映射真实 ID，单样本成功。 |
| KuaiRec | `kuairec/scripts/run_waterfall.mjs` | 1 个公开样本，真实模型调用现有 BM25 目录工具，输出由现有评分器检查。首次请求因额度停止的记录保留。 |
| AgentRecBench | `agentrecbench/scripts/waterfall_bridge.mjs` | 1 个官方任务，经现有目标屏蔽和官方工具取得完整 20 项排名，运行官方指标函数。 |
| ClawRec-SimBench | `clawrec/scripts/run_waterfall.mjs` | 1 个公开可见历史样本，通过实时来源得到推荐；独立评估侧也对最终版本输出运行了一次基于官方轨迹评分提示的模型相关性判断与现有汇总器。内容未冻结，缺少小红书，且只有 Waterfall 一个方法，不能作为正式对比或效果结论。 |

真实模型单样本记录在 `verification/` 和各数据集的 `results/`；评分器专用数据及判断在 `verification/evaluator-only/`，不进入被测 Agent。五套数据的最终版本记录都标有 `final-core-v4-smoke`，核心 SHA-256 为 `761addab728b8a05b0e944fd119fa9b55d83dd381141f56a1cbbc3262bc137b1`。中间失败和先前版本结果全部保留。ClawRec 的一次判断和被评输出来自同一模型服务，不视为独立效果验证。

历史 MIND 1000 样本运行有版本锁、调用日志和已冻结输出，原运行器没有切换；`unified/run.mjs` 是新核心的独立 JSONL 入口，不续写该历史运行。正式对比前仍须确定同一内容环境、运行版本、预算及评价设置，不得把冒烟结果当成论文结果。

## 验证命令

从仓库根目录运行：

```sh
node --test experiments/agentic-waterfall/unified/*.test.mjs
(cd demos/agentic-feed && node --test)
```

测试包含五套数据公开样本的离线接线、来源并发与部分失败、旧结果防覆盖、状态保留、历史查询、完整候选排序、大输入不丢字段、Demo HTTP 及轨迹。浏览器检查使用隔离账号；模拟来源/模型的页面交互，以及真实模型加真实 B 站来源的首轮、后续推荐和反馈打断均已检查。另有 13 个已配置来源的真实接口检查，不代表所有查询、账号和未来可用性，不能代替真人长期使用验收。

模型实验需要现有 `shared/model-client.mjs` 的总额度及相应实验 `CONTROL.json` 同时允许。此次验证用的控制文件已停止；执行正式实验前须明确配置可用额度及实验输入，旧冻结运行的版本锁不得绕过。没有启动长训练、批量下载或正式效果比较。

实际来源检查记录见 `verification/live-source-check.json` 与 `verification/live-source-cn-check.json`：13 个来源均有至少一种模式返回内容，初次英文关键词的中文维基查询为空，改中文关键词后有结果；具体时点和数量以记录为准。模型输出采用候选序号时，原始输出和映射均保留在运行记录中。

2026-11-02 完整信息与数据集适配修订见 [修复说明](../../../docs/research/agentic-waterfall/Waterfall-完整信息修复-20261102.md)。旧运行保留原协议，不合并为新协议成绩。
