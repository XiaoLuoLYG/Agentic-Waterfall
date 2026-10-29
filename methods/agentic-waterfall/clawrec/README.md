# ClawRec：独立方法适配

`source-snapshot/` 为官方仓库 `6eeb309c47430f91280e9845a98fb56a68dc0d90` 的 Skills 本地副本。原作者代码和旧实验未改动；ClawRec-SimBench 数据仍在统一数据目录。

`kuairec_data.py` 将 KuaiRec 已有公开播放事件映射为作者的 UnifiedEvent 格式，然后调用作者原 `build_update_packets.py` 生成可供状态阶段读取的 update packets。它保留原始发生时间、视频 ID、内容文本和播放比例；视频没有公开 URL 时用空字符串，不虚构链接；播放比例保留为原始信号，不标成喜欢。事件只有发生时间，起止时间设为同一个时间点，不代表播放时长。一个现有公开样本共 78 条事件已通过作者 packet 生成器，输出在 `data/kuairec-example-0/`。

本样本来自已有 KuaiRec big/small 静态协议；事件时间和评价矩阵不应声称构成严格的实时先后实验。历史材料、事件适配和报告不能读取小矩阵的隐含评分或作为模型输入。

`kuairec_smoke.mjs` 在一条公开 KuaiRec 用户样本上接通了 **状态生成 → 内容规划 → 共同视频目录 BM25 检索 → 内容筛选**：3 次真实 API 请求、37,982 tokens，规划8次查询、实际取得80条候选、筛选10条，所有交付 ID 均属于已取得内容。入口使用本地索引替代原方法浏览器平台检索，模型以 JSON 封装传递状态、计划和筛选结果，因此明确称为 ClawRec-adapted；执行记录在 `runs/kuairec-public-0-live-20261029/`。

这只是单轮冒烟：尚未接入连续反馈、持久状态、正式同条件评分和完整预算协议。KuaiRec 原处理将可评用户的已观察项作为可检索范围，正式比较前仍需审计该范围是否泄露额外用户信息。以前 SimBench 五事件状态与规划实验保留在链接的旧实验记录，不能用于证明新链路的完整效果。

离线测试：`PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s methods/agentic-waterfall/clawrec -p test_kuairec_data.py`。

规划解析测试：`node --test methods/agentic-waterfall/clawrec/plan.test.mjs`。

MIND 的固定候选受限版本亦完成一条真实模型冒烟：先按作者状态机制总结点击，再对4条新闻候选排序，2次请求、7,327 tokens；不做获取，也没有用户原话或精确历史时间。该链路只证明候选排序接线，不等于完整 ClawRec。记录在 `runs/mind-public-0-live-20261029/`。

### KuaiRand-1K 固定候选适配（单样本检查）

`kuairand_input.mjs` 仅取公开历史中截至观察时刻已可用的行为和公开候选；长观看、点赞、点踩分别保留，不把未点击当成负反馈。`kuairand_smoke.mjs` 使用作者状态与筛选 skills，对固定候选排序，不执行开放式搜索。2026-10-29 两次真实模型调用返回了 20 个唯一且在候选中的条目，22,317 tokens，记录在 `runs/kuairand-fixed-candidate-smoke-20261029/`；没有读取当前评分标签，也没有计算效果。补充文本是后续静态资料，不能宣称在 2022 年实时可获得；正式比较须对所有方法一致披露使用方式。

### 可选择用户的 KuaiRec 入口

`node methods/agentic-waterfall/clawrec/kuairec_run.mjs RUN_ID PUBLIC_INPUT.jsonl 行号 [上轮next-state.json]`。从零开始的非空行号选择用户，增量状态仅接受同一用户，并记住处理过的证据 ID。2026-10-29 对第二位公开用户完成 3 次真实模型调用、10 次查询、100 个真实取得的候选、10 条推荐，记录在 `runs/user-1-live-20261029/`；使用其他用户状态会拒绝。该测试为单轮，不代表真实连续反馈已验收。
