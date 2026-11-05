# RecBot 作者代码与第三方复现检索

2026-11-05 批次说明：无 AIA 语义变体已获用户批准，617 题当前输入对齐、计分和验收完成；不因 AIA 缺失继续等待。源码见[本批快照](../../../output/agentic-waterfall/contract-repair-20261103/README.md)。以下保留原日期的历史检索记录，本次没有重新检索、下载或训练。

核查日期：2026-10-29。目标是 [Interactive Recommendation Agent with Active User Commands](https://arxiv.org/abs/2509.21317)（论文提交 2025-09-25）。

- [第一作者主页](https://tangjiakai.github.io/) 的 RecBot 条目只链接论文；该主页其他工作有独立 Code 链接，但 RecBot 条目没有。
- GitHub 仓库按论文全名、arXiv 编号、`RecBot in:name` 和核心方法关键词查找；目前没有找到可核对的论文作者仓库或第三方论文复现。名称搜索共返回50个仓库，明显同名不代表是同一个系统。
- [ron457/RecBot](https://github.com/ron457/RecBot) 是商品搜索与评论助手，仓库描述的分类/检索/写作流程不是论文的 Parser、Planner、AIA 机制；不能用于论文 RecBot 对照。
- [hexagonwarrior/recbot](https://github.com/hexagonwarrior/recbot) 是文本推荐强化学习项目，建立于2021年，早于本论文；不是同一方法。
- Hugging Face 的 [recbot_hrnn](https://huggingface.co/api/models/Kevin99z/recbot_hrnn) 和 [RecBot-ReDial](https://huggingface.co/api/models/Kevin99z/RecBot-ReDial) 创建于2023年，早于该论文，不能作为论文模型权重。
- grep.app 的4个精确代码搜索均返回 HTTP 429，Sourcegraph 返回 HTTP 403；未能完成这两个全文代码索引的核查，不以此声称不存在未索引仓库。

目前未找到**可核实**的作者代码或第三方复现，不能断言全球没有。原论文涉及语义和 AIA 协同路径，缺可确认的 AIA 权重；现有 `fixed_pool.py` 仅是公式组件，不是完整 RecBot。按用户要求，暂不自行实现论文复现。

## 第三方对照线索：SAGER

[SAGER 论文](https://arxiv.org/html/2604.14972) 的实验表包含名为 RecBot 的对照，附录 A.2.2 描述其使用动态对话历史。这说明该论文作者报告过一个相关对照；但目前没有公开的实现细节可确认是否完整保留 RecBot 原论文的 Parser/Planner/AIA。

找到的 [Jove-Zhen/SAGER 社区仓库](https://github.com/Jove-Zhen/SAGER) 自称社区复现 SAGER，当前只有 README，明确写代码仍在准备，不能下载其中的 RecBot 基线。SAGER 合作者 [Weixin Chen 的发表列表](https://weixinchen.com/) 对 SAGER 只列论文链接，未列代码。该线索不证明该论文没有其他私有或未索引实现。
