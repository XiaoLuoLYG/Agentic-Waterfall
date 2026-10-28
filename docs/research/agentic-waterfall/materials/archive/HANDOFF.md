# Waterfall 论文交接（历史记录恢复版）

> 历史材料：保留当时内容，不作为现行方案。当前以 [研究主方案](../../01-研究主方案.md) 和 [输入输出与数据流](../../02-输入输出与数据流.md) 为准。

恢复日期：2026-10-26。原交接文档创建于 2026-10-21，存放在系统临时目录，现已不存在。本文件根据聊天中的交接内容和仍存在的项目记录恢复，固定保存在项目内。

**时间边界：下面的完成状态与排版数字主要对应 2026-10-21 的检查。本次只恢复文档、核验相关文件存在，没有重新编译、运行实验或审计此后全部变更。继续工作前请读取当前源码与现有研究计划，不把历史状态当作今日完成情况。**

## 1. 工作入口与下一步目标

工作目录：`~/Documents/ChatGPT/waterfall`，下称 `WORKSPACE`。

论文目录：`$WORKSPACE/paper/acl-2027/official-template`，下称 `PAPER`。

当前论文主文件：`$PAPER/acl_latex.tex`。

本交接文档：`$WORKSPACE/docs/research/agentic-waterfall/materials/archive/HANDOFF.md`。

用户为下一阶段指定的目标是：**先确定整体研究方向、论文撰写计划、实验方案、数据集和评测指标，先不要跑实验。** 先读现有研究材料，针对缺口核查一手文献，给出明确推荐并更新现有研究计划；本次恢复文档不代表这些决策已经完成。

研究应围绕召回获取、推荐排序、画像学习与持续反馈的统一架构，确定可检验的核心问题和贡献边界。不要未经论证缩成一个小功能，也不要只因流程完整就宣称首次创新。

下一阶段需要定下的五项：

1. **研究方向**：核心问题、假设、与 ClawRec / RecBot / MARS 等邻近工作的关系；已有能力与值得验证的差异。
2. **论文计划**：主线、各章节问题、主张所需证据、现稿保留与待改部分，以及必须等实验完成的内容。
3. **实验方案**：研究问题对应哪些对照与消融，什么结果支持或否定假设；实施顺序、资源预算及估计前提。
4. **数据集**：主数据、辅助数据、自建部分、获取方式、行为字段映射、划分、标注与信息泄漏防范。
5. **评测指标**：主要指标与必要辅助指标，覆盖召回、排序、多轮适应与成本；解释标签来源、计算和公平比较，用具体小例子说明。

## 2. 论文与插图的历史完成状态

2026-10-21 已完成：

- 用户明确选定 **A 版 Academic Research Skills**，两张正式插图已替换。B 版未加入论文，不要无请求重启选图。
- 正式图为 Matplotlib 原生矢量 PDF，保留可编辑 SVG 和 PNG 预览；不是位图转 PDF。
- 评测图注同步说明独立盲评负责有用性，适应和成本来自轨迹日志；评判标签不流回策略。
- 编辑器内置与本机同源编译均成功，10 页均已渲染并逐页检查。
- 图形说明、格式检查、初稿说明和审计 JSON 已同步指向 A 版。

论文仍是方法与评测协议初稿：拟议完整控制器当时未实现和验证，没有实测结果。现有原型的受限记忆/查询编辑与程序搜排，不等于已完成自主阶段选择。运行时状态更新不等于模型参数微调；研究默认使用冻结模型。

图中字母内容与三轮流程用于说明机制，不是实验观测。不能把无实验证据的主张写成结果，也不能将格式通过等同于具备投稿所需研究证据。

## 3. 产物索引

以下路径相对 `PAPER`：

