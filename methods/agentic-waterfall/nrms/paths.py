"""Locations for the MIND-small NRMS run."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MIND = ROOT / "data"
TRAIN_NEWS = MIND / "MINDsmall_train" / "news.tsv"
TRAIN_BEHAVIORS = MIND / "MINDsmall_train" / "behaviors.tsv"
DEV_NEWS = MIND / "MINDsmall_dev" / "news.tsv"
DEV_BEHAVIORS = MIND / "MINDsmall_dev" / "behaviors.tsv"
PUBLIC_INPUT = MIND / "prepared" / "mind-small-dev-full.jsonl"

UTILS = ROOT / "utils"
CHECKPOINT = ROOT / "checkpoints" / "nrms_ckpt"
PREDICTIONS = ROOT / "predictions" / "nrms-small-dev.jsonl"
UTILS_URL = "https://huggingface.co/datasets/Recommenders/MIND/resolve/main/"
UTILS_ZIP = "MINDsmall_utils.zip"
