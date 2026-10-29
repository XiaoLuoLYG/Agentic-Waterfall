# 固定检索对照：BM25 + BGE-M3 + reranker

本目录实现研究方案的固定检索流水线：BM25 与 BGE-M3 分别在允许的共同目录取前100，RRF(k=60) 融合最多100条，再用 BGE-reranker-v2-m3 打分排序。向量取作者模型的 CLS 并归一化；分词/编码和重排均限制512 tokens，超长文本会截断。查询由调用方按照实验协议从原始表达、资料和历史构造，不读取其他方法的画像。无查询时使用单独冻结的训练集热度顺序；缺失热度列表会明确报错。

## 模型与数据

| 模型 | 固定版本 | 权重大小 | 校验 |
|---|---|---:|---|
| [BGE-M3](https://huggingface.co/BAAI/bge-m3/tree/5617a9f61b028005a4858fdac845db406aefb181) | `5617a9f61b028005a4858fdac845db406aefb181` | 2,271,145,830 bytes | `b5e0ce3470abf5ef3831aa1bd5553b486803e83251590ab7ff35a117cf6aad38`，匹配官方 LFS SHA-256 |
| [BGE reranker v2 m3](https://huggingface.co/BAAI/bge-reranker-v2-m3/tree/953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e) | `953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e` | 2,271,071,852 bytes | `d9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286`，匹配官方 LFS SHA-256 |

两个模型均为现成权重，没有训练；`weights/` 和独立 `.venv/` 在本目录且不纳入 Git。默认使用可用的 Apple MPS，否则使用 CPU；MPS/CPU输出可能有浮点差异。初次 Hugging Face Xet 下载未产生有效文件并停止，随后普通 HTTPS 下载成功，日志保留。

从现有 KuaiRec public `catalog.json` 投影出 3,327 个 ID 与内容，保存在 `data/kuairec-catalog-public.json`；不把用户标签放入模型输入。依据原训练部分的 `big_positive_count` 冻结热度顺序。完整目录 BGE-M3 编码在本机用时约74秒，存入 `runs/kuairec-full-index-20261029/`，索引包含输入 SHA-256、模型版本、文本和向量。8项和64项小目录仅作为独立检查。

## 已做检查

1. 8条公开内容上的 BM25/BGE 融合与真实 reranker 推理完成。
2. 同一 KuaiRec 公开用户历史构造查询后，在完整目录、已有可评范围与排除记录下取得100条并完整重排，耗时约14秒；校验了唯一性、集合一致性、允许范围和排除项。保存为 `runs/kuairec-example-full-ranking-20261029.json`。
3. 无查询时训练集热度回退产生100条，并遵守同样排除规则。
4. `PYTHONDONTWRITEBYTECODE=1 methods/agentic-waterfall/fixed-retrieval/.venv/bin/python -m unittest discover -s methods/agentic-waterfall/fixed-retrieval -p test_retrieval.py`：7项检查。

索引与排序检查没有读取测试答案、没有计算质量指标。用户可评范围复用旧 KuaiRec 工具的 `observed` 掩码：它由 small matrix 中该用户是否有记录构造，不包含观看比例或喜欢标签，但会透露测试侧哪些用户–视频对有观察记录。KuaiRec 主方案明确采用该掩码，这项可见信息须在正式对照中披露并由所有方法统一使用；内容文本是后续发布的静态补充，不代表 2020 年实时可获取；这不是正式效果结果。其他数据集仍需各自目录与输入映射，不能因为 KuaiRec 跑通就称全部实验就绪。

## 自行运行

从仓库根目录运行（输出文件必须不存在）：

```sh
methods/agentic-waterfall/fixed-retrieval/.venv/bin/python methods/agentic-waterfall/fixed-retrieval/retrieval.py search \
  --index methods/agentic-waterfall/fixed-retrieval/runs/kuairec-full-index-20261029 \
  --query '摄影技巧' --output methods/agentic-waterfall/fixed-retrieval/runs/example-ranking.json
```

正式任务应通过 `--eligible` 和 `--exclude` 传入预先确定的 JSON ID 数组，并统一各方法的候选可见性。空查询需通过 `--hot-order` 指定训练部分冻结的完整目录顺序；不得用测试标签或未来统计构造热榜。输出包含实际取得的候选和完整重排；评测时按协议取前10，评分器与隐藏答案单独使用。

KuaiRec 批量入口：`kuairec_batch.py` 使用每位用户最近20条公开长观看文本，统一读取现有观察掩码，冻结输入/索引/热度哈希；无模型 API 调用，并单独记录本地推理时间。已在与 ClawRec 和通用 Agent 相同的两位用户上真实推理，各获取100条并返回10条，集合约束通过。`freeze_predictions.py` 在读取标签之前检查所有计划用户均完成并冻结结果；开发282人、测试1,129人的清单已准备，全量与真实评分仍未运行。
