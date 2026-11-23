"""MIND comparison from frozen complete predictions."""
import collections
import hashlib
import io
import json
from pathlib import Path

import numpy as np

from scoring.cost_reporting import summarize_usage
from scoring.error_policy import operational_failure
from scoring.evaluate import scoring

KEYS = ["AUC", "MRR", "NDCG@5", "NDCG@10"]


def validate_predictions(inputs, methods):
    if not inputs or not methods:
        raise ValueError("no inputs or methods")
    ids = [x["observation"]["decision_id"] for x in inputs]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate input decision")
    for item in inputs:
        candidates = [news["id"] for news in item["observation"]["environment"]["candidate_pool"]]
        if not candidates or len(candidates) != len(set(candidates)):
            raise ValueError("invalid public candidate pool")
    fixed = {}
    for name, rows in methods.items():
        index = {row["decision_id"]: row for row in rows}
        if len(index) != len(rows) or set(index) != set(ids):
            raise ValueError(f"{name}: incomplete or duplicate decisions")
        if any(operational_failure(row) for row in rows):
            raise ValueError(f"{name}: operationally incomplete decisions")
        fixed[name] = index
    return fixed


def rank_lines(inputs, records, truth):
    truth_lines = []
    prediction = []
    invalid = []
    for item in inputs:
        observation = item["observation"]
        decision = observation["decision_id"]
        impression_id = decision.rsplit(":", 1)[-1]
        labels = truth[impression_id]
        candidates = [news["id"] for news in observation["environment"]["candidate_pool"]]
        if len(set(labels["ids"])) != len(labels["ids"]) or set(labels["ids"]) != set(candidates):
            raise ValueError("truth/public candidate mismatch")
        row = records[decision]
        rank = row.get("ordered_item_ids", [])
        valid = (
            row.get("status", "ok") in ("ok", "completed", "success", "submitted")
            and isinstance(rank, list)
            and len(rank) == len(candidates)
            and all(isinstance(value, str) for value in rank)
            and len(set(rank)) == len(rank)
            and set(rank) == set(candidates)
        )
        if valid:
            by_id = {value: position + 1 for position, value in enumerate(rank)}
            ranks = [by_id[news_id] for news_id in labels["ids"]]
        else:
            ranks = [1] * len(labels["ids"])
            invalid.append(decision)
        truth_lines.append(impression_id + " " + json.dumps(labels["labels"], separators=(",", ":")) + "\n")
        prediction.append(impression_id + " " + json.dumps(ranks, separators=(",", ":")) + "\n")
    return "".join(truth_lines), "".join(prediction), invalid


def load_truth(path, wanted):
    found = {}
    with Path(path).open() as stream:
        for line in stream:
            fields = line.rstrip("\n").split("\t")
            impression_id = fields[0]
            if impression_id not in wanted:
                continue
            if len(fields) < 5 or impression_id in found:
                raise ValueError("invalid truth row")
            parts = [token.rsplit("-", 1) for token in fields[-1].split()]
            if any(len(part) != 2 or part[1] not in ("0", "1") for part in parts):
                raise ValueError("invalid labels")
            found[impression_id] = {"ids": [part[0] for part in parts], "labels": [int(part[1]) for part in parts]}
    if set(found) != wanted:
        raise ValueError("missing truth")
    return found


def run(inputs_path, predictions, behaviors_path, output_path):
    inputs_path = Path(inputs_path)
    behaviors_path = Path(behaviors_path)
    output_path = Path(output_path)
    inputs = [json.loads(line) for line in inputs_path.read_text().splitlines() if line.strip()]
    methods = {}
    hashes = {}
    for name, path in predictions.items():
        if not name or name in methods:
            raise ValueError("invalid method name")
        data = Path(path).read_bytes()
        methods[name] = [json.loads(line) for line in data.splitlines() if line.strip()]
        hashes[name] = hashlib.sha256(data).hexdigest()
    fixed = validate_predictions(inputs, methods)
    output_path.mkdir(parents=True, exist_ok=False)
    receipt = {
        "input_sha256": hashlib.sha256(inputs_path.read_bytes()).hexdigest(),
        "prediction_sha256": hashes,
        "decisions": len(inputs),
        "labels_accessed": False,
    }
    (output_path / "frozen.json").write_text(json.dumps(receipt, indent=2) + "\n")
    wanted = {item["observation"]["decision_id"].rsplit(":", 1)[-1] for item in inputs}
    truth = load_truth(behaviors_path, wanted)
    per = {}
    summary = {}
    for name, records in fixed.items():
        truth_text, prediction_text, invalid = rank_lines(inputs, records, truth)
        per[name] = np.array([
            scoring(io.StringIO(truth_line), io.StringIO(prediction_line))
            for truth_line, prediction_line in zip(truth_text.splitlines(True), prediction_text.splitlines(True))
        ])
        scores = scoring(io.StringIO(truth_text), io.StringIO(prediction_text))
        summary[name] = {
            "metrics": dict(zip(KEYS, map(float, scores))),
            "invalid_count": len(invalid),
            "invalid_decisions": invalid,
            "resource_usage": summarize_usage(list(records.values())),
        }
    clusters = collections.defaultdict(list)
    for index, item in enumerate(inputs):
        clusters[item["observation"]["user_id"]].append(index)
    groups = list(clusters.values())
    rng = np.random.RandomState(20261029)
    samples = {name: [] for name in fixed}
    for _ in range(1000):
        chosen = np.concatenate([groups[index] for index in rng.randint(0, len(groups), len(groups))])
        for name in fixed:
            samples[name].append(np.mean(per[name][chosen], axis=0))
    for name in fixed:
        low, high = np.percentile(np.asarray(samples[name]), [2.5, 97.5], axis=0)
        summary[name]["user_cluster_bootstrap_95"] = dict(zip(KEYS, [[float(left), float(right)] for left, right in zip(low, high)]))
    first = next(iter(fixed))
    paired = {}
    for name in list(fixed)[1:]:
        difference = np.array(samples[first]) - np.array(samples[name])
        low, high = np.percentile(difference, [2.5, 97.5], axis=0)
        observed = np.mean(per[first], axis=0) - np.mean(per[name], axis=0)
        paired[f"{first}_minus_{name}"] = dict(zip(
            KEYS,
            [{"observed": float(value), "bootstrap_95": [float(left), float(right)]} for value, left, right in zip(observed, low, high)],
        ))
    result = {
        "decisions": len(inputs),
        "users": len(groups),
        "methods": summary,
        "paired": paired,
        "bootstrap_replicates": 1000,
        "seed": 20261029,
        "invalid_fallback": "all ranks 1",
        "labels_accessed_after_frozen_receipt": True,
        "comparison_model_call_cap": None,
        "resource_control": "operational safety caps are independent of comparison protocol",
    }
    (output_path / "metrics.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"decisions": len(inputs), "methods": list(methods), "output": str(output_path)}))
