# Agentic Waterfall Feed：Agent 输入输出 v0.1

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../01-研究主方案.md) 和 [输入输出与数据流](../../02-输入输出与数据流.md) 为准。

> 当前核心入口：[agentic-waterfall/README.md](../../01-研究主方案.md)。逐步数据与并行调用见新例子；主评测以“下一条盲选＋连续使用后续用选择”为准。本页保留作早期规格/研究依据。

2026-10-27。研究接口提案；本页统一后续方法与采集设计。示例均为人工编写，未接入 demo 或作为实验结果。

完整采集和评价连接已补在第 6 节；从冷启动到结束的连续样例见[完整使用例子](2026-10-27-agentic-feed-complete-example.md)。

**输入：用户说了什么、做了什么、系统已经知道什么，加上眼前可用的内容与工具。输出：接下来执行哪些获取、推荐、更新动作。**

## 1. 一次决策怎样发生

`input → actions → execution_results → 实际曝光与用户反馈 → next_input`

用户发言、产生新行为、工具返回、待展示队列不足或开始新会话，都可以触发决策。一次“用户交互”可以包含多次 Agent 决策，例如先搜索、收到结果后再推荐。无指令时也正常运行。

## 2. 输入：三类用户信息，加一份环境

顶层必填 `schema_version, decision_id, user_id, session_id, observed_at, trigger, dialogue, behavior_events, user_state, environment`。数组允许为空；`trigger=session_start|user_event|tool_result|feed_low`；时间使用带时区的 ISO 8601。

| 部分 | 结构与内容 | 为什么要给 Agent |
|---|---|---|
| 用户表达 `dialogue[]` | `id, role, text, occurred_at, available_at, target_refs`；role 为 user/assistant，保留相关对话原文，target_refs 指向内容、曝光、任务或消息 | 理解“这些”“还是刚才的”，也能理解对上一个问题的简短回答 |
| 行为 `behavior_events[]` | `id, type, occurred_at, available_at, item_id, exposure_id, payload` | 知道用户实际看见和操作了什么 |
| 画像与记忆 `user_state` | `version, records[]`；记录事实、偏好、当前任务、约束、过去经历 | 维持跨轮次、跨会话的理解 |
| 环境 `environment` | `candidate_pool, feed, source_catalog, in_flight, tool_results, limits` | 知道有哪些内容、展示到哪里、能调用什么来源、上次动作是否成功 |

`dialogue` 与 `behavior_events` 都是截至决策时已收到的记录；available_at 不晚于 observed_at。导入数据缺少发生时间时 occurred_at=null，保留原始顺序。发言属于前者，点击、评论等页面操作属于后者，同一个事件不重复记账。过去对话可保留在同一历史中；普通问答是否改变偏好，由动作决定，不自动写成偏好。

**行为保留原始信号：**`type` 使用 `exposure/open/play/dwell/like/dislike/save/comment/share/follow/skip/scroll/search`，以及生命周期事件 `session_start/session_end/exposure_end`。`payload` 按类型记录：曝光的 `slate_id, position, surface, visible_ms`；观看/停留的 `duration_ms`；赞踩收藏的 `value`；评论/用户主动搜索的 `text`；滚动的 `depth_ratio`；会话结束的 `reason` 和曝光窗口结束的 `observation_status`。事件没有对应内容时 item_id/exposure_id 为 null。来源、界面类型及原字段可放 `payload.source_id/layout/raw`。play 时长记录已收到的播放片段，不把尚未结束的总时长提前填入。

`position` 从 1 开始；未知值用 null。曝光事件表示内容实际进入可见区域，推荐队列中尚未看见的内容不算曝光。取消收藏可记 save/value=false；缺失或 null 表示未观测。离线数据的未点击/未点赞标签保留原字段及观察窗口，不改写成取消、略过或点踩事件。

### 画像与记忆：统一存记录，按类型读取

每条记录有 `id, kind, key, value, scope, scope_id, status, basis, evidence_refs, updated_at`：

