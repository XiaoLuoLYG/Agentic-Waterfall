# MARS：按论文修正的适配实现，非作者代码

依据 [MARS v2](https://arxiv.org/pdf/2605.14401v2) 的 §§3–4、附录 A/B/G。2026-11-02 重新检索后仍未找到可核实的作者实现；不能把本目录称为作者原版或已复现论文成绩。检索范围见 [SOURCE-SEARCH.md](SOURCE-SEARCH.md)。

`prompts.json` 从原 PDF 第 17–18 页提取四类核心模板并记录 PDF SHA-256。先前“确切提示未公开”的说明不准确，现予纠正。`prompts.mjs` 保留模板主体，增加数据边界、事件引用和完整候选 ID 的传输说明；抽取接受原生 JSON 数组，画像接受原生文本，排序接受逐项评分行，没有统一强制包装成 JSON 对象。

## 修正内容

- 抽取按 create / strengthen / weaken 增量应用，保留未涉及的偏好；每次最多五项，分类必须来自冻结的六类领域配置。
- 六个偏好维度按附录 B，从十份公开物品描述生成一次，再对全部用户复用。例如题材/风格是维度，美食/游戏是题材的取值，不能拿六种题材代替六个维度。不能每个用户临时自定分类，不能使用隐藏目标或评分选择分类。
- 回顾模式完整历史用于抽取，排序事件层按论文保留最近十五条。持续模式逐事件调度，未处理信号保持在事件窗口内，提供健康摘要和上轮动作结果。失败不提交部分状态。
- 恢复画像和评分模板，包括画像长度提示、评分区间、逐项理由。
- 本地有界候选一次完整评分。论文 Table 5 的 N=10 是候选总数，不是必须十条一批的硬限制；旧版将 101 条拆成 11 组的设置已移除。输出必须覆盖全部候选，缺失、重复、越界或截断直接保留失败，不补造、不裁尾。

## 仍存在的复现差异

本实现不是作者源码。论文没有公开全部更新代码：事件 ID 到 evidence 计数的映射、重复证据去重，以及加权 merge 的细节是明确注明的本地解释。所有引用必须来自可见事件，不能虚构证据数。主要阈值保持原文：事件窗口 15、每类容量 8、规划间隔 3、增强 0.1、减弱 0.2、遗忘阈值 0.1/5、五次变更后重建画像。

原论文主要使用 InstructRec 四域、每题十个候选及 Llama-4-Maverick。现有 KuaiRand 适配使用原实验的 DeepSeek、101 个候选、无当前用户指令；不能把结果与论文分数直接横比。当前小批量只检查回顾式推荐质量，不验证真实连续会话中的记忆收益。

此次固定旧实验的同一批用户和历史事件窗口（64 条）。“全部可见历史”指这 64 条，不等于该用户全部原始日志；结果 observation_scope 同时报告可见条数、已归档条数与输入策略。旧公共导出另有标题 64 UTF-8 字节/封面 32 字节裁剪，已用独立的 kuairand/restore_public_text.py 在隔离输入中恢复经过来源校验的完整文本，没有改正常实验的数据。历史窗口扩展属于另一项协议变更，本次未将其偷偷扩成全历史实验。

结果标识为 `paper-aligned-retrospective-adapted`，同时记录 `author_implementation:false`、`complete_original_method:false` 及具体差异。这两个字段不代表执行失败，而是防止把适配实验误当成完整作者实验。

## 入口与验证

先准备经过上述一次性分类过程得到的 MARS_DOMAIN_FILE，内容含 name、item_noun、六个不同的 categories。例如在隔离实验目录执行：

```sh
MARS_DOMAIN_FILE=/absolute/path/domain.json node methods/agentic-waterfall/paper-reproductions-run.mjs mars /absolute/path/public-input.jsonl 0 /absolute/path/new-result kuairand
```

运行前需要独立模型控制、记录目录及用户已授权的实验范围；不要覆盖现有运行或切换正常实验代码。sequence_live.mjs 同样要求明确的领域文件。

离线检查：`node --test methods/agentic-waterfall/mars/*.test.mjs methods/agentic-waterfall/paper-reproductions-run.test.mjs`。检查范围包括增量更新、事务回滚、完整历史/近期窗口、真实入口中 101 候选一次传递与原生输出解析。离线通过不等于效果提高。
