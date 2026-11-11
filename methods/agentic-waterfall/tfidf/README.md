# TF-IDF baseline

The ranker uses scikit-learn's default unigram TF-IDF and cosine similarity between the available history and candidate text. Ties keep the input order.

## Reproduce the results table

From the repository root, authenticate GitHub CLI with read access to the private repository. The verified run used Python 3.13.9.

```sh
tfidf_dir=methods/agentic-waterfall/tfidf
replay_dir=$(mktemp -d)
python3.13 -m venv "$replay_dir/venv"
. "$replay_dir/venv/bin/activate"
python -m pip install -r "$tfidf_dir/requirements-replay.txt"
gh release download tfidf-benchmarks-20261110-v1 \
  --repo XiaoLuoLYG/waterfall-anything \
  --pattern tfidf-benchmarks-20261110-v1.zip --dir "$replay_dir"
bundle="$replay_dir/tfidf-benchmarks-20261110-v1.zip"
printf '%s  %s\n' 63b36aeefe9706f496b5b113300612335518823e8e624eeb6842275ec615ac3c "$bundle" \
  | shasum -a 256 -c && \
  python "$tfidf_dir/reproduce.py" "$bundle" --output "$replay_dir/tfidf-reproduced-metrics.json"
```

The release provides both the replay ZIP and the verified metrics JSON. [Frozen inputs and scoring artifacts](https://github.com/XiaoLuoLYG/waterfall-anything/releases/tag/tfidf-benchmarks-20261110-v1)

The ZIP contains three files.

- `inputs.json` has the frozen unigram counts encoded as opaque terms, the candidate order and eligibility, and the available history after each dataset adapter. Item positions refer to the corresponding corpus.
- `scoring.json` has evaluator-only targets and relevance values. SimBench includes the four peer methods' frozen top-20 rankings so all five methods use the same ideal ranking.
- `manifest.json` binds both inputs by SHA-256 and records the original run hashes, expected per-dataset ranking hashes, and published metrics.

The replay fits TF-IDF on the archived term counts, checks all four ranking hashes, then reads the scoring data and checks the metrics to within `1e-12`. It runs offline without a model API or the original workspace.

| Dataset | Frozen evaluation | TF-IDF |
| --- | --- | --- |
| AgentRecBench | Short-term tasks, 300 total and 220 common cases. Original 20 candidates per task. | Hit@5 37.33% (112/300), common set 42.73% (94/220) |
| KuaiRand | 617 test tasks, latest 512 visible events, 101 fixed candidates per task. | Hit@10 10.53%, NDCG@10 0.0522 |
| KuaiRec | 1,129 users with per-user eligibility, up to 100 acquired items and 10 returned. | P@10 4.84%, NDCG@10 0.0500 |
| ClawRec-SimBench | 210 events from 42 users, cumulative public history, original source and publication-time filters. | Shared-pool NDCG@20 0.5040 |

AgentRecBench domain Hit@5 is 48/100 for Amazon, 42/100 for Goodreads, and 22/100 for Yelp. Fixed-candidate cases with an empty query keep the original order. This accounts for 17 hits across 72 empty-query AgentRecBench cases. The default analyzer treats uninterrupted Chinese text as a single term. KuaiRec's empty result stays in the denominator.

SimBench reuses 42 first-event TF-IDF rankings and reranks the remaining 168 with cumulative visible history. The five-method union contains 12,507 event–item pairs, judged in 743 accepted batches with DeepSeek-V4.1-Flash-1017. The replay uses those archived judgments.

## Original experiment inputs

The release captures the exact projections and judgments used in the table. The original benchmarks and video metadata are available from their maintainers. [AgentRecBench](https://huggingface.co/datasets/SGJQovo/AgentRecBench) · [KuaiRand-1K](https://kuairand.com/) · [KuaiRec](https://kuairec.com/) · [ClawRec-SimBench](https://github.com/RUCAIBox/ClawRec/tree/6eeb309c47430f91280e9845a98fb56a68dc0d90/clawrec-simbench)

For maintainers with the original experiment archive, `BATCH` is `output/agentic-waterfall/contract-repair-20261103` in that workspace. The archived manifests contain the original absolute paths and content hashes.

| Input or output | Path under `BATCH` |
| --- | --- |
| AgentRecBench assignments | `fixed-agentrecbench-20261106/assignment.json` |
| KuaiRand assignments | `kuairand-waterfall-core79d-full-20261109/assignment.json` |
| KuaiRec assignments, index, and eligibility references | `baseline-fidelity/fixed-full-plan.json` |
| SimBench visible cases and catalog | `simbench-three-methods-20261103/public-preflight/manifest.json`, `simbench-three-methods-20261103/snapshot/` |
| TF-IDF rankings and three-benchmark scores | `tfidf-20261110/frozen/`, `tfidf-20261110/metrics.json` |
| Final SimBench rankings, labels, and metrics | `tfidf-20261110/simbench-cumulative/` |

`benchmark_predict.py` runs the original dataset adapters. `benchmark_score.py` evaluates the first three benchmarks and reports label coverage for the initial SimBench run. `simbench_cumulative.py` freezes the final rankings and builds the five-method pool. `simbench_judge.py` runs the original judge and scores the completed pool. `export_replay.py inputs` reads the frozen public inputs, and `export_replay.py pack` joins the sealed projection with evaluator data to produce the release ZIP. The intermediate item-ID map stays in the staging directory.

## MIND-small

MIND fits IDF on unlabeled train and dev news text. Supply a fresh prediction path and prepare the public impressions with `experiments/agentic-waterfall/unified/prepare_mind_full.py`.

```sh
python methods/agentic-waterfall/tfidf/tfidf_predict.py \
  --inputs "$MIND_PUBLIC_INPUTS" \
  --train-news "$MIND_DATA/MINDsmall_train/news.tsv" \
  --dev-news "$MIND_DATA/MINDsmall_dev/news.tsv" \
  --output "$NEW_PREDICTIONS"
```

Use `--limit 8` for a smoke run. The news path flags default to `experiments/agentic-waterfall/mind/data`.
