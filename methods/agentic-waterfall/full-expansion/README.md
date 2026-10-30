# 全量对照运行工具

这些是 2026-10-30 隔离运行的调度、输入索引和只读进度工具。运行快照在本机 `output/agentic-waterfall/full-expansion-20261030`；仓库不保存数据集、模型权重、API 密钥、账本或实验结果。脚本的路径约定针对该隔离目录，直接在此仓库目录运行正式任务并不能复现实验：须先恢复原固定输入、正式运行快照、权重、控制文件和锁，逐项比对冻结哈希。

`prepare_mind.py` 和 `prepare_kuairand.py` 只处理公开输入，建立不重复的任务索引；`run_mind.py` / `run_kuairand.py` 通过共享旧队列的账本锁限制总模型并发，新的已完成回执写入 SQLite；`fetch_agentrecbench.py` 固定作者发布版本并验证文件哈希，不解析评测标签；`monitor.py` 是只读显示。缺失条件或未解决在途任务时必须停队审计，不得盲目续跑。

`python3 monitor.py` 在终端使用固定屏幕显示总进度、Waterfall与对照进度、开发/测试和队列停因；按窗口尺寸裁切，中文按显示宽度对齐。每30秒原位刷新，`q`或`Ctrl+C`只关闭显示。`--details`输出一次完整方法明细供滚动阅读；`--once`输出一次摘要，可交给`watch -n 30 'python3 monitor.py --once'`。显示使用Python自带终端库，不要求安装watch。

总进度的单位是“题目×方法”，含计划内开发和测试任务；合法空推荐单列但表示该方法已结束本题，失败/未提交不计交付，不适用另列。下载准备、未配对场景与最终评分不计入预测进度，所以100%预测交付不等于完整研究完成。

MIND 已按用户要求暂停。MIND 专用 i²Agent 适配位于上一级 `i2agent-mind/`：其输入、输出上限及最多两次模型纠错属于单独的 MIND 修订，受影响旧结果须留档并统一重跑；未将该修订扩散到其他数据集。作者 `model.py` 未随仓库分发，需按 `i2agent-mind/fetch_author.py` 固定版本及哈希单独取得。

当前 KuaiRand 617 条测试输入与 Waterfall 共用，原队列的 14 条测试样本不重复运行；旧输入与 Waterfall 的字幕状态字段不同，历史和候选内容核对一致。其他 AgentRecBench 场景的数据与 Waterfall 同题对比仍需准备，不能当作已完成。

`kuairec_crosswalk.py` 在不读取标签时核对两侧按 split 和 user_id 匹配的公开观察；已发现对照测试输入的 decision_id 前缀误写为 dev，不能按该前缀合并结果。匹配关系必须在最终评分中使用，并验证用户、split、输入及预测的唯一对应。

`fetch_agentrecbench_reviews.py` 以限速和断点续传获取官方长历史和全部历史文件，校验固定版本的完整 SHA-256；这些原始数据在本地保存，不进入 Git。下载完成不等于领域索引、任务适配或同题运行已完成。
