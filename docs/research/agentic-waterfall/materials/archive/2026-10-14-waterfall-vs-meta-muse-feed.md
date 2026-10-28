# 当前 Waterfall 与 Meta Muse Feed：功能差异与可借鉴方向

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../01-研究主方案.md) 和 [输入输出与数据流](../../02-输入输出与数据流.md) 为准。

核对日期：2026-10-14，Asia/Shanghai。

**结论：Waterfall 已经有多来源内容发现、反馈学习和阅读助手。Muse 最值得借鉴的是把“阅读目的、个人化表达、推荐解释、继续讨论”连成一段用户能感知的体验。** 不需要因为 Muse 使用 Agent，就重写 Waterfall 的排序与内容池。

## 比较基准与证据

- 已读取引用聊天《梳理 Waterfall 演示材料》，并查看其中保留的 Muse 用户原截图 01、05。
- Waterfall 采用本轮 `git ls-remote` 核实的 DigitalMate `release_20260818`：`f70603d0db5939a3a68d23176686c18d1ecb31f3`。读取的是固定提交中的源码，未把本机旧分支和未提交修改混入结论。本目录正在拆分的独立版也以该提交为来源，但本报告不承担迁移验收。
- Muse 采用本轮打开的一手设计文章、帮助中心和官方导览，以及此前用户提供、本轮重新查看的界面截图。官方展示证明公开提供/演示了什么；截图证明可见界面，不证明后台一定按要求执行。
- 下文“当前有”表示源码已有入口或实现；没有因此宣称所有平台接口今天均联网成功。“建议”均未实施。

### 先更正旧材料中的一个结论

10 月 8 日基准曾存在“主 App 话题偏好被 Top10 整栏替换”。**10 月 12 日的 #224 已改变这点：**

1. 主 App 投影的话题权重与 Waterfall Top10 合并参与排序；前者按候选内容匹配，后者保留其搜索词匹配方式。
2. S Agent 已能读取最多 24 条主 App 推荐偏好摘要；它不能把同一条主 App 记忆再冒充一份独立浏览证据。
3. 记忆变化会触发刷新，并防止过期模型结果覆盖新状态；这不等于偏好保存后内容立刻全部到货。

因此，不能再说当前 Waterfall “主 App 记忆完全没进入话题推荐”。但共享部分信号，也不等于此前讨论的统一画像、临时需求有效期、完整冲突规则和用户管理界面已经全部实现。[W1][W2][W3]

## 逐项功能比较

