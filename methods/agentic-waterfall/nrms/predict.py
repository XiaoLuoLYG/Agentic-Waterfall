"""Rank every MIND-small dev impression with a trained NRMS checkpoint."""
import argparse
import json
import os

import numpy as np
from recommenders.models.newsrec.io.mind_iterator import MINDIterator
from recommenders.models.newsrec.models.nrms import NRMSModel
from recommenders.models.newsrec.newsrec_utils import prepare_hparams

from paths import CHECKPOINT, DEV_BEHAVIORS, DEV_NEWS, PREDICTIONS
from train import ensure_utils


def candidate_rows(path):
    rows = []
    with open(path) as stream:
        for line in stream:
            impression_id, _user, _time, _history, impressions = line.rstrip("\n").split("\t")
            rows.append((impression_id, [token.rsplit("-", 1)[0] for token in impressions.split()]))
    return rows


def predict(batch_size, seed):
    if not CHECKPOINT.parent.exists():
        raise FileNotFoundError(f"missing checkpoint directory {CHECKPOINT.parent}; run train.py first")
    yaml_file, embedding, word_dict, user_dict = ensure_utils()
    hparams = prepare_hparams(
        str(yaml_file),
        wordEmb_file=str(embedding),
        wordDict_file=str(word_dict),
        userDict_file=str(user_dict),
        batch_size=batch_size,
        epochs=1,
        show_step=10,
    )
    model = NRMSModel(hparams, MINDIterator, seed=seed)
    model.model.load_weights(str(CHECKPOINT))
    indexes, _labels, scores = model.run_fast_eval(str(DEV_NEWS), str(DEV_BEHAVIORS))
    rows = candidate_rows(DEV_BEHAVIORS)
    if len(indexes) != len(rows):
        raise ValueError(f"prediction rows {len(indexes)} do not match behaviors {len(rows)}")
    PREDICTIONS.parent.mkdir(parents=True, exist_ok=True)
    with PREDICTIONS.open("w") as stream:
        for index, preds in zip(indexes, scores):
            impression_id, candidates = rows[index]
            order = np.argsort(-np.asarray(preds, dtype=float), kind="mergesort")
            if len(order) != len(candidates):
                raise ValueError(f"score count mismatch for impression {impression_id}")
            record = {
                "decision_id": f"mind:test:{impression_id}",
                "status": "submitted",
                "method": "nrms",
                "ordered_item_ids": [candidates[int(position)] for position in order],
            }
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    print(f"wrote {len(rows)} {PREDICTIONS}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    predict(args.batch_size, args.seed)