| 字段 | 定义 |
|---|---|
| `kind` | `fact/preference/task/constraint/episode`：事实、偏好、任务、要求、经历摘要；profile 是这些记录的视图，不再另存一份互相矛盾的画像 |
| `key, value` | key 是稳定字段名，value 是字符串、数值、布尔、数组或对象，例如 `has_computer: true` |
| `scope, scope_id` | `persistent/session/task`；分别绑定用户、会话或任务。persistent 的 scope_id 为 null；临时“短一点”可只绑定当前任务 |
| `status, basis` | status 为 `active/completed/expired/superseded`；completed 用于任务。basis 为 `user_stated/observed/inferred`，区分用户原话、观察事实与推断 |
| `evidence_refs, updated_at` | 指向消息、行为、已有证据记录或已返回的动作 ID；更新时间由执行器填写。偏好/约束另有 `polarity=prefer/avoid` 与 `strength=hard/soft` |

例如“绝对不要购物内容”是 hard/avoid；“尽量短一点”是 soft/prefer。初次使用可只有用户自填事实，也可以 records=[]；不存在的历史不补造。所有已开放历史与记忆均可访问；默认送入近期记录和相关旧记录，保留 ID 回读能力，记录本次实际读取的范围。读历史/记忆属于上下文读取，不增加一类用户需求动作。

### 环境：内容、显示队列与来源能力

- **内容 `candidate_pool[]`：**必填 `id, source_id, url, content_type, title, text, text_origin, available_at, retrieval_action_id`。text 是实际取得的摘要/字幕/正文片段；text_origin 为 source/model_summary/fixture。正文、图片、音视频通过可选 `media_refs[]` 提供；可选 `published_at, language, duration_ms, tags`。缺失信息为 null；语义摘要不能冒充原始正文。内容类型为 article/video/image/audio/mixed。
- **显示 `feed`：**`visible_item_ids, queued_item_ids`。内容获取成功、排入队列、实际可见是不同状态；历史曝光保存在事件里。
- **来源 `source_catalog[]`：**`source_id, modes, content_types, status`；status 为 available/unavailable，modes 为 search/hot/browse/subscription 的可用子集。浏览频道/订阅源可另列 `targets[{id,label,mode}]`。source_id 表示平台/站点；content_type 表示内容形态，两者分开。
- **执行 `in_flight, tool_results`：**前者保存尚未完成的 action_id/kind；后者保存已返回的 action_id/status/result/error/available_at。获取返回内容，更新返回状态版本，推荐返回实际排入队列的列表；失败也返回。
- **限制 `limits`：**至少有 `max_recommend_items`；调用额度等由研究条件补充。

## 3. 输出：一个可执行动作列表

顶层为 `{decision_id, actions[]}`。每个动作统一包含 `action_id, kind, arguments, evidence_refs, depends_on`，可选一句简短 `reason`。不要求长篇推理。actions 至少一项；无变化时显式 idle。

| 动作 | arguments 的字段 | 实际作用 |
|---|---|---|
| **获取 `acquire`** | `source_ids, mode, query, target_id, content_types, constraint_refs, limit`；可选 `purpose` | 搜索、热榜、频道或订阅获取。search 必须有 query；browse/subscription 的 target_id 来自来源目录；hot 默认榜单时 query/target_id 可为 null。constraint_refs 引用需遵守的状态记录，limit 为本动作返回内容总上限 |
| **推荐 `recommend`** | `ordered_item_ids, delivery`；delivery 为 append/replace_pending | 从已到达候选中选择和排序；append 追加，replace_pending 替换未展示队列。两者都不修改既有曝光记录 |
| **更新 `update_state`** | `base_version, edits[]` | edits 为 `{op:upsert, record:…}` 或 `{op:set_status, record_id, status}`。新增/替换记录、结束任务、使旧记录失效；upsert 携带完整记录，updated_at 由执行器补齐 |
| 回复 `respond` | `kind=answer/explain/clarify, text, target_refs` | 回答、解释调整或必要时提问；成功发送后的文本进入后续 dialogue |
| 保持 `idle` | `mode=keep/wait/end_task, task_id` | 保持队列、等待新结果、停止服务指定任务；前两者 task_id=null。结束任务不等于结束整个信息流，可与 update_state 的完成标记配合 |

