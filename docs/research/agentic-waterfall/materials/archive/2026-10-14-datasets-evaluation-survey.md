# Waterfall：公开数据与评估调查

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../01-研究主方案.md) 和 [输入输出与数据流](../../02-输入输出与数据流.md) 为准。

核验日期：2026-10-14。下文区分官方已公开的事实与建议方案；没有下载全量数据、运行模型或产生性能结果。

**结论：点赞、曝光、停留、反馈时间序列早已有成熟定义，结构化这些输入本身不是创新。真正要验证的是：同样的用户历史、内容池和成本下，Waterfall 是否更会找内容、更会安排顺序，以及是否更快纠正对用户的误解。**

## 1. 这些数据究竟有没有你的输入

| 数据 | 已公开、可以直接用的东西 | 不能直接声称拥有的东西 | 对 Waterfall 的用途 |
| --- | --- | --- | --- |
| MIND | 英文新闻标题/摘要/分类；用户过去点击；同次曝光的新闻及点击/未点击 | 点赞、收藏、文章停留、明确讨厌；下载包不含新闻全文 | 最省事的新闻推荐排序起点 |
| KuaiRand | 每次视频交互的点赞、显式负反馈、播放时长、时间；普通推荐和随机曝光 | 文章阅读时长、精确滑动轨迹、Waterfall 操作的正确答案 | 检验多种反馈如何更新推荐 |
| KuaiRec | 视频观看时长、视频长度、近乎完整的小型用户×视频反馈表；补充文本 | 逐次交互的真实点赞（官方明确没有） | 较少“没看到所以不知道”的离线对照 |
| BEIR | 固定文档库、查询、相关性标注 | 用户点赞/画像/连续反馈 | 单独测试“给定需求能否找对文档” |
| EB-NeRD | 丹麦新闻正文/标题/摘要，曝光列表、点击、阅读时长、滚动比例 | 真实点赞/讨厌；原始曝光顺序已打乱 | 更贴近文章停留与推荐的扩展实验 |
| Adressa | 挪威新闻访问事件、页面活跃秒数、会话边界 | 官方字典未给出 MIND 式完整同次曝光候选列表 | 阅读停留的补充验证，优先级低于上面组合 |