| 内容 | 路径 |
| --- | --- |
| 当前论文与文献 | `acl_latex.tex`、`waterfall.bib` |
| 架构图 | `figures/waterfall-architecture.pdf`，同名 `.svg` / `.png` |
| 评测图 | `figures/waterfall-evaluation.pdf`，同名 `.svg` / `.png` |
| 生成源码与说明 | `figures/draw_figures.py`、`figures/README.md`、`figures/checks.json` |
| 同源校验 PDF | `qa/acl_latex.pdf` |
| 编译与审计 | `qa/compile-result.json`、`qa/pdf-audit-A.json`、`qa/pdf-audit.json` |
| 当轮页图 | `qa/A-page-01.png` 至 `qa/A-page-10.png` |
| 格式检查与初稿边界 | `ACL_FORMAT_CHECK.md`、`DRAFT_NOTES.md`、`bibliography-audit.md` |
| 替换前备份 | `qa/before-A-20261021/` |

历史 `qa/page-*.png` 不代表 A 版。`paper/acl-2027/README.md` 主要是早期下载记录，不代表现稿还是空模板。

### 历史排版检查（2026-10-21）

- 共 **10 页**；Conclusion 在 **第 8 页**结束，Limitations、伦理讨论和参考文献也从第 8 页开始，附录延续至第 10 页。
- 架构图在 **第 4 页**，图内实际文字 **8.0–9.3 pt**；评测图在 **第 6 页**，**8.0–9.0 pt**。两图均 **160 × 84 mm**。
- 正文官方 **11 pt** 配置，PDF 常规正文约 **10.909 pt**；摘要、图注与参考文献约 **9.963 PDF pt**，对应模板 10 pt 配置。
- A4；**17/17 字体嵌入**，无 Type 3、Overfull 或未定义引用；有 **9 条 Underfull**，不能称为无警告。逐页检查未见遮挡、截断或超栏。
- `acl.sty`、`acl_natbib.bst` 与已下载官方 ZIP 逐字节相同；未缩字号、改页边距或用负间距压页数。

历史页数与视觉结论对应本地校验 PDF。编辑器预览无法通过接口导出，没有核对两个编译器产物逐字节一致。补实验、改正文或图注后必须重新检查；官方投稿政策和截止日期需要在提交前重新查询。

## 4. 研究材料与继续方式

以下路径相对 `WORKSPACE`，2026-10-26 恢复时均已核验存在；内容应读取其当前版本：

| 用途 | 路径 |
| --- | --- |
| 统一架构论文计划（优先读取、继续更新） | `docs/research/agentic-waterfall/materials/archive/2026-10-20-waterfall-unified-architecture-paper-plan.md` |
| ClawRec / RecBot / MARS 对比 | `docs/research/agentic-waterfall/materials/archive/2026-10-20-waterfall-clawrec-recbot-mars-comparison.md` |
| 评测证据 | `docs/research/agentic-waterfall/materials/archive/2026-10-20-unified-architecture-evaluation-evidence.md` |
| 实现审计 | `docs/research/agentic-waterfall/materials/archive/2026-10-20-manuscript-implementation-audit.md` |
| 邻近工作 | `docs/research/agentic-waterfall/materials/archive/2026-10-20-unified-architecture-neighbors.md` |
| 召回调研 | `docs/research/agentic-waterfall/materials/archive/2026-10-14-agent-retrieval-survey.md` |
| 排序调研 | `docs/research/agentic-waterfall/materials/archive/2026-10-14-agent-ranking-survey.md` |
| 数据与评测调研 | `docs/research/agentic-waterfall/materials/archive/2026-10-14-datasets-evaluation-survey.md` |
| 问题定义调研 | `docs/research/agentic-waterfall/materials/archive/2026-10-14-waterfall-question-definition-survey.md` |

不要只根据旧对话重建研究结论。ClawRec 是紧邻的完整流程对照；RecBot、MARS 的适配能力与公开证据应查原论文/代码。引用疑点及实现边界见论文目录的 `bibliography-audit.md` 和 `DRAFT_NOTES.md`。

评测设计要控制模型、信息、来源、工具和预算，但不同方法可以获得不同候选池。每个方法只能接收对自己展示内容的反馈；未展示内容的历史点击不是当前策略收到的反馈。真实日志与合成交互支持的结论须分开。

