"""Score a frozen, complete RecAgent MIND-small queue with the official MIND scorer."""
import argparse
from collections import Counter
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import sqlite3

import numpy as np

OPERATIONAL = {
    "budget_exhausted", "model_calls_not_enabled", "model_slots_busy",
    "model_timeout", "model_transport_error", "runner_failure", "api_ledger_unavailable",
    "api_capacity_wait_exceeded", "No verified flash API slot",
}


def digest(path):
    checksum = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def load(path):
    return json.loads(path.read_text())


def save(path, value):
    with path.open("x") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


def is_operational(row):
    error = row.get("error", "")
    return error in OPERATIONAL or error.startswith(("model_http_", "request_gate_"))


def score(run, output, behaviors, official_path):
    plan = load(run / "plan.json")
    frozen = load(run / "frozen-predictions.json")
    progress = load(run / "progress.json")
    retry_dir = run / "final-retry-20261114"
    assignment_path = retry_dir / "targeted-retry.json"
    assignment = load(assignment_path)
    launches = [load(path) for path in retry_dir.glob("*launch.json")]
    previous = retry_dir / "predictions-before.jsonl"
    predicted = run / "predictions.jsonl"
    source = Path(plan["source"])
    source_manifest = load(source.with_suffix(".manifest.json"))
    assert progress["phase"] in ("complete", "review_required") and not progress["error"]
    assert not (run / "runner.lock").exists()
    assert not (run / "run.sqlite-wal").exists()
    assert frozen["final_retry_done"] == frozen["final_retry_total"] == assignment["count"]
    assert frozen["final_retry_pending"] == frozen["final_retry_running"] == 0
    targets = {row["decision_id"]: row["request_sha256"] for row in assignment["cases"]}
    assert len(targets) == assignment["count"]
    assignment_sha = digest(assignment_path)
    assert launches and all(item["request_assignment_sha256"] == assignment_sha for item in launches)
    assert frozen["labels_read"] is False
    assert frozen["input_sha256"] == plan["source_sha256"] == digest(source)
    assert frozen["predictions_sha256"] == digest(predicted)
    assert assignment["prior_predictions_sha256"] == digest(previous)
    assert source_manifest["source_behaviors_sha256"] == digest(behaviors)

    runs = [load(path) for path in (run / "gateway").glob("*/api/stats.json")]
    assert runs and all(row["closed_at"] and not row["pending"] and not row["in_flight"] and not row["waiting"] for row in runs)
    retry_pids = {item["pid"] for item in launches}
    retry_gateways = [row for row in runs if row["pid"] in retry_pids]
    assert progress["pid"] in retry_pids
    assert {row["pid"] for row in retry_gateways} == retry_pids
    operation = Counter()
    failure = Counter()
    attempts_status = Counter()
    wanted = {}
    retained = sha256()

    with sqlite3.connect((run / "run.sqlite").as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        assert not db.execute("select 1 from attempts where finished_at is null or turn>4 limit 1").fetchone()
        original_hashes = dict(db.execute(
            "select i.decision_id,a.request_sha256 from impressions i join attempts a on i.id=a.id and a.turn=1"
        ))
        final = list(db.execute(
            "select i.decision_id,a.request_sha256,a.result from impressions i join attempts a on i.id=a.id and a.turn=4"
        ))
        assert len(final) == len(targets)
        for decision, key, text in final:
            assert key == original_hashes[decision] == targets[decision]
            attempts_status[json.loads(text)["status"]] += 1
        records = db.execute("select decision_id,offset,bytes,state,prediction from impressions order by id")
        with source.open("rb") as inputs, predicted.open("rb") as after, previous.open("rb") as before:
            for decision, offset, size, state, expected in records:
                raw = after.readline()
                prior = before.readline()
                prediction, old = json.loads(raw), json.loads(prior)
                assert raw.decode().rstrip("\n") == expected
                assert prediction["decision_id"] == old["decision_id"] == decision
                if decision not in targets:
                    assert old["status"] == "submitted" and raw == prior
                    retained.update(raw)
                else:
                    assert old["status"] == "failed" and prediction["attempt"] == 4
                inputs.seek(offset)
                observation = json.loads(inputs.read(size))["observation"]
                assert observation["decision_id"] == decision
                assert len(observation["behavior_events"]) >= 2
                article_ids = [item["id"] for item in observation["environment"]["candidate_pool"]]
                assert article_ids and len(article_ids) == len(set(article_ids))
                ranking = prediction.get("ordered_item_ids")
                if state == "submitted":
                    assert prediction["status"] == "submitted"
                    assert isinstance(ranking, list) and len(ranking) == len(article_ids) and set(ranking) == set(article_ids)
                else:
                    assert state == "exhausted" and prediction["status"] == "failed"
                    if is_operational(prediction):
                        operation[prediction["error"]] += 1
                    reason = (prediction.get("transport_error") or {}).get("detail") or {}
                    failure[reason.get("finish_reason") or prediction["error"]] += 1
                impression = decision.rsplit(":", 1)[-1]
                assert impression not in wanted
                wanted[impression] = (observation["user_id"], set(article_ids), ranking)
            assert not after.read(1) and not before.read(1)
    assert not operation, dict(operation)
    total = len(wanted)
    valid = sum(ranking is not None for _, _, ranking in wanted.values())
    assert total == plan["eligible"] and valid == progress["submitted"] == frozen["submitted"]
    assert valid == assignment["preserved_rankings"] + attempts_status["submitted"]
    assert sum(failure.values()) == total - valid

    output.mkdir(mode=0o700)
    save(output / "scoring-input-freeze.json", {
        "input_sha256": frozen["input_sha256"], "predictions_sha256": frozen["predictions_sha256"],
        "behaviors_sha256": source_manifest["source_behaviors_sha256"], "decisions": total,
    })

    # Reuse the existing official-compatible convention for exhausted model responses.
    seen = set()
    cases = {"all": 0, "valid": 0}
    with (output / "truth.txt").open("x") as truth, (output / "prediction.txt").open("x") as full, \
            (output / "truth-valid.txt").open("x") as truth_valid, (output / "prediction-valid.txt").open("x") as full_valid, \
            behaviors.open() as data:
        for line in data:
            impression, user, _, history, exposures = line.rstrip("\n").split("\t")
            if impression not in wanted:
                continue
            saved_user, candidate_ids, ranking = wanted[impression]
            assert user == saved_user and len(history.split()) >= 2 and impression not in seen
            seen.add(impression)
            pairs = [token.rsplit("-", 1) for token in exposures.split()]
            ids, flags = zip(*pairs)
            assert len(ids) == len(candidate_ids) and set(ids) == candidate_ids
            assert set(flags) == {"0", "1"}
            positions = {item: rank for rank, item in enumerate(ranking, 1)} if ranking is not None else {}
            actual = [int(flag) for flag in flags]
            ordered = [positions[item] for item in ids] if positions else [1] * len(ids)
            expected_line = impression + " " + json.dumps(actual, separators=(",", ":")) + "\n"
            predicted_line = impression + " " + json.dumps(ordered, separators=(",", ":")) + "\n"
            truth.write(expected_line)
            full.write(predicted_line)
            cases["all"] += 1
            if positions:
                truth_valid.write(expected_line)
                full_valid.write(predicted_line)
                cases["valid"] += 1
    assert cases == {"all": total, "valid": valid}

    spec = importlib.util.spec_from_file_location("official_mind", official_path)
    official = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(official)
    keys = ("AUC", "MRR", "NDCG@5", "NDCG@10")
    metrics = {}
    for label, suffix in (("all", ""), ("valid", "-valid")):
        with (output / f"truth{suffix}.txt").open() as truth, (output / f"prediction{suffix}.txt").open() as ranked:
            values = official.scoring(truth, ranked)
        assert np.all(np.isfinite(values)) and np.all((0 <= np.asarray(values)) & (np.asarray(values) <= 1))
        metrics[label] = dict(zip(keys, map(float, values)))
    final_errors = dict(sorted(failure.items()))
    result = {
        "method": "RecAgent (MIND adaptation, direct ranking)", "model": plan["model"],
        "dataset": "MINDsmall_dev", "cohort": plan["cohort"], "decisions": total, "users": len({u for u, _, _ in wanted.values()}),
        "valid_rankings": valid, "coverage": valid / total, "unresolved": total - valid,
        "final_retry": {"assigned": len(final), "passed": attempts_status["submitted"], "remaining": attempts_status["failed"]},
        "terminal_model_failures": final_errors, "operational_failures": dict(operation),
        "failure_policy": "all ranks tied at 1 (same as the existing official-compatible MIND scorer)",
        "metrics": metrics["all"], "valid_only_metrics": metrics["valid"],
        "zero_failure_contribution_sensitivity": {k: v * valid / total for k, v in metrics["valid"].items()},
        "predictions_sha256": frozen["predictions_sha256"], "official_scorer_sha256": digest(official_path),
        "preserved_rankings_in_source_order_sha256": retained.hexdigest(),
        "http_attempts_all_launches": sum(row["attempts"] for row in runs),
        "final_retry_http_attempts": sum(row["attempts"] for row in retry_gateways),
        "final_retry_http_successes": sum(row["successes"] for row in retry_gateways),
        "labels_accessed_after_frozen_receipt": True,
    }
    save(output / "metrics.json", result)
    print(json.dumps(result, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ("run", "output", "behaviors", "official"):
        parser.add_argument("--" + option, type=Path, required=True)
    args = parser.parse_args()
    score(args.run.resolve(), args.output.resolve(), args.behaviors.resolve(), args.official.resolve())


if __name__ == "__main__":
    main()