可以只推荐、只更新，也可以组合动作。depends_on 是本批先决动作 ID；满足依赖后执行，先决动作失败则返回该依赖未满足。无依赖的多源获取可以并行。同批的状态更新最多一项，可含多个 edits，提交成功后版本加一。

**Agent 输出的是行动请求。** 执行器返回 `{action_id,status,result,error,available_at}`；status 为 success/error/skipped/cancelled。新候选、已提交状态版本及真正入队列表以执行返回为准。获取结果尚未到达时，Agent 可以推荐旧候选，但不能提前选不存在的新内容 ID。

## 4. 一个完整例子：买好电脑，转向学习剪辑

以下对象可直接解析为 JSON；来源、内容和反馈均为设计样例。

**第一次输入：**旧画像仍记着买电脑，当前原话提出新需求。

```json
{
  "schema_version":"awf-io/0.1","decision_id":"d1","user_id":"u1","session_id":"s1",
  "observed_at":"2026-10-27T10:00:00+08:00","trigger":"user_event",
  "dialogue":[
    {"id":"m0","role":"user","text":"我准备买电脑，平时喜欢摄影。","occurred_at":"2026-10-26T09:00:00+08:00","available_at":"2026-10-26T09:00:00+08:00","target_refs":[]},
    {"id":"m1","role":"user","text":"电脑买好了，想学剪视频，先看简单一点的短教程。","occurred_at":"2026-10-27T10:00:00+08:00","available_at":"2026-10-27T10:00:00+08:00","target_refs":["buy_pc"]}
  ],
  "behavior_events":[
    {"id":"e0","type":"exposure","occurred_at":"2026-10-27T09:58:00+08:00","available_at":"2026-10-27T09:58:00+08:00","item_id":"i0","exposure_id":"x0","payload":{"slate_id":"sl0","position":1,"surface":"feed","visible_ms":null}},
    {"id":"e1","type":"open","occurred_at":"2026-10-27T09:58:05+08:00","available_at":"2026-10-27T09:58:05+08:00","item_id":"i0","exposure_id":"x0","payload":{}}
  ],
  "user_state":{"version":7,"records":[
    {"id":"buy_pc","kind":"task","key":"goal","value":"选购电脑","scope":"task","scope_id":"buy_pc","status":"active","basis":"user_stated","evidence_refs":["m0"],"updated_at":"2026-10-26T09:00:01+08:00"},
    {"id":"photography","kind":"preference","key":"interest","value":"摄影","scope":"persistent","scope_id":null,"status":"active","basis":"user_stated","polarity":"prefer","strength":"soft","evidence_refs":["m0"],"updated_at":"2026-10-26T09:00:01+08:00"}
  ]},
  "environment":{
    "candidate_pool":[{"id":"i0","source_id":"demo_guides","url":"urn:example:pc-review","content_type":"article","title":"电脑选购参考","text":"比较电脑配置。","text_origin":"fixture","available_at":"2026-10-27T09:57:00+08:00","retrieval_action_id":null}],
    "feed":{"visible_item_ids":["i0"],"queued_item_ids":[]},
    "source_catalog":[{"source_id":"demo_guides","modes":["search"],"content_types":["article","video"],"status":"available"}],
    "in_flight":[],"tool_results":[],"limits":{"max_recommend_items":5}
  }
}
```

**第一次输出：**完成购机任务，保存已购机事实，建立学习任务及临时偏好，再搜索。

