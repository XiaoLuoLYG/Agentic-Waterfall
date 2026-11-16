# Reproduce the results

The Waterfall Dataset release has the 50 simulated trajectories, 300 checkpoints, two content pools, and the model judgments. Use the score replay archive to recalculate the shared-shortlist table in the paper or the independent-recall comparison. Both use the saved rankings and judgments. [Waterfall Dataset downloads](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset)

The dataset repo has the paper's benchmark and ablation tables and the download links for AgentRecBench, KuaiRand-1K, KuaiRec, ClawRec-SimBench, and MIND-small. Its score pack gives the cases and outputs available for offline reproduction. [Public benchmark setup](https://github.com/XiaoLuoLYG/agentic-waterfall-dataset/blob/main/dataset/docs/public-benchmarks.md)

## Evaluation code

| Run | Code |
| --- | --- |
| Public benchmarks | [Input builders, runners, and scorers](../experiments/agentic-waterfall/README.md) |
| Waterfall Dataset independent recall | [Runner and frozen protocol](research/agentic-waterfall/synthetic-independent-recall/README.md) |
| RecAgent on MIND-small | [Adapter, runner, and local dependencies](../methods/agentic-waterfall/recagent/README.md) |
| Ablation input checks | [Shared runtime tests](../experiments/agentic-waterfall/unified/runtime.test.mjs) |

For research runs, the core and its SHA-256 live together in `demos/agentic-feed-site/lib/waterfall/`. The independent-recall runner copies that core into each run directory. It uses the included historical adapters and pinned retrieval dependencies. Running a new model sweep requires your own model configuration and the listed data and weights.

```sh
node examples/run-core.mjs
node --test experiments/agentic-waterfall/unified/runtime.test.mjs
```

## Run a new Waterfall Dataset comparison

Extract `waterfall-dataset-v1-full.zip` from the dataset release. Check it before setting up a model:

```sh
node experiments/agentic-waterfall/synthetic-collection/run-dataset.mjs \
  --dataset /path/to/waterfall-dataset-v1-full --check
```

This verifies all 300 checkpoints and both catalogs without calling a model. The package keeps the original content IDs. Its expansion manifest records the three content hashes that changed when share-link parameters were removed.

For inference, install the Python dependencies and pinned author code from the repository root. Use Python 3.11 or 3.12:

```sh
python3.11 -m venv methods/agentic-waterfall/fixed-retrieval/.venv
methods/agentic-waterfall/fixed-retrieval/.venv/bin/pip install \
  -r methods/agentic-waterfall/fixed-retrieval/requirements.txt
python3.11 -m venv experiments/agentic-waterfall/agentrecbench/.venv
experiments/agentic-waterfall/agentrecbench/.venv/bin/pip install tiktoken==0.12.0
python3 methods/agentic-waterfall/agentrecbench-data/fetch_official.py
python3 methods/agentic-waterfall/i2agent/fetch_author.py
frozen=output/agentic-waterfall/comparison-20261106-synthetic-10x20-all-methods-v4/author-methods
mkdir -p "$frozen/i2agent/source-snapshot"
cp methods/agentic-waterfall/i2agent/source-snapshot/model.py "$frozen/i2agent/source-snapshot/model.py"
TIKTOKEN_CACHE_DIR="$PWD/methods/agentic-waterfall/recagent/cache" \
  experiments/agentic-waterfall/agentrecbench/.venv/bin/python -c \
  "import tiktoken; tiktoken.get_encoding('cl100k_base')"
```

Download the two pinned [BGE model versions](../methods/agentic-waterfall/fixed-retrieval/README.md#模型与数据). Put each model's config, tokenizer files, and weights under `methods/agentic-waterfall/fixed-retrieval/weights/MODEL_NAME/`. BGE-M3 uses `pytorch_model.bin`; the reranker uses `model.safetensors`. The two weight files total about 4.5 GB. Link that directory into the frozen adapters:

```sh
ln -s "$PWD/methods/agentic-waterfall/fixed-retrieval/weights" "$frozen/fixed-retrieval/weights"
```

The runner verifies the pinned weight hashes at their new location. BGE uses MPS when available and otherwise CPU; a full CPU run can be slow.

The paper runner uses `DeepSeek-V4.1-Flash-1017` through `https://api.jiuwenappless.com/v1`. Save your own `apiKey` and `apiBase` in a private JSON file outside Git. Starting the following command makes paid model requests for 1,500 method slots and their judgments:

```sh
node experiments/agentic-waterfall/synthetic-collection/run-dataset.mjs \
  --dataset /path/to/waterfall-dataset-v1-full \
  --out /path/to/new-run --config /path/to/private-model.json \
  --protocol independent-recall
```

Use `--protocol shared-shortlist` for the paper's shared-candidate protocol. Output directories must be new. Each run saves its input hashes, method outputs, API receipts, judgments, and `comparison/analysis.json`. The older `run-main-comparison.mjs` remains the entry for continuing an archived run with its existing ledgers.
