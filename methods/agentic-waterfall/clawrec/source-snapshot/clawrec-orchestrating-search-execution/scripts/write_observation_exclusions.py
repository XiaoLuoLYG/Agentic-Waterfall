#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


SCHEMA_VERSION = "clawrec_observation_exclusion_v1"
PRODUCER = "search-execution"


class SearchExecutionExclusionError(ValueError):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SearchExecutionExclusionError(f"missing JSON input: {path}") from exc
    except json.JSONDecodeError as exc:
        raise SearchExecutionExclusionError(f"invalid JSON in {path}: {exc.msg}") from exc
    if not isinstance(value, dict):
        raise SearchExecutionExclusionError(f"{path} must be a JSON object")
    return value


def parse_time_ms(value: object, field_name: str) -> int:
    if isinstance(value, bool):
        raise SearchExecutionExclusionError(f"{field_name} must be an ISO timestamp or unix milliseconds")
    if isinstance(value, (int, float)):
        return int(value)
    if not isinstance(value, str) or not value.strip():
        raise SearchExecutionExclusionError(f"{field_name} must be an ISO timestamp or unix milliseconds")

    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as exc:
        raise SearchExecutionExclusionError(f"{field_name} is not a valid ISO timestamp: {value}") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        if not path.is_dir():
            raise SearchExecutionExclusionError(f"output path exists and is not a directory: {path}")
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def ensure_new_dir(path: Path) -> None:
    if path.exists():
        raise SearchExecutionExclusionError(f"observation exclusion run already exists; choose a new run id: {path}")
    path.mkdir(parents=True, exist_ok=False)


def mirror_run_to_latest(run_dir: Path, latest_dir: Path) -> None:
    ensure_clean_dir(latest_dir)
    for child in run_dir.iterdir():
        if child.is_file():
            shutil.copy2(child, latest_dir / child.name)


def build_exclusion_records(search_meta: dict, search_meta_path: Path, created_at: str) -> list[dict]:
    run_id = search_meta.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        raise SearchExecutionExclusionError("search execution meta.json must contain non-empty run_id")

    dispatched_task_count = search_meta.get("dispatched_task_count", 0)
    if isinstance(dispatched_task_count, bool) or not isinstance(dispatched_task_count, int):
        raise SearchExecutionExclusionError("search execution meta.json dispatched_task_count must be an integer")
    if dispatched_task_count <= 0:
        return []

    window_start_ms = parse_time_ms(search_meta.get("started_at"), "started_at")
    window_end_ms = parse_time_ms(search_meta.get("finished_at"), "finished_at")
    if window_end_ms < window_start_ms:
        raise SearchExecutionExclusionError("finished_at must not be earlier than started_at")

    return [
        {
            "schema_version": SCHEMA_VERSION,
            "record_type": "observation_exclusion",
            "producer": PRODUCER,
            "run_id": run_id,
            "exclusion_id": f"exclude:search-execution:{run_id}",
            "reason": "agent_search_execution",
            "applies_to": ["search_hit", "content_hit"],
            "match": {
                "window_start_ms": window_start_ms,
                "window_end_ms": window_end_ms,
            },
            "source": {
                "artifact": str(search_meta_path),
                "search_execution_run_id": run_id,
                "browser_access_mode": search_meta.get("browser_access_mode"),
                "browser_access_profile": search_meta.get("browser_access_profile"),
                "started_at": search_meta.get("started_at"),
                "finished_at": search_meta.get("finished_at"),
                "dispatched_task_count": dispatched_task_count,
            },
            "created_at": created_at,
        }
    ]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write search-execution observation exclusions for one orchestrated run.")
    parser.add_argument("--run-dir", required=True, help="Path to .clawrec/clawrec-search-execution/runs/<run_id>.")
    parser.add_argument(
        "--output-root",
        default=".clawrec/clawrec-observation-exclusions/search-execution",
        help="Search-execution observation exclusion output root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    search_run_dir = Path(args.run_dir)
    search_meta_path = search_run_dir / "meta.json"
    output_root = Path(args.output_root)

    try:
        search_meta = read_json(search_meta_path)
        run_id = search_meta.get("run_id")
        if not isinstance(run_id, str) or not run_id:
            raise SearchExecutionExclusionError("search execution meta.json must contain non-empty run_id")

        created_at = utc_now_iso()
        records = build_exclusion_records(search_meta, search_meta_path, created_at)
        run_dir = output_root / "runs" / run_id
        latest_dir = output_root / "latest"
        ensure_new_dir(run_dir)

        meta = {
            "schema_version": SCHEMA_VERSION,
            "producer": PRODUCER,
            "run_id": run_id,
            "source_search_execution_run_dir": str(search_run_dir),
            "source_search_execution_meta_path": str(search_meta_path),
            "output_dir": str(run_dir),
            "latest_dir": str(latest_dir),
            "created_at": created_at,
            "exclusion_count": len(records),
            "reason_counts": {
                "agent_search_execution": len(records),
            },
        }
        write_jsonl(run_dir / "exclusions.jsonl", records)
        write_json(run_dir / "meta.json", meta)
        mirror_run_to_latest(run_dir, latest_dir)
    except SearchExecutionExclusionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(meta, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