出处：[MIND 官方说明](https://learn.microsoft.com/en-us/azure/open-datasets/dataset-microsoft-news)、[KuaiRand 官网](https://kuairand.com/)、[KuaiRec 官网](https://kuairec.com/)、[BEIR 数据格式](https://github.com/beir-cellar/beir/wiki/Load-your-custom-dataset)、[EB-NeRD 论文](https://arxiv.org/abs/2410.03432)、[Adressa 官方手册](https://reclab.idi.ntnu.no/dataset/cxdataset_v5.pdf)。

### MIND：适合第一版，但只有点击

`behaviors.tsv` 无表头，五列依次为 `Impression ID / User ID / Time / History / Impressions`。示例 `N4-1 N34-1 N156-0` 表示同一轮展示三篇新闻，前两篇点击，第三篇未点击。它没有告诉你第三篇是否被认真看过，更不代表用户讨厌第三篇。`History` 是该次曝光前点击过的新闻 ID，不含每条历史的精确停留。`news.tsv` 实际列出八个字段：ID、类别、子类、标题、摘要、URL、标题实体、摘要实体；官方文案误写“七列”，应以字段列表/示例读取代码为准。全文因许可不随包公开。[微软数据字典](https://learn.microsoft.com/en-us/azure/open-datasets/dataset-microsoft-news)

推荐保留官方曝光列表做排序评估，先用 MIND-small 调试，再扩大规模；不要把官方未点击样本改叫“明确负反馈”。官方挑战采用 AUC、MRR、nDCG@5/10，主文只需解释并突出 nDCG@10，其余放附表。[MIND 官方挑战说明](https://competitions.codalab.org/competitions/24122)

### KuaiRand：与你的反馈最接近，但语义不能混

| 原字段 | 原意 | 接入时的限制 |
| --- | --- | --- |
| `user_id`, `video_id`, `time_ms` | 用户、视频、毫秒时间戳 | 时间是交互时间，不是完整 UI 手势日志 |
| `is_like` | 点过赞，0/1 | 0 是没有点赞，不能改成讨厌 |
| `is_hate` | 显式负反馈，0/1 | 不是“取消赞” |
| `is_click` | 双列界面是点击；单列界面是有效播放 | 不能全部映射为 `open` |
| `play_time_ms`, `duration_ms` | 播放毫秒、视频时长毫秒 | 不等同卡片可见时间，也不等同文章活跃阅读 |
| `long_view` | 短于等于 18 秒的视频看完，较长视频至少看 18 秒 | 阈值不是 Waterfall 目前的 15 秒 |
| `is_follow`, `is_comment`, `is_forward`, `is_profile_enter` | 关注、评论、转发、进入作者页 | 若当前 Agent 没吃这些字段，就不能宣称已支持 |
| `profile_stay_time`, `comment_stay_time` | 作者页/评论区停留 | 官网这两项没有明确写单位；本调查不擅自判定为毫秒 |
| `is_rand`, `tab` | 是否随机插入、所在推荐场景 | 保留，不能将所有日志当随机曝光 |

有效播放的精确定义：视频≤7秒时需要看完；视频>7秒时需播放>7秒。公开交互字段没有单独的 `skip`，如用“短播放”定义跳过，须写成研究者派生标签。[官方日志字典](https://github.com/chongminggao/KuaiRand#1️⃣-description-of-the-fields-in-log_xxxcsv)

**版本选错会改变研究问题。** 27K 含 27,285 个用户的完整发布历史；1K 是抽其中 1,000 个用户并保留其历史；Pure 保留 7,583 个随机候选池视频相关日志，因此删掉了用户看其他视频的中间过程。官方建议长序列/离线策略评估用 1K/27K，明确提示 Pure 序列不完整。建议 Pure 只跑通流程，持续画像更新实验用 1K。[官方版本比较](https://kuairand.com/#three-versions-and-suggestions)

**语义信息有新补充，不能沿用“只有匿名 ID”的旧说法。** 目前官方提供 `kuairand_video_captions.csv`（`final_video_id`, `caption`, `show_cover_text`, `duration`）和类别名称文件。封面文字可为空，缺类别可能是 `-124`/`UNKNOWN`。原始 `tag` 仍是类别编号，不能让 LLM 凭编号理解内容。实验前应统计所选版本的文本覆盖率、空值率、ID 联接成功率；本次只核验官方说明，没有实测覆盖率。[官方补充数据说明](https://github.com/chongminggao/KuaiRand#additional-video-level-metadata-supplementary-files)

尤其不要直接使用 `video_features_statistic` 预测历史行为：它汇总整个月的平均统计，包含待预测时刻之后的信息。建议第一版不用，或仅从预测时刻之前的日志重算。[官方统计字段说明](https://kuairand.com/#4️⃣-descriptions-of-the-fields-in-video_features_statisticcsv)

### KuaiRec：有停留，不等于有点赞

核心字段是 `user_id / video_id / play_duration / video_duration / time / date / timestamp / watch_ratio`。前两种 duration 单位是毫秒，`timestamp` 示例为 Unix 秒；`watch_ratio = play_duration / video_duration`，可以超过 1，不能因为大于 1 就自动当脏数据。官方示例把 `watch_ratio > 2` 派生成正反馈，只是人为规则，**不是真人点过赞**。`item_daily_features.csv` 的 `like_cnt` 是视频日统计，也不能还原谁点了赞。[KuaiRec 字段说明](https://github.com/chongminggao/KuaiRec#1-descriptions-of-the-fields-in-big_matrixcsv-and-small_matrixcsv)

小矩阵覆盖 1,411 用户×3,327 视频的 99.6%；缺少的部分涉及用户屏蔽作者。它让“这个用户对另一条视频的已有反馈”更容易查到，但仍没有证明同一视频换个时间、换个推荐顺序会得到同样反应。2024 年已补充文本字幕/分类；2026 年补充原始类别与用户特征，须固定数据版本，不能混用 2022 年重编号之前的 ID。[KuaiRec 官网更新与统计](https://kuairec.com/)

### 若重点研究文章阅读：EB-NeRD 比视频时长更贴近

官方实际列名包括 `article_ids_inview`、`article_ids_clicked`、`impression_time`、`read_time`、`scroll_percentage`、`next_read_time`、`next_scroll_percentage`。`read_time` 是当前页面停留秒数；`next_read_time` 是下一篇被点击文章的阅读秒数，不能提前作为预测输入。曝光列表顺序已随机打乱，不能推断原始位置。滚动比例等允许缺失；正文是丹麦语，实验模型与对照模型要用相同语言条件。[官方常量代码](https://raw.githubusercontent.com/jppol-ai/ebnerd-benchmark/main/src/ebrec/utils/_constants.py)、[作者论文附录表7/8](https://backend.orbit.dtu.dk/ws/portalfiles/portal/380286489/3687151.3687152.pdf)

Adressa 的 `activeTime` 是页面活跃秒数，明确是“已知时才提供”；官方 FAQ 说明过短可能不记录。因此空值不能填成 0，更不能一律当“用户秒退”。正文完整版需要申请。该数据可做停留补充，不建议让初版同时背负太多数据集。[官方手册，第5、10、16页](https://reclab.idi.ntnu.no/dataset/cxdataset_v5.pdf)

### 搜索与推荐一起记录也已有公开先例

KuaiSAR 公开真实搜索与推荐及二者切换：推荐日志含 `playing_time / click / like / search / search_item_related`，搜索日志有 `search_session_id / keyword / search_source / item_id / click_cnt`。但 `keyword` 和 `caption` 被匿名成整数词编号，不能当成 LLM 可读的自然语言。推荐侧 timestamp 是分发时间，批量内容可能同时间；也不能据此重建精确浏览手势顺序。[官方数据字典](https://kuaisar.github.io/detailed_statistics.html)

## 2. 与当前 Waterfall 输入逐项怎么对齐

当前实现已结构化 `sequence / timestamp / kind / candidateId / title / summary / source / keywords / durationMs / heat / planRevision`。接收 `passed / like / unlike / open`，以及 B 站可见停留；open 要>1秒、弱停留为3秒至不足15秒、强停留为≥15秒。由代码可知 `heat` 是本系统设定的权重，不是外部真值。[WaterfallSAgent.ets](../../../../../waterfall-anything/hive/waterfall/state/WaterfallSAgent.ets:204)

| Waterfall 当前信号 | 最接近的外部数据 | 是否完全一样 |
| --- | --- | --- |
| `like` | KuaiRand `is_like=1` | 基本同义，但要把一次交互记录转换成事件 |
| `unlike` | 取消赞的事件；KuaiRand 的单条日志未给等价字段 | 不应直接映射 `is_hate` |
| `passed` | MIND 曝光未点，或 KuaiRand 短播放 | 只是近似；没有原始滑过手势就不能叫真实滑过 |
| `open` + `durationMs` | MIND 点击；EB-NeRD 点击与阅读秒数 | MIND 没有时长，无法验证 Waterfall >1秒门槛 |
| `bilibili_visible_dwell*` | KuaiRand `play_time_ms` | 不一样：可见停留不保证实际播放 |
| `heat` | 无直接等价列 | 是策略设定，不能拿它当“用户真实喜欢”的评价标签 |
| `planRevision` | 没有直接等价列 | 记录当前版本有助分析，但不是原始召回来源证明 |

建议只统一共同外壳：用户、内容、发生时间、行为类型、时长、测量方式、数据来源。原始字段同时保留。未知值用 null；0 只表示确实观测到零。这样可以比较算法，而不会假装不同 App 的传感器一样。这个适配是实验基础设施，不应单独作为论文创新。

## 3. 召回与排序，分别怎么考试

**召回是“先找到”，排序是“再排好”。** 书店里有 10 万本书，你先找出 100 本候选，再把最该看的 10 本放到前排。

### 召回：所有方法从同一本书库找

最小对照建议：关键词搜索 BM25、向量搜索、二者合并、固定一次 LLM 改写后检索、普通多轮搜索Agent、Waterfall计划更新后由程序执行检索。当前S Agent不直接调用搜索或自主翻页，必须通过真实程序链路评估其影响。各组拿相同原始需求/用户历史、同一语料、同一可用工具与成本预算；固定改写可分“单查询”与“同数量多查询”，排除“只是搜得更多”的解释。这里只是建议，不是已跑实验。

例：人工标注一条需求有 5 篇相关文档，你返回前 10 篇，其中命中 3 篇，Recall@10=3/5=60%；Precision@10=3/10=30%。这些数反映的是**已标注相关项**，不是整个互联网的所有好内容。BEIR 正好提供文档、查询、相关性标注；官方支持 Recall、Precision、nDCG 等。[BEIR 数据格式](https://github.com/beir-cellar/beir/wiki/Load-your-custom-dataset)、[官方指标说明](https://github.com/beir-cellar/beir/wiki/Metrics-available)

BEIR 可检验搜索器，但它通常没有 Waterfall 用户画像，不能用 BEIR 检索成绩直接宣布“个性化推荐更好”。如研究由历史行为生成查询，可在带语义的新闻/视频库另做“根据过去找出以后点击的内容”，明确这是改造后的推荐召回任务，未知交互不能当真实负反馈。

若测外部网站实时搜索，应给所有方法同一时间窗口、工具/域名范围、结果缓存和调用预算；否则今天网站更新本身就可能造成分数差。可将多方法结果合并、匿名打乱后由人按同一需求判定相关性；要说明未标注区域仍有遗漏，不宜称为全网真实召回率。

### 排序：所有方法拿到同一批候选

MIND 最好理解：该轮真正展示过 20 篇，用户点了其中 1 篇。让每个方法只排序这相同的 20 篇。唯一点击项排第1，nDCG@10=1；排第3，约0.5；排到第11则为0。它奖励“值得看的靠前”，不是模型输出文字是否漂亮。多点击时按官方评价代码计算。

最小对照建议：热门/近期、基于历史内容相似度、成熟新闻排序模型 NRMS、一轮 LLM 排序、Waterfall 的反馈更新后排序。别只打败随机排序。官方 EBRec 提供 NRMS/LSTUR/NAML 等实现可复用；不是都必须实现。[官方基线库](https://github.com/jppol-ai/ebnerd-benchmark)

点击只是“当时想打开”，不等于“看完觉得值”。主指标可先用 nDCG@10，补充长阅读/显式负反馈/内容重复率，并报告每轮耗时、调用量。不要把“停留越久越好”作为唯一目标，也不要用自己的 `heat` 同时训练和自证更好。真实满意度可用小规模用户选择/评价补证。

## 4. 连续更新怎么公平测，能证明到哪里

建议第一轮做三种同条件对照：①不更新画像；②规则更新；③Agent 更新。按时间播放**相同已记录历史**，先预测下一轮、评分，再允许读取该轮真实反馈；然后重复。训练/调参/测试按时间分开，所有特征在当时必须可知。兴趣变化是否真实发生，不能仅凭一条跳过自动判定；可额外构造并明确标为合成的转向任务。

示例：此前喜欢摄影，今天连续点开露营内容。比较收到1/3/5条新反馈后，下轮露营候选的排序改善、摄影内容是否被过度删光，以及用了几次模型调用。这个例子定义待验证的问题，不预设 Waterfall 一定赢。

**历史回放不等于用户真的体验过新策略。** 原日志显示 A，用户点了；新 Agent 想显示 B，日志没有告诉我们用户对 B 会怎样。把 A 的点击奖励送给 B，或让一个 LLM 编造 B 的反应，再宣称真实用户更满意，都是错误。随机曝光的日志能在明确的抽样/支持条件下做离线策略评估，但不能因为数据名叫 KuaiRand 就跳过这些条件。经典 replay 已研究这个问题。[Li 等，WSDM 2011](https://arxiv.org/abs/1003.5956)

KuaiRec 的密集矩阵能补一些“B 没看过”的空洞；若拿跨时点的既有评分当交互环境，仍是静态偏好假设。最终要主张“更好的连续体验”，需要真实在线对照、受控用户实验，或清楚标注局限的模拟；普通离线排序改进只证明在该日志任务上预测更好。

## 5. 最小可行选择

1. **新闻排序先用 MIND-small。** 理解一轮曝光、历史、标签与 nDCG，先建立可复现基线。
2. **多反馈更新用 KuaiRand-1K。** 保留完整发布序列，使用可读文本补充并先审计覆盖率。Pure 只作小规模流程验证。
3. **文章停留重要时，补 EB-NeRD-small。** 保留秒/毫秒区别，严格隔离下一次反馈和未来文章统计。
4. **独立召回主张用 BEIR 或固定自建语料。** 排序固定候选；召回固定语料，两项不混算。若研究真正的个性化召回，再加历史驱动的候选检索任务。

当前不建议一次训练所有模型、堆七个数据集；先确定一个主要研究问题，再用第二个数据验证结论能否迁移。

未做：全量数据下载、空值/覆盖率实测、模型复现和线上用户试验。风险：公开反馈语义与 Waterfall 不完全相同，离线成绩不能直接当作真实用户体验或论文创新已获证明。
