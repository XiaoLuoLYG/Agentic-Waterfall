# MARS 作者代码与第三方复现检索

核查日期：2026-10-29。目标是 [Agentic Recommender System with Hierarchical Belief-State Memory](https://arxiv.org/abs/2605.14401)，不是其他同名系统。

- 核查论文正文、GitHub 仓库按论文标题、arXiv 编号与 hierarchical belief state 检索，以及 Hugging Face 模型搜索：目前没有找到可确认的作者实现或第三方论文复现。
- [Multi-Agent-Recommender-System-MARS](https://github.com/Vedant-1012/Multi-Agent-Recommender-System-MARS-) 是电影推荐多智能体聊天项目；没有证明与本论文的 event/preference/profile 三层记忆及其更新流程对应。
- [第三方论文与代码目录](https://github.com/Nevaeh7/awesome-agentic-recommender-systems) 对该论文的 Code 栏标为 N/A，只能作为检索线索，不是不存在代码的证明。
- grep.app 的精确代码搜索返回 HTTP 429、Sourcegraph 返回 HTTP 403，两个全文代码索引未能覆盖；不排除存在未被索引的实现。

按用户要求，暂不自行实现论文复现，也不把同名项目当作 MARS。已有资料和论文见上一级目录中的入口。
