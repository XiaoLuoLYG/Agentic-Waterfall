"""Freeze cumulative-history TF-IDF, then build the official five-method SimBench pools."""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

import numpy
import sklearn

from benchmark_predict import checked_json, ranked, sha, text_parts


METHODS = ("clawrec", "generic-agent", "fixed-bm25-bge-reranker", "waterfall-core79d")


def write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2))


def check_files(hashes):
    for path, expected in hashes.items():
        assert sha(path) == expected, path


def read_predictions(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def predict(batch, output, sim, support, current):
    sys.path.insert(0, str(support))
    from case_input import load_case
    from catalog import published_ms

    old_path = batch / "tfidf-20261110/frozen/prediction-freeze.json"
    old_freeze = checked_json(old_path)
    check_files(old_freeze["sources_sha256"])
    old = old_freeze["datasets"]["simbench"]
    old_predictions = old_path.with_name("simbench.jsonl")
    assert sha(old_predictions) == old["predictions_sha256"]
    original = {row["case_id"]: row for row in read_predictions(old_predictions)}
    public_plan = Path(old["input"])
    plan = checked_json(public_plan, old["input_sha256"])
    assert plan["cases"] == [row for group in checked_json(current / "plan.json")["groups"] for row in group]
    assert len(plan["cases"]) == len(original) == old["n"] == 210
    assert set(original) == {row["case_id"] for row in plan["cases"]}
    manifest = sim / "snapshot/manifest.json"
    meta = checked_json(manifest)
    catalog = sim / "snapshot/catalog.jsonl"
    snapshot_sha256 = sha(catalog)
    assert snapshot_sha256 == meta["catalog_sha256"] == plan["snapshot_sha256"]
    docs = sorted(read_predictions(catalog), key=lambda item: item["id"])
    assert len({item["id"] for item in docs}) == len(docs) == meta["count"] == 1109
    dated = [(item, published_ms(item.get("published_at"))) for item in docs]
    parts = {}
    progress = {}
    predictions = []
    changed = 0
    cutoff_regressions = 0
    for entry in plan["cases"]:
        folder = Path(entry["input"])
        assert set(entry["input_hashes"]) == {"manifest.json", "allowed_sources.json", "evidence.visible.jsonl"}
        check_files({folder / name: digest for name, digest in entry["input_hashes"].items()})
        case = load_case(folder)
        assert all(case[key] == entry[key] for key in ("case_id", "user_id", "event"))
        uid, event, cutoff = (case[key] for key in ("user_id", "event", "as_of_ms"))
        previous_event, previous_cutoff = progress.get(uid, (0, 0))
        # SimBench releases history by event position; source timestamps can move backward.
        assert event == previous_event + 1, case["case_id"]
        cutoff_regressions += cutoff < previous_cutoff
        progress[uid] = (event, cutoff)
        history = parts.setdefault(uid, {})
        for part in text_parts(row.get(key) for row in case["evidence"] for key in ("title", "normalized_query")):
            history[part] = None
        sources = sorted(set(case["allowed_sources"]) & set(meta["sources"]))
        assert sources == entry["active_sources"]
        eligible = {item["id"]: item["title"] + "\n" + item["text"] for item, published in dated
                    if item["source"] in sources and published is not None and published <= cutoff}
        prediction = ranked(case["case_id"], history, eligible, top=20, acquire=100)
        acquired = prediction["acquired_item_ids"]
        assert prediction["eligible_items"] == len(eligible)
        assert len(acquired) == len(set(acquired)) == min(100, len(eligible))
        assert set(acquired) <= eligible.keys()
        assert len(prediction["ordered_item_ids"]) == 20 and prediction["ordered_item_ids"] == acquired[:20]
        old_prediction = original[case["case_id"]]
        if event == 1:
            assert prediction == old_prediction, case["case_id"]
            prediction = old_prediction
        else:
            assert prediction["query_parts"] > old_prediction["query_parts"], case["case_id"]
            changed += prediction["ordered_item_ids"] != old_prediction["ordered_item_ids"]
        predictions.append({**prediction, "user_id": uid, "event": event, "as_of_ms": cutoff,
                            "active_sources": sources, "snapshot_sha256": snapshot_sha256})

    assert len(progress) == 42 and {event for event, _ in progress.values()} == {5}
    assert Counter(row["event"] for row in predictions) == dict.fromkeys(range(1, 6), 42)
    output.mkdir(mode=0o700)
    path = output / "predictions.jsonl"
    with path.open("x", encoding="utf-8") as stream:
        for row in predictions:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")
    sources = (Path(__file__).resolve(), Path(__file__).with_name("benchmark_predict.py").resolve(),
               Path(__file__).with_name("tfidf_predict.py").resolve(), support / "case_input.py",
               support / "runtime_input.py", support / "catalog.py", public_plan, current / "plan.json",
               catalog, manifest, old_path, old_predictions)
    receipt = dict(n=len(predictions), device="CPU", model_api_calls=0, labels_read=False,
                   sklearn=sklearn.__version__, numpy=numpy.__version__, first_event_reused=42,
                   later_events_reranked=168, top20_changed=changed, cutoff_regressions=cutoff_regressions,
                   snapshot_sha256=snapshot_sha256,
                   predictions_sha256=sha(path), source_sha256={str(file): sha(file) for file in sources})
    write(output / "prediction-freeze.json", receipt)
    print(json.dumps({key: receipt[key] for key in ("n", "first_event_reused", "later_events_reranked",
                                                    "top20_changed", "predictions_sha256")}), flush=True)


def prepare(output, sim, support, current):
    scripts = sim / "code-v5/experiments/agentic-waterfall/clawrec/scripts"
    sys.path[:0] = [str(support), str(scripts)]
    from prepare_evaluation import prepare as prepare_evaluation
    from build_blind_pool import build

    assert not (output / "plan.json").exists() and not (output / "evaluation").exists()
    frozen = output / "prediction-freeze.json"
    receipt = checked_json(frozen)
    assert receipt["n"] == 210 and receipt["labels_read"] is False
    check_files(receipt["source_sha256"])
    predictions = output / "predictions.jsonl"
    assert sha(predictions) == receipt["predictions_sha256"]
    tfidf = read_predictions(predictions)
    assert len({row["case_id"] for row in tfidf}) == len(tfidf) == receipt["n"]
    accepted = checked_json(current / "score-acceptance.json")
    assert accepted["passed"] and accepted["paired_scoring_complete"] and accepted["assigned_events"] == len(tfidf)
    paired_path = current / "paired-predictions-frozen.json"
    paired = checked_json(paired_path, accepted["paired_prediction_freeze_sha256"])
    assert set(paired) == {row["case_id"] for row in tfidf}
    original_metrics = checked_json(current / "metrics.json", accepted["metrics_sha256"])
    assert set(original_metrics["new_four_way_from_paired_judgments"]) == set(METHODS)
    docs = {item["id"]: item for item in read_predictions(sim / "snapshot/catalog.jsonl")}
    plan = checked_json(sim / "public-preflight/manifest.json")
    cases = []
    missing_current = 0
    with TemporaryDirectory(prefix=".prepare-", dir=output) as temp:
        staging = Path(temp) / "evaluation"
        for entry, prediction in zip(plan["cases"], tfidf, strict=True):
            case_id = entry["case_id"]
            assert case_id == prediction["case_id"]
            expected = paired[case_id]
            reference = current / "evaluation" / case_id
            comparison_freeze = checked_json(reference / "frozen/freeze.json")
            assert comparison_freeze["case_id"] == case_id
            assert comparison_freeze["snapshot_sha256"] == receipt["snapshot_sha256"]
            assert comparison_freeze["runs"] == {
                method: {key: value for key, value in files.items() if key != "path"}
                for method, files in expected.items()
            }
            official_ranks = checked_json(reference / "frozen/rankings.json",
                                          comparison_freeze["files"]["rankings.json"])
            runs = []
            for method in METHODS:
                files = expected[method]
                folder = Path(files["path"])
                source = checked_json(folder / "input.json", files["input_sha256"])
                result = checked_json(folder / "result.json", files["result_sha256"])
                assert source["method"] == result["method"] == method
                assert result["ordered_item_ids"] == official_ranks[method]
                runs.append((source, result))
            tfidf_input = {key: prediction[key] for key in ("case_id", "user_id", "event", "snapshot_sha256",
                                                           "as_of_ms", "active_sources", "method")}
            tfidf_result = {**tfidf_input, "status": prediction["status"],
                            "ordered_item_ids": prediction["ordered_item_ids"],
                            "acquired_ids": prediction["acquired_item_ids"]}
            rankings, catalog = prepare_evaluation([*runs, (tfidf_input, tfidf_result)], docs)
            assert rankings == {**{method: official_ranks[method] for method in METHODS},
                                "tfidf": prediction["ordered_item_ids"]}
            folder = Path(entry["input"])
            payload, mapping = build(folder.parents[2], folder.parent.parent.name, entry["event"], rankings, catalog)
            ref_metrics = checked_json(reference / "metrics.json")
            prior = checked_json(reference / "blind/blind-judge-input.json", ref_metrics["pool_sha256"])
            assert {key: value for key, value in payload.items() if key != "cards"} == {
                key: value for key, value in prior.items() if key != "cards"
            }, case_id
            old_mapping = checked_json(reference / "blind/evaluator-mapping.json")
            assert old_mapping["rankings"] == official_ranks
            missing_current += len(set(rankings["tfidf"]) - set(old_mapping["card_id_to_item_id"].values()))
            card_count = len(payload["cards"])
            assert card_count == len(catalog) == len(mapping["card_id_to_item_id"])
            assert set(mapping["card_id_to_item_id"].values()) == set().union(*map(set, rankings.values()))
            assert payload["evaluation_id"] == case_id and mapping["k"] == 20 and mapping["seed"] == 42
            blind = staging / case_id / "blind"
            blind.mkdir(parents=True)
            payload_path = blind / "blind-judge-input.json"
            mapping_path = blind / "evaluator-mapping.json"
            write(payload_path, payload)
            write(mapping_path, mapping)
            cases.append(dict(case_id=case_id, cards=card_count, batches=(card_count + 19) // 20,
                              blind_sha256=sha(payload_path), mapping_sha256=sha(mapping_path)))
        staging.rename(output / "evaluation")
    sources = (scripts / "build_blind_pool.py", scripts.parent / "adapters/simbench.py",
               scripts.parent / "adapters/shared_pool_metrics.py", support / "prepare_evaluation.py",
               current / "score-acceptance.json", current / "metrics.json")
    prepared = dict(n=len(cases), cards=sum(row["cards"] for row in cases),
                    batches=sum(row["batches"] for row in cases), methods=[*METHODS, "tfidf"],
                    model="DeepSeek-V4.1-Flash-1017", prediction_freeze_sha256=sha(frozen),
                    paired_predictions_sha256=sha(paired_path), tfidf_cards_unjudged_in_prior_pool=missing_current,
                    source_sha256={str(path): sha(path) for path in sources}, cases=cases)
    write(output / "plan.json", prepared)
    print(json.dumps({key: prepared[key] for key in ("n", "cards", "batches", "tfidf_cards_unjudged_in_prior_pool")}),
          flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("predict", "prepare"))
    parser.add_argument("--batch", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert __debug__
    batch, output = args.batch.resolve(), args.output.resolve()
    sim = batch / "simbench-three-methods-20261103"
    support = sim / "code-v5/methods/agentic-waterfall/simbench"
    current = batch / "simbench-waterfall-core79d-full-20261109"
    if args.phase == "predict":
        predict(batch, output, sim, support, current)
    else:
        prepare(output, sim, support, current)


if __name__ == "__main__":
    main()