| 用户关心的功能 | 当前 Waterfall | Meta Muse Feed 的可确认范围 | 判断与借鉴价值 |
|---|---|---|---|
| **打开后消费什么** | 主要是来源条目：视频、图文、帖子、新闻、播客等，保留来源与原链接。[W4][W5] | 官方导览说明 Feed 帖子专门为用户撰写；截图呈现短文、配图和引用链接。[M1][U1] | 核心差别是个性化发生在哪里：Waterfall 主要改变取哪些内容、怎样排列；Muse 还改变怎样把材料讲给这个人。 |
| **自然语言能控制什么** | 当前发现页对话只增删“优先主题”；提示明确排除修改信源、形式、画像和排序权重。来源另有界面控制。[W6] | Feed instructions 能表达主题、阅读角度和简洁程度；官方还演示按时段描述内容需求。[M1][U1] | **差距明确，优先借鉴。** 用户应能表达用途与本次限制；但不能仅换一段 prompt 就宣称执行完成。 |
| **理解为什么看** | 明确主题与行为兴趣已进入供给和排序；尚无完整的用户可见“本次阅读目的”设置。旧通用偏好类型存在，不等于当前入口接通所有能力。[W1][W6] | 截图指令关注选举“对市场与政策的影响”，生成理由也回应这个目的。[U1] | 从“我喜欢机器人”进到“我为项目选型看机器人，重点看成本和真实演示”。这能影响找法、选法和解释。 |
| **按个人情况写内容** | Reader AI 可总结、回答与生成追问；主 Feed 没有逐条按个人背景重新撰稿的主链。[W7] | 官方称每篇为用户撰写；旅行示例结合用户已有出行语境。[M1] | 不必把全流改成生成文章。可以先加少量“今日重点/主题简报”，并保留原内容入口。 |
| **为什么出现这张卡** | 有检索命中、时效等简单 `reason`，当前渲染主要在 summary 缺失时作回退；未看到常驻的个人相关性解释与纠正入口。[W4][W8] | 截图有 “Why I created this post”，解释内容与用户兴趣/阅读目的的联系。[U1] | **差距明确，实施范围相对可控。** Waterfall 可基于真实选取依据解释，并让用户纠正。理由不能由模型随意补故事。 |
| **围绕一条内容继续聊** | 已有 AI 总结、临时问答和建议追问；模型输入是标题、最多 6000 字符的 summary、主题、媒体类型与临时对话。[W7][W8] | 官方画面和截图有 Discuss；本轮未登录点击，也未验证讨论是否自动改变 Feed。[M1][U1] | **不是“有/没有聊天”的差距。** 值得补的是讨论后明确选择“仅本次解释”或“用于后续推荐”。 |
| **材料理解深度** | 阅读界面可能取得正文，但现有 Reader AI 构造请求仍以 candidate.summary 为 body；视频提示明确禁止把标题简介冒充看过视频或取得字幕。[W7] | 公开展示有引用和生成短文；完整正文获取、视频理解覆盖率与回答准确率未公开验证。 | 不能据此判 Muse 理解更深。Waterfall 如增加个人简报，先明确模型拿到了全文、摘要还是字幕。 |
| **点赞、不喜欢、收藏、分享** | 已有喜欢/不喜欢/收藏、收藏检索、分享与查看来源；行为可以形成偏好信号。[W8][W9] | 用户截图有赞、踩与 Discuss。完整收藏、分享、历史管理范围未由本轮来源确定。[U1] | 已有能力无需照着重做。负反馈可以进一步区分“不喜欢主题”“重复了”“这条质量差”。不能宣称 Muse 已有这套原因分类。 |
| **主聊天与长期记忆** | 主 App 偏好与 Waterfall 行为兴趣已经共同影响排序，S Agent 可参考主 App 摘要；仍是不同依据和状态。[W1][W2][W3] | 官方帮助确认对话、交互模式、连接服务与文件记忆参与个人理解，可通过对话或手动修改，跨会话保留。[M2] | 借鉴“用户能看懂、能更正”的产品呈现。Muse 未公开 Feed 内部怎样融合这些信息，不能当作已知算法。 |
| **临时需求和按时段阅读** | 当前发现页主题编辑没有到期时间、阅读长度或时段规则的完整执行入口。[W6] | 官方导览演示早晨财经、晚间非虚构书籍推荐；运行节奏、准点性及冲突优先级未披露。[M1] | 先补“本次/今天”的有效期，时段模式放在下一步。避免临时研究永远污染长期兴趣。 |
| **来源控制和订阅** | 来源开关、添加 RSS 2.0/Atom、原链接，以及各平台媒体/评论适配已有代码。[W5][W8][W10] | Feed 帖子含报道署名/链接，但本轮未核实与 Waterfall 等价的平台开关、RSS、自有订阅或原生播放器体系。[U1] | 这是 Waterfall 已有的能力资产。不能把“未展示 Muse 有”写成“Muse 不支持”。也不能把 Muse Connectors 数量当作 Feed 来源数量。 |
| **内容更新与持续关注** | 有补货、分页、库存恢复和调度；尚未核实完整的“指定主题长期跟踪、仅实质变化通知”闭环。已耗尽的分页关键词当前不会因时间过去自动恢复。[W11] | Muse 整体产品能按计划/事件继续做任务，只在值得提醒或需要输入时通知；这是 Agent 平台能力，未证明每张 Feed 卡都可一键建立监控。[M3] | 可作为后续延伸，但不要把补货等同持续跟踪。跟踪先交给宿主 Agent，Feed 接收变化摘要。 |
| **浏览稳定性** | 保留当前及稳定窗口，主要调整后续内容；有去重、候选区、补排与多来源内容组织。[W4] | 官方未公开 Feed 的队列、刷新和去重实现，也没有可比运行数据。 | 保留 Waterfall 现有工程投入。不能因 Muse 演示顺滑就推断应改成其未知内部算法。 |
| **长期任务、产物和执行** | 宿主有任务状态提示，独立 Waterfall 的模块边界是内容发现，通用任务由宿主承接。[W12] | Muse 整体产品公开有 Goals、Ideas、Artifacts 和后台任务。[M3] | 借鉴发现后能继续做事的衔接，不把邮件、购物、文件管理等整个个人 Agent 平台塞进 Waterfall。 |

## 最值得做的五件事

### 1. 把“主题列表”提升为可见的阅读要求

