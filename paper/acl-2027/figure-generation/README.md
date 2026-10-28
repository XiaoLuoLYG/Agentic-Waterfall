# 使用官方项目重画 Waterfall 论文图

状态（2026-10-21）：两套核心绘图环境已安装，并已实际调用 OpenAI。**AutoFigure 评测图已完成并替换论文原图；PaperVizAgent 完整生成了架构图候选，但连线和字号未通过内容与排版检查，因此未替换原架构图。** 简化架构图的重绘请求被 OpenAI 的 `429 credit_balance_exhausted` 拒绝，已停止重试，等待账户额度恢复。论文当前使用 v5 架构图和 AutoFigure 新评测图；旧图已备份。

## 已安装

| 项目 | 官方来源 / 固定版本 | 本地目录 |
| --- | --- | --- |
| PaperBanana（现名 PaperVizAgent） | https://github.com/google-research/papervizagent ，`e088a8fff74cc363b6897c0843631fff76484908` | `/Users/luoyige/.local/share/research-figure-tools/PaperVizAgent` |
| AutoFigure | https://github.com/ResearAI/AutoFigure ，`454ee868b9e253d2dbf990b42c4e964b93e498fd` | `/Users/luoyige/.local/share/research-figure-tools/AutoFigure` |

两者使用独立 Python 3.12.13 虚拟环境。依赖下载超时后改用清华 PyPI 镜像；`uv pip check` 均通过。具体依赖保存在同目录的 requirements 快照中。AutoFigure 采用 SDK，不需要启动其网页前端。

PaperBanana 的官方 [PaperBananaBench](https://huggingface.co/datasets/dwzhu/PaperBananaBench) 已下载，安装了 diagram/ref.json 及其 298 张参考图；所有图片均可解码。下载包 SHA256 为 `a980d23954c0cb47017cdaa8a9029dbea3598791fd269a457482033821927e37`，与官方文件记录一致。压缩包中三个乱码文件名按 UTF-8/CP437 映射恢复为 manifest 中的名称，图片内容没有改动。上游自动检索代码当前只搜索前 200 条参考记录。

AutoFigure 自带 5 张 paper 参考图；Chromium 和 FFmpeg 已安装。已有 Homebrew Cairo 1.18.4 可供其 SVG 渲染使用，运行时需要 `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib`。

## 已验证的兼容修正

PaperVizAgent 的本地改动保存在 `papervizagent-local.patch`：

1. 捕获本地缺少 Google ADC 的异常，并预先初始化 project_id，使官方 API-key 回退路径能工作。
2. Planner 将参考图传入统一的 image/source 数据结构；修复前，官方转换器把该图丢弃，实际得到 0 个图片输入。
3. 允许输入指定图片分辨率；Gemini 默认仍是 1K，本次 GPT Image 请求 2560×1280。
4. 为 Retriever、Planner、Stylist、Critic 接通仓库已有的 OpenAI 文字/视觉调用函数。生成阶段使用上游已支持的 GPT Image 分支，完整 `demo_full` 顺序不变。此次不是作者原论文的 Gemini 配置复现。

API-key 回退、参考图传递、分辨率参数和供应商路由已通过本地断言检查。AutoFigure 的原生 SVG→PNG 函数和 Chromium 启动检查通过。另修复了上游预处理删除 `xmlns:xlink`、导致已生成 SVG 无法渲染的问题，修改有复现与断言检查；并移除了日志中的密钥末四位。测试资产只保存在安装目录的 smoke 子目录，不用于论文。供应商适配测试与实际生成记录分别保存，不将测试替身当作模型输出。

## 实际生成配置

- `architecture.md` → `run_papervizagent.py`：官方 Retriever → Planner → Stylist → Visualizer → 最多两轮 Critic，生成架构图。
- `evaluation.md` → `run_autofigure.py`：官方 AutoFigure SVG 生成和评审循环，最多三轮，生成可编辑评测图。不开启额外位图增强，以控制装饰程度。

实际结果：

- `outputs/papervizagent-architecture/`：检索到 10 张参考图，执行 Planner、Stylist、Visualizer 和两轮 Critic，产生 4 个图像版本。最后一版仍有命令箭头连接错误和小字问题，作为未采用候选保留。
- `outputs/autofigure-evaluation/`：原始完整流水线输出。第一轮修订因命名空间导出 bug 失败，流水线退回首版；该首版未用于论文。
- `outputs/autofigure-evaluation-final/`、`outputs/autofigure-evaluation-final-r2/`：修复导出器后，实际调用官方 `autofigure.generator.improve_code`，使用编辑检查意见完成排版、绘制最终图标、修正文字上的连线。采用 `final-r2` 的 SVG/PNG，并通过 CairoSVG 导出论文 PDF。没有手工重画其 SVG。
- `architecture-compact.md`、`refine_papervizagent.py`：已准备三组布局、较大字号的简化重绘，复用真实检索得到的参考图。计划使用官方 Planner→Visualizer 和 `gpt-image-2.5-sunburst`；该次在线请求因余额不足没有得到有效新图。恢复额度后只需继续此步骤。

两个输入均按现有论文核对：模型参数冻结、四种动作、共享状态、候选不足才补充获取；评测中各方法只接收自己展示内容的反馈，不填造结果。

凭据文件位于项目外：`/Users/luoyige/.config/research-figure-tools/credentials.env`，权限 0600。用户授权填入 `OPENAI_API_KEY`。启动脚本从环境读取密钥，不将密钥写入论文目录。已核对账户模型列表，文字/视觉环节采用 `gpt-6.1-sol`，图像环节采用 `gpt-image-2.5-flare`。

所有请求均指向 `https://api.openai.com/v1`。AutoFigure 上游将其通用兼容传输命名为 `openrouter`；本次显式覆盖 base URL 指向 OpenAI 官方，不向 OpenRouter 发送请求。`run_autofigure.py --provider openai` 封装了这项配置，`--provider gemini` 保留原始 Gemini 路径。

执行时使用各自 `.venv/bin/python`，通过 `--output` 指定独立的输出目录。保存输入快照、完整流水线结果与私有运行日志。只有实际生成、逐图核对内容并检查论文尺寸之后，才替换 `official-template/figures/` 中的正式图，并编译现有 TeX 文件。

当前本地校验 PDF 为 10 页，Conclusion 位于第 8 页，架构图在第 4 页、评测图在第 6 页；19 个字体均嵌入，无 Overfull 或未定义引用。评测图 PDF 的真实字号范围为 8.19–9.45 pt，页面范围内无越界字符。模型自评分只作迭代反馈，不作为质量验证或研究结果。

接口依据：[OpenAI 图像生成 API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。模型可列出不等同于每次调用必然成功，实际结果以运行文件为准。
