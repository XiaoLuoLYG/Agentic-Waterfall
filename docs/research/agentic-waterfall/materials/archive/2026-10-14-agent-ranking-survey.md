# Waterfall：Agent 推荐排序与操作输出的既有工作核验

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../01-研究主方案.md) 和 [输入输出与数据流](../../02-输入输出与数据流.md) 为准。

核验日：2026-10-14。依据作者论文、正式论文集、作者代码与数据页；下列“相近”“可研究”是分析判断，不是首次性或录用保证。本文只讨论推荐、排序、用户记忆与操作输出；检索召回另见主报告。

## 最关键的判断

**“用 Agent 推荐”“用自然语言改推荐”“根据反馈更新记忆”“输出操作而不是聊天文字”都已有直接先例。** 最应逐项对比的是 RecBot、iAgent/i²Agent、MARS；PersonaMem-v3 已经提供非常接近“跨来源行为 + 用户指令 + 动态记忆 + 信息流排序”的测试任务。

按主调查对 PPT 第 15、20、21 页的核验，Waterfall 当前更准确的定位是：**Agent 更新用户状态和查询主题，代码负责打分、去重、槽位和来源穿插。** 这属于“Agent 控制推荐流程”，不能直接称为“Agent 学会了排序算法”。`edit_pes_profile` 的增删、`commit_s_agent` 的状态提交是动作接口；创新要看它们如何改善决策，不能由接口格式推导。

## 12 篇核心文献

