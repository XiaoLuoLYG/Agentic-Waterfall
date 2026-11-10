"""Rank every MIND-small dev impression by TF-IDF similarity to its click history."""
import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

HERE = Path(__file__).resolve().parent
WORKSPACE = HERE.parents[4]
MIND = WORKSPACE / "nrms" / "data"
TRAIN_NEWS = MIND / "MINDsmall_train" / "news.tsv"
DEV_NEWS = MIND / "MINDsmall_dev" / "news.tsv"
PUBLIC_INPUT = MIND / "prepared" / "mind-small-dev-full.jsonl"
OUTPUT = HERE / "predictions" / "tfidf-small-dev.jsonl"


def article_text(title, abstract):
    return f"{title} {abstract}".strip()


def load_news(*paths):
    news = {}
    for path in paths:
        with Path(path).open() as stream:
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


def rank_impression(vectorizer, matrix, row_of, observation):
    history = []
    for event in observation["behavior_events"]:
        _news_id, text = item_text(event["item"])
        if text:
            history.append(text)
    candidates = []
    for item in observation["environment"]["candidate_pool"]:
        news_id, _text = item_text(item)
        if news_id not in row_of:
            raise ValueError(f"unknown news id {news_id}")
        candidates.append(news_id)
    if not candidates or len(set(candidates)) != len(candidates):
        raise ValueError(f"invalid candidates for {observation.get('decision_id')}")
    rows = [row_of[news_id] for news_id in candidates]
    if history:
        query = vectorizer.transform([" ".join(history)])
        scores = np.asarray(matrix[rows].dot(query.T).todense()).ravel()
    else:
        scores = np.zeros(len(candidates))
    order = np.argsort(-scores, kind="mergesort")
    return [candidates[int(position)] for position in order]


def predict(inputs, output, limit, train_news, dev_news):
    news = load_news(train_news, dev_news)
    print(f"fitting TF-IDF on {len(news)} news articles", flush=True)
    ids = list(news)
    vectorizer = TfidfVectorizer()
    matrix = vectorizer.fit_transform([news[news_id] for news_id in ids])
    row_of = {news_id: index for index, news_id in enumerate(ids)}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.name + ".partial")
    written = 0
    with Path(inputs).open() as source, temporary.open("w") as destination:
        for line in source:
            if not line.strip():
                continue
            if limit is not None and written >= limit:
                break
            observation = json.loads(line)["observation"]
            ordered = rank_impression(vectorizer, matrix, row_of, observation)
            record = {
                "decision_id": observation["decision_id"],
                "status": "submitted",
                "method": "tfidf",
                "ordered_item_ids": ordered,
            }
            destination.write(json.dumps(record, ensure_ascii=False) + "\n")
            written += 1
            if written % 5000 == 0:
                print(f"ranked {written}", flush=True)
    temporary.replace(output)
    print(f"wrote {written} {output}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, default=PUBLIC_INPUT)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--train-news", type=Path, default=TRAIN_NEWS)
    parser.add_argument("--dev-news", type=Path, default=DEV_NEWS)
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    predict(args.inputs, args.output, args.limit, args.train_news, args.dev_news)


if __name__ == "__main__":
    main()
