# MARS 公开实现核查

核查日期：2026-11-02。目标是 [Agentic Recommender System with Hierarchical Belief-State Memory v2](https://arxiv.org/abs/2605.14401v2)，Xiang Shen 等的三层信念记忆方法。

检查论文及作者线索、GitHub 仓库/全文检索、Hugging Face 模型/论文标签、引用该工作的公开仓库。未找到可核实、可直接运行的作者实现或完整第三方复现。名称相同不代表论文相同：Vedant-1012 的 Multi-Agent-Recommender-System-MARS、xwang97/MARS 等不作为目标实现。当前项目自己的公开代码也从检索证据中排除，避免循环认证。

ClawRec 作者仓库 2,162 条目的完整文件树中没有目标 MARS 基线；Hugging Face 对应论文标签和编号检索没有提供实现。grep.app 本次返回 429，CatalyzeX 返回 403，不能把受限搜索写成已遍历完成；公开检索也无法证明私有、未索引资源不存在。

论文确实公开了方法和附录 G 的核心提示模板。此前“确切提示未公开”的描述错误，已按原 PDF 修正。当前目录是明确披露差异的论文适配实现，非作者代码，也未复现原论文分数。

完整查询、原始入口、排除理由和限制记录于本地 output/agentic-waterfall/recbot-mars-paper-alignment-20261102/sources/independent-search.md；本次没有联系作者或取得非公开实现。
