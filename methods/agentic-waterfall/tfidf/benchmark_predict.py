"""Run the PR's TF-IDF scorer on the four frozen public benchmark assignments."""
import argparse
from collections import Counter
import hashlib
from itertools import islice
import json
from pathlib import Path
import sys
from time import monotonic

import numpy
import sklearn

from tfidf_predict import fit_catalog, rank_candidates


def checked_json(path, expected=None):
    data = Path(path).read_bytes()
    if expected is not None and hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"frozen input changed: {path}")
    return json.loads(data)


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def text_parts(values):
    return [text.strip() for text in values if isinstance(text, str) and text.strip()]


def ranked(case_id, history, text_by_id, *, index=None, candidates=None, top=None, acquire=None):
    candidates = list(text_by_id) if candidates is None else candidates
    if len(candidates) != len(set(candidates)):
        raise ValueError(f"duplicate candidate: {case_id}")
    order, nonzero = [], 0
    if acquire is None or history:
        order, nonzero = rank_candidates(index or fit_catalog(text_by_id), history, candidates)
    result = dict(case_id=case_id, method="tfidf", status="submitted" if order else "no_delivery",
                  ordered_item_ids=order[:top], eligible_items=len(candidates), query_parts=len(history),
                  nonzero_candidates=nonzero)
    if acquire is not None:
        result["acquired_item_ids"] = order[:acquire]
    else:
        result["candidate_ids"] = candidates
    return result


def agentrecbench(plan, limit):
    for row in islice(plan["rows"], limit):
        obs = checked_json(row["input"], row["input_sha256"])["observation"]
        task = checked_json(row["public_task"], row["public_sha256"])
        pool = obs["environment"]["candidate_pool"]
        assert [item["id"] for item in pool] == row["candidate_ids"] == task["candidate_list"]
        assert len(pool) == 20
        history = []
        for event in obs["behavior_events"]:
            item = event["payload"].get("item") or {}
            review = event["payload"].get("review") or {}
            history.extend(text_parts((item.get("title") or item.get("name"), review.get("text"))))
        yield ranked(row["id"], history, {item["id"]: item["text"] for item in pool})


def kuairand(plan, limit):
    for row in islice(plan["cases"], limit):
        obs = checked_json(row["path"], row["sha256"])["observation"]
        assert obs["decision_id"] == row["task_id"] and not obs["dialogue"]
        events = obs["behavior_events"]
        assert len(events) == row["retained_history_count"] <= 512
        # These frozen UTC timestamps use the same ISO format.
        assert all(event["available_at"] <= obs["observed_at"] for event in events)
        history = []
        for event in events:
            payload = event["payload"]
            if payload["long_view"] == 1:
                history.extend(text_parts((payload.get("caption_excerpt"), payload.get("content_metadata"))))
        pool = obs["environment"]["candidate_pool"]
        assert len(pool) == len({item["id"] for item in pool}) == 101
        catalog = {item["id"]: "\n".join(text_parts((item["title"], item["text"]))) for item in pool}
        yield ranked(row["task_id"], history, catalog)


def kuairec(plan, limit):
    index = checked_json(Path(plan["index"]) / "index.json", plan["index_sha256"]["index.json"])
    catalog = {item["id"]: item["text"] for item in index["catalog"]}
    assert len(catalog) == len(index["catalog"]) == 3327
    eligible = checked_json(plan["eligibility"], plan["eligibility_sha256"])
    assert set(eligible) == {row["user_id"] for row in plan["cases"]}
    corpus = fit_catalog(catalog)
    for row in islice(plan["cases"], limit):
        obs = checked_json(row["input"], row["input_sha256"])["observation"]
        user = row["user_id"]
        assert obs["user_id"] == user
        events = obs["behavior_events"]
        history = text_parts(event["payload"]["item_text"] for event in events
                             if event["payload"].get("watch_ratio", 0) > 2)
        seen = {str(event["item_id"]) for event in events}
        allowed = set(eligible[user]) - seen
        assert len(eligible[user]) == len(set(eligible[user])) and allowed <= catalog.keys()
        candidates = [item_id for item_id in catalog if item_id in allowed]
        yield ranked(user, history, catalog, index=corpus, candidates=candidates, top=10, acquire=100)