**优先级：先做；影响面中等。** Muse 给出的启发是表达空间，不是它的文本框样式。

例子：用户说“这周看端侧 Agent，重点找实际产品，少看融资；今天只看图文”。建议界面显示：

> 本周关注：端侧 Agent · 实际产品  
> 减少：融资新闻  
> 今天形式：图文  
> 到期恢复；可修改或撤销

最小首版只接通当前主题、形式限制、有效期和可撤销反馈。阅读角度先影响搜索词与候选选择，不能未增加写作链却承诺“所有文章按你的风格重写”。

需要覆盖偏好解析、保存、供给与排序应用、到期处理及界面回执。保留现有来源控制、内容池和稳定浏览机制。验收看偏好更新到首条合格内容的耗时、不符合明确形式限制的比例，以及到期后是否恢复；不要用“解析成功”代替生效。

### 2. 给卡片一个可信的“为什么给我看”

**优先级：先做；影响面小到中等，取决于已有溯源字段是否足够。**

例子：“来自你本周关注的端侧 Agent，今天更新，包含设备演示。”只有真实参与选取的条件才展示；仅按搜索词入池时应说“按这个主题找到”，不能声称已确认文章满足所有质量要求。

最小范围是保留选取时的依据、卡片解释和纠正操作。优先使用结构化依据与短模板，不先增加每卡一次大模型调用。纠正可以是“本周不想看这个”“这不是实测”。

验收抽查理由是否和实际选取记录一致，以及用户能否用一次操作修正误解。`reason` 原有的“标题命中查询”不足以直接冒充个人解释。

### 3. 让现有阅读助手能接回后续发现

**优先级：先做；影响面中等。** Waterfall 不缺问答入口，缺的是把明确的新意图接回去。

例子：看完一篇机器人文章后说“以后给我更多带真实演示的，少看概念宣传”。建议返回可检查的偏好变更，并按用户用词区分“这一篇解释得短些”和“以后默认短些”。

复用现有 Reader AI 和偏好应用通路，不新建一套平行聊天。问答材料有全文就用全文并保留来源，没有就明确使用摘要；不声称读取了并未取得的视频。

验收一条明确的后续要求能否影响接下来候选；普通问答是否保持只读，不悄悄改长期偏好。

### 4. 增加少量个人简报，保留原始内容

**优先级：第二阶段；影响面与成本较高。** 这是 Muse 与 Waterfall 最大的输出差异，但不适合第一步全量替换。

最小版本针对一个主题/一次请求，把几条已取得的资料组织成“发生了什么—与你有什么关系—继续看哪些原文”，嵌入一张简报卡。每条关键结论有来源；分析、推测与材料事实分开。对同一事件的多来源综合属于本报告的建议，不能仅凭 Muse 有两个引用就认定其已完整实现相同机制。

不必先接新平台，不对所有卡片预生成长文。验收阅读理解所需时间、信息遗漏、引文支持率、生成延迟与费用。只有用户实际节省了理解成本，才扩大覆盖。

### 5. 从收藏进一步走到“有变化再告诉我”

**优先级：之后做；最好利用宿主 Agent。**

例子：“跟踪这个开源项目，只在新版本或关键能力变化时提醒。”任务由宿主保存、调度，Waterfall 展示更新摘要、来源与暂停入口；不要求 Feed 自己拥有整套通用任务系统。

先解决主题重新检查、已读变化对比、来源失败可见性。当前已耗尽分页词不会自行重新开放，说明“能一直刷”与“能持续追新”是不同要求。具体重查周期应按来源与使用成本确定，不能把此前提过的 24 小时方案当作已采用。

验收应统计有用变化命中、重复提醒、漏报和来源失败；没有新增信息时保持安静。

## 用一个场景看清区别

用户要研究端侧 Agent 产品：

- **当前 Waterfall：** 用户添加“端侧 Agent”主题；系统从已启用来源取内容、选批排序，提供原文/视频与阅读问答。主 App 相关偏好也能参与。当前不能只凭一句复杂要求，就保证“只看图文、只看本周实测、两百字内讲清楚”。
- **Muse 已展示的方向：** 用户在 Feed instructions 说明领域、用途、写法，Feed 生成面向个人的图文帖子，展示个人相关性理由，再提供 Discuss。不能把这个演示扩大成对每条限制的严格保证。
- **建议的 Waterfall：** 先清楚执行本次限制，再展示来自不同来源的原内容；必要时提供一张短简报；解释实际推荐依据；用户讨论后明确提出的新需求可继续影响后续内容。

