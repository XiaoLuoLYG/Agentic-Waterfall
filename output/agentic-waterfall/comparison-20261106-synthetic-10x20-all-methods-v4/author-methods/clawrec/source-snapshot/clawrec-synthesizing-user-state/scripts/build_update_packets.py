#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


SUPPORTED_KINDS = {"search_intent", "content_interest"}
SEARCH_REQUIRED_FIELDS = {
    "record_id",
    "kind",
    "session_id",
    "ts_start_ms",
    "ts_end_ms",
    "platform",
    "engine",
    "normalized_query",
    "url",
    "title",
    "context",
}
CONTENT_REQUIRED_FIELDS = {
    "record_id",
    "kind",
    "session_id",
    "ts_start_ms",
    "ts_end_ms",
    "platform",
    "page_type",
    "content_key",
    "title",
    "canonical_url",
    "context",
}


class CardRenderingError(ValueError):
    pass


@dataclass
class RenderContext:
    timezone: Optional[object]


def load_records(input_path: str) -> List[dict]:
    if input_path == "-":
        lines = sys.stdin.read().splitlines()
    else:
        lines = Path(input_path).read_text(encoding="utf-8").splitlines()
    records = []
    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError as exc:
            raise CardRenderingError(f"invalid JSON on line {line_number}: {exc.msg}") from exc
        validate_record(record, line_number)
        records.append(record)
    return records


def validate_record(record: dict, line_number: int) -> None:
    kind = record.get("kind")
    if kind not in SUPPORTED_KINDS:
        raise CardRenderingError(f"unsupported kind on line {line_number}: {kind!r}")
    required = SEARCH_REQUIRED_FIELDS if kind == "search_intent" else CONTENT_REQUIRED_FIELDS
    missing = sorted(field for field in required if field not in record)
    if missing:
        raise CardRenderingError(
            f"missing required fields on line {line_number}: {', '.join(missing)}"
        )

    ensure_string_field(record, "record_id", line_number)
    ensure_string_field(record, "session_id", line_number)
    ensure_string_field(record, "platform", line_number)
    ensure_number_field(record, "ts_start_ms", line_number)
    ensure_number_field(record, "ts_end_ms", line_number)
    ensure_nullable_string(record.get("title"), "title", line_number)
    if not isinstance(record["context"], dict):
        raise CardRenderingError(f"invalid context payload on line {line_number}")

    if kind == "search_intent":
        ensure_string_field(record, "engine", line_number)
        ensure_string_field(record, "normalized_query", line_number)
        ensure_string_field(record, "url", line_number)
        validate_search_context(record["context"], line_number)
        return

    ensure_string_field(record, "page_type", line_number)
    ensure_string_field(record, "content_key", line_number)
    ensure_string_field(record, "canonical_url", line_number)
    validate_content_context(record["context"], line_number)


def ensure_string_field(record: dict, field: str, line_number: int) -> None:
    if not isinstance(record[field], str):
        raise CardRenderingError(f"invalid {field} on line {line_number}: expected string")


