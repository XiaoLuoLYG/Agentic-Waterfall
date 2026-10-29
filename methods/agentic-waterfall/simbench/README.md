# ClawRec-SimBench 受限共同环境

快照只包括 B站、知乎和 YouTube，且采集日期晚于行为；论文原始网页环境无法由该快照完整复原。评测前先用 `prepare_evaluation.py` 冻结公开输入和实际输出，再用 `build_evaluation.py` 在评测侧读取隐藏目标，`judge_pool.mjs` 逐项判断，最后调用既有 `score_rankings.py`。

已用一条真实、先冻结的事件贯通33条匿名内容的模型判断与共享池评分，只作为链路诊断；结果不代表方法总体效果。修复前包含不可见前向链接的测试记录已作废，禁止作为正式结果。
