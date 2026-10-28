# Waterfall 最近工作：补充一手核查（2026-10-22）

> 一手核查记录：对应 2026-10-22 所读论文与固定代码版本。保留事实依据；其中旧方法建议与优先级不作为现行方案，当前以 [研究主方案](../../01-研究主方案.md) 为准。

状态：研究证据备忘录；未运行实验、论文代码或产品。沿用 10 月 14 日召回/排序综述和 10 月 20 日比较笔记，只核查会影响本轮研究路线的缺口。下述“未确认”不表示领域中不存在。

**推荐：保留完整的搜、排、画像和反馈研究范围；把贡献落在可复现的跨阶段协调机制及真人反馈基准。不能把“首次串起四段”“首次多轮纠正”“首次按需执行阶段”当贡献。当前稿件的候选数量门控还是薄弱的方法差异，必须对照给已有框架加同一门控的便宜改法。**

## 1. 三个近邻的最新可核查状态

| 工作 | 本轮确认 | 对 Waterfall 的约束 |
|---|---|---|
| **ClawRec** | [arXiv](https://arxiv.org/abs/2607.23779) 仍为 v1（2026-07-26）。[正文 §§2.1–2.5、3.3、4.3.3](https://arxiv.org/html/2607.23779v1) 已有证据关联状态、时效、跨源规划、预算内获取、边际列表选择和展示反馈；评测是隐藏每个事件的最后行为，跨事件分析比较逐渐增加的历史。 | 不能说它没有反馈闭环、临时/长期区分、失败归因或预算控制。论文的跨事件评测不能自动当作“每种策略展示后获得自己的新反馈”的长期效果证明。 |
| **RecBot** | [arXiv](https://arxiv.org/abs/2509.21317) 最新 v2（2025-10-01）；[KDD 2026 官方列表](https://kdd2026.kdd.org/papers/) 源 HTML 的论文对象含 Research 条目和 [DOI](https://doi.org/10.1145/3770855.3817619)，[作者组](https://ict-star.github.io/publications/) 也列 KDD 2026；不应沿用 arXiv 的旧 Under Review 标签。[正文 §§3.2–3.4、4.1.2、4.3](https://arxiv.org/html/2509.21317v2) 已有语言偏好更新、工具链重排、蒸馏、最多 5 轮模拟以及作者报告的线上实验。 | 已经研究“边刷边说要求”、冲突纠正和漂移。模拟器基于当轮曝光列表的第一项给反馈，第 3 轮切换目标；不能用“我们有多轮且反馈依赖曝光”单独声称新颖。其主要动作作用于平台候选池，不能直接当开放多源获取方法。 |
| **MARS** | [arXiv](https://arxiv.org/abs/2605.14401) 最新 v2（2026-05-15）；[正文 §§3.3–3.4、4.1、4.3](https://arxiv.org/html/2605.14401v2) 明确 planner 是 frozen heuristic policy，可跳过或选择有序记忆操作；用画像和近期事件给已有候选打分。evolving 模式顺序接收行为，测试仍留出最后一项，与 9 个随机候选比较。 | “冻结模型、运行时改记忆、按需更新”均已有。不能把顺序消化既有行为等同任意新推荐策略的真实闭环反馈；也不能声称 MARS 完全没有持续演化实验。 |

本轮在 RecBot/MARS 的论文、作者相关页面和精确标题代码检索中，**未定位到可确认归属的官方完整实现或已训练权重**；这不等于证明没有。复现前应再核作者发布情况。依正文重写时命名 `RecBot-style` / `MARS-style`，公开差异，不能标成已复现原作者系统。RecBot 的私有 Taobao 线上效果不能直接在本地复现。

## 2. ClawRec 的阶段路由究竟做到了什么

本轮读取论文指向的 [RUCAIBox/ClawRec](https://github.com/RUCAIBox/ClawRec)，固定提交 **`6eeb309c47430f91280e9845a98fb56a68dc0d90`**。旧 `wuchenghao0215/ClawRec` 路径解析到同一提交。以下是源码证据，不是运行结果：

| 实际文件 | 确认的行为 | 可保留的区别 |
|---|---|---|
| [生命周期路由](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-using-clawrec/SKILL.md) | 根据用户请求选“刷新状态、生成页面、结算反馈、全周期”四种预设流程。各流程有固定顺序；MVP 明确不做工件时效诊断、恢复规划和历史运行比较。 | 可称“预设流程路由 + 阶段内适应”。不能简单称完全固定串联，也没有在该入口发现候选覆盖/剩余预算驱动的跨阶段效用选择。 |
| [源执行](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-executing-search-instruction/SKILL.md) 的 Bounded Query Expansion | 初始查询后允许至多 2 个补充查询，可针对初始结果差做同焦点重试、翻译和消歧；禁止沿结果里新发现的关键词继续无限扩展。 | “根据结果决定再搜”也不是空白。Waterfall 的区别必须超过增加一次重试。 |
| [搜索编排](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-orchestrating-search-execution/SKILL.md) 与 [筛选](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-curating-display-data/SKILL.md) | 编排执行已有计划，不重写 `PLAN.md`；失败单独记录。筛选无可展示卡时报告失败，不把空输出报成功。 | 所读路径未显示筛选器把库存充分度反馈给一个统一动作选择器、再自动回到改画像/换计划/仅重排。这个局部区别能设计实验，但不能推出未读代码或未来版本没有。 |
| [展示反馈](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-collecting-display-feedback/SKILL.md) 与 [状态更新](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/skills/clawrec-synthesizing-user-state/SKILL.md) | 明确结算时从 rendered-card manifest 和 link-click 形成 click/skip，再写反馈包供状态更新；一次点击不建长期偏好，一次 skip 不建硬抑制。 | 已经有可执行的曝光—反馈—状态链。manifest 记录的是渲染卡，不自动证明每张卡真实进入可视区域；Waterfall 若新增可视曝光测量，应单列为数据质量设计，不据此抹去其闭环能力。 |

**对现稿门控的判断（研究分析）：** `min(1,n/k)` 统计足够合格候选就停止，否则补搜，是可执行、容易检验的规则，但本身还不能支撑“统一决策算法明显新颖”。必须加入 `ClawRec-adapted + 相同候选充分度门控`，或与之等价的“共享状态流程 + 相同门控”强对照。如果它追平 Waterfall，证据支持的是这个简单规则及基准所揭示的问题，不能把收益扩大解释成全新统一智能体算法。

## 3. ClawRec-SimBench 公开量与论文表格不一致

[论文 §3.4](https://arxiv.org/html/2607.23779v1#S3.SS4) 报告实验 split 为 109 用户、545 事件。本轮用 GitHub API 对固定提交的[完整仓库树](https://api.github.com/repos/RUCAIBox/ClawRec/git/trees/6eeb309c47430f91280e9845a98fb56a68dc0d90?recursive=1)做只读计数（`truncated=false`）：

- `clawrec-simbench/cases/*/event_*/input/evidence.visible.jsonl`：**42 用户、210 个事件文件，每人 5 个**。
- `clawrec-simbench/review_md/*.md`：**111 份合成意图说明**；不是 111 份可运行完整行为轨迹。
- 所读树中未找到显式命名的 train/dev/test/split 文件；本轮没有逐例检查所有内容完整性，不能由文件数推出 210 个都可运行。

[数据 README](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/clawrec-simbench/README.md)明确区分意图脚本与 GUI 行为记录；[复现说明](https://github.com/RUCAIBox/ClawRec/blob/6eeb309c47430f91280e9845a98fb56a68dc0d90/docs/reproduction.md)要求事件按顺序运行并保留用户状态，`private/` 只给评价器。事件 n 的可见文件只增补前事件 step 5 和当前 step 1–4，更早证据靠持久状态保留。不能把每个事件单独空状态运行后声称原协议复现。

推荐把它当**外部可比基准**，先核实际发布子集与原 split 对应关系，再报告可用规模；不能提前承诺论文全量复现。真实 URL/标题不代表行为来自真人。数据中的 `raw-evidence://` 是来源标识，不是可下载地址。代码仓的 MIT 标签也不自动赋予所有原站内容再分发权。

## 4. 最低可信的比较组与否定条件

1. **同组件、共享状态的固定完整流程**：同模型、原始历史、工具、评分后端、候选 metadata 与预算；只让行动顺序/触发不同，防止把能力补齐算成协调收益。
2. **同动作通用 Agent**：获得同样的状态和候选摘要，允许更新、搜、排、保持；检验通用规划是否已经够用。
3. **ClawRec-adapted 原机制 + 同门控增强版**：原机制保留证据状态、源角色、预算和反馈；适配固定检索环境的改动全部列出。两版分别回答“是否超过最近完整方法”和“是否只多了一个门控”。
4. **RecBot-style / MARS-style 模块替换**：分别替换语言到约束/排序控制、记忆调度，在相同外层环境比较；不给它们缺失的召回能力扣分，不拿原论文分数与新环境直接比。
5. **Waterfall 原型与完整提案分列**：当前受限 M/S 更新不能和拟议候选控制器混在一个条件。只有完整提案在同成本下超过强对照，并且去掉相应协同依赖会下降，才支持方法主张。

`ClawRec + gate` 追平、收益只来自额外模型调用/更好的评分器、只在模板模拟反馈里有收益而真人不支持，均会收缩方法结论。自建数据仍可成为贡献，但需要独立证明任务覆盖、标注可靠性、真人反馈来源、对新方法的可复用性和能区分强对照，不能因为“自建”就宣称创新成立。

## 5. 参数学习与运行时状态的用词

建议统一写 **frozen-model runtime adaptation / continual user-state adaptation**。MARS 已有冻结 planner；[InteRecAgent 官方项目](https://github.com/microsoft/RecAI/tree/main/InteRecAgent)已有调用查询/召回/排序工具的框架。冻结大模型本身不是 Waterfall 独创。

若讨论联合训练，只作相邻路线：[RRCM 最新 v2](https://arxiv.org/abs/2605.07129)（2026-09-27）用排名奖励优化记忆读取策略；[RAR 最新 v2](https://arxiv.org/abs/2604.04457)（2026-04-13）用排名反馈更新召回模型。它们说明“最终推荐效果驱动召回”已有先例，不应把其训练时更新混称用户运行时纠正画像。Waterfall 本轮默认不新增模型参数训练。

未做：官方代码运行、作者效果复现、全量数据完整性审计或实验。主要风险是方法与 ClawRec/RecBot/MARS 的重合仍较大；候选门控及自建数据的贡献必须由公平强对照和实际标注质量证明。
