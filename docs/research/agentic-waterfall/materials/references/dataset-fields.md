# Agentic Waterfall Feed：KuaiRand / MIND 字段参考

2026-10-27。用户提到的“kuaihand”暂按 KuaiRand 理解。以下分开列出已有数据字段与 Waterfall 的设计建议；本次没有下载完整数据包。

## 1. KuaiRand：借鉴细粒度行为记录

官方将普通推荐与随机曝光的交互分文件保存；`is_rand` 标记随机干预，`tab` 区分场景。[官方字段说明](https://kuairand.com/#data-descriptions)

| 数据部分 | 原始字段 | 对 Waterfall 的用途 |
|---|---|---|
| 交互标识、时间、场景 | `user_id`, `video_id`, `date`, `hourmin`, `time_ms`, `tab`, `is_rand` | 关联用户、内容和已发生的交互，保留曝光方式 |
| 行为信号 | `is_click`, `is_like`, `is_follow`, `is_comment`, `is_forward`, `is_hate`, `long_view`, `is_profile_enter` | 已完成交互进入行为历史；本次曝光结果进入反馈记录 |
| 时长 | `play_time_ms`, `duration_ms`, `profile_stay_time`, `comment_stay_time` | 同时记录观看时长与内容时长，避免只有一个模糊的兴趣分 |
| 内容属性 | `video_id`, `author_id`, `video_type`, `upload_dt`, `video_duration`, `tag` 等 | 内容表及候选内容描述 |

以上列名来自[官方 README 的日志和基础内容字段表](https://github.com/chongminggao/KuaiRand#data-descriptions)。`is_comment` 只表明是否评论，没有评论原文；`is_click` 在双列界面表示点击，单列界面表示满足时长规则的有效播放。映射时保留原语义。[官网日志定义](https://kuairand.com/#1%EF%B8%8F%E2%83%A3-description-of-the-fields-in-log_xxxcsv)

新增的官方内容补充文件提供 `final_video_id`, `caption`, `show_cover_text`, `duration` 及分级类别，可用于给模型提供语义描述。[官方补充文件](https://kuairand.com/#additional-video-level-metadata-supplementary-files)

连续行为研究优先参考 1K / 27K；Pure 只保留指定候选池相关交互，序列不完整。统计特征表是跨一个月的平均统计，不能直接当成某个历史决策时已经知道的热度。[官方版本建议及统计说明](https://kuairand.com/)

## 2. MIND：借鉴“历史—本次曝光—结果”的关联

`behaviors.tsv` 有五列：`Impression ID`, `User ID`, `Time`, `History`, `Impressions`。`History` 是本次曝光前的点击 ID 序列，按时间排列；`Impressions` 是 `新闻ID-点击标签` 的列表，1 表示点击、0 表示未点击。[官方数据格式](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md#behaviorstsv)

| 部分 | 已发布内容 | 对 Waterfall 的映射 |
|---|---|---|
| 历史 | `History` | 已发生的点击历史，关联内容表；不补造每次点击的精确时间 |
| 曝光 | `Impression ID`, `Time`, `Impressions` 中的新闻 ID | 一次展示对应哪些内容；训练或评测前拆掉同次点击标签 |
| 反馈 | `Impressions` 中的 0/1 | 该次展示后的点击结果，不等于喜欢/不喜欢 |
| 内容 | `News ID`, `Category`, `SubCategory`, `Title`, `Abstract`, `URL`, `Title Entities`, `Abstract Entities` | 内容表的八列；标题、摘要、类别可直接用于语义建模 |

内容列以[微软官方列清单与读取代码](https://learn.microsoft.com/en-us/azure/open-datasets/dataset-microsoft-news#newstsv)为准。公开包不含新闻正文；官方格式说明注明原 URL 已失效。[官方正文说明](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md#newstsv)

**MIND 的本次曝光列表已打乱顺序，不能把它的数组位置当成真实展示排名。** 其历史列也只提供 ID 顺序，不提供每条点击的时间。[官方 History / Impressions 定义](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md#behaviorstsv)

## 3. Waterfall 采用的结构：以下是我们的设计

借鉴两者，把内容与行为分开保存；给 Agent 看的输入快照，与执行后才知道的结果分开保存。

| Waterfall 记录 | 最小内容 | 来自已有数据的经验 / 我们新增什么 |
|---|---|---|
| `content` | 内容 ID、来源、类型、标题、摘要、时长、实际取得的内容 | 继承独立内容表；新增跨来源身份和获取时点 |
| `event` | 事件 ID、时间、用户、关联内容/曝光、原始行为或用户原话 | 继承时序行为；新增自然语言命令、原文评论、收藏等实际交互 |
| `exposure` + `feedback` | 哪些内容真正可见、位置、随后点击/停留/赞踩/评论 | 继承曝光与反馈关联；自采时补真实位置及可见性，未观察到的值记空 |
| `decision` + `execution` | 当时输入、结构化动作、工具参数、返回内容与状态 | 新增搜索、推荐、状态更新的完整执行过程 |
| `user_state` | 当前目标、长期偏好、事实/记忆、更新时间及依据 | 新增显式用户状态；区分用户明确说过与系统推断 |

决策时只读已经发生且系统已经拿到的信息。某次曝光的点击标签、最终观看时长和后续评价，留在结果记录中；收到后才成为下一次决策的历史。离线数据未提供的字段保留未知，不把未点击改写成负反馈。

## 4. 对完整范式的用途

从公开字段看，KuaiRand 可支撑行为理解，MIND 可支撑候选排序；二者都没有提供 Agent 的查询选择、工具返回和记忆更新动作轨迹。这是依据上述格式得出的判断。因此，Waterfall 自采数据要补齐 **“当时知道什么 → 决定做什么 → 实际得到/展示什么 → 用户怎样反应”**，用同一结构连接搜索、推荐和交互式更新。

未下载数据包或运行模型；本文用于字段设计，不能据此声称已完成数据导入或端到端评测。

## 5. KuaiRand 的任务与打分

2026-10-28 核对：原论文没有算法性能 benchmark 表，Table 1 是数据集统计比较；AUC、GAUC、LogLoss、MAE、RMSE 未出现。§2.1 一般性提及 Precision/Recall/NDCG，§4 列出去偏、OPE、交互、长序列和多任务用途。因此下表指标是**我们按任务可以选择的方案，不是原论文已经采用的统一基准**。[KuaiRand 原论文](https://arxiv.org/pdf/2208.08696v2)、[官方仓库](https://github.com/chongminggao/KuaiRand)

| 任务 | 标签怎样产生 | 可选择怎样打分 |
|---|---|---|
| 点击、点赞等二元预测 | 取日志的 `is_click`、`is_like`、`is_hate` 等单个 0/1 字段；长观看也可取 `long_view` | AUC 看正例是否排在负例前；LogLoss 看概率预测误差。按用户分组时可用 GAUC，并声明权重 |
| 观看时长预测 | 取实际 `play_time_ms`，统一换算成秒；内容时长另由 `duration_ms` 给出 | MAE 看平均差几秒；RMSE 更重罚较大的预测误差 |
| 多目标预测 | 同一次曝光有多个行为标签，分别预测点击、点赞、时长等 | 分目标报告相应指标；需要综合分时预先说明权重 |
| 序列推荐/排序 | 实验者先选正反馈标准，再按时间留出下一条符合标准的视频作 target item；它不是数据自带的唯一答案 | 在明确候选范围内算 Hit@K、Recall@K、NDCG@K；单目标 Hit 是 target 是否进入前 K 条 |
| 交互推荐/RL | 把选定反馈定义为每步 reward，串成时序过程 | 在明确的模拟环境或 OPE 设定下评累计奖励等；原始日志不直接给出新策略下未发生的整段体验 |

字段来自真实曝光后的行为记录或时长规则。`is_click` 在双列界面表示点击；单列界面中，视频≤7秒需看完，长视频需观看超过7秒。`long_view` 对视频≤18秒要求看完，长视频要求至少观看18秒。它们都是可用于预测的标签，但不是同一个“喜欢”含义。[官方字段定义](https://kuairand.com/#data-descriptions)

## 6. 传统数据适配：固定候选与获取扩展

2026-10-28 建议固定两轨。**A 轨先比较排序；B 轨再比较从本地目录获取内容并排序。** MIND 的 A 轨可直接沿用官方 impression 协议；KuaiRand 没有唯一官方评测协议，其切分、目标和采样均须标成本文设定。

| 轨道 | Agent 输入与输出 | 评价依据 |
|---|---|---|
| A / MIND 原曝光排序 | 输入原 `History`、原 impression 全部候选的 ID/内容，去掉当前点击标签；输出这些候选的完整排列，不调用外部获取 | 原 impression 的点击标签；官方 AUC、MRR、nDCG@5/10 |
| A / KuaiRand 固定候选 | 输入决策前历史、打乱的 target + 100 个对照项，不标出哪项是 target；输出候选排名 | 本文定义的 next-item target；Hit@10、NDCG@10，另报 Hit@1 |
| B / KuaiRand 本地目录获取 + 排序 | 输入相同历史和可调用的本地检索工具；工具只搜索事先建立的公共目录；最终推荐只能来自实际获取结果 | 同一个隐藏 target；获取命中率、端到端 Hit@10 / NDCG@10；单列获取后的排序诊断 |

**MIND 输出转换。** 原候选 `[N1,N2,N3]`，Agent 返回 `[N3,N1,N2]`，提交的排名数组为 `[2,3,1]`，对应每个原候选的名次。官方脚本用 `1/rank` 作分数，逐 impression 计算并平均四项指标；其中 MRR 平均的是该 impression 内所有点击项的倒数排名，不只取第一个点击。只输出 top-K 不足以复现全候选官方评分。[官方 evaluate.py](https://github.com/msnews/MIND/blob/master/evaluate.py)

**MIND 最小配置。** 用 MIND-small 开发；正式复用 MIND-large 的官方 train/dev/test。若封存 small 的官方 dev 作本地测试，就在 train 内按全体用户统一时间边界留出调参集，并明确称 local-test；不能把该分数当官方测试榜单结果。所有输入历史沿用各行给定的 `History`，不加入同次标签。[官方数据划分及格式](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md)

**KuaiRand 最小配置（本文协议）。**

1. 训练使用 `log_standard_4_08_to_4_21_1k.csv`；所有用户统一截止于 4 月 21 日。后续普通日志按 4/22–28 调参、4/29–5/8 测试；同期 `log_random_4_22_to_5_08_1k.csv` 另作随机曝光分层，不混成同一结果。三个文件的原始范围见[官方文件说明](https://kuairand.com/#data-descriptions)。模型参数、热度和采样权重只用训练窗；不能逐用户留下最后一项、却让其他用户的未来进入训练。
2. 主目标选 `long_view=1`。每用户、每评测窗取第一条此前未曝光过且满足该条件的记录为 target；决策时点是该条日志的时间。模型只读此前的行为，哪一项是 target 及本次反馈只由评测器掌握；A 轨中 target 只作为普通候选 ID 呈现。普通与随机曝光分别选目标、分别报告；历史可合并两类已发生记录并保留 `is_rand`。这是对 next-item 任务的明确定义，不是 KuaiRand 自带的标准答案。
3. 先用训练窗实际出现的视频建立固定目录 `C`，再关联可用内容元数据，测试前冻结。先选 target、再检查它是否在 `C`；报告目录覆盖率，并在预先定义的可用目录范围内评测，不为某个 target 补目录。此默认版所有内容 ID 都在全局训练截止前出现过。后发布的官方 caption/类别可作为离线重建的内容视图，须核对 ID 对应和覆盖，不冒充历史线上搜索快照。[官方内容补充](https://kuairand.com/#additional-video-level-metadata-supplementary-files)
4. A 轨从 `C` 去掉该用户此前已曝光内容，再取 target + 100 个不重复对照项；固定样本、种子并打乱顺序，各系统完全共享。对照项没有被该用户曝光过：它们是“预测下一条记录”的干扰项，不能写成真实负反馈。B 轨直接搜索同一 `C` 中尚未对该用户曝光的内容，没有 target 注入步骤，也不把 A 轨的 101 项拿来冒充搜索目录。
5. 回放时按 `time_ms` 取严格早于当前决策的历史；允许此前已揭示的测试期反馈成为后续输入，但不据此重新训练参数。这仍是固定日志前缀的离线评价，不声称得到新策略下真实发生的连续体验。整月统计特征及未注明历史快照时点的用户状态不作为默认输入；原表的 `upload_dt` 只有日期，`visible_status` 是采集时的当前状态。[官方字段语义](https://kuairand.com/#data-descriptions)

**获取失败怎样算。** 隐藏 target 为足球视频 `v42`，它在可用目录中；工具搜到 `v7/v19` 却没搜到 `v42`，则 B 轨 Hit@10、NDCG@10 都是 0。不能删除这一题，也不能临时补进 `v42` 再排。A 轨本来就把 `v42` 放在固定候选中，因此只测排序。另一个足球视频可能同样好看，但“主题相关”不等于命中指定 ID；这种体验差异交由独立的人类偏好评测回答。

**基线范围。** MIND 先用训练集热门度、NRMS、Waterfall；NRMS 的官方维护示例直接支持标题、点击历史和 MIND 候选排序。[NRMS 论文](https://aclanthology.org/D19-1671/)、[官方维护示例](https://github.com/recommenders-team/recommenders/blob/main/examples/00_quick_start/nrms_MIND.ipynb)。KuaiRand 用训练集热门度、SASRec、Waterfall；SASRec 原作者代码以历史 ID 序列预测下一 ID，并用 target + 100 个随机对照项计算 Hit/NDCG@10，但原来的逐用户末尾切分不照搬到上述全局时间协议。[SASRec 原作者代码](https://github.com/kang205/SASRec/blob/master/util.py)。B 轨让基线对同一完整目录进行检索/评分；固定 101 候选的结果与完整目录结果分开报，不能直接对比分数。

动态目录扩展时，再用上传日期或首次出现时间定义每个时点的可用内容；`upload_dt` 无时分秒，同日内容不能凭空指定已上线。首版 B 轨只做 KuaiRand。MIND 的 `news.tsv` 没有发布时间字段，后续扩展宜从截止前日志构造保守目录；不得使用整个未来新闻表冒充当时可检索全集，更不能把原 impression 之外的未曝光新闻标成负反馈后沿用官方分数。两者的本地目录获取都须标成新协议，不称原数据的官方搜索评测。
