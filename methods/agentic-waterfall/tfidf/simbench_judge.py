"""Run and score the original blind judge on the frozen five-method SimBench pool."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import fcntl
import importlib.util
import json
import math
import os
from pathlib import Path
from statistics import mean
import subprocess
from threading import Event

from benchmark_predict import checked_json as read, sha


MODEL = "DeepSeek-V4.1-Flash-1017"
OLD_RUN = "simbench-waterfall-core79d-full-20261109"
METHODS = {"waterfall-core79d", "generic-agent", "clawrec", "fixed-bm25-bge-reranker", "tfidf"}
RECOVERABLE = {"model_http_502", "model_http_503", "model_http_504", "model_timeout",
               "request_gate_call_deadline_exceeded", "request_gate_wait_exceeds_90s",
               "request_gate_wait_exceeds_300s", "credential_busy_other_available"}


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def verify_plan(run, batch):
    plan = read(run / "plan.json")
    assert plan["n"] == len(plan["cases"]) == len({row["case_id"] for row in plan["cases"]}) == 210
    assert set(plan["methods"]) == METHODS
    assert sha(run / "prediction-freeze.json") == plan["prediction_freeze_sha256"]
    original = batch / OLD_RUN / "paired-predictions-frozen.json"
    assert sha(original) == plan["paired_predictions_sha256"]
    acceptance = read(batch / OLD_RUN / "score-acceptance.json")
    assert acceptance["passed"] and acceptance["paired_prediction_freeze_sha256"] == sha(original)
    for row in plan["cases"]:
        assert Path(row["case_id"]).name == row["case_id"]
        blind = run / "evaluation" / row["case_id"] / "blind"
        assert sha(blind / "blind-judge-input.json") == row["blind_sha256"]
        assert sha(blind / "evaluator-mapping.json") == row["mapping_sha256"]
        assert row["batches"] == math.ceil(row["cards"] / 20)
    assert plan["cards"] == sum(row["cards"] for row in plan["cases"])
    assert plan["batches"] == sum(row["batches"] for row in plan["cases"])
    return plan


def judge(batch, run, plan, workers, limit):
    repo = batch.parents[2]
    original = batch / OLD_RUN
    gate = batch / "full-agentrecbench-20261103/request-gates"
    config = repo / "HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json"
    transport = batch / "core79d-reruns-20261109/register.mjs"
    entry = original / "judge.mjs"
    assert gate.is_dir() and config.is_file() and transport.is_file() and entry.is_file()
    stopped = Event()
    env = {key: value for key, value in os.environ.items() if key not in {
        "NODE_OPTIONS", "WATERFALL_APPROVED_QUOTA_PROBE", "WATERFALL_PROBE_CREDENTIAL_SLOT",
        "BASELINE_REPLAY_DIR", "BASELINE_REPLAY_ONLY", "KREC_REPLAY_PREFIX",
    }}
    env.update(WATERFALL_FORMAL_ROUTE="1", WATERFALL_MODEL_TIMEOUT_MS="180000",
               MODEL_CONFIG_FILE=str(config), WATERFALL_REQUEST_GATE_DIR=str(gate), OPENAI_MODEL=MODEL)
    rows = plan["cases"][:limit]

    def work(row):
        case = run / "evaluation" / row["case_id"]
        out = case / "judge"
        blind = case / "blind/blind-judge-input.json"
        for retry in range(4):
            if stopped.is_set() or (run / "STOP").exists() or (batch / "STOP").exists():
                return "held"
            if (out / "labels.json").exists():
                return "complete"
            with (case / "judge.log").open("ab") as log:
                result = subprocess.run(["node", "--import", str(transport), str(entry), str(blind), str(out)],
                                        cwd=repo, env=env, stdout=log, stderr=subprocess.STDOUT, check=False)
            if result.returncode == 0 and (out / "labels.json").is_file():
                return "complete"
            errors = [(path, read(path)) for path in out.glob("*-error.json")]
            if not errors:
                raise RuntimeError(f"judge exited {result.returncode}; check the format or subprocess log")
            terminal = []
            for _, error in errors:
                http = error.get("http_error") or {}
                transient = (error["error"] in RECOVERABLE or error.get("transport_retryable")
                             or (http.get("status") == 429 and http.get("retryable") is True))
                if not transient:
                    terminal.append(error["error"])
            if terminal:
                if set(terminal) & {"approved_routes_budget_exhausted", "approved_routes_unavailable",
                                    "model_calls_not_enabled", "global_request_budget_exhausted",
                                    "experiment_request_budget_exhausted", "model_http_401", "model_http_403"}:
                    stopped.set()
                raise RuntimeError(f"judge admission or response failure: {', '.join(terminal)}")
            if retry == 3:
                raise RuntimeError("judge transport remained unavailable after three isolated retries")
            archived = out / "transport-holds" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
            archived.mkdir(parents=True)
            for path, _ in errors:
                path.rename(archived / path.name)
        raise AssertionError("invalid retry state")

    outcomes = {}
    progress = run / "judging-progress.json"
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(work, row): row["case_id"] for row in rows}
        for job in as_completed(jobs):
            name = jobs[job]
            try:
                outcomes[name] = job.result()
            except Exception as error:
                outcomes[name] = str(error)
                print(name, outcomes[name], flush=True)
            complete = sum(value == "complete" for value in outcomes.values())
            save(progress, dict(pid=os.getpid(), planned=len(rows), finished=len(outcomes), complete=complete,
                                pending={k: v for k, v in outcomes.items() if v != "complete"}))
            if len(outcomes) % 10 == 0 or len(outcomes) == len(rows):
                print(f"judging {complete}/{len(rows)} events", flush=True)
    if complete != len(rows):
        raise RuntimeError(f"judging incomplete at {complete}/{len(rows)}; saved valid batches are reusable")


def score(batch, run, plan):
    source = batch / "simbench-three-methods-20261103/code-v5/experiments/agentic-waterfall/clawrec/adapters/shared_pool_metrics.py"
    spec = importlib.util.spec_from_file_location("shared_pool_metrics", source)
    scorer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scorer)
    ndcg = {method: [] for method in plan["methods"]}
    hits = {method: [] for method in ndcg}
    deliveries = {method: 0 for method in ndcg}
    receipts = set()
    usage = dict(prompt_tokens=0, completion_tokens=0, total_tokens=0)
    output_rows = []
    for row in plan["cases"]:
        folder = run / "evaluation" / row["case_id"]
        blind = read(folder / "blind/blind-judge-input.json", row["blind_sha256"])
        mapping = read(folder / "blind/evaluator-mapping.json", row["mapping_sha256"])
        by_card = read(folder / "judge/labels.json")
        labels = {}
        assert len(blind["cards"]) == row["cards"]
        for index in range(row["batches"]):
            prefix = folder / "judge" / f"{index + 1:02d}"
            response = read(prefix.with_name(prefix.name + "-response.json"))
            request = read(prefix.with_name(prefix.name + "-request.json"))
            assert response["status"] == "success" and response["finish_reason"] != "length"
            assert response["provider_response_model"] == response["requested_model"] == MODEL
            assert response["attempt_id"] not in receipts
            receipts.add(response["attempt_id"])
            for key in usage:
                usage[key] += response["usage"][key]
            payload = json.loads(request["messages"][1]["content"])
            cards = blind["cards"][index * 20:(index + 1) * 20]
            assert payload["cards"] == [{**card, "rank": i} for i, card in enumerate(cards, 1)]
            assert payload["k"] == len(cards)
            assert all(payload[key] == blind[key] for key in ("evaluation_id", "heldout_step", "visible_evidence"))
            votes = json.loads(response["content"])["card_relevance"]
            assert len(votes) == len(cards)
            for vote in votes:
                card, rank, rel = vote["card_id"], vote["rank"], vote["rel"]
                assert type(rank) is int and 1 <= rank <= len(cards) and cards[rank - 1]["card_id"] == card
                assert type(rel) is int and 1 <= rel <= 5 and card not in labels
                labels[card] = rel
        assert labels == by_card and labels.keys() == mapping["card_id_to_item_id"].keys()
        labels = {mapping["card_id_to_item_id"][card]: rel for card, rel in labels.items()}
        rankings = mapping["rankings"]
        assert set(rankings) == METHODS and labels.keys() == set().union(*(set(ids) for ids in rankings.values()))
        result = scorer.score_pool(rankings, labels, 20)
        ideal = sum((2 ** rel - 1) / math.log2(i + 2)
                    for i, rel in enumerate(sorted(labels.values(), reverse=True)[:20]))
        for method, ids in rankings.items():
            expected_dcg = sum((2 ** labels[item] - 1) / math.log2(i + 2) for i, item in enumerate(ids))
            item = result["scores"][method]
            assert math.isclose(item["ndcg_shared_at_k"], expected_dcg / ideal, abs_tol=1e-12)
            assert item["hit_at_k"] == int(any(labels[i] >= 3 for i in ids))
            ndcg[method].append(item["ndcg_shared_at_k"])
            hits[method].append(item["hit_at_k"])
            deliveries[method] += bool(ids)
        output_rows.append(dict(case_id=row["case_id"], scores=result["scores"],
                                judge_labels_sha256=sha(folder / "judge/labels.json")))
    assert len(receipts) == plan["batches"] and len(output_rows) == 210 and deliveries["tfidf"] == 210
    metrics = {method: {"n": 210, "NDCG@20": mean(ndcg[method]), "Hit@20": mean(hits[method]),
                        "delivering_events": deliveries[method]} for method in ndcg}
    destination = run / "metrics.json"
    with destination.open("x", encoding="utf-8") as file:
        json.dump(dict(plan_sha256=sha(run / "plan.json"), scorer_sha256=sha(source), judge_model=MODEL,
                       cards=plan["cards"], judged_batches=len(receipts), accepted_usage=usage,
                       scores=metrics, cases=output_rows), file, ensure_ascii=False, indent=2)
        file.write("\n")
    print(json.dumps(metrics, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("check", "judge", "score"))
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=48)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    assert __debug__ and 1 <= args.workers <= 48
    batch, run = args.batch.resolve(), args.run.resolve()
    plan = verify_plan(run, batch)
    if args.phase == "check":
        print(json.dumps({key: plan[key] for key in ("n", "cards", "batches", "methods")}))
        return
    with (run / "judging.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.phase == "score":
            score(batch, run, plan)
        else:
            assert args.limit is None or 1 <= args.limit <= plan["n"]
            judge(batch, run, plan, args.workers, args.limit)


if __name__ == "__main__":
    main()