选用点赞、点击、可见时长、播放时长和语言纠正等字段时保留测量语义，缺失字段保持缺失。不能默认停留或点击就是满意，也不能把不同来源的时间字段当成同一行为。

## 5. 绘图来源与编译入口

A 版原始研究目录：`$WORKSPACE/paper/acl-2027/figure-studies/2026-10-21/academic-research/`。

用户指定仓库：<https://github.com/imbad0202/academic-research-skills>，固定提交 `3224a27a2571cefef0fddfd437004cb006f2b0cb`。采用 visualization agent、可视化标准及渲染复核流程，通过 Matplotlib 绘制概念关系图；没有调用远程图像 API。

原 study 的“尚未加入论文”是候选阶段记录；正式采用说明以 `$PAPER/figures/README.md` 为准。B 版位于同级 `diagram-design/`。

如后续确需重新导出，在 `$PAPER/figures` 中运行：

```sh
~/.local/share/research-figure-tools/matplotlib-venv/bin/python draw_figures.py
```

已有运行环境。重新导出后检查实际页面，不要仅凭生成成功就断言布局正确。

编辑 TeX 后使用内置 `compile_latex_document`，保持原文档及标签页。用户此前已允许从同一源码生成本地校验 PDF，输出到 `$PAPER/qa/`。历史本机入口：

```sh
python3 ~/.codex/plugins/cache/openai-bundled/latex/0.2.8/scripts/compile_latex.py \
  "$PAPER/acl_latex.tex" --compiler texlive --engine pdflatex \
  --output-directory "$PAPER/qa" --json
```

需先设置实际 `PAPER` 路径并确认工具仍存在；终端成功不能替代内置编译检查。本次文档恢复没有执行上述命令。

PaperBanana / PaperVizAgent、AutoFigure 的历史安装及实际运行记录见 `$WORKSPACE/paper/acl-2027/figure-generation/README.md`。这些候选已被 A 版替代；此前模型接口曾因余额不足失败。不要自动重试付费调用。凭据位于工作区外，本文不包含任何密钥。

## 6. 编辑与沟通约束

- 原位编辑已有 `acl_latex.tex`，不创建替代文档，不自动打开其他标签页；本轮恢复未修改论文。
- 保留已有工作区变更，不做 reset、clean 或 add-all，不自动提交、上传或发布。
- 下一阶段只做研究与实验方案，先不跑实验；除非用户另有要求，不改产品代码、论文正文或已选 A 版插图。
- 用中文说人话，以具体案例解释。先给一页以内推荐，再分步展开，每次最多让用户决定一个真正影响路线的问题。
- 不夸大新颖性、实现状态、实验效果或录用可能；时间估计写明前提。

## suggested skills

- `i-have-adhd`：用户要求的沟通方式；路径 `~/.codex/skills/i-have-adhd/SKILL.md`。下一步明确、分步且简短，避免一次堆积大量决策。
- `lieflat-less-ai-tone`：用户已指定；遵守其实际规则和语言适用范围，不把中文规则机械套入英文，不自行改变论文框架。
- `latex:latex-compile` 与 `pdf:pdf`：仅在后续涉及修改、编译或实际排版核查时使用。
- 用户指定 `academic-research-skills` 的 visualization agent：继续 A 版图时使用；`diagram-design` 只在用户重新要求相应风格时使用。
- `handoff`：后续交接引用现有产物、去除敏感信息；**用户本次明确要求把恢复文档保存到固定项目位置，因此不要再迁回系统临时目录。**

## 恢复说明

这是根据聊天记录重建的交接文档，不是从磁盘找回的原文件，不能保证逐字一致。保留了继续研究需要的路径、历史状态、边界和下一步要求。文件中的历史实验/实现状态需要接手者结合当前材料复核。本次没有运行实验、重新编译论文或更改主线程其他文件。
