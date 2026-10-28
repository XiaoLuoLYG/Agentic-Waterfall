# 输入输出约定

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../../01-研究主方案.md) 和 [输入输出与数据流](../../../02-输入输出与数据流.md) 为准。

**三类用户信息，加运行环境，输出一组可执行动作。** 本页是现行简版；每个字段的具体值见[逐步例子](../../../02-输入输出与数据流.md)。

## 输入

| 字段 | 装什么 |
|---|---|
| `dialogue[]` | 用户和助手的原话、角色、发生/收到时间、指向的内容或任务 |
| `behavior_events[]` | 曝光、打开、停留/播放片段、赞踩、收藏、评论、滚动、进入/离开；含内容与曝光关联 |
| `user_state` | version 与 records；事实、偏好、任务、要求和经历。每条有 scope、status、basis、evidence_refs |
| `environment` | 已取得的内容、当前可见/待展示队列、来源能力、在途动作、实际返回、额度及内容环境版本 |

每次另带 `schema_version, decision_id, user_id, session_id, observed_at, trigger`。冷启动的历史和记忆为空；没有新发言时仍可按行为或工具结果决策。

内容记录包含 ID、来源、类型、标题、实际文本/媒体、时长（适用时）、获取时间和内容 hash。记忆的“明确说过”与“系统推断”分开；偏好/要求用 prefer/avoid、hard/soft，作用范围为当前任务、当前会话或长期。

## 输出

顶层为 `{decision_id, actions[]}`。每个动作含 `action_id, kind, arguments, evidence_refs, depends_on`。action_id 只是追踪与依赖连接，用户页面显示内容标题。

| kind | arguments | 对应执行工具 |
|---|---|---|
| acquire | source_ids、mode、query、target_id、content_types、constraint_refs、limit | 来源适配器；mode 为 search/hot/browse/subscription 中该来源支持的方式 |
| recommend | ordered_item_ids、delivery=append/replace_pending | 内容队列工具；只选择已经返回的内容 |
| update_state | base_version、edits；upsert 或 set_status | 记忆工具；一次提交后增加版本 |
| respond | kind=answer/explain/clarify、text、target_refs | 对话发送工具 |
| idle | mode=keep/wait/end_task、task_id | 保持/等待/结束指定任务 |

更新记录最小字段：`id, kind, key, value, scope, scope_id, status, basis, evidence_refs`，执行器写 updated_at。kind 为 fact/preference/task/constraint/episode；status 为 active/completed/expired/superseded。完整既有字段参考保留在[早期详细规格](../2026-10-27-agentic-feed-io.md)，有冲突时以本目录和当前样例为准。

## 谁负责决定并行

Agent 输出依赖，执行器找出“前置动作已经成功完成”的动作，一起提交。例：

```text
更新当前要求
    ├── 找视频 ──┐
    └── 找图文 ──┤
                 └── 结果回给 Agent → 选择内容 → 更新队列
```

两个 acquire 可并发；依赖状态更新的获取需等待该更新成功。获取未知内容后进行选择，需要下一次模型决策。已有候选的推荐可与独立的新获取并发；本例用两路获取演示并行。对共享状态或同一队列的写入由执行器串行化，不能只因未写依赖就并发覆盖。依赖失败的后续动作不执行；无依赖动作可继续。

执行器将 JSON 当数据解析，再调用固定工具映射；不执行模型生成的程序。先检查字段、来源、候选 ID、状态版本和依赖；保留失败原文及错误。同一 action_id 不重复产生副作用。

## 运行记录与评价

每步保存实际 input、raw_output、parsed_output、校验、调度组、execution_results、state_after。客户端另记实际曝光和反馈窗口；入队不算曝光，没看见不算不喜欢。

起止时间、实际模型/提示词/动作协议、查询环境、采集规则和结束原因归档。对比题的算法身份、用户答案、未来反馈单独保存，不能提前进入被评测 Agent。真人选择是**被记录的评价结果**，不要求模型输出自己的满意度分数。

字段依据：[KuaiRand](https://kuairand.com/)的多信号行为、[MIND](https://github.com/msnews/msnews.github.io/blob/master/assets/doc/introduction.md)的历史/曝光关联、[RecBot](https://arxiv.org/html/2509.21317v2#S3)的要求解析、[ClawRec](https://arxiv.org/html/2607.23779v1#S2)的证据状态与获取追踪。

