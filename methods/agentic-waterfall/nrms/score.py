"""Score the NRMS dev predictions with the local MIND scorer."""
import argparse
from pathlib import Path

from paths import DEV_BEHAVIORS, PREDICTIONS, PUBLIC_INPUT, ROOT
from scoring.comparison import run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inputs", type=Path, default=PUBLIC_INPUT)
    parser.add_argument("--predictions", type=Path, default=PREDICTIONS)
    parser.add_argument("--behaviors", type=Path, default=DEV_BEHAVIORS)
    parser.add_argument("--output", type=Path, default=ROOT / "metrics")
    parser.add_argument("--name", default="nrms")
    args = parser.parse_args()
    run(args.inputs, {args.name: args.predictions}, args.behaviors, args.output)


if __name__ == "__main__":
    main()