def ensure_number_field(record: dict, field: str, line_number: int) -> None:
    value = record[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CardRenderingError(f"invalid {field} on line {line_number}: expected number")


def ensure_nullable_string(value: object, field: str, line_number: int) -> None:
    if value is not None and not isinstance(value, str):
        raise CardRenderingError(f"invalid {field} on line {line_number}: expected string or null")


def ensure_optional_number(context: dict, field: str, line_number: int) -> None:
    if field not in context:
        return
    value = context[field]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CardRenderingError(f"invalid context.{field} on line {line_number}: expected number")


def ensure_optional_string_list(context: dict, field: str, line_number: int) -> None:
    if field not in context:
        return
    value = context[field]
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise CardRenderingError(f"invalid context.{field} on line {line_number}: expected string list")


def validate_search_context(context: dict, line_number: int) -> None:
    required_fields = {"previous_query"}
    missing = sorted(field for field in required_fields if field not in context)
    if missing:
        raise CardRenderingError(
            f"missing required search context fields on line {line_number}: {', '.join(missing)}"
        )
    ensure_nullable_string(context["previous_query"], "context.previous_query", line_number)


def validate_content_context(context: dict, line_number: int) -> None:
    required_fields = {"source_search_record_id"}
    missing = sorted(field for field in required_fields if field not in context)
    if missing:
        raise CardRenderingError(
            f"missing required content context fields on line {line_number}: {', '.join(missing)}"
        )
    ensure_nullable_string(context["source_search_record_id"], "context.source_search_record_id", line_number)
    ensure_nullable_string(context.get("source_query"), "context.source_query", line_number)
    for field in ("visit_count", "foreground_seconds", "repeat_visits_7d", "repeat_sessions_7d"):
        ensure_optional_number(context, field, line_number)
    ensure_optional_string_list(context, "behavior_signal_types", line_number)


def filter_records(records: Iterable[dict], session_id: Optional[str], kind_filter: str) -> List[dict]:
    filtered = []
    for record in records:
        if session_id and record["session_id"] != session_id:
            continue
        if kind_filter == "search" and record["kind"] != "search_intent":
            continue
        if kind_filter == "content" and record["kind"] != "content_interest":
            continue
        filtered.append(record)
    return filtered


def sort_records(records: Iterable[dict]) -> List[dict]:
    return sorted(records, key=lambda record: (record["ts_start_ms"], record["record_id"]))


def assign_handles(records: List[dict]) -> None:
    search_index = 0
    content_index = 0
    for record in records:
        if record["kind"] == "search_intent":
            search_index += 1
            record["_handle"] = f"S{search_index}"
        else:
            content_index += 1
            record["_handle"] = f"C{content_index}"


def build_context(records: List[dict], timezone_name: Optional[str]) -> RenderContext:
    timezone = resolve_timezone(timezone_name)
    return RenderContext(timezone=timezone)


def resolve_timezone(timezone_name: Optional[str]):
    if timezone_name:
        if ZoneInfo is None:
            raise CardRenderingError("timezone support is unavailable on this Python runtime")
        try:
            return ZoneInfo(timezone_name)
        except Exception as exc:  # pragma: no cover
            raise CardRenderingError(f"unknown timezone: {timezone_name}") from exc
    return datetime.now().astimezone().tzinfo


def format_time_range(start_ms: int, end_ms: int, timezone) -> str:
    start_dt = datetime.fromtimestamp(start_ms / 1000, tz=timezone)
    end_dt = datetime.fromtimestamp(end_ms / 1000, tz=timezone)
    if start_dt.date() == end_dt.date():
        date_prefix = start_dt.strftime("%Y-%m-%d")
        start_time = start_dt.strftime("%H:%M")
        end_time = end_dt.strftime("%H:%M")
        if start_time == end_time:
            return f"{date_prefix} {start_time}"
        return f"{date_prefix} {start_time}-{end_time}"
    return f"{start_dt.strftime('%Y-%m-%d %H:%M')} -> {end_dt.strftime('%Y-%m-%d %H:%M')}"


def humanize_content_key(content_key: str, title: Optional[str] = None) -> str:
    parts = content_key.split(":")
    if len(parts) >= 3 and parts[0] == "generic_web" and parts[1] == "webpage":
        return use_title_or_fallback(title, "Generic web page")
    if len(parts) >= 3 and parts[0] == "github" and parts[1] == "repo":
        return f"GitHub repo {parts[2]}"
    if len(parts) >= 3 and parts[0] == "zhihu" and parts[1] == "question":
        return use_title_or_fallback(title, f"Zhihu question {parts[2]}")
    if len(parts) >= 3 and parts[0] == "zhihu" and parts[1] == "article":
        return use_title_or_fallback(title, f"Zhihu article {parts[2]}")
    if len(parts) >= 3 and parts[0] == "bilibili" and parts[1] == "video":
        return use_title_or_fallback(title, f"Bilibili video {parts[2]}")
    if len(parts) >= 3:
        return use_title_or_fallback(title, f"{parts[0]} {parts[1]} {parts[2]}")
    return use_title_or_fallback(title, content_key)


def use_title_or_fallback(title: Optional[str], fallback: str) -> str:
    normalized = (title or "").strip()
    if normalized and normalized.lower() not in {fallback.lower(), f"github - {fallback}".lower()}:
        return normalized
    return fallback


def platform_label(record: dict) -> str:
    platform = str(record["platform"])
    platform_map = {
        "github": "GitHub",
        "generic_web": "Generic Web",
        "google": "Google",
        "bing": "Bing",
        "bilibili": "Bilibili",
        "zhihu": "Zhihu",
        "zhihu_zhuanlan": "Zhihu Zhuanlan",
    }
    if record["kind"] == "search_intent":
        engine = str(record["engine"])
        return platform_map.get(engine, engine.replace("_", " ").title())
    return platform_map.get(platform, platform.replace("_", " ").title())


def render_search_card(record: dict, context: RenderContext) -> str:
    lines = [
        f"Search [{record['_handle']}]",
        f"- Time: {format_time_range(record['ts_start_ms'], record['ts_end_ms'], context.timezone)}",
        f"- Engine: {record['engine']}",
        f"- Normalized query: {record['normalized_query']}",
        f"- Title: {display_text(record['title'])}",
        f"- URL: {record['url']}",
    ]
    previous_query = record["context"].get("previous_query")
    if previous_query:
        lines.append(f'- Query progression: "{previous_query}" -> "{record["normalized_query"]}"')
    return "\n".join(lines)


def render_content_card(record: dict, context: RenderContext) -> str:
    record_context = record["context"]
    lines = [
        f"Content [{record['_handle']}]",
        f"- Time: {format_time_range(record['ts_start_ms'], record['ts_end_ms'], context.timezone)}",
        f"- Platform: {platform_label(record)}",
        f"- Type: {record['page_type']}",
        f"- Title: {display_text(record['title'])}",
        f"- Identity: {humanize_content_key(record['content_key'], record['title'])}",
        f"- Canonical URL: {record['canonical_url']}",
    ]
    source_query = record_context.get("source_query")
    if source_query:
        lines.append(f"- Source query: {source_query}")
    behavior_summary = render_behavior_summary(record_context)
    if behavior_summary:
        lines.append(f"- Behavior signals: {behavior_summary}")
    return "\n".join(lines)


def render_behavior_summary(context: dict) -> str:
    signals = context.get("behavior_signal_types") or []
    details = []
    if "visit_count" in context:
        details.append(f"visit_count={context['visit_count']}")
    if "foreground_seconds" in context:
        details.append(f"foreground_seconds={context['foreground_seconds']}")
    if "repeat_visits_7d" in context:
        details.append(f"repeat_visits_7d={context['repeat_visits_7d']}")
    if "repeat_sessions_7d" in context:
        details.append(f"repeat_sessions_7d={context['repeat_sessions_7d']}")
    if not signals and not details:
        return ""
    signal_text = ", ".join(signals) if signals else "none"
    if details:
        return f"{signal_text} ({'; '.join(details)})"
    return signal_text


def display_text(value: Optional[str]) -> str:
    return value if value else "none"


def render_cards(records: List[dict], context: RenderContext) -> str:
    rendered = []
    for record in records:
        rendered.append(
            render_search_card(record, context)
            if record["kind"] == "search_intent"
            else render_content_card(record, context)
        )
    return "\n\n".join(rendered)


def group_records_by_session(records: List[dict]) -> List[List[dict]]:
    by_session: Dict[str, List[dict]] = defaultdict(list)
    for record in records:
        by_session[record["session_id"]].append(record)

    sessions: List[List[dict]] = []
    for session_records in by_session.values():
        sessions.append(sort_records(session_records))
    sessions.sort(key=lambda session_records: (session_records[0]["ts_start_ms"], session_records[0]["record_id"]))
    return sessions


def render_chains(session_records: List[dict]) -> str:
    chains = []
    for record in session_records:
        if record["kind"] != "search_intent":
            continue
        linked = [
            content_record["_handle"]
            for content_record in session_records
            if content_record["kind"] == "content_interest"
            and content_record["context"].get("source_search_record_id") == record["record_id"]
        ]
        if linked:
            chains.append(f"[{record['_handle']}] -> {', '.join(f'[{handle}]' for handle in linked)}")
    return "; ".join(chains) if chains else "none"


def render_update_packet(index: int, session_records: List[dict], context: RenderContext) -> str:
    session_id = session_records[0]["session_id"]
    packet_time = format_time_range(
        session_records[0]["ts_start_ms"],
        session_records[-1]["ts_end_ms"],
        context.timezone,
    )
    lines = [
        f"## Update Packet {index}",
        f"- Session: {session_id}",
        f"- Time: {packet_time}",
        "",
        "### Evidence Sequence",
    ]
    for event_index, record in enumerate(session_records, start=1):
        card_lines = (
            render_search_card(record, context).splitlines()
            if record["kind"] == "search_intent"
            else render_content_card(record, context).splitlines()
        )
        first, *rest = card_lines
        lines.append(f"{event_index}. {first}")
        lines.extend(f"   {line}" for line in rest)
    lines.extend(
        [
            "",
            "### Observed Structure",
            f"- Search-to-content chains: {render_chains(session_records)}",
            f"- Platforms involved: {', '.join(sorted({platform_label(record) for record in session_records}))}",
        ]
    )
    return "\n".join(lines)


def render_update_packets(records: List[dict], context: RenderContext) -> str:
    sessions = group_records_by_session(records)
    return "\n\n".join(
        render_update_packet(index, session_records, context)
        for index, session_records in enumerate(sessions, start=1)
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert UnifiedEvent JSONL into LLM-facing markdown update packets."
    )
    parser.add_argument("--input", required=True, help="Path to UnifiedEvent JSONL input, or '-' for stdin.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        records = load_records(args.input)
        filtered = records
        filtered = sort_records(filtered)
        assign_handles(filtered)
        context = build_context(filtered, None)
        output = render_update_packets(filtered, context)
    except CardRenderingError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if output:
        print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
