"""Score the frozen TF-IDF predictions with the original benchmark evaluators."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
from statistics import mean
import sys

import numpy as np

from benchmark_predict import checked_json, sha


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def score_agentrecbench(batch, plan, predictions):
    current = checked_json(batch / "agentrecbench-waterfall-core79d-full-20261109/assignment.json")
    assert {row["id"]: row["public_task"] for row in plan["rows"]} == {
        row["id"]: row["public_task"] for row in current["commands"]
    }
    official = batch / "full-agentrecbench-20261103/frozen/code/experiments/agentic-waterfall/agentrecbench/scripts/official_components.py"
    evaluator = load_module("official_components", official).load_components().RecommendationEvaluator()
    published = batch / "agentrecbench-waterfall-core79d-full-20261109/continuation-20261109/projection"
    existing_scores = checked_json(published / "metrics.json")
    existing_orders = checked_json(published / "predictions-frozen.json", existing_scores["predictions_sha256"])["predictions"]
    matched = set(checked_json(batch / "scoring/agentrecbench-matched220-metrics.json")["matched_assignment_ids"])
    domains = ("amazon", "goodreads", "yelp")
    groups = {domain: [] for domain in (*domains, "all", "matched220")}
    for row, prediction in zip(plan["rows"], predictions, strict=True):
        assert row["id"] == prediction["case_id"] and row["candidate_ids"] == prediction["candidate_ids"]
        truth_path = Path(row["public_task"]).parents[1] / "groundtruth" / f"groundtruth_{row['task_id']}.json"
        label = checked_json(truth_path)["ground truth"]
        assert label in row["candidate_ids"]
        order = prediction["ordered_item_ids"]
        example = (label, order, prediction["candidate_ids"], prediction["query_parts"] == 0,
                   existing_orders[row["id"]])
        groups[row["domain"]].append(example)
        groups["all"].append(example)
        if row["id"] in matched:
            groups["matched220"].append(example)
    assert {name: len(group) for name, group in groups.items()} == {
        **dict.fromkeys(domains, 100), "all": 300, "matched220": 220
    }
    scores = {}
    for name, group in groups.items():
        labels, orders, original, empty, reference = zip(*group)
        key = "all" if name == "matched220" else name
        archived = existing_scores["matched_220_metrics" if name == "matched220" else "metrics"]
        assert sum(label in order[:5] for label, order in zip(labels, reference)) == archived[key]["top_5_hits"]
        result = evaluator.calculate_hr_at_n(list(labels), list(orders), 0)
        hits = sum(label in order[:5] for label, order in zip(labels, orders))
        assert result.top_5_hits == hits and result.top_5_hit_rate == hits / len(group)
        scores[name] = dict(n=len(group), hits_at_5=hits, hit_at_5=hits / len(group),
                            empty_query=sum(empty),
                            hits_from_empty_query=sum(no_text and label in order[:5]
                                                      for no_text, label, order in zip(empty, labels, orders)),
                            original_order_hits=sum(label in order[:5] for label, order in zip(labels, original)))
    return scores


def score_kuairand(batch, plan, predictions):
    pinned = batch / "frozen/v4/code/experiments/agentic-waterfall"
    sys.path.insert(0, str(pinned / "unified"))
    from score_formal import kuairand_truth

    protocol = load_module("kuairand_protocol", pinned / "kuairand/scripts/protocol.py")
    manifest = checked_json(batch / "public-data/kuairand/manifest.json")
    truth_path = batch / "public-data/kuairand/evaluator-only/private-tasks.jsonl"
    assert sha(truth_path) == manifest["evaluator_sha256"]
    assert [row["task_id"] for row in plan["cases"]] == [row["case_id"] for row in predictions] == manifest["task_ids"]
    visible = [{"observation": {"decision_id": row["case_id"],
                                "environment": {"candidate_ids": row["candidate_ids"]}}}
               for row in predictions]
    truth = kuairand_truth(truth_path, visible, "test")
    by_id = {row["case_id"]: row for row in predictions}
    scores = protocol.evaluate(truth, by_id)["groups"]
    assert scores["all"]["n"] == 617 and scores["all"]["invalid"] == 0
    ranks = [by_id[row["task_id"]]["ordered_item_ids"].index(f"kuairand:{row['target']}") + 1
             for row in truth]
    hits = sum(rank <= 10 for rank in ranks)
    assert math.isclose(hits / 617, scores["all"]["Hit@10"], abs_tol=1e-12)
    assert math.isclose(mean(1 / math.log2(rank + 1) if rank <= 10 else 0 for rank in ranks),
                        scores["all"]["NDCG@10"], abs_tol=1e-12)
    scores["all"]["hits_at_10"] = hits
    return scores


def score_kuairec(batch, plan, predictions):
    evaluator = load_module("kuairec_evaluate",
                            batch / "frozen/v4/code/experiments/agentic-waterfall/kuairec/scripts/evaluate.py")
    original = checked_json(batch / "core79d-reruns-20261109/kuairec-resume-20261110/scored/metrics.json")
    truth = original["truth_files_sha256"]
    by_name = {Path(path).name: path for path in truth}
    assert all(sha(path) == digest for path, digest in truth.items())
    eligible = checked_json(plan["eligibility"], plan["eligibility_sha256"])
    users = [row["case_id"] for row in predictions]
    assert users == [row["user_id"] for row in plan["cases"]]
    stats = []
    with np.load(by_name["eligibility.npz"], allow_pickle=False) as mask, np.load(
            by_name["labels.npz"], allow_pickle=False) as labels:
        assert np.array_equal(mask["users"], labels["users"]) and np.array_equal(mask["items"], labels["items"])
        positions = {str(user): pos for pos, user in enumerate(mask["users"])}
        assert len(users) == 1129 and set(users) == eligible.keys() and set(users) <= positions.keys()
        items, observed, relevant = mask["items"], mask["observed"], labels["relevant"]
        for row in predictions:
            user = row["case_id"]
            i = positions[user]
            observed_ids = set(map(str, items[observed[i]]))
            assert set(eligible[user]) == observed_ids
            positives = set(map(str, items[relevant[i]]))
            ranked, acquired = row["ordered_item_ids"], row["acquired_item_ids"]
            result = evaluator.score_user(ranked, acquired, observed_ids, positives, True)
            hits = sum(item in positives for item in ranked)
            dcg = sum(1 / math.log2(pos + 2) for pos, item in enumerate(ranked) if item in positives)
            idcg = sum(1 / math.log2(pos + 2) for pos in range(min(10, len(positives))))
            assert math.isclose(result["precision_at_10"], hits / 10, abs_tol=1e-12)
            assert ((result["ndcg_at_10"] is None) if not idcg else
                    math.isclose(result["ndcg_at_10"], dcg / idcg, abs_tol=1e-12))
            stats.append(result)
    metrics = {key: [row[key] for row in stats if row[key] is not None]
               for key in ("precision_at_10", "ndcg_at_10", "recall_at_10", "acquired_recall_at_100")}
    return dict(n=len(users), mean={key: mean(values) if values else None for key, values in metrics.items()},
                denominators={key: len(values) for key, values in metrics.items()},
                truth_files_sha256=truth, statuses=dict(Counter(row["status"] for row in predictions)))


def score_simbench(batch, plan, predictions):
    original = batch / "simbench-waterfall-core79d-full-20261109"
    adapter = batch / "simbench-three-methods-20261103/code-v5/experiments/agentic-waterfall/clawrec/adapters"
    scorer = load_module("shared_pool_metrics", adapter / "shared_pool_metrics.py")
    acceptance = checked_json(original / "score-acceptance.json")
    assert acceptance["passed"] and acceptance["assigned_events"] == 210
    assert sha(original / "metrics.json") == acceptance["metrics_sha256"]
    missing = {}
    returned = 0
    complete = 0
    scores = []
    for row, prediction in zip(plan["cases"], predictions, strict=True):
        case = row["case_id"]
        assert prediction["case_id"] == case
        directory = original / "evaluation" / case
        hashes = checked_json(directory / "metrics.json")
        cards = checked_json(directory / "blind/blind-judge-input.json", hashes["pool_sha256"])["cards"]
        mapping = checked_json(directory / "blind/evaluator-mapping.json")
        card_digest = hashlib.sha256(json.dumps(cards, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        assert mapping["pool_sha256"] == card_digest
        card_labels = checked_json(directory / "judge/labels.json", hashes["labels_sha256"])
        assert card_labels.keys() == mapping["card_id_to_item_id"].keys() == {card["card_id"] for card in cards}
        labels = {mapping["card_id_to_item_id"][card]: grade for card, grade in card_labels.items()}
        order = prediction["ordered_item_ids"]
        returned += len(order)
        unknown = [item for item in order if item not in labels]
        if unknown:
            missing[case] = unknown
            continue
        complete += 1
        rankings = {key: value for key, value in mapping["rankings"].items() if key != "waterfall"}
        score = scorer.score_pool({**rankings, "tfidf": order}, labels, mapping["k"])
        scores.append(score["scores"]["tfidf"]["ndcg_shared_at_k"])
    unjudged = sum(map(len, missing.values()))
    return dict(n=210, returned_items=returned, judged_items=returned - unjudged,
                unjudged_items=unjudged, fully_judged_events=complete, unjudged_items_by_event=missing,
                ndcg_at_20=mean(scores) if not missing else None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--frozen", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert __debug__
    freeze_path = args.frozen / "prediction-freeze.json"
    freeze_hash = sha(freeze_path)
    freeze = checked_json(freeze_path, freeze_hash)
    assert freeze["limit"] is None and freeze["labels_read"] is False and freeze["model_api_calls"] == 0
    assert all(sha(path) == digest for path, digest in freeze["sources_sha256"].items())
    scorers = dict(agentrecbench=score_agentrecbench, kuairand=score_kuairand,
                   kuairec=score_kuairec, simbench=score_simbench)
    assert freeze["datasets"].keys() == scorers.keys()
    plans, predictions = {}, {}
    for name, receipt in freeze["datasets"].items():
        plans[name] = checked_json(receipt["input"], receipt["input_sha256"])
        path = args.frozen / f"{name}.jsonl"
        assert sha(path) == receipt["predictions_sha256"]
        rows = [json.loads(line) for line in path.read_bytes().splitlines()]
        assert len(rows) == len({row["case_id"] for row in rows}) == receipt["n"]
        predictions[name] = rows
    metrics = {name: score(args.batch, plans[name], predictions[name]) for name, score in scorers.items()}
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(dict(method="tfidf", model_api_calls=0, prediction_freeze_sha256=freeze_hash,
                       scoring_script_sha256=sha(__file__), **metrics), stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
