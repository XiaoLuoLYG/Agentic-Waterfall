#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


SCHEMA_VERSION = "clawrec_feedback_v1"
EXCLUSION_SCHEMA_VERSION = "clawrec_observation_exclusion_v1"
DISPLAY_EXCLUSION_PRODUCER = "display-feedback"
DISPLAY_EXCLUSION_PRE_CLICK_MS = 10_000
DISPLAY_EXCLUSION_POST_CLICK_MS = 120_000


class FeedbackCollectionError(ValueError):
    pass


@dataclass
class DisplayedCard:
    card_id: str
    title: str
    source: str
    href: str
    summary: str
    section_label: str
    topic: str
    section_index: int
    card_index: int


@dataclass
class ClickMatch:
    count: int
    first_clicked_at_ms: Optional[int]
    last_clicked_at_ms: Optional[int]
    event_indexes: List[int]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_id_utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def read_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FeedbackCollectionError(f"missing JSON input: {path}") from exc
    except json.JSONDecodeError as exc:
        raise FeedbackCollectionError(f"invalid JSON in {path}: {exc.msg}") from exc


def require_object(value: object, context: str) -> dict:
    if not isinstance(value, dict):
        raise FeedbackCollectionError(f"{context} must be a JSON object")
    return value


def require_string(value: object, context: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise FeedbackCollectionError(f"{context} must be a non-empty string")
    return value.strip()


def optional_string(value: object) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def generated_card_id(section_index: int, card_index: int) -> str:
    return f"card-s{section_index:02d}-c{card_index:02d}"


def cards_from_display_payload(payload: dict) -> List[DisplayedCard]:
    sections = payload.get("sections")
    if not isinstance(sections, list) or not sections:
        raise FeedbackCollectionError("display payload must contain non-empty sections")

    cards: List[DisplayedCard] = []
    seen_ids = set()
    for section_index, raw_section in enumerate(sections, start=1):
        section = require_object(raw_section, f"sections[{section_index}]")
        section_label = require_string(section.get("label"), f"sections[{section_index}].label")
        topic = require_string(section.get("topic"), f"sections[{section_index}].topic")
        raw_cards = section.get("cards")
        if not isinstance(raw_cards, list) or not raw_cards:
            raise FeedbackCollectionError(f"sections[{section_index}].cards must be non-empty")

        for card_index, raw_card in enumerate(raw_cards, start=1):
            card = require_object(raw_card, f"sections[{section_index}].cards[{card_index}]")
            card_id = optional_string(card.get("card_id")) or generated_card_id(section_index, card_index)
            if card_id in seen_ids:
                raise FeedbackCollectionError(f"duplicate card_id in displayed cards: {card_id}")
            seen_ids.add(card_id)
            cards.append(
                DisplayedCard(
                    card_id=card_id,
                    title=require_string(card.get("title"), f"card {card_id}.title"),
                    source=require_string(card.get("source"), f"card {card_id}.source"),
                    href=require_string(card.get("href"), f"card {card_id}.href"),
                    summary=require_string(card.get("summary"), f"card {card_id}.summary"),
                    section_label=section_label,
                    topic=topic,
                    section_index=section_index,
                    card_index=card_index,
                )
            )
    return cards


def load_displayed_cards(manifest_path: Optional[Path], display_data_path: Optional[Path]) -> Tuple[List[DisplayedCard], str, Path]:
    if manifest_path is not None:
        payload = require_object(read_json(manifest_path), str(manifest_path))
        return cards_from_display_payload(payload), "manifest", manifest_path

    if display_data_path is None:
        raise FeedbackCollectionError("either --manifest or --display-data is required")

    payload = require_object(read_json(display_data_path), str(display_data_path))
    return cards_from_display_payload(payload), "display-data", display_data_path


def load_event_lines(events_path: Path) -> Tuple[List[dict], bool]:
    if not events_path.exists():
        return [], True

    events: List[dict] = []
    for line_number, raw_line in enumerate(events_path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise FeedbackCollectionError(f"invalid JSON in {events_path} line {line_number}: {exc.msg}") from exc
        if not isinstance(event, dict):
            raise FeedbackCollectionError(f"invalid event in {events_path} line {line_number}: expected object")
        event["_line_number"] = line_number
        events.append(event)
    return events, False


def normalize_href(value: object) -> Optional[str]:
    text = optional_string(value)
    if text is None:
        return None
    return text.rstrip("/")


def event_timestamp_ms(event: dict) -> Optional[int]:
    value = event.get("timestamp")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def match_clicks(cards: List[DisplayedCard], events: Iterable[dict]) -> Tuple[Dict[str, ClickMatch], List[dict], int]:
    by_id = {card.card_id: card for card in cards}
    by_href = {normalize_href(card.href): card for card in cards}
    click_events_by_card: Dict[str, List[dict]] = {card.card_id: [] for card in cards}
    unmatched: List[dict] = []
    ignored_count = 0

    for event_index, event in enumerate(events, start=1):
        if event.get("type") != "link-click":
            ignored_count += 1
            continue

        matched_card: Optional[DisplayedCard] = None
        event_card_id = optional_string(event.get("cardId"))
        if event_card_id is not None:
            matched_card = by_id.get(event_card_id)

        if matched_card is None:
            matched_card = by_href.get(normalize_href(event.get("href")))

        if matched_card is None:
            unmatched_record = {
                "schema_version": SCHEMA_VERSION,
                "record_type": "unmatched_click_event",
                "event_index": event_index,
                "line_number": event.get("_line_number"),
                "card_id": event_card_id,
                "href": event.get("href"),
                "text": event.get("text"),
                "source": event.get("source"),
                "topic": event.get("topic"),
                "timestamp": event.get("timestamp"),
                "reason": "no_displayed_card_match",
            }
            unmatched.append(unmatched_record)
            continue

        click_events_by_card[matched_card.card_id].append(event)

    matches: Dict[str, ClickMatch] = {}
    for card_id, matched_events in click_events_by_card.items():
        if not matched_events:
            continue
        timestamps = [event_timestamp_ms(event) for event in matched_events]
        numeric_timestamps = [timestamp for timestamp in timestamps if timestamp is not None]
        event_indexes = [int(event["_line_number"]) for event in matched_events if "_line_number" in event]
        matches[card_id] = ClickMatch(
            count=len(matched_events),
            first_clicked_at_ms=min(numeric_timestamps) if numeric_timestamps else None,
            last_clicked_at_ms=max(numeric_timestamps) if numeric_timestamps else None,
            event_indexes=event_indexes,
        )

    return matches, unmatched, ignored_count


def build_feedback_records(
    cards: List[DisplayedCard],
    click_matches: Dict[str, ClickMatch],
    session_id: str,
    run_id: str,
    collected_at: str,
    source_path: Path,
    events_path: Path,
) -> List[dict]:
    records = []
    for card in cards:
        match = click_matches.get(card.card_id)
        action = "click" if match is not None else "skip"
        records.append(
            {
                "schema_version": SCHEMA_VERSION,
                "record_type": "card_feedback",
                "run_id": run_id,
                "feedback_id": f"feedback:{session_id}:{card.card_id}",
                "session_id": session_id,
                "action": action,
                "card_id": card.card_id,
                "title": card.title,
                "source": card.source,
                "href": card.href,
                "summary": card.summary,
                "section_label": card.section_label,
                "topic": card.topic,
                "section_index": card.section_index,
                "card_index": card.card_index,
                "click_count": 0 if match is None else match.count,
                "first_clicked_at_ms": None if match is None else match.first_clicked_at_ms,
                "last_clicked_at_ms": None if match is None else match.last_clicked_at_ms,
                "click_event_lines": [] if match is None else match.event_indexes,
                "displayed_cards_path": str(source_path),
                "events_path": str(events_path),
                "collected_at": collected_at,
            }
        )
    return records


def build_section_records(card_records: List[dict], session_id: str, run_id: str, collected_at: str) -> List[dict]:
    grouped: Dict[int, List[dict]] = {}
    for record in card_records:
        grouped.setdefault(int(record["section_index"]), []).append(record)

    section_records = []
    for section_index in sorted(grouped):
        records = sorted(grouped[section_index], key=lambda record: int(record["card_index"]))
        clicked = [record for record in records if record["action"] == "click"]
        skipped = [record for record in records if record["action"] == "skip"]
        action = "topic_skip" if not clicked else "section_has_click"
        first_record = records[0]
        section_records.append(
            {
                "schema_version": SCHEMA_VERSION,
                "record_type": "section_feedback",
                "run_id": run_id,
                "section_feedback_id": f"section-feedback:{session_id}:s{section_index:02d}",
                "session_id": session_id,
                "action": action,
                "section_label": first_record["section_label"],
                "topic": first_record["topic"],
                "section_index": section_index,
                "card_count": len(records),
                "clicked_count": len(clicked),
                "skipped_count": len(skipped),
                "all_cards_skipped": len(clicked) == 0,
                "clicked_card_ids": [record["card_id"] for record in clicked],
                "skipped_card_ids": [record["card_id"] for record in skipped],
                "collected_at": collected_at,
            }
        )
    return section_records


def build_display_exclusion_records(card_records: List[dict], run_id: str, collected_at: str, feedback_artifact_path: Path) -> List[dict]:
    records = []
    for record in card_records:
        if record["action"] != "click":
            continue
        first_clicked_at_ms = record.get("first_clicked_at_ms")
        if first_clicked_at_ms is None:
            continue
        last_clicked_at_ms = record.get("last_clicked_at_ms") or first_clicked_at_ms
        window_start_ms = max(0, int(first_clicked_at_ms) - DISPLAY_EXCLUSION_PRE_CLICK_MS)
        window_end_ms = int(last_clicked_at_ms) + DISPLAY_EXCLUSION_POST_CLICK_MS
        records.append(
            {
                "schema_version": EXCLUSION_SCHEMA_VERSION,
                "record_type": "observation_exclusion",
                "producer": DISPLAY_EXCLUSION_PRODUCER,
                "run_id": run_id,
                "exclusion_id": f"exclude:display-feedback:{record['session_id']}:{record['card_id']}",
                "reason": "display_feedback_click",
                "applies_to": ["content_hit"],
                "match": {
                    "url": record["href"],
                    "window_start_ms": window_start_ms,
                    "window_end_ms": window_end_ms,
                },
                "source": {
                    "artifact": str(feedback_artifact_path),
                    "feedback_id": record["feedback_id"],
                    "feedback_run_id": run_id,
                    "session_id": record["session_id"],
                    "card_id": record["card_id"],
                    "href": record["href"],
                    "first_clicked_at_ms": first_clicked_at_ms,
                    "last_clicked_at_ms": last_clicked_at_ms,
                },
                "created_at": collected_at,
            }
        )
    return records


def write_jsonl(path: Path, records: Iterable[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def write_json(path: Path, value: dict) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def render_feedback_packets(card_records: List[dict], section_records: List[dict], meta: dict) -> str:
    lines = [
        "# Feedback Packets",
        "",
        f"- Run: {meta['run_id']}",
        f"- Session: {meta['session_id']}",
        f"- Collected: {meta['collected_at']}",
        f"- Display Source: {meta['displayed_cards_path']}",
        f"- Events Source: {meta['events_path']}",
        "",
        "## Feedback Packet 1",
        "",
        "### Card Feedback",
    ]

    for index, record in enumerate(card_records, start=1):
        handle = f"F{index}"
        click_detail = (
            f"click_count={record['click_count']}, first_clicked_at_ms={record['first_clicked_at_ms']}"
            if record["action"] == "click"
            else "not clicked at explicit collection time"
        )
        lines.extend(
            [
                f"{index}. [{handle}] {record['action'].upper()} card",
                f"   - Card: {record['title']}",
                f"   - Source: {record['source']}",
                f"   - Topic: {record['topic']}",
                f"   - Section: {record['section_label']}",
                f"   - Href: {record['href']}",
                f"   - Evidence: card_id={record['card_id']}, {click_detail}",
            ]
        )

    lines.extend(["", "### Section Aggregates"])
    for index, record in enumerate(section_records, start=1):
        handle = f"T{index}"
        if record["action"] == "topic_skip":
            meaning = "all displayed cards in this section were skipped; weak topic downrank evidence"
        else:
            meaning = "section has at least one click; do not treat unclicked sibling cards as topic skip"
        lines.extend(
            [
                f"- [{handle}] {record['action']}",
                f"  - Topic: {record['topic']}",
                f"  - Section: {record['section_label']}",
                f"  - Counts: clicked={record['clicked_count']}, skipped={record['skipped_count']}, total={record['card_count']}",
                f"  - Meaning: {meaning}",
            ]
        )

    lines.extend(
        [
            "",
            "### State Update Guidance",
            "- Treat `click` as weak positive evidence for current or recent interests; a single click must not create a durable long-term preference by itself.",
            "- Treat card-level `skip` as weak negative evidence for that specific displayed card or source only.",
            "- Treat section-level `topic_skip` as weak topic downrank evidence only when every card in the section was skipped.",
            "- Do not create hard suppressions from MVP click/skip feedback alone.",
        ]
    )
    return "\n".join(lines) + "\n"


def render_collection_summary(card_records: List[dict], section_records: List[dict], unmatched: List[dict], meta: dict) -> str:
    click_count = sum(1 for record in card_records if record["action"] == "click")
    skip_count = sum(1 for record in card_records if record["action"] == "skip")
    topic_skip_count = sum(1 for record in section_records if record["action"] == "topic_skip")
    return "\n".join(
        [
            "# Feedback Collection",
            "",
            f"- Run: {meta['run_id']}",
            f"- Session: {meta['session_id']}",
            f"- Collected: {meta['collected_at']}",
            f"- Display source type: {meta['display_source_type']}",
            f"- Display source path: {meta['displayed_cards_path']}",
            f"- Events path: {meta['events_path']}",
            f"- Events file missing: {meta['events_missing']}",
            "",
            "## Counts",
            "",
            f"- Displayed cards: {len(card_records)}",
            f"- Clicked cards: {click_count}",
            f"- Skipped cards: {skip_count}",
            f"- Sections: {len(section_records)}",
            f"- Topic skips: {topic_skip_count}",
            f"- Unmatched click events: {len(unmatched)}",
            f"- Ignored non-click events: {meta['ignored_event_count']}",
            "",
            "## Output Files",
            "",
            "- `feedback.jsonl`",
            "- `section-feedback.jsonl`",
            "- `unmatched-events.jsonl`",
            "- `feedback-packets.md`",
            "- `meta.json`",
            f"- Observation exclusions: {meta['observation_exclusion_latest_path']}",
            "",
            "## Notes",
            "",
            "- Feedback was finalized by explicit collection.",
            "- Unclicked cards were treated as skips only for this collection run.",
            "- Section-level topic skip is present only for sections with zero clicked cards.",
            "- Clicked-card outbound URLs are also written as observation exclusions for browser-observer filtering.",
        ]
    ) + "\n"


def ensure_clean_dir(path: Path) -> None:
    if path.exists():
        if not path.is_dir():
            raise FeedbackCollectionError(f"output path exists and is not a directory: {path}")
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)


def ensure_new_dir(path: Path) -> None:
    if path.exists():
        raise FeedbackCollectionError(f"feedback run already exists; choose a new --run-id: {path}")
    path.mkdir(parents=True, exist_ok=False)


def validate_new_run_dir(path: Path, label: str) -> None:
    if path.exists():
        raise FeedbackCollectionError(f"{label} run already exists; choose a new --run-id: {path}")


def mirror_run_to_latest(run_dir: Path, latest_dir: Path) -> None:
    ensure_clean_dir(latest_dir)
    for child in run_dir.iterdir():
        if child.is_file():
            shutil.copy2(child, latest_dir / child.name)


def infer_session_id(events_path: Path) -> Optional[str]:
    parts = list(events_path.parts)
    for index, part in enumerate(parts):
        if part == "clawrec-generative-interface" and index + 1 < len(parts):
            return parts[index + 1]
    if events_path.name == "events" and events_path.parent.name == "state":
        return events_path.parent.parent.name
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect ClawRec display click/skip feedback.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest", help="Path to displayed-cards.json written for the rendered session.")
    source.add_argument("--display-data", help="Path to display-data.json used to render the session.")
    parser.add_argument("--events", required=True, help="Path to rendering session state/events JSONL.")
    parser.add_argument("--session-id", help="Rendered interface session id. Inferred from --events when omitted.")
    parser.add_argument("--run-id", help="Optional feedback run id. Defaults to a UTC timestamp.")
    parser.add_argument("--output-root", default=".clawrec/clawrec-feedback", help="Feedback output root.")
    parser.add_argument(
        "--exclusion-output-root",
        default=".clawrec/clawrec-observation-exclusions/display-feedback",
        help="Display-feedback observation exclusion output root.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    manifest_path = Path(args.manifest) if args.manifest else None
    display_data_path = Path(args.display_data) if args.display_data else None
    events_path = Path(args.events)
    output_root = Path(args.output_root)
    exclusion_output_root = Path(args.exclusion_output_root)
    run_id = args.run_id or run_id_utc_now()
    session_id = args.session_id or infer_session_id(events_path)
    if not session_id:
        print("error: --session-id is required when it cannot be inferred from --events", file=sys.stderr)
        return 1

    try:
        cards, display_source_type, displayed_cards_path = load_displayed_cards(manifest_path, display_data_path)
        events, events_missing = load_event_lines(events_path)
        click_matches, unmatched, ignored_event_count = match_clicks(cards, events)
        collected_at = utc_now_iso()
        card_records = build_feedback_records(
            cards,
            click_matches,
            session_id,
            run_id,
            collected_at,
            displayed_cards_path,
            events_path,
        )
        section_records = build_section_records(card_records, session_id, run_id, collected_at)

        run_dir = output_root / "runs" / run_id
        latest_dir = output_root / "latest"
        exclusion_run_dir = exclusion_output_root / "runs" / run_id
        exclusion_latest_dir = exclusion_output_root / "latest"
        exclusion_records = build_display_exclusion_records(card_records, run_id, collected_at, run_dir / "feedback.jsonl")
        validate_new_run_dir(run_dir, "feedback")
        validate_new_run_dir(exclusion_run_dir, "observation exclusion")
        run_dir.mkdir(parents=True, exist_ok=False)
        exclusion_run_dir.mkdir(parents=True, exist_ok=False)

        meta = {
            "schema_version": SCHEMA_VERSION,
            "run_id": run_id,
            "session_id": session_id,
            "display_source_type": display_source_type,
            "displayed_cards_path": str(displayed_cards_path),
            "events_path": str(events_path),
            "output_dir": str(run_dir),
            "latest_dir": str(latest_dir),
            "collected_at": collected_at,
            "explicit_collection": True,
            "events_missing": events_missing,
            "displayed_card_count": len(card_records),
            "clicked_card_count": sum(1 for record in card_records if record["action"] == "click"),
            "skipped_card_count": sum(1 for record in card_records if record["action"] == "skip"),
            "section_count": len(section_records),
            "topic_skip_count": sum(1 for record in section_records if record["action"] == "topic_skip"),
            "unmatched_click_event_count": len(unmatched),
            "ignored_event_count": ignored_event_count,
            "observation_exclusion_output_root": str(exclusion_output_root),
            "observation_exclusion_run_dir": str(exclusion_run_dir),
            "observation_exclusion_latest_dir": str(exclusion_latest_dir),
            "observation_exclusion_latest_path": str(exclusion_latest_dir / "exclusions.jsonl"),
            "observation_exclusion_count": len(exclusion_records),
        }
        exclusion_meta = {
            "schema_version": EXCLUSION_SCHEMA_VERSION,
            "producer": DISPLAY_EXCLUSION_PRODUCER,
            "run_id": run_id,
            "source_feedback_run_dir": str(run_dir),
            "output_dir": str(exclusion_run_dir),
            "latest_dir": str(exclusion_latest_dir),
            "created_at": collected_at,
            "exclusion_count": len(exclusion_records),
            "reason_counts": {
                "display_feedback_click": len(exclusion_records),
            },
        }

        write_jsonl(run_dir / "feedback.jsonl", card_records)
        write_jsonl(run_dir / "section-feedback.jsonl", section_records)
        write_jsonl(run_dir / "unmatched-events.jsonl", unmatched)
        write_jsonl(exclusion_run_dir / "exclusions.jsonl", exclusion_records)
        write_json(exclusion_run_dir / "meta.json", exclusion_meta)
        (run_dir / "feedback-packets.md").write_text(
            render_feedback_packets(card_records, section_records, meta),
            encoding="utf-8",
            newline="\n",
        )
        (run_dir / "COLLECTION.md").write_text(
            render_collection_summary(card_records, section_records, unmatched, meta),
            encoding="utf-8",
            newline="\n",
        )
        write_json(run_dir / "meta.json", meta)
        mirror_run_to_latest(run_dir, latest_dir)
        mirror_run_to_latest(exclusion_run_dir, exclusion_latest_dir)
    except FeedbackCollectionError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(meta, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
