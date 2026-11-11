"""Rank every MIND-small dev impression by TF-IDF similarity to its click history."""
import argparse
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

MIND = Path(__file__).resolve().parents[3] / "experiments/agentic-waterfall/mind/data"
TRAIN_NEWS = MIND / "MINDsmall_train" / "news.tsv"
DEV_NEWS = MIND / "MINDsmall_dev" / "news.tsv"


def article_text(title, abstract):
    return f"{title} {abstract}".strip()


def load_news(*paths):
    news = {}
    for path in paths:
        with Path(path).open(encoding="utf-8") as stream:
            for line in stream:
                fields = line.rstrip("\n").split("\t")
                if len(fields) < 4 or not fields[0]:
                    continue
                text = article_text(fields[3], fields[4] if len(fields) > 4 else "")
                if fields[0] in news and news[fields[0]] != text:
                    raise ValueError(f"conflicting news text for {fields[0]}")
                news.setdefault(fields[0], text)
    if not news:
        raise ValueError("empty news table")
    return news


def item_text(item):
    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
        raise ValueError("invalid news item")
    title = item.get("title") or ""
    abstract = item.get("abstract") or ""
    if not isinstance(title, str) or not isinstance(abstract, str):
        raise ValueError(f"invalid news text for {item['id']}")
    return item["id"], article_text(title, abstract)


def fit_catalog(text_by_id):
    vectorizer = TfidfVectorizer()
    try:
        matrix = vectorizer.fit_transform(text_by_id.values())
    except ValueError as error:
        if not str(error).startswith("empty vocabulary"):
            raise
        matrix = None
    return vectorizer, matrix, {item_id: row for row, item_id in enumerate(text_by_id)}


def rank_candidates(index, history, candidates):
    vectorizer, matrix, row_of = index
    rows = [row_of[item_id] for item_id in candidates]
    if history and rows and matrix is not None:
        query = vectorizer.transform([" ".join(history)])
        scores = np.asarray(matrix[rows].dot(query.T).todense()).ravel()
    else:
        scores = np.zeros(len(candidates))
    order = np.argsort(-scores, kind="mergesort")
    return [candidates[int(position)] for position in order], int(np.count_nonzero(scores))


def rank_impression(index, observation):
    history = []
    for event in observation["behavior_events"]:
        _news_id, text = item_text(event["item"])
        if text:
            history.append(text)
    candidates = []
    for item in observation["environment"]["candidate_pool"]:
        news_id, _text = item_text(item)
        if news_id not in index[2]:
            raise ValueError(f"unknown news id {news_id}")
        candidates.append(news_id)
    if not candidates or len(set(candidates)) != len(candidates):
        raise ValueError(f"invalid candidates for {observation.get('decision_id')}")
    return rank_candidates(index, history, candidates)[0]


def predict(inputs, output, limit, train_news, dev_news):
    output = Path(output)
    if output.exists():
        raise FileExistsError(output)
    news = load_news(train_news, dev_news)
    print(f"fitting TF-IDF on {len(news)} news articles", flush=True)
    index = fit_catalog(news)
    output.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with TemporaryDirectory(dir=output.parent, prefix=".tfidf-") as tmp:
        temporary = Path(tmp) / "predictions.jsonl"
        with Path(inputs).open(encoding="utf-8") as source, temporary.open("w", encoding="utf-8") as destination:
            for line in source:
                if limit is not None and written >= limit:
                    break
                if not line.strip():
                    continue
                row = json.loads(line)
                observation = row["observation"]
                if row.get("preparation_status") == "blocked":
                    raise ValueError(f"blocked MIND input: {observation['decision_id']}")
                record = {
                    "decision_id": observation["decision_id"],
                    "status": "submitted",
                    "method": "tfidf",
                    "ordered_item_ids": rank_impression(index, observation),
                }
                destination.write(json.dumps(record, ensure_ascii=False) + "\n")
                written += 1
                if written % 5000 == 0:
                    print(f"ranked {written}", flush=True)
        if not written:
            raise ValueError("no MIND impressions")
        os.link(temporary, output)
    print(f"wrote {written} {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, required=True, help="prepared public MIND JSONL")
    parser.add_argument("--output", type=Path, required=True, help="new predictions JSONL")
    parser.add_argument("--train-news", type=Path, default=TRAIN_NEWS)
    parser.add_argument("--dev-news", type=Path, default=DEV_NEWS)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    predict(args.inputs, args.output, args.limit, args.train_news, args.dev_news)


if __name__ == "__main__":
    main()
