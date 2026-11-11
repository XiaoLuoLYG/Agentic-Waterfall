"""Recompute the published TF-IDF rankings and scores from the frozen release."""
import argparse
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
from statistics import mean
from zipfile import ZipFile

from benchmark_predict import ranked
from benchmark_score import load_module
from tfidf_predict import fit_catalog

DATASETS = {"agentrecbench": 300, "kuairand": 617, "kuairec": 1129, "simbench": 210}
EXPERIMENTS = Path(__file__).resolve().parents[3] / "experiments/agentic-waterfall"


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def replay_rankings(dataset, frozen):
    documents = frozen["documents"]
    cases = frozen["cases"]
    assert len(cases) == DATASETS[dataset]
    top = {"kuairec": 10, "simbench": 20}.get(dataset)

    @lru_cache(maxsize=1)
    def catalog(corpus):
        positions = frozen["corpora"][corpus]
        assert all(type(i) is int and 0 <= i < len(documents) for i in positions)
        text = {i: documents[doc] for i, doc in enumerate(positions)}
        return text, fit_catalog(text)

    result = []
    for i, case in enumerate(cases):
        text, index = catalog(case["corpus"])
        query = case["query"]
        candidates = case.get("candidates")
        assert query is None or isinstance(query, str)
        assert candidates is None or set(candidates) <= text.keys()
        prediction = ranked(i, [] if query is None else [query], text, index=index,
                            candidates=candidates, top=top, acquire=100 if top else None)
        result.append([prediction["ordered_item_ids"], prediction.get("acquired_item_ids", []),
                       prediction["nonzero_candidates"]])
    return result


def summarize(rankings, inputs, scoring):
    for dataset, n in DATASETS.items():
        assert len(scoring[dataset]) == len(rankings[dataset]) == n
    agentrecbench = {}
    for group in ("amazon", "goodreads", "yelp", "all", "matched220"):
        hits = [
            truth["target"] in ordered[:5]
            for (ordered, _, _), truth in zip(rankings["agentrecbench"], scoring["agentrecbench"], strict=True)
            if group == "all" or group == truth["domain"] or (group == "matched220" and truth["matched"])
        ]
        agentrecbench[group] = dict(n=len(hits), hits_at_5=sum(hits), hit_at_5=mean(hits))

    kr_metrics = load_module("replay_kuairand", EXPERIMENTS / "kuairand/scripts/protocol.py").metrics
    rows = [kr_metrics(target, ordered) for (ordered, _, _), target
            in zip(rankings["kuairand"], scoring["kuairand"], strict=True)]
    kuairand = {"n": len(rows), "Hit@10": mean(row["Hit@10"] for row in rows),
                "NDCG@10": mean(row["NDCG@10"] for row in rows)}

    score_user = load_module("replay_kuairec", EXPERIMENTS / "kuairec/scripts/evaluate.py").score_user
    rows = [score_user(ordered, acquired, case["candidates"], positives)
            for (ordered, acquired, _), case, positives
            in zip(rankings["kuairec"], inputs["kuairec"]["cases"], scoring["kuairec"], strict=True)]
    kuairec = dict(n=len(rows), mean={
        key: mean(row[key] for row in rows if row[key] is not None)
        for key in ("precision_at_10", "ndcg_at_10")
    })

    score_pool = load_module("replay_simbench",
                             EXPERIMENTS / "clawrec/adapters/shared_pool_metrics.py").score_pool
    by_method = {}
    card_count = 0
    for (ordered, _, _), truth in zip(rankings["simbench"], scoring["simbench"], strict=True):
        ranks = {name: list(map(str, ids)) for name, ids in {**truth["peer_rankings"], "tfidf": ordered}.items()}
        labels = {str(item): value for item, value in truth["labels"]}
        assert labels.keys() == set().union(*map(set, ranks.values()))
        card_count += len(labels)
        for method, row in score_pool(ranks, labels)["scores"].items():
            by_method.setdefault(method, []).append(row)
    assert card_count == 12507
    simbench = {method: {"n": len(rows), "NDCG@20": mean(row["ndcg_shared_at_k"] for row in rows),
                        "Hit@20": mean(row["hit_at_k"] for row in rows),
                        "delivering_events": sum(row["returned_count"] > 0 for row in rows)}
                for method, rows in by_method.items()}
    return dict(agentrecbench=agentrecbench, kuairand=kuairand, kuairec=kuairec, simbench=simbench)


def verify(actual, expected):
    if isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            verify(actual[key], expected[key])
    elif isinstance(expected, float):
        assert math.isclose(actual, expected, rel_tol=0, abs_tol=1e-12), (actual, expected)
    else:
        assert actual == expected, (actual, expected)


def reproduce(path):
    with ZipFile(path) as bundle:
        assert sorted(bundle.namelist()) == ["inputs.json", "manifest.json", "scoring.json"]
        manifest = json.loads(bundle.read("manifest.json"))
        assert manifest["format"] == 1

        def checked_member(name):
            raw = bundle.read(name)
            assert digest(raw) == manifest["files"][name], name
            return json.loads(raw)

        inputs = checked_member("inputs.json")
        ranks = {name: replay_rankings(name, inputs[name]) for name in DATASETS}
        for name in DATASETS:
            assert digest(json_bytes(ranks[name])) == manifest["ranking_sha256"][name], name
        scoring = checked_member("scoring.json")
        metrics = summarize(ranks, inputs, scoring)
        verify(metrics, manifest["published_metrics"])
    return metrics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if not __debug__:
        parser.error("run without -O to enable verification")
    metrics = reproduce(args.bundle)
    result = json.dumps(metrics, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        with args.output.open("x", encoding="utf-8") as stream:
            stream.write(result)
    print(result, end="")


if __name__ == "__main__":
    main()