def simbench(plan, snapshot, support, limit):
    sys.path.insert(0, str(support))
    from case_input import load_case
    from catalog import published_ms

    meta = checked_json(snapshot / "manifest.json")
    raw = (snapshot / "catalog.jsonl").read_bytes()
    assert hashlib.sha256(raw).hexdigest() == meta["catalog_sha256"] == plan["snapshot_sha256"]
    documents = sorted((json.loads(line) for line in raw.splitlines()), key=lambda item: item["id"])
    assert len({item["id"] for item in documents}) == len(documents) == meta["count"]
    dated = [(item, published_ms(item.get("published_at"))) for item in documents]
    for row in islice(plan["cases"], limit):
        folder = Path(row["input"])
        for name, digest in row["input_hashes"].items():
            assert sha(folder / name) == digest
        case = load_case(folder)
        assert all(case[key] == row[key] for key in ("case_id", "user_id", "event"))
        sources = set(case["allowed_sources"]) & set(meta["sources"])
        assert sources == set(row["active_sources"])
        public_text = {item["id"]: item["title"] + "\n" + item["text"] for item, published in dated
                       if item["source"] in sources and published is not None and published <= case["as_of_ms"]}
        history = list(dict.fromkeys(text_parts(event.get(key) for event in case["evidence"]
                                                for key in ("title", "normalized_query"))))
        yield ranked(case["case_id"], history, public_text, top=20, acquire=100)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=Path, required=True, help="frozen experiment root")
    parser.add_argument("--output", type=Path, required=True, help="new prediction directory")
    parser.add_argument("--limit", type=int, help="smoke cases per benchmark")
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    assert __debug__
    batch = args.batch.resolve()
    sim = batch / "simbench-three-methods-20261103"
    support = sim / "code-v5/methods/agentic-waterfall/simbench"
    snapshot = sim / "snapshot"
    paths = {
        "agentrecbench": batch / "fixed-agentrecbench-20261106/assignment.json",
        "kuairand": batch / "kuairand-waterfall-core79d-full-20261109/assignment.json",
        "kuairec": batch / "baseline-fidelity/fixed-full-plan.json",
        "simbench": sim / "public-preflight/manifest.json",
    }
    inputs = {name: sha(path) for name, path in paths.items()}
    plans = {name: checked_json(path, inputs[name]) for name, path in paths.items()}
    sim_current = checked_json(batch / "simbench-waterfall-core79d-full-20261109/plan.json")
    assert [row for group in sim_current["groups"] for row in group] == plans["simbench"]["cases"]
    assert plans["kuairand"]["history_policy"] == "recent-512-visible-events-v1"
    assert Counter(row["domain"] for row in plans["agentrecbench"]["rows"]) == dict.fromkeys(
        ("amazon", "goodreads", "yelp"), 100)
    generators = {
        "agentrecbench": agentrecbench(plans["agentrecbench"], args.limit),
        "kuairand": kuairand(plans["kuairand"], args.limit),
        "kuairec": kuairec(plans["kuairec"], args.limit),
        "simbench": simbench(plans["simbench"], snapshot, support, args.limit),
    }
    sizes = {"agentrecbench": 300, "kuairand": 617, "kuairec": 1129, "simbench": 210}
    sources = [Path(__file__), Path(__file__).with_name("tfidf_predict.py"),
               *(support / name for name in ("catalog.py", "case_input.py", "runtime_input.py"))]
    args.output.mkdir()
    receipt = dict(method="tfidf", device="CPU", model_api_calls=0, labels_read=False,
                   sklearn=sklearn.__version__, numpy=numpy.__version__, limit=args.limit,
                   sources_sha256={str(path): sha(path) for path in sources}, datasets={})
    for name, records in generators.items():
        start = monotonic()
        rows = list(records)
        assert len(rows) == len({row["case_id"] for row in rows}) == min(args.limit or sizes[name], sizes[name])
        for row in rows:
            order = row["ordered_item_ids"]
            assert len(order) == len(set(order))
            if "candidate_ids" in row:
                assert set(order) == set(row["candidate_ids"])
            else:
                k = 10 if name == "kuairec" else 20
                acquired = row["acquired_item_ids"]
                assert order == acquired[:k]
                assert len(acquired) == len(set(acquired))
                assert len(acquired) == (min(100, row["eligible_items"]) if row["query_parts"] else 0)
        prediction = args.output / f"{name}.jsonl"
        with prediction.open("x", encoding="utf-8") as stream:
            for row in rows:
                stream.write(json.dumps(row, ensure_ascii=False) + "\n")
        summary = dict(n=len(rows), statuses=dict(Counter(row["status"] for row in rows)),
                       empty_query=sum(row["query_parts"] == 0 for row in rows),
                       zero_similarity=sum(row["nonzero_candidates"] == 0 for row in rows),
                       elapsed_seconds=round(monotonic() - start, 3), input=str(paths[name]),
                       input_sha256=inputs[name], predictions_sha256=sha(prediction))
        receipt["datasets"][name] = summary
        print(name, json.dumps(summary), flush=True)
    with (args.output / "prediction-freeze.json").open("x") as stream:
        json.dump(receipt, stream, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
