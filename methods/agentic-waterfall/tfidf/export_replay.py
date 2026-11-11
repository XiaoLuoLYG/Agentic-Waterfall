"""Prepare a text-free replay bundle from the original TF-IDF experiment archive."""
import argparse
from collections import Counter
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

import benchmark_predict as native
from benchmark_predict import checked_json as read, sha
from reproduce import DATASETS, digest, json_bytes
import simbench_cumulative as simbench


def rows(path):
    with path.open(encoding="utf-8") as stream:
        return [json.loads(line) for line in stream]


def write(path, value):
    with path.open("xb") as stream:
        stream.write(json_bytes(value))


def pack_terms(documents, queries):
    analyzer = TfidfVectorizer().build_analyzer()
    doc_counts = [Counter(analyzer(document)) for document in documents]
    terms = sorted(set().union(*(counts.keys() for counts in doc_counts)))
    ids = {term: f"t{i:08x}" for i, term in enumerate(terms)}

    def encode(counts):
        # Preserve first encounters for the vectorizer's sparse traversal order.
        return " ".join(ids[term] for term, count in counts.items() if term in ids for _ in range(count))

    return [encode(counts) for counts in doc_counts], [
        None if query is None else encode(Counter(analyzer(query))) for query in queries
    ]


class Projection:
    def __init__(self):
        self.documents = {}
        self.corpora = {}
        self.cases = []
        self.private_map = []
        self.predictions = []

    def capture(self, case_id, history, text_by_id, **options):
        item_ids = list(text_by_id)
        docs = tuple(self.documents.setdefault(text, len(self.documents)) for text in text_by_id.values())
        corpus = self.corpora.setdefault(docs, len(self.corpora))
        indices = {item: i for i, item in enumerate(item_ids)}
        case = dict(corpus=corpus, query=" ".join(history) if history else None)
        if options.get("candidates") is not None:
            case["candidates"] = [indices[item] for item in options["candidates"]]
        self.cases.append(case)
        self.private_map.append([case_id, item_ids])
        result = native_ranked(case_id, history, text_by_id, **options)
        self.predictions.append([
            [indices[item] for item in result["ordered_item_ids"]],
            [indices[item] for item in result.get("acquired_item_ids", [])],
            result["nonzero_candidates"],
        ])
        return result

    def export(self, expected):
        assert len(expected) == len(self.cases)
        for (case, item_ids), frozen, prediction in zip(self.private_map, expected, self.predictions, strict=True):
            assert case == frozen["case_id"]
            assert [item_ids[i] for i in prediction[0]] == frozen["ordered_item_ids"]
            assert [item_ids[i] for i in prediction[1]] == frozen.get("acquired_item_ids", [])
            assert prediction[2] == frozen["nonzero_candidates"]
        docs, queries = pack_terms(self.documents, (case["query"] for case in self.cases))
        for case, query in zip(self.cases, queries, strict=True):
            case["query"] = query
        return dict(documents=docs, corpora=list(self.corpora), cases=self.cases)


native_ranked = native.ranked


def export_inputs(batch, run, staging):
    base = run / "frozen"
    cumulative = run / "simbench-cumulative"
    frozen = read(base / "prediction-freeze.json")
    sim_frozen = read(cumulative / "prediction-freeze.json")
    assert frozen["labels_read"] is sim_frozen["labels_read"] is False
    simbench.check_files(frozen["sources_sha256"])
    simbench.check_files(sim_frozen["source_sha256"])
    staging.mkdir(mode=0o700)
    inputs, maps, rank_hashes, originals = {}, {}, {}, {}
    for dataset in DATASETS:
        projection = Projection()
        if dataset == "simbench":
            sim = batch / "simbench-three-methods-20261103"
            with TemporaryDirectory() as temp, patch.object(simbench, "ranked", projection.capture):
                output = Path(temp) / "prediction"
                simbench.predict(batch, output, sim, sim / "code-v5/methods/agentic-waterfall/simbench",
                                 batch / "simbench-waterfall-core79d-full-20261109")
                assert sha(output / "predictions.jsonl") == sim_frozen["predictions_sha256"]
            expected = cumulative / "predictions.jsonl"
            expected_hash = sim_frozen["predictions_sha256"]
        else:
            receipt = frozen["datasets"][dataset]
            plan = read(receipt["input"], receipt["input_sha256"])
            with patch.object(native, "ranked", projection.capture):
                list(getattr(native, dataset)(plan, None))
            expected = base / f"{dataset}.jsonl"
            expected_hash = receipt["predictions_sha256"]
        assert sha(expected) == expected_hash
        inputs[dataset] = projection.export(rows(expected))
        maps[dataset] = projection.private_map
        rank_hashes[dataset] = digest(json_bytes(projection.predictions))
        originals[dataset] = expected_hash
        print(f"{dataset}: captured {len(projection.cases)} frozen inputs", flush=True)
    write(staging / "inputs.json", inputs)
    write(staging / "private-index.json", maps)
    write(staging / "prediction-hashes.json", dict(ranking_sha256=rank_hashes,
                                                   original_predictions_sha256=originals))


