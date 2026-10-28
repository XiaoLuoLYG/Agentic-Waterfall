# Waterfall 正式插图：A 版

2026-10-21，用户选定 Academic Research Skills 的 A 版，已替换当前论文的架构图和评测图。正式文件为 `waterfall-architecture.pdf` 和 `waterfall-evaluation.pdf`，同名 PNG 供预览、SVG 可编辑。

## 来源与复现

采用用户指定的 [academic-research-skills](https://github.com/imbad0202/academic-research-skills)，固定提交 `3224a27a2571cefef0fddfd437004cb006f2b0cb` 中的 visualization agent、可视化标准和图形复核流程。实际绘图使用 Matplotlib，每个模块、图标、文字和连线均由源码生成，不调用外部图像 API。

原始 A 版及完整来源记录在 `../../figure-studies/2026-10-21/academic-research/`。该目录保留候选时的记录；当前正式采用状态以本文件为准。B 版仍保留在同级 `diagram-design/`，未加入论文。

正式 `draw_figures.py` 从选定 A 版复制，仅增加原生矢量 PDF 导出、嵌入 TrueType 字体及正式文件名，未重做设计。从本目录运行：

```sh
~/.local/share/research-figure-tools/matplotlib-venv/bin/python draw_figures.py
```

脚本生成两套 PDF/PNG/SVG 和 `checks.json`。PDF 是原生矢量输出，不是 PNG 转 PDF。字体使用本机 Arial，尺寸为 160 × 84 mm，按论文正文宽度原尺寸嵌入。

## 内容边界

- 架构图：任务难度纠正、保留长期摄影兴趣、共享状态、候选池和预算检查，以及 Acquire / Rank / Hold。虚线框表示拟议扩展；模型参数保持冻结。
- 评测图：同起点、各方法独立候选池和展示列表；反馈仅来自各自展示内容。独立盲评负责有用性，适应和成本从轨迹日志计算；评价标签不流回策略。
- 字母是示意内容 ID，三轮用于解释流程。两图均无实验结果，不证明方法已实现或有效。

## 插入后检查

- 两个正式 PDF 由现有 `acl_latex.tex` 引用；评测图注已同步说明盲评与轨迹日志的职责。
- 编辑器内置编译、本机 TeX Live 同源编译均成功。校验 PDF 共 10 页，正文结论在第 8 页结束。
- 架构图在第 4 页，实际文字 8.0–9.3 pt；评测图在第 6 页，8.0–9.0 pt。
- 17 种字体全部嵌入，无 Type 3；无 Overfull 或未定义引用。9 条 Underfull 提示保留，逐页检查未见遮挡、截断或超栏。
- 全篇 10 页已渲染检查，见 `../qa/A-page-01.png` 至 `A-page-10.png`；机器记录见 `../qa/pdf-audit-A.json`。

## 回退与历史

替换前的主文档和整个 figures 目录保存在 `../qa/before-A-20261021/`。该备份中的 README 包含 v1–v5、PaperVizAgent 和 AutoFigure 的历史选用记录。其他生成工具的安装与实际运行记录见 `../../figure-generation/README.md`，它们不是本次正式 A 版的生成方式。