| 工作、已核验状态 | 输入 → 实际输出/动作 | 与 Waterfall 的关系 |
|---|---|---|
| **[RecBot — Interactive Recommendation Agent with Active User Commands](https://arxiv.org/html/2509.21317v2)**；2025-09 首发，KDD 2026，见[作者研究组发表记录](https://ict-star.github.io/publications/)与[会议论文索引](https://kdd2026.kdd.org/papers/)；arXiv仍保留旧的Under Review标记 | 当前信息流、用户语言指令、历史偏好和交互序列 → 解析正/负、硬/软条件；保留/合并/解决记忆冲突；调度 Filter、Matcher、Attenuator、Aggregator，计算下一页排序 | **最接近现有控制方式。** 已有“刷信息流时说一句话 → Agent 更新偏好 → 操作打分工具 → 下一页变化”。包含离线实验与作者报告的三个月线上实验。不能把这一整条链条再当作新范式。原文 §2–3、§4.3。 |
| **[MARS — Agentic Recommender System with Hierarchical Belief-State Memory](https://arxiv.org/html/2605.14401v2)**；2026-05 预印本 | 用户、物品、动作、物品信息、时间 → 事件/偏好/画像三层；计划提取、增强、减弱、合并、遗忘、重写画像，或跳过；随后 LLM 给候选打分 | **最接近“最终输出记忆操作”。** 已有强度、证据数、容量限制及操作调度。论文明确部分更新是确定性规则；不能将“操作由 Agent 选、代码执行”本身当创新。原文 §3.2–3.4。 |
| **[iAgent: LLM Agent as a Shield between User and Recommender Systems](https://aclanthology.org/2025.findings-acl.928/)**；Findings of ACL 2025 | 用户自由文本要求、历史交互、候选信息 → 调用知识工具、重新排列列表；i²Agent 依反馈更新个人画像，并抽取当前要求相关兴趣 | **最直接的公开排序基线。** 用户侧代理、语言控制、动态个人记忆均已存在。其 InstructRec 指令由历史评论生成，评测每次 1 个真实交互物品 + 9 个随机候选；这是受控排序，不能当全网召回表现。论文 §2、§3.1。 |
| **[PersonaMem-v3: Toward Omni-Platform Personal Intelligence for Holistic User Understanding, Recommendation, and Agentic Tasks](https://arxiv.org/html/2608.21381)**；2026 预印本，v2 更新于 10-07 | 带时间的跨平台证据、语言指令、候选 → 排序及工具动作；测指令持续生效、临时兴趣到期和过度个性化 | **高度相关的补充基准。** 核心排序给 16 个候选，用未来正反馈和难负例评 NDCG@5；指令持续性看 24 小时、72 小时、7 天。数据经群组聚合/重采样后，再合成丰富画像和六平台活动，不能称原始真实跨平台日志。原文 §2.1、§3.2.3、§7。 |
| **[InteRecAgent — Recommender AI Agent: Integrating Large Language Models for Interactive Recommendations](https://arxiv.org/html/2308.16505)**；2023 预印本；[TOIS 2025 论文页](https://doi.org/10.1145/3731446) | 对话、用户画像 → SQL 查询/过滤、物品召回、推荐模型排序；候选总线存中间结果 | **“LLM 是脑，传统搜推是工具”早已有之。** 长短期画像还分 like/dislike/expect，其中 expect 特意表示当前要求，不等于永久喜好。直接覆盖“把当前任务与长期偏好分开”的基础思路。原文 §3.1–3.2。 |
| **[RecMind: Large Language Model Powered Agent For Recommendation](https://aclanthology.org/2024.findings-naacl.271/)**；Findings of NAACL 2024 | 推荐任务、用户历史与可查询知识 → 规划并调用工具，再做推荐等任务 | 已有不微调 LLM 的推荐 Agent，具备记忆、工具和多步规划。贡献是具体规划方法与实验，不是“Agent 能推荐”这句话。其多任务结果不能直接换算成 Waterfall 信息流收益。 |
| **[Large Language Models are Zero-Shot Rankers for Recommender Systems / LLMRank](https://arxiv.org/abs/2305.08845)**；ECIR 2024，[作者代码确认](https://github.com/RUCAIBox/LLMRank) | 用户按时间排列的历史 + 其他模型召回的候选 → 输出重新排列的物品列表 | “不训练，直接请 LLM 给候选排序”已有成熟起点；原文指出历史顺序理解、热门物品偏好、候选位置偏差。它评的是候选内排序，不能证明找全了候选。 |
| **[Is ChatGPT Good at Search? Investigating Large Language Models as Re-Ranking Agents / RankGPT](https://aclanthology.org/2023.emnlp-main.923/)**；EMNLP 2023 | 查询 + 搜到的文本段落 → 相关性顺序 | 证明 LLM 检索重排已有研究。适合“这篇内容是否回答这个查询”的对照；不是“这个用户此刻会不会喜欢”的完整推荐对照。 |
| **[AgentCF: Collaborative Learning with Autonomous Language Agents for Recommender Systems](https://arxiv.org/html/2310.09233)**；WWW 2024，[作者代码](https://github.com/RUCAIBox/AgentCF) | 真实用户物品交互 → 用户与物品 Agent 做选择、对照实际行为反思并更新各自记忆 | 根据行为而非只根据对话学习，以及通过反思改记忆，已有先例。它强调用户—物品协同建模，不等于用户在内容信息流中发指令控制搜索。 |
| **[MemRec: Collaborative Memory-Augmented Agentic Recommender System](https://aclanthology.org/2026.acl-long.2061/)**；ACL 2026 主会长文 | 用户/物品及社区关联证据 → 小模型在后台维护、提炼协同记忆；大模型负责最终推荐 | “后台记忆维护与前台推荐解耦”也已有直接先例。区别在共享群体信息，不只是单用户 Top10 记忆。[作者代码](https://github.com/rutgerswiselab/memrec)已公开。 |
| **[SAGER: Self-Evolving User Policy Skills for Recommendation Agent](https://arxiv.org/html/2604.14972v2)**；2026-04 预印本 | 用户接受/未选的物品、记忆 → 更新个人自然语言决策原则，再用它对候选整表排序 | 连“每个用户有会变化的推荐策略文字”也已有先例。需注意论文的主要实验在预热后冻结策略再测试，不能把结果描述为完全开放的长期线上学习证明。 |
| **[Re2LLM: Reflective Reinforcement Large Language Model for Session-based Recommendation](https://ojs.aaai.org/index.php/AAAI/article/view/33399)**；AAAI 2025 | 当前会话里的物品序列 → 从错误反思形成提示库，由轻量强化学习代理挑提示，引导 LLM 推荐下一个物品 | “不微调大模型 + 反思 + 经验检索”已有工作；但它训练检索代理，不能一概标为完全免训练。主要是单会话下一物品任务。 |

补充辨别：**[RecAgent / User Behavior Simulation with Large Language Model based Agents](https://arxiv.org/abs/2306.02552)** 主要是模拟用户行为的环境，不能因为名字有 Rec 和 Agent 就当成直接排序算法。**[Tunable LLM-based Proactive Recommendation Agent](https://aclanthology.org/2025.acl-long.944/)**（ACL 2025）和 **[STEPS / A Self-Triggered Agentic Push Recommendation System](https://arxiv.org/abs/2608.01949)**（2026-08 预印本）也说明“主动推荐”不是空白；但前者有长期目标引导，后者决定推送时机，不能与应用内信息流混成同一个任务。

## 还能把问题定义在哪里

以下是**待实验验证的研究假设**，不是本次已证明的创新点：

> 用户一边浏览、一边说出新要求时，系统怎样用少量、可能误导的行为证据，决定该修改哪条偏好、该影响哪些下一轮搜索与展示，同时避免误改其余偏好？

只写“长期/短期分开”“加入置信度”“增删记忆”仍不够：InteRecAgent、MARS、PersonaMem-v3 已覆盖相当多的基础设计。真正要拿出的是比这些方法更明确的更新规则，以及能揭示差别的失败情形。

例如：“平时喜欢数码；本周替父母找手机；刚看了一篇摄影手机测评；用户说‘这次只要便宜、大字、续航好’。”系统应当用这句话控制当前推荐，不把一次购物永久改成用户的新爱好。任务结束后，数码兴趣仍在。这个例子可以测**改对范围、多久见效、结束后能否恢复、是否忘掉无关偏好**，而不只测最终列表有没有手机。

`commit_s_agent` 的原子提交可以让画像和搜索主题版本一致，这是合理工程设计。若要研究贡献，需证明不同步会导致错误候选/旧偏好继续曝光，并通过对照实验显示解决了这个问题；“有事务”不自动等于推荐方法创新。

## 最小而公平的对照

先固定同一批候选、相同物品信息、同一个基础模型与成本预算。各方法只能看到当时已经发生的行为，不能提前看到后续点赞或测试标签。把召回和排序分开，否则无法判断涨分来自哪里。

| 对照 | 它回答的问题 |
|---|---|
| 现有规则排序 + 不更新画像 | 没有 Agent 时现在能做到多好？ |
| 现有规则排序 + 全历史 LLM 摘要 | 复杂记忆动作是否真的优于“把历史总结一下”？ |
| 现有规则排序 + Waterfall 更新策略 | 单独测 S Agent 改用户状态的价值，保持排序器完全一样。 |
| 同候选的 LLMRank / i²Agent | 如果直接让 LLM 或已有个人 Agent 排序，Waterfall 还有什么优势？ |
| RecBot 风格控制；MARS 风格记忆调度 | 针对“语言转操作”与“行为转记忆”的最近邻作方法对照。未原样复现时，应写“依论文实现的对照”，不要冒充官方结果。 |

如果论文强调后台记忆维护，再纳入 MemRec；强调个体策略自演化，再纳入 SAGER。不用为了论文显得丰富而同时重现所有方法。

**排序好坏的简单例子：** 固定 20 篇候选，用户后来真实喜欢其中 3 篇。A 把它们排在第 1、3、5，B 排在第 8、12、18，A 就更容易让用户看到喜欢的内容。先报“前 5 篇里中了几篇”，再用一个越靠前加分越高的指标（NDCG@5）统一比较。若只有一篇已知正例，别把“排进前 5 的比例”误写成用户对所有其他内容都不喜欢。

对语言控制，另测“不要摄影内容”之后前 5 条仍出现几条摄影；对记忆更新，测一次偶然长停留会不会误改画像；对系统体验，测下一页生效时间和每百次浏览的调用成本。这些是本调查建议的指标，不是已有实验结果。

## PersonaMem-v3 如何用，边界是什么

已核验 [Hugging Face 数据页](https://huggingface.co/datasets/bowen-upenn/PersonaMem-v3) 与 [作者 GitHub](https://github.com/bowen-upenn/PersonaMem-v3) 可访问。可以先选 feed ranking、@AI 指令跟随、短期兴趣到期三类，测试 Waterfall 的记忆与控制逻辑。原始输入可参考显式/隐式正负信号、时间、内容标签以及展开后的 `action` 等字段；不要把缺失的真实停留秒数伪造出来。

它非常接近产品目标，但它是由隐私处理后的行为底座和合成跨平台世界组成的基准。优点是有指令、时间和任务标准；局限是不能单独证明真实 Waterfall 用户会更满意，也不能作为全网召回覆盖率测试。文中“跳过不一定是不喜欢”的处理值得采用为基本原则，而不是抄其数据特定阈值。

## 证据边界

已读核心方法和评测设置，核验论文/作者资源状态；没有运行任何论文代码，也没有验证作者线上效果。主调查补查确认：KDD 2026官网原始页面内的论文数据列出RecBot，轨道为Research，正式[DOI为10.1145/3770855.3817619](https://doi.org/10.1145/3770855.3817619)，作者研究组也列为KDD 2026。网页文本解析未展示动态列表，不能据此误判尚未发表；arXiv旧状态不应覆盖更新的一手记录。相关性检索不可能证明不存在未检索到的更近工作。
