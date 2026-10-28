# ACL 2027 主会长文：格式与检查记录

核对日期：2026-10-21。目标是匿名审稿版 Long Paper。本文为作者工作记录，不属于论文正文。本次 A 版替换复核了实际 PDF，未重新查询投稿政策或截止日期；下列官方来源保留此前核对记录，正式投稿前须再核查。

## 官方要求与出处

| 项目 | 要求 | 官方出处 |
|---|---|---|
| 审稿篇幅 | 正文最多 8 页，正文图表也计入；录用后的终稿才可增加到 9 页 | [ACL 2027：Paper Submission Details](https://2027.aclweb.org/calls/main/#paper-submission-details) |
| 额外章节 | Limitations 必需；伦理讨论可选。二者放在结论之后、参考文献之前，不强制另起页，不占正文额度；不得藏入新方法或结果 | [ARR：Long Papers / Limitations](https://aclrollingreview.org/cfp)，[ACLPUB：Limitations](https://acl-org.github.io/ACLPUB/formatting.html#limitations) |
| 参考文献与附录 | 参考文献不限页数；附录置于参考文献之后，也不计正文额度。附录继续使用官方双栏格式，关键论证必须留在正文 | [ARR：Optional Supplementary Materials](https://aclrollingreview.org/cfp#optional-supplementary-materials-appendices-software-and-data) |
| 模板与纸张 | 使用官方 ACL 样式；A4、双栏；不得修改样式文件或通过负间距、缩字绕过篇幅 | [官方模板](https://github.com/acl-org/acl-style-files)，[ACLPUB：Layout](https://acl-org.github.io/ACLPUB/formatting.html#layout) |
| 尺寸 | A4 为 210 × 297 mm；标准页边距 25 mm；栏宽 77 mm、栏间距 6 mm。审稿行号及页码位于模板规定的位置 | [ACLPUB：File Format / Layout](https://acl-org.github.io/ACLPUB/formatting.html#file-format) |
| 字体 | 正文 11 pt Times；摘要、图表标题、参考文献 10 pt；标题 15 pt。PDF 必须嵌入所需字体，包括外部插图字体 | [ACLPUB：Fonts](https://acl-org.github.io/ACLPUB/formatting.html#fonts) |
| 摘要与元数据 | 摘要不超过 200 词；投稿系统中的题目、摘要用纯文本，并与 PDF 一致 | [ACLPUB：Abstract / Metadata](https://acl-org.github.io/ACLPUB/formatting.html#abstract) |
| 图表 | 靠近首次讨论位置，至少一栏宽；宽图可跨两栏。优先矢量图，文字在 A4 打印时应清楚，不能只靠颜色区分含义；图表下方有编号和标题 | [ACLPUB：Figures and tables](https://acl-org.github.io/ACLPUB/formatting.html#figures-and-tables) |
| 匿名审稿 | 使用 review 模式，保留页码和行号；删除作者姓名、单位和身份线索，附件及仓库链接也须匿名；审稿稿不放致谢 | [ARR：Two-Way Anonymized Review](https://aclrollingreview.org/cfp#instructions-for-two-way-anonymized-review)，[ACLPUB：Acknowledgments](https://acl-org.github.io/ACLPUB/formatting.html#acknowledgments) |
| 引用 | 作者—年份制，参考文献按作者排序；尽可能有 DOI 或权威页面链接，不能仅凭自动生成的条目确认真实性 | [ACLPUB：References](https://acl-org.github.io/ACLPUB/formatting.html#references) |

## 本次文件检查

- 当前主文件：`acl_latex.tex`；没有替换文档或打开新标签页。
- 匿名 review 模式；摘要 172 词；保留 Limitations 和 Ethical Considerations，审稿稿无 Acknowledgments。
- 两张正式插图已替换为用户选定的 A 版：`figures/waterfall-architecture.pdf` 和 `figures/waterfall-evaluation.pdf`。采用 Academic Research Skills 的可视化流程，由 Matplotlib 原生生成矢量 PDF；同名 SVG 可编辑。图宽 160 mm、高 84 mm，架构图文字 8.0–9.3 pt，评测图文字 8.0–9.0 pt，Arial 字体均嵌入。来源、复现和备份见 [figures/README.md](figures/README.md)。
- 架构图以虚线标识拟议协调策略及共享状态；评测图展示独立轨迹和独立有用性评审，成本与适应来自轨迹日志。图中没有实测结果。评测图注已同步说明这些边界。
- 原模板样式文件未修改，`acl.sty`、`acl_natbib.bst` 与官方 ZIP 逐字节一致。最终源码已通过编辑器内置编译。
- 用户已授权从同一源码生成本地校验 PDF。使用本机 TeX Live 2026 编译，输出为 [qa/acl_latex.pdf](qa/acl_latex.pdf)，没有替换文档或打开新标签页。
- **整篇 10 页，正文结论在第 8 页结束，满足审稿正文最多 8 页的要求。** Limitations、Ethical Considerations 及参考文献均从第 8 页开始；参考文献与附录延续至第 10 页。这里的“10 页”不是正文页数。
- 10 页均为 A4（595.276 × 841.89 PDF pt）；17 种字体全部嵌入，无 Type 3 字体。PDF 作者元数据为空，正文使用匿名审稿署名、行号及页码。
- 本轮未改变正文、表格或模板尺寸，仅替换插图并同步评测图注。正文使用官方 11 pt 配置（PDF 中常规正文约 10.909 pt）；摘要、图注及参考文献约 9.963 PDF pt，对应模板 10 pt 配置。最终日志无 Overfull、无未定义引用；有 9 条 Underfull 提示，逐页检查未见遮挡、截断或超栏。
- 当前 A 版校验数据、文件哈希及字体列表见 [qa/pdf-audit-A.json](qa/pdf-audit-A.json)；通用入口 [qa/pdf-audit.json](qa/pdf-audit.json) 已同步。
- 本记录的页数与逐页结论对应本地校验 PDF。编辑器预览已编译成功，但接口不导出预览文件，因此未确认两个编译器产出的 PDF 逐字节相同。

## 逐页检查

本轮全篇以 100 dpi 渲染为约 827 × 1170 像素并逐页检查，当前页图为 `qa/A-page-01.png` 至 `qa/A-page-10.png`。旧 `qa/page-*.png` 不代表本次 A 版。

| 页 | 内容 | 检查结果 |
|---|---|---|
| 1 | 标题、匿名署名、摘要、引言 | 标题与正文清晰，无重叠；首页署名区域留白遵循官方模板 |
| 2 | 相关工作、问题定义 | 引用及公式正常；操作列表引导句在页尾，列表在下一页续排 |
| 3 | 操作列表、目标函数、方法 | 公式未超栏，列表和小节标题清楚 |
| 4 | 架构图、动作选择 | 新版跨栏图及图注完整；反馈案例、作用范围、候选和展示列表可辨，连线未压字 |
| 5 | 排序、实现边界表、评测开头 | 表格不再超宽，表注与正文间距正常 |
| 6 | 多轮评测图、数据与环境 | 新版三轮双行轨迹清楚，每种方法的反馈只进入自己的下一状态；图注完整 |
| 7 | 对照、指标、消融 | 列表和公式未溢出，无遮挡 |
| 8 | 实验状态、结论、限制、伦理、参考文献开头 | 正文于本页结束；额外章节顺序正确 |
| 9 | 参考文献、附录 A/B | 引文与附录衔接正常，arXiv 信息不再重复 |
| 10 | 事件映射表、附录 B 续文及 C | 跨栏表完整且列对齐清楚；后续文字位于左栏，右栏为正常文末留白，无孤行、遮挡或截断 |

本次没有用缩字、负间距或修改页边距压缩篇幅。后续加入实验结果后，必须重新核对正文页数和浮动图表位置。

## 不是排版检查，但提交前同样必需

研究需有完成的工作和足以支持主张的证据；格式通过不代表方法、结果或创新性已经满足录用要求。本文仍缺实际实验。

须填写 Responsible NLP Checklist，并如实披露本次 AI 辅助范围；审稿 PDF 不放致谢，披露先按表单要求填写。作者应核对引用、方法和结果。出处：[ARR：Ethics / AI Writing Assistance](https://aclrollingreview.org/cfp#ai-writingcoding-assistance-policy)。

ACL 2027 先经 ARR 审稿再 commitment。当前官方列出的最晚 ARR 截止日为 2027-01-04 23:59 AoE，即北京时间 2027-01-05 19:59；commitment 日期尚未公布。还需提前准备 OpenReview 作者资料及当轮审稿服务要求。出处：[ACL 2027：Important Dates](https://2027.aclweb.org/calls/main/#important-dates)、[ARR CFP](https://aclrollingreview.org/cfp)。