```json
{"decision_id":"d1","actions":[
  {"action_id":"a1","kind":"update_state","evidence_refs":["m1"],"depends_on":[],"arguments":{"base_version":7,"edits":[
    {"op":"set_status","record_id":"buy_pc","status":"completed"},
    {"op":"upsert","record":{"id":"has_pc","kind":"fact","key":"has_computer","value":true,"scope":"persistent","scope_id":null,"status":"active","basis":"user_stated","evidence_refs":["m1"]}},
    {"op":"upsert","record":{"id":"learn_edit","kind":"task","key":"goal","value":"学习剪视频","scope":"task","scope_id":"learn_edit","status":"active","basis":"user_stated","evidence_refs":["m1"]}},
    {"op":"upsert","record":{"id":"intro_brief","kind":"preference","key":"tutorial_style","value":{"difficulty":"introductory","length":"short"},"scope":"task","scope_id":"learn_edit","status":"active","basis":"user_stated","polarity":"prefer","strength":"soft","evidence_refs":["m1"]}}
  ]}},
  {"action_id":"a2","kind":"acquire","evidence_refs":["m1"],"depends_on":["a1"],"arguments":{"source_ids":["demo_guides"],"mode":"search","query":"电脑 视频剪辑 入门 简短教程","target_id":null,"content_types":["article","video"],"constraint_refs":["intro_brief"],"limit":6,"purpose":"找到可照着做的入门内容"}}
]}
```

**执行返回：**状态版本变为 8；工具此时才带回两个内容 ID。摄影偏好继续保留。

```json
[
  {"action_id":"a1","status":"success","result":{"state_version":8},"error":null,"available_at":"2026-10-27T10:00:01+08:00"},
  {"action_id":"a2","status":"success","result":{"items":[
    {"id":"i1","source_id":"demo_guides","url":"urn:example:editing-video","content_type":"video","title":"三分钟认识剪辑流程","text":"导入、裁剪与导出演示。","text_origin":"fixture","duration_ms":180000,"available_at":"2026-10-27T10:00:03+08:00","retrieval_action_id":"a2"},
    {"id":"i2","source_id":"demo_guides","url":"urn:example:editing-guide","content_type":"article","title":"第一段视频：四步完成","text":"用四个图文步骤完成第一次剪辑。","text_origin":"fixture","available_at":"2026-10-27T10:00:03+08:00","retrieval_action_id":"a2"}
  ]},"error":null,"available_at":"2026-10-27T10:00:03+08:00"}
]
```

**第二次输入/输出：**沿用第一次输入的已知信息，改为 decision_id=d2、observed_at=10:00:04、trigger=tool_result；应用 a1 后的 records/version，合并 i1/i2，并把上述回执放入 tool_results。无新增用户发言。随后输出：

```json
{"decision_id":"d2","actions":[
  {"action_id":"a3","kind":"recommend","evidence_refs":["m1","a2"],"depends_on":[],"arguments":{"ordered_item_ids":["i2","i1"],"delivery":"replace_pending"}}
]}
```

执行器成功入队后返回 `slate_id=sl1, queued_item_ids=[i2,i1]`。用户真正看到 i2 并收藏时，客户端再记录：

```json
[
  {"id":"e2","type":"exposure","occurred_at":"2026-10-27T10:00:05+08:00","available_at":"2026-10-27T10:00:05+08:00","item_id":"i2","exposure_id":"x1","payload":{"slate_id":"sl1","position":1,"surface":"feed","visible_ms":null}},
  {"id":"e3","type":"save","occurred_at":"2026-10-27T10:00:20+08:00","available_at":"2026-10-27T10:00:20+08:00","item_id":"i2","exposure_id":"x1","payload":{"value":true}}
]
```

e2/e3 成为后续输入，系统由此继续调整；未看见 i1 不等于讨厌 i1。另一个合法情况是用户不发言、只产生浏览行为，直接触发同一接口。完全冷启动时 dialogue/behavior_events/records 可以为空，先获取可用内容并逐步获得反馈。

## 5. 采用了哪些已有做法