建议产品方向可表述为：**让用户按自己的目的发现内容，看得懂为什么推荐，也能随时纠正；需要重点时帮他整理，需要深入时保留原文和原媒体。**

## 不建议直接照搬的部分

1. 全量重写 Feed 每张卡：会增加引用核查、延迟与费用，并削弱原视频/原帖消费体验，须先用少量简报验证。
2. 只有一个巨大的 prompt 文本框：表达方便，但规则是否生效、什么时候过期仍需用户可见。
3. 把 Muse 整体的连接服务、Goals、Artifacts 都算作 Feed 已有能力；或为了对齐它，把 Waterfall 重做成完整个人 Agent。
4. 把每次阅读停留或一条主 App 记忆重复计算成多份兴趣证据。当前代码已经在区分这些来源，应保留。
5. 仅凭展示就宣称更准、更快、更省电。没有同条件实测，也未找到足够的 Feed 专属公开排序指标来比较。

## 证据入口

### Muse 一手资料

- [M1 官方导览，Feed 段约 1:09 起](https://www.youtube.com/watch?v=wHn0hTjvFoo&t=69s)。本轮研究通过 YouTube 页面转写核对主题、时段与个性化撰稿表述。
- [M2 Meta 帮助：个性与记忆](https://www.meta.com/help/artificial-intelligence/995796179982326/)。本轮重新打开。
- [M3 官方设计文章：How We Designed Muse](https://introducing.muse.ai/)。本轮重新打开；区分整体任务、Goals、Ideas、Artifacts 与 Feed。
- [U1 用户原截图：Feed instructions](../../../../../../../codex/Waterfall-Anything-重要文档/PPT材料-2026-09-28/Waterfall-补充研究与素材-单文档版-2026-10-09/素材/Muse-用户截图-01-Feed指令.jpg)；[个人相关性解释与 Discuss](../../../../../../../codex/Waterfall-Anything-重要文档/PPT材料-2026-09-28/Waterfall-补充研究与素材-单文档版-2026-10-09/素材/Muse-用户截图-05-选举与市场关联.jpg)。本轮查看原图；不把图中新闻事实作为本报告的事实结论。
- [本轮 Muse 专项来源记录](2026-10-14-meta-muse-primary-sources.md)。

### Waterfall 固定提交证据

以下均为本轮读取过的 `f70603d0` 源码，而非旧工作区文件：

- [W1 Index.ets，推荐画像合成](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/Index.ets#L5497-L5543)。
- [W2 S Agent prompt](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/WaterfallSAgentPrompt.ets)；[主 App 摘要与证据去重](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/WaterfallSAgent.ets)。
- [W3 主 App 记忆投影更新](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/DiscoveryMemoryProjectionCoordinator.ets)。
- [W4 候选结构、简单 reason、偏好匹配与展示状态](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/agent_core/src/main/ets/aiphone/runtime/WaterfallAnythingCore.ets)。
- [W5 来源适配器注册](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/agent_core/src/main/ets/aiphone/runtime/ToolGatewayClient.ets#L15749-L15824)。
- [W6 当前发现页对话职责](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/WaterfallPesConversation.ets#L7-L16)。
- [W7 Reader AI 实际输入](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/Index.ets#L1188-L1213)。
- [W8 卡片、反馈栏、AI 阅读、收藏和来源界面](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/html/HtmlAggregateSearchHomeRenderer.ets)。
- [W9 喜欢/不喜欢/收藏状态与持久化](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/WaterfallReactions.ets)。
- [W10 RSS 注册与 Worker](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/workers/WaterfallPoolWorker.ets)。
- [W11 已耗尽关键词可用性判断](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/agent_core/src/main/ets/aiphone/runtime/WaterfallPool.ets#L572-L578)；[分页进度](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/agent_core/src/main/ets/aiphone/runtime/WaterfallSearchProgress.ets)。
- [W12 宿主任务提示状态](https://github.com/XiaoLuoLYG/DigitalMate/blob/f70603d0db5939a3a68d23176686c18d1ecb31f3/entry/src/main/ets/pages/A2uiHome/waterfall/WaterfallTaskNotice.ets)。

本轮只新增研究文档；未改产品代码，未登录 Muse 做同条件实测，未验证手机当前安装包与基准提交一致。建议的收益与工作量仍需通过最小原型和实际使用验证。
