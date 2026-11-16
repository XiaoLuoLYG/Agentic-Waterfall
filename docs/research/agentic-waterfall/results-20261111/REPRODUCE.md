# 复现 2026-11-11 结果

从仓库根目录执行。离线复算需要对应的冻结榜单和评价数据。公开发布包提供 26 组方法与数据集的离线评分材料。优先按发布包中的 README 复算；下文保留的是原始实验归档目录的核查命令。 [当前结果](README.md) · [TF-IDF 回放包](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset/releases/tag/waterfall-dataset-v1)

```sh
repo=$(pwd -P)
archive=/path/to/output/agentic-waterfall
batch="$archive/contract-repair-20261103"
scratch=$(mktemp -d)
printf '%s  %s\n' 79d87e6b8bbc031727a43526768aba4765afec0b44c3e9bf06b2a9c39dd03905 \
  demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs | shasum -a 256 -c -
```

发布包下载后，在下载目录运行 `shasum -a 256 -c SHA256SUMS`。本目录的历史清单使用归档标签，不能直接套到发布包或原运行目录。评价标签与模型可见输入分开存放。先校验冻结榜单，再在评价进程中读取标签。以下步骤复算存档预测，无需模型调用。

## AgentRecBench

使用官方短期任务的 `amazon`、`goodreads`、`yelp` 三个域目录，每个域包含 `tasks/` 与 `groundtruth/`。官方评价器源码固定到 AgentSocietyChallenge 的 `3f575247a5778d34c3ae6b0297139c7d4a3597fd`，放在 `experiments/agentic-waterfall/agentrecbench/upstream/AgentSocietyChallenge-3f575247a5778d34c3ae6b0297139c7d4a3597fd/`。300 题榜单和 220 题共同子集 ID 都以清单中的文件为准。

```sh
ar="$batch/agentrecbench-waterfall-core79d-full-20261109/continuation-20261109/projection"
ar_tasks=/path/to/agentrecbench/task-full/short_term
PYTHONPATH="$repo/experiments/agentic-waterfall/agentrecbench/scripts" \
python3 - "$ar" "$ar_tasks" "$batch/scoring/agentrecbench-matched220-metrics.json" <<'PY'
import json
import sys
from pathlib import Path
from adapter import official_metrics, validate_ranking

projection, tasks, matched_file = map(Path, sys.argv[1:])
commands = json.loads((projection / 'assignment.json').read_text())['commands']
predictions = json.loads((projection / 'predictions-frozen.json').read_text())['predictions']
matched = set(json.loads(matched_file.read_text())['matched_assignment_ids'])
assert len(commands) == len(predictions) == 300 and len(matched) == 220
assert {row['id'] for row in commands} == set(predictions) and matched <= set(predictions)
all_pairs, matched_pairs = [], []
for row in commands:
    case, task = row['id'], row['task_id']
    domain = tasks / row['domain']
    public = json.loads((domain / 'tasks' / f'task_{task}.json').read_text())
    label = json.loads((domain / 'groundtruth' / f'groundtruth_{task}.json').read_text())['ground truth']
    ranking = validate_ranking(predictions[case], public['candidate_list'])
    all_pairs.append((label, ranking))
    if case in matched:
        matched_pairs.append((label, ranking))
for pairs in (all_pairs, matched_pairs):
    labels, rankings = map(list, zip(*pairs))
    score = official_metrics(labels, rankings)
    print(len(pairs), score['top_5_hits'], score['top_5_hit_rate'])
PY
```

预期为 191/300 和 179/220。

## KuaiRand

完整历史准备入口输出逐题 `cases/` 和 `assignment.jsonl`。从原数据重建时，`--data` 指向含 `raw/`、`prepared-v2/`、已校验的官方文案 CSV 和文案清单的目录。执行 `python3 experiments/agentic-waterfall/unified/prepare_kuairand_full.py --data "$kr_data" --output "$scratch/full"`，再令下方 `full_source="$scratch/full"`。使用已有的完整历史归档时，可以直接执行窗口投影。