| 参考 | 已有设计 | 本接口怎样采用 |
|---|---|---|
| [KuaiRand 官方字段](https://kuairand.com/) | 用户/视频 ID、时间、场景 tab、随机曝光 is_rand，以及观看时长、赞踩、评论等多种反馈 | 分事件保留原始行为和场景；播放时长关联内容时长。is_comment 只有标记，不能补造评论原文 |
| [MIND 官方格式](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md) | behaviors.tsv 将用户、时间、历史与本次曝光/点击关联；news.tsv 独立保存内容信息 | 内容与事件分表、曝光与反馈关联；其曝光顺序已打乱、历史只有 ID 顺序，不能补造真实排名/点击时间 |
| [RecBot §§2–3](https://arxiv.org/html/2509.21317v2#S2) | 当前列表、语言反馈、偏好记忆和行为历史；正负及硬软要求；工具链得到后续推荐 | dialogue 保留指向对象；polarity/strength 表达要求；将用户状态与执行动作分开 |
| [ClawRec §2](https://arxiv.org/html/2607.23779v1#S2) | 统一事件、证据关联状态、状态补丁、来源规划、候选与推荐反馈追踪 | evidence_refs、scope/status、update_state、来源能力目录及获取—曝光—反馈关联 |

这些是采用依据；本页字段名和统一接口是 Waterfall 的设计。数据集详细列名见[字段参考](../references/dataset-fields.md)。

**采集单位：**一段轨迹保存每次实际 input、Agent 原始 output、execution_results，以及之后的曝光和反馈；另存内容快照和用户评价。动作请求与执行回执分别保存。同次展示的未来点击、最终时长、盲选答案不放入当时 input，收到后才进入后续历史。

**与现有文件关系：**旧 episode.schema.json 是归档草案，不是此接口的运行时校验器；其中 policy_input.command_events/history_event_ids/profile_memory 对应本页 dialogue 中的用户消息、行为事件引用和 user_state。后续采集实现应同时保存完整 input 快照；动作沿用 action_id/kind/arguments，回执再合并到归档动作。旧范式文档的接口节以本页为准。

## 6. 采集、解析与评价的完整记录

核心动作保持不变。补齐以下记录即可形成从开始到结束的一条轨迹；字段名以[完整 JSON](agentic-feed-v1/complete-example.json)为例。

| 记录组 | 必需信息 | Agent 是否可见 |
|---|---|---|
| `run_meta` 与 `environment_snapshot` | 实际模型/提示词及动作协议快照、运行配置、内容环境版本、采集口径；真实使用随机分配时保留已知概率 | 提示词、动作协议和开放的来源能力可见；完整内容库通过工具查询 |
| `decisions[]` | 实际 input、raw_output、parsed_output、validation、execution_results、state_after | 当前 input 及此前已返回结果可见；未来步骤不提前进入 |
| `feedback_windows` | exposure_id、观察结束时间、complete/pending/interrupted、实际采集的反馈类型及事件引用 | 已收到的曝光与反馈进入行为；未观测保持未知 |
| `initial_snapshot/final_snapshot`、`evaluation_private` | 起止状态、会话结束原因；另存事后评分、真实效果和盲选答案 | 初始开放信息可见；事后评分和评价答案不进入受评测的决策 |

运行环境可携带 `snapshot_id` 绑定对应内容版本。输出校验失败时，保存原始回答与错误，不执行无效动作；下一次输入可用 `environment.last_validation_error={decision_id,errors}` 返回具体错误，无错误时省略或为 null。同批已完成的合法动作仍保留回执。一次多源获取在 `result.source_calls[]` 中分别记录来源、实际查询和成功/失败；成功得到的内容仍可用。`recommend` 的成功回执仅表示入队，真正曝光由客户端报告。

会话退出后关闭或标记中断的曝光窗口，并结清在途动作或标记取消/未完成。任务 completed、用户离开和满意度分别记录。不同系统共享起点与可查询内容环境，后续消费各自的反馈。指标按内容效用、需求适应、状态质量与执行情况评价，允许不同的合理动作路径。

