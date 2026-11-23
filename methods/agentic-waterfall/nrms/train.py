"""Train official NRMS on all of MIND-small train and score MINDsmall_dev each epoch."""
import argparse
import os

from paths import CHECKPOINT, DEV_BEHAVIORS, DEV_NEWS, TRAIN_BEHAVIORS, TRAIN_NEWS, UTILS, UTILS_URL, UTILS_ZIP


def find_file(name):
    matches = [path for path in UTILS.rglob(name) if path.is_file() and not path.name.startswith(".")]
    if len(matches) != 1:
        raise FileNotFoundError(f"expected one {name} under {UTILS}, found {len(matches)}")
    return matches[0]


REQUIRED_UTILS = ("nrms.yaml", "embedding.npy", "word_dict.pkl", "uid2index.pkl")


def ensure_utils():
    from recommenders.models.deeprec.deeprec_utils import download_deeprec_resources

    UTILS.mkdir(parents=True, exist_ok=True)
    if any(not any(UTILS.rglob(name)) for name in REQUIRED_UTILS):
        download_deeprec_resources(UTILS_URL, str(UTILS), UTILS_ZIP)
    return tuple(find_file(name) for name in REQUIRED_UTILS)


def train(epochs, batch_size, seed):
    from recommenders.models.newsrec.io.mind_iterator import MINDIterator
    from recommenders.models.newsrec.models.nrms import NRMSModel
    from recommenders.models.newsrec.newsrec_utils import prepare_hparams

    for required in (TRAIN_NEWS, TRAIN_BEHAVIORS, DEV_NEWS, DEV_BEHAVIORS):
        if not required.exists():
            raise FileNotFoundError(f"missing {required}")
    yaml_file, embedding, word_dict, user_dict = ensure_utils()
    hparams = prepare_hparams(
        str(yaml_file),
        wordEmb_file=str(embedding),
        wordDict_file=str(word_dict),
        userDict_file=str(user_dict),
        batch_size=batch_size,
        epochs=epochs,
        show_step=10,
    )
    model = NRMSModel(hparams, MINDIterator, seed=seed)
    model.fit(
        str(TRAIN_NEWS),
        str(TRAIN_BEHAVIORS),
        str(DEV_NEWS),
        str(DEV_BEHAVIORS),
    )
    CHECKPOINT.parent.mkdir(parents=True, exist_ok=True)
    model.model.save_weights(str(CHECKPOINT))
    print(f"saved {CHECKPOINT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--gpu", type=int, default=0, help="physical GPU index; use -1 for CPU")
    args = parser.parse_args()
    os.environ["CUDA_VISIBLE_DEVICES"] = str(args.gpu)
    os.environ.setdefault("TF_FORCE_GPU_ALLOW_GROWTH", "true")
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    train(args.epochs, args.batch_size, args.seed)