```sh
kr="$batch/core79d-reruns-20261109/kuairand-resume-20261110/projection"
full_source="$batch/public-data/kuairand"
python3 experiments/agentic-waterfall/unified/prepare_kuairand_window.py \
  --full-source "$full_source" --output "$scratch/kuairand"
jq -S 'del(.cases[].path)' "$kr/assignment.json" > "$scratch/expected-kuairand.json"
jq -S 'del(.cases[].path)' "$scratch/kuairand/assignment.json" > "$scratch/actual-kuairand.json"
diff -u "$scratch/expected-kuairand.json" "$scratch/actual-kuairand.json"

jq -c '.predictions[]' "$kr/predictions-frozen.json" > "$scratch/kuairand-predictions.jsonl"
python3 experiments/agentic-waterfall/kuairand/scripts/score.py \
  --tasks "$full_source/evaluator-only/private-tasks.jsonl" \
  --predictions "$scratch/kuairand-predictions.jsonl" --output "$scratch/kuairand-scores.json"
jq -e --slurpfile archived "$kr/metrics.json" \
  '.groups == $archived[0].methods.waterfall.groups and .per_task == $archived[0].methods.waterfall.per_task' \
  "$scratch/kuairand-scores.json"
```

路径可随归档移动。其余逐题清单字段应完全一致，包括全部 617 份输入的 SHA-256 与 101 个候选的顺序。30 题无效交付保留在分母并计零，预期 Hit@10 为 27.39%，NDCG@10 为 0.1597。

## KuaiRec

使用原 `eligibility.npz` 和 `evaluator_only/labels.npz`，以及包含 1,129 行的冻结投影。Python 环境需要 NumPy。

```sh
krec="$batch/core79d-reruns-20261109/kuairec-resume-20261110"
krec_data=/path/to/kuairec/data/processed
(cd "$krec_data" && printf '%s  %s\n' \
  8684deb1ce09916a615a57063656f37d06d87b073a1cc316f3bbdc27467ccbe6 eligibility.npz \
  b6ea0acd2fe3861b89523da238ea08038d49047f5e31700b3b58bd1e1edb239d evaluator_only/labels.npz \
  | shasum -a 256 -c -)
python3 experiments/agentic-waterfall/kuairec/scripts/evaluate.py \
  --data-root "$krec_data" --predictions "$krec/scoring-freeze/projections.jsonl" \
  --output "$scratch/kuairec-scores.json"
jq '{n_users, mean: (.mean | {precision_at_10, ndcg_at_10})}' "$scratch/kuairec-scores.json"
```

预期 P@10 为 9.30%，NDCG@10 为 0.1092。空榜计零。所有资格集合内的正例都参与理想排序的计算。

## TF-IDF 与 SimBench

按 [TF-IDF 基线说明](../../../../methods/agentic-waterfall/tfidf/README.md)下载并校验 `tfidf-benchmarks-20261110-v1.zip`。使用该说明中的 Python 环境运行 `reproduce.py`。脚本复算四个基准的 TF-IDF 榜单和分数，并从包里的其他四法冻结榜单、共同池标签复算 SimBench 五法得分。Waterfall 的五法共同池结果在 `simbench.waterfall-core79d`，预期 NDCG@20 为 0.7790。历史四法池与新旧 Waterfall 配对池各有自己的理想排序和分数。

## Waterfall Dataset

Download the score replay archive from the [Waterfall Dataset release](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset/releases/tag/waterfall-dataset-v1). Extract it and run the following commands.

```sh
cd waterfall-dataset-v1
python3 replay.py
```

The script recomputes the paper's shared-shortlist results from the saved rankings and judgments, including the number of complete lists and blind votes. The full dataset archive contains the 50 trajectories, visible inputs, catalogs, and evaluation records. The public benchmark download guide also lists the MIND score inputs available for replay.