def evaluator_inputs(batch, run, maps, metrics, sim_metrics):
    frozen = read(run / "frozen/prediction-freeze.json")
    assert sha(run / "frozen/prediction-freeze.json") == metrics["prediction_freeze_sha256"]
    plan = frozen["datasets"]["agentrecbench"]
    assigned = read(plan["input"], plan["input_sha256"])["rows"]
    matched = set(read(batch / "scoring/agentrecbench-matched220-metrics.json")["matched_assignment_ids"])
    agentrecbench = []
    for (case_id, items), assignment in zip(maps["agentrecbench"], assigned, strict=True):
        assert case_id == assignment["id"] and items == assignment["candidate_ids"]
        path = Path(assignment["public_task"]).parents[1] / "groundtruth" / f"groundtruth_{assignment['task_id']}.json"
        agentrecbench.append(dict(target=items.index(read(path)["ground truth"]), domain=assignment["domain"],
                                  matched=case_id in matched))

    private = batch / "public-data/kuairand/evaluator-only/private-tasks.jsonl"
    assert sha(private) == read(batch / "public-data/kuairand/manifest.json")["evaluator_sha256"]
    truth = {row["task_id"]: row for row in rows(private)}
    kuairand = []
    for case, items in maps["kuairand"]:
        target = truth[case]
        assert items == [f"kuairand:{item}" for item in target["candidate_ids"]]
        kuairand.append(items.index(f"kuairand:{target['target']}"))

    truth_files = metrics["kuairec"]["truth_files_sha256"]
    simbench.check_files(truth_files)
    label_path = next(path for path in truth_files if Path(path).name == "labels.npz")
    kuairec = []
    with np.load(label_path, allow_pickle=False) as label:
        users = {str(user): i for i, user in enumerate(label["users"])}
        items, relevant = label["items"], label["relevant"]
        for case, catalog in maps["kuairec"]:
            indices = {item: i for i, item in enumerate(catalog)}
            kuairec.append(sorted(indices[str(item)] for item in items[relevant[users[case]]]))

    sim_run = run / "simbench-cumulative"
    assert sim_metrics["plan_sha256"] == sha(sim_run / "plan.json")
    plan = read(sim_run / "plan.json")
    sim_scores = []
    for (case, catalog), planned, scored in zip(maps["simbench"], plan["cases"], sim_metrics["cases"], strict=True):
        assert case == planned["case_id"] == scored["case_id"]
        folder = sim_run / "evaluation" / case
        mapping = read(folder / "blind/evaluator-mapping.json", planned["mapping_sha256"])
        labels = read(folder / "judge/labels.json", scored["judge_labels_sha256"])
        assert labels.keys() == mapping["card_id_to_item_id"].keys()
        indices = {item: i for i, item in enumerate(catalog)}
        sim_scores.append(dict(labels=sorted([indices[item], labels[card]]
                                              for card, item in mapping["card_id_to_item_id"].items()),
                               peer_rankings={name: [indices[item] for item in ranking]
                                              for name, ranking in mapping["rankings"].items() if name != "tfidf"}))
    return dict(agentrecbench=agentrecbench, kuairand=kuairand, kuairec=kuairec, simbench=sim_scores)


def pack(batch, run, staging, output):
    inputs = (staging / "inputs.json").read_bytes()
    metrics_path = run / "metrics.json"
    sim_path = run / "simbench-cumulative/metrics.json"
    metrics, sim_metrics = read(metrics_path), read(sim_path)
    maps = read(staging / "private-index.json")
    scoring = json_bytes(evaluator_inputs(batch, run, maps, metrics, sim_metrics))
    expected = {
        "agentrecbench": {group: {k: row[k] for k in ("n", "hits_at_5", "hit_at_5")}
                          for group, row in metrics["agentrecbench"].items()},
        "kuairand": {k: metrics["kuairand"]["all"][k] for k in ("n", "Hit@10", "NDCG@10")},
        "kuairec": dict(n=metrics["kuairec"]["n"], mean={
            k: metrics["kuairec"]["mean"][k] for k in ("precision_at_10", "ndcg_at_10")
        }),
        "simbench": sim_metrics["scores"],
    }
    manifest = dict(format=1, files={"inputs.json": digest(inputs), "scoring.json": digest(scoring)},
                    **read(staging / "prediction-hashes.json"), published_metrics=expected,
                    original_metrics_sha256={"three_benchmarks": sha(metrics_path), "simbench": sha(sim_path)})
    with ZipFile(output, "x", compression=ZIP_DEFLATED, compresslevel=9) as bundle:
        bundle.writestr("inputs.json", inputs)
        bundle.writestr("scoring.json", scoring)
        bundle.writestr("manifest.json", json_bytes(manifest))
    print(f"{sha(output)}  {output.name}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("inputs", "pack"))
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--staging", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    assert __debug__
    batch = args.batch.resolve()
    run = batch / "tfidf-20261110"
    if args.phase == "inputs":
        export_inputs(batch, run, args.staging)
    elif args.output is None:
        parser.error("pack requires --output")
    else:
        pack(batch, run, args.staging, args.output)


if __name__ == "__main__":
    main()
