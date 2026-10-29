#!/usr/bin/env python3

import argparse
import ipaddress
import json
import os
import re
import shutil
import sqlite3
import tempfile
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


CHROME_EPOCH_OFFSET_US = 11644473600000000
SESSION_GAP_MS = 30 * 60 * 1000
SEARCH_MERGE_GAP_MS = 3 * 60 * 1000
SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
GENERIC_WEB_PLATFORM = "generic_web"
GENERIC_WEB_PAGE_TYPE = "webpage"
EXCLUSION_SCHEMA_VERSION = "clawrec_observation_exclusion_v1"
OBSERVATION_EXCLUSION_SOURCES = [
    ("display-feedback", Path(".clawrec") / "clawrec-observation-exclusions" / "display-feedback" / "latest" / "exclusions.jsonl"),
    ("search-execution", Path(".clawrec") / "clawrec-observation-exclusions" / "search-execution" / "latest" / "exclusions.jsonl"),
]
OUTPUT_FIELDS_TO_DROP = {
    "query",
    "raw_visit_ids",
}


SQL_QUERY = """
SELECT
  v.id AS visit_id,
  u.url AS raw_url,
  u.title AS title,
  u.hidden AS hidden,
  v.visit_time AS visit_time,
  v.from_visit AS from_visit,
  v.external_referrer_url AS external_referrer_url,
  v.opener_visit AS opener_visit,
  ca.alternative_title AS alternative_title,
  xa.total_foreground_duration AS total_foreground_duration,
  xa.task_id AS task_id,
  xa.root_task_id AS root_task_id,
  kst.normalized_term AS keyword_normalized_term
FROM visits v
JOIN urls u ON u.id = v.url
LEFT JOIN content_annotations ca ON ca.visit_id = v.id
LEFT JOIN context_annotations xa ON xa.visit_id = v.id
LEFT JOIN keyword_search_terms kst ON kst.url_id = u.id
ORDER BY v.visit_time ASC
"""


def chrome_us_to_unix_ms(chrome_us):
    if chrome_us is None:
        return None
    return int((int(chrome_us) - CHROME_EPOCH_OFFSET_US) // 1000)


def iso_utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run_id_utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")


def normalize_query(query):
    return " ".join(query.strip().split()).lower()


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def copy_history_db(history_db_path):
    src = Path(history_db_path)
    fd, temp_path = tempfile.mkstemp(prefix="chrome_history_", suffix=".sqlite")
    os.close(fd)
    shutil.copyfile(src, temp_path)
    return temp_path


def load_visits(history_db_path):
    temp_db_path = copy_history_db(history_db_path)
    conn = None
    try:
        conn = sqlite3.connect(temp_db_path)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(SQL_QUERY).fetchall()
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        Path(temp_db_path).unlink(missing_ok=True)

    loaded = []
    for row in rows:
        title = row["title"] or row["alternative_title"]
        loaded.append(
            {
                "visit_id": int(row["visit_id"]),
                "raw_url": row["raw_url"],
                "title": title,
                "hidden": int(row["hidden"]),
                "visit_time_ms": chrome_us_to_unix_ms(row["visit_time"]),
                "from_visit": row["from_visit"],
                "external_referrer_url": row["external_referrer_url"],
                "opener_visit": row["opener_visit"],
                "total_foreground_duration": row["total_foreground_duration"],
                "task_id": row["task_id"],
                "root_task_id": row["root_task_id"],
                "keyword_normalized_term": row["keyword_normalized_term"],
            }
        )
    return loaded


def normalize_url(raw_url, config):
    parsed = urllib.parse.urlparse(raw_url)
    if not parsed.scheme:
        return None

    host = parsed.netloc.lower() if config["global_normalization"].get("lowercase_domain", False) else parsed.netloc
    path = parsed.path or "/"
    query_lists = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)

    drop_exact = set(config["global_normalization"].get("drop_query_params_exact", []))
    drop_prefix = tuple(config["global_normalization"].get("drop_query_params_prefix", []))
    filtered_query = {}
    for key, values in query_lists.items():
        if key in drop_exact:
            continue
        if drop_prefix and any(key.startswith(prefix) for prefix in drop_prefix):
            continue
        if values:
            filtered_query[key] = values

    return {
        "scheme": parsed.scheme.lower(),
        "host": host,
        "path": path,
        "query": filtered_query,
    }


def build_url(scheme, host, path, query, keep_params=None):
    items = []
    if keep_params is None:
        keys = sorted(query.keys())
    else:
        keys = [key for key in keep_params if key in query]
    for key in keys:
        for value in query[key]:
            items.append((key, value))
    query_string = urllib.parse.urlencode(items, doseq=True)
    return urllib.parse.urlunparse((scheme, host, path, "", query_string, ""))


def first_query_value(query, key):
    values = query.get(key)
    if not values:
        return None
    return values[0]


def decode_percent_escapes(value):
    return urllib.parse.unquote(value)


def extract_referrer_domain(raw_referrer_url):
    if not raw_referrer_url:
        return None
    parsed = urllib.parse.urlparse(raw_referrer_url)
    return parsed.netloc.lower() or None


def hostname_from_netloc(netloc):
    parsed = urllib.parse.urlparse("//" + netloc)
    return (parsed.hostname or "").lower().rstrip(".")


def whitelisted_hosts(config):
    hosts = set()
    for extractor in config.get("search_extractors", []):
        hosts.update(host.lower().rstrip(".") for host in extractor.get("domains", []))
    for extractor in config.get("content_extractors", []):
        hosts.update(host.lower().rstrip(".") for host in extractor.get("domains", []))
    return hosts


def is_whitelisted_host(norm, config):
    hosts = whitelisted_hosts(config)
    host = norm["host"].lower().rstrip(".")
    hostname = hostname_from_netloc(norm["host"])
    return host in hosts or hostname in hosts


def is_local_or_private_host(hostname):
    if not hostname:
        return True
    if hostname == "localhost" or hostname.endswith(".localhost") or hostname.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    )


def host_matches(hostname, exact_hosts, suffixes):
    exact = {host.lower().rstrip(".") for host in exact_hosts}
    if hostname in exact:
        return True
    for raw_suffix in suffixes:
        suffix = raw_suffix.lower().rstrip(".")
        if not suffix:
            continue
        if suffix.startswith("."):
            if hostname == suffix[1:] or hostname.endswith(suffix):
                return True
        elif hostname == suffix or hostname.endswith("." + suffix):
            return True
    return False


def path_matches_prefix(path, prefixes):
    path_lower = path.lower()
    for prefix in prefixes:
        if path_lower.startswith(prefix.lower()):
            return True
    return False


def is_globally_ignored(norm, config):
    global_ignore = config.get("global_ignore", {})
    if norm["scheme"] in set(global_ignore.get("scheme", [])):
        return True
    if norm["host"] in set(global_ignore.get("host_exact", [])):
        return True
    path = norm["path"]
    for fragment in global_ignore.get("path_contains", []):
        if fragment in path:
            return True
    return False


def is_generic_web_ignored(norm, config):
    generic_config = config.get("generic_web", {})
    if not generic_config.get("enabled", False):
        return True

    allowed_schemes = set(generic_config.get("allowed_schemes", ["http", "https"]))
    if norm["scheme"] not in allowed_schemes:
        return True
    if "@" in norm["host"]:
        return True

    hostname = hostname_from_netloc(norm["host"])
    if is_whitelisted_host(norm, config):
        return True
    if is_local_or_private_host(hostname):
        return True

    ignore_config = generic_config.get("ignore", {})
    exact_hosts = (
        ignore_config.get("host_exact", [])
        + ignore_config.get("sensitive_host_exact", [])
    )
    suffixes = (
        ignore_config.get("host_suffix", [])
        + ignore_config.get("sensitive_host_suffix", [])
    )
    if host_matches(hostname, exact_hosts, suffixes):
        return True

    if path_matches_prefix(
        norm["path"],
        ignore_config.get("path_prefix", []) + ignore_config.get("sensitive_path_prefix", []),
    ):
        return True
    return False


def path_matches(match_config, path):
    if "path_exact" in match_config and path not in match_config["path_exact"]:
        return None
    if "path_prefix" in match_config:
        prefixes = tuple(match_config["path_prefix"])
        if not path.startswith(prefixes):
            return None
    if "path_regex" in match_config:
        result = re.match(match_config["path_regex"], path)
        if not result:
            return None
        return result.groupdict()
    return {}


def params_present(match_config, query):
    for key in match_config.get("required_query_params", []):
        if not first_query_value(query, key):
            return False
    any_keys = match_config.get("required_query_params_any")
    if any_keys and not any(first_query_value(query, key) for key in any_keys):
        return False
    return True


def is_extractor_ignored(ignore_config, path):
    if not ignore_config:
        return False
    if "path_exact" in ignore_config and path in set(ignore_config["path_exact"]):
        return True
    for prefix in ignore_config.get("path_prefix", []):
        if path.startswith(prefix):
            return True
    if "path_regex" in ignore_config and re.match(ignore_config["path_regex"], path):
        return True
    return False


def render_template(template, path_groups, query):
    def replace(match):
        token = match.group(1)
        if token.startswith("path."):
            return path_groups[token[5:]]
        if token.startswith("query."):
            return first_query_value(query, token[6:])
        raise KeyError(token)

    return re.sub(r"\{([^{}]+)\}", replace, template)


def find_search_extractor(norm, config):
    path = norm["path"]
    for extractor in config["search_extractors"]:
        if norm["host"] not in set(extractor["domains"]):
            continue
        path_groups = path_matches(extractor["match"], path)
        if path_groups is None or not params_present(extractor["match"], norm["query"]):
            continue
        return extractor
    return None


def find_content_extractor(norm, config):
    path = norm["path"]
    for extractor in config["content_extractors"]:
        if norm["host"] not in set(extractor["domains"]):
            continue
        if is_extractor_ignored(extractor.get("ignore"), path):
            continue
        path_groups = path_matches(extractor["match"], path)
        if path_groups is None or not params_present(extractor["match"], norm["query"]):
            continue
        return extractor, path_groups
    return None, None


def project_generic_web_url(norm, config):
    if is_generic_web_ignored(norm, config):
        return None

    generic_config = config.get("generic_web", {})
    canonical_url = build_url(norm["scheme"], norm["host"], norm["path"], norm["query"])
    platform = generic_config.get("platform", GENERIC_WEB_PLATFORM)
    page_type = generic_config.get("page_type", GENERIC_WEB_PAGE_TYPE)
    return {
        "hit_type": "content_hit",
        "platform": platform,
        "page_type": page_type,
        "content_key": f"{platform}:{page_type}:{canonical_url}",
        "url": canonical_url,
        "canonical_url": canonical_url,
    }


def is_generic_web_projection(projection, config):
    generic_config = config.get("generic_web", {})
    return (
        projection["hit_type"] == "content_hit"
        and projection["platform"] == generic_config.get("platform", GENERIC_WEB_PLATFORM)
        and projection["page_type"] == generic_config.get("page_type", GENERIC_WEB_PAGE_TYPE)
    )


def project_supported_url(raw_url, config):
    norm = normalize_url(raw_url, config)
    if norm is None or is_globally_ignored(norm, config):
        return None

    search_extractor = find_search_extractor(norm, config)
    if search_extractor is not None:
        extract = search_extractor["extract"]
        query_key = None
        query = None
        if "query_param" in extract:
            query_key = extract["query_param"]
            query = first_query_value(norm["query"], query_key)
        elif "query_param_first_of" in extract:
            for key in extract["query_param_first_of"]:
                query = first_query_value(norm["query"], key)
                if query:
                    query_key = key
                    break
        if not query:
            return None
        if extract.get("decode_percent_escapes", False):
            query = decode_percent_escapes(query)

        keep_params = [extract["query_param"]] if "query_param" in extract else extract.get("query_param_first_of", [])
        url_query = dict(norm["query"])
        if query_key is not None and query_key in url_query:
            values = list(url_query[query_key])
            if values:
                values[0] = query
                url_query[query_key] = values
        return {
            "hit_type": "search_hit",
            "platform": search_extractor["platform"],
            "engine": extract["engine"],
            "query": query,
            "normalized_query": normalize_query(query),
            "url": build_url(
                norm["scheme"],
                norm["host"],
                norm["path"],
                url_query,
                keep_params=keep_params,
            ),
        }

    content_extractor, path_groups = find_content_extractor(norm, config)
    if content_extractor is None:
        return project_generic_web_url(norm, config)

    extract = content_extractor["extract"]
    content_key = render_template(extract["content_key"], path_groups, norm["query"])
    canonical_path = norm["path"]
    if "canonical_path_template" in extract:
        canonical_path = render_template(extract["canonical_path_template"], path_groups, norm["query"])
    elif "canonical_path_segments" in extract:
        segment_count = int(extract["canonical_path_segments"])
        segments = [segment for segment in norm["path"].split("/") if segment]
        canonical_segments = segments[:segment_count]
        canonical_path = "/" + "/".join(canonical_segments)
    canonical_scheme = extract.get("canonical_scheme", norm["scheme"])
    canonical_url = build_url(
        canonical_scheme,
        norm["host"],
        canonical_path,
        norm["query"],
        keep_params=extract.get("canonical_query_params", []),
    )

    return {
        "hit_type": "content_hit",
        "platform": content_extractor["platform"],
        "page_type": content_extractor["page_type"],
        "content_key": content_key,
        "url": build_url(norm["scheme"], norm["host"], norm["path"], norm["query"]),
        "canonical_url": canonical_url,
    }


def parse_exclusion_ms(value, path, line_number, field_name):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"invalid observation exclusion in {path} line {line_number}: match.{field_name} must be a number")
    return int(value)


def normalize_observation_url(raw_url, config):
    if raw_url is None:
        return None
    norm = normalize_url(str(raw_url), config)
    if norm is None:
        return str(raw_url).rstrip("/")
    return build_url(norm["scheme"], norm["host"], norm["path"], norm["query"]).rstrip("/")


def load_observation_exclusions(project_dir, config):
    records = []
    configured_paths = []
    consumed_paths = []

    for producer, relative_path in OBSERVATION_EXCLUSION_SOURCES:
        path = Path(project_dir) / relative_path
        configured_paths.append(str(path))
        if not path.exists():
            continue
        consumed_paths.append(str(path))
        with path.open("r", encoding="utf-8") as fh:
            for line_number, raw_line in enumerate(fh, start=1):
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"invalid JSON in observation exclusion {path} line {line_number}: {exc.msg}") from exc
                if not isinstance(record, dict):
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: expected object")
                if record.get("schema_version") != EXCLUSION_SCHEMA_VERSION:
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: unsupported schema_version")
                if record.get("record_type") != "observation_exclusion":
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: unsupported record_type")

                applies_to = record.get("applies_to")
                if not isinstance(applies_to, list) or not all(isinstance(item, str) and item for item in applies_to):
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: applies_to must be a non-empty string list")
                match = record.get("match")
                if not isinstance(match, dict):
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: match must be an object")
                window_start_ms = parse_exclusion_ms(match.get("window_start_ms"), path, line_number, "window_start_ms")
                window_end_ms = parse_exclusion_ms(match.get("window_end_ms"), path, line_number, "window_end_ms")
                if window_end_ms < window_start_ms:
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: match window end is before start")
                reason = record.get("reason")
                if not isinstance(reason, str) or not reason:
                    raise ValueError(f"invalid observation exclusion in {path} line {line_number}: reason must be a non-empty string")

                records.append(
                    {
                        "producer": record.get("producer") if isinstance(record.get("producer"), str) else producer,
                        "reason": reason,
                        "applies_to": set(applies_to),
                        "window_start_ms": window_start_ms,
                        "window_end_ms": window_end_ms,
                        "url": normalize_observation_url(match.get("url"), config) if match.get("url") is not None else None,
                        "source_path": str(path),
                    }
                )

    return records, {
        "configured_observation_exclusion_source_paths": configured_paths,
        "consumed_observation_exclusion_source_paths": consumed_paths,
        "observation_exclusion_record_count": len(records),
    }


def hit_url_candidates(hit, config):
    candidates = set()
    for key in ("url", "canonical_url"):
        value = hit.get(key)
        normalized = normalize_observation_url(value, config)
        if normalized:
            candidates.add(normalized)
    return candidates


def matching_observation_exclusion(hit, exclusions, config):
    visit_time_ms = hit.get("visit_time_ms")
    if visit_time_ms is None:
        return None
    url_candidates = None
    for exclusion in exclusions:
        if hit["hit_type"] not in exclusion["applies_to"]:
            continue
        if not (exclusion["window_start_ms"] <= visit_time_ms <= exclusion["window_end_ms"]):
            continue
        if exclusion["url"] is not None:
            if url_candidates is None:
                url_candidates = hit_url_candidates(hit, config)
            if exclusion["url"] not in url_candidates:
                continue
        return exclusion
    return None


def filter_observation_exclusions(hits, exclusions, config):
    if not exclusions:
        return list(hits), {
            "excluded_hit_count": 0,
            "exclusion_reason_counts": {},
            "exclusion_producer_counts": {},
            "exclusion_source_counts": {},
        }

    retained = []
    reason_counts = defaultdict(int)
    producer_counts = defaultdict(int)
    source_counts = defaultdict(int)
    for hit in hits:
        exclusion = matching_observation_exclusion(hit, exclusions, config)
        if exclusion is None:
            retained.append(hit)
            continue
        reason_counts[exclusion["reason"]] += 1
        producer_counts[exclusion["producer"]] += 1
        source_counts[exclusion["source_path"]] += 1

    return retained, {
        "excluded_hit_count": len(hits) - len(retained),
        "exclusion_reason_counts": dict(sorted(reason_counts.items())),
        "exclusion_producer_counts": dict(sorted(producer_counts.items())),
        "exclusion_source_counts": dict(sorted(source_counts.items())),
    }


def classify_visit(row, config):
    if row["hidden"] == 1:
        return None
    projection = project_supported_url(row["raw_url"], config)
    if projection is None:
        return None
    if (
        is_generic_web_projection(projection, config)
        and config.get("generic_web", {}).get("require_title", True)
        and not (row["title"] or "").strip()
    ):
        return None

    referrer_projection = (
        project_supported_url(row["external_referrer_url"], config)
        if row["external_referrer_url"] else None
    )
    session_hints = {
        "from_visit": row["from_visit"],
        "opener_visit": row["opener_visit"],
        "task_id": row["task_id"],
        "root_task_id": row["root_task_id"],
        "referrer_url": None if referrer_projection is None else referrer_projection["url"],
    }

    if projection["hit_type"] == "search_hit":
        normalized = row["keyword_normalized_term"] or projection["normalized_query"]
        return {
            "hit_type": "search_hit",
            "visit_id": row["visit_id"],
            "visit_time_ms": row["visit_time_ms"],
            "session_hints": session_hints,
            "platform": projection["platform"],
            "engine": projection["engine"],
            "query": projection["query"],
            "normalized_query": normalized,
            "url": projection["url"],
            "title": row["title"],
        }

    return {
        "hit_type": "content_hit",
        "visit_id": row["visit_id"],
        "visit_time_ms": row["visit_time_ms"],
        "session_hints": session_hints,
        "platform": projection["platform"],
        "page_type": projection["page_type"],
        "content_key": projection["content_key"],
        "url": projection["url"],
        "canonical_url": projection["canonical_url"],
        "title": row["title"],
        "referrer_domain": extract_referrer_domain(row["external_referrer_url"]),
        "total_foreground_duration": row["total_foreground_duration"],
    }


class UnionFind:
    def __init__(self, items):
        self.parent = {item: item for item in items}

    def find(self, item):
        parent = self.parent[item]
        if parent != item:
            self.parent[item] = self.find(parent)
        return self.parent[item]

    def union(self, a, b):
        root_a = self.find(a)
        root_b = self.find(b)
        if root_a != root_b:
            self.parent[root_b] = root_a


def valid_task_id(value):
    return value is not None and value != -1


def build_sessions(hits):
    if not hits:
        return []

    hits_sorted = sorted(hits, key=lambda hit: hit["visit_time_ms"])
    by_visit_id = {hit["visit_id"]: hit for hit in hits_sorted}
    uf = UnionFind(by_visit_id.keys())

    for hit in hits_sorted:
        hints = hit["session_hints"]
        for linked_id in (hints.get("from_visit"), hints.get("opener_visit")):
            if linked_id in by_visit_id:
                uf.union(hit["visit_id"], linked_id)

    latest_visit_by_url = {}
    for hit in hits_sorted:
        referrer_url = hit["session_hints"].get("referrer_url")
        if referrer_url in latest_visit_by_url:
            uf.union(hit["visit_id"], latest_visit_by_url[referrer_url])
        latest_visit_by_url[hit["url"]] = hit["visit_id"]

    for left, right in zip(hits_sorted, hits_sorted[1:]):
        if right["visit_time_ms"] - left["visit_time_ms"] > SESSION_GAP_MS:
            continue
        left_hints = left["session_hints"]
        right_hints = right["session_hints"]
        if valid_task_id(left_hints.get("root_task_id")) and left_hints.get("root_task_id") == right_hints.get("root_task_id"):
            uf.union(left["visit_id"], right["visit_id"])
        elif valid_task_id(left_hints.get("task_id")) and left_hints.get("task_id") == right_hints.get("task_id"):
            uf.union(left["visit_id"], right["visit_id"])

    sessions = defaultdict(list)
    for hit in hits_sorted:
        sessions[uf.find(hit["visit_id"])].append(hit)

    output = []
    for items in sessions.values():
        items.sort(key=lambda hit: hit["visit_time_ms"])
        session_id = "session:" + str(min(hit["visit_id"] for hit in items))
        output.append({"session_id": session_id, "hits": items})
    output.sort(key=lambda session: session["hits"][0]["visit_time_ms"])
    return output


def can_merge_search(previous, current):
    if previous["engine"] != current["engine"]:
        return False
    if current["visit_time_ms"] - previous["visit_time_ms"] > SEARCH_MERGE_GAP_MS:
        return False
    left = previous["normalized_query"]
    right = current["normalized_query"]
    return left == right or left.startswith(right + " ") or right.startswith(left + " ")


def emit_search_intents(session, search_history_counts):
    events = session["hits"]
    search_chains = []
    current_chain = None

    for hit in events:
        if hit["hit_type"] == "content_hit":
            continue
        if current_chain is None:
            current_chain = [hit]
            continue
        if can_merge_search(current_chain[-1], hit):
            current_chain.append(hit)
        else:
            search_chains.append(current_chain)
            current_chain = [hit]

    if current_chain:
        search_chains.append(current_chain)

    search_records = []
    previous_query = None
    for index, chain in enumerate(search_chains, start=1):
        final_hit = chain[-1]
        normalized_query = final_hit["normalized_query"]
        search_history_counts[normalized_query] += 1

        later_content_keys = []
        chain_end_ms = final_hit["visit_time_ms"]
        seen = set()
        for hit in events:
            if hit["hit_type"] != "content_hit" or hit["visit_time_ms"] <= chain_end_ms:
                continue
            if hit["content_key"] not in seen:
                later_content_keys.append(hit["content_key"])
                seen.add(hit["content_key"])

        record = {
            "record_id": f"search:{final_hit['engine']}:{session['session_id']}:{index}",
            "kind": "search_intent",
            "session_id": session["session_id"],
            "ts_start_ms": chain[0]["visit_time_ms"],
            "ts_end_ms": final_hit["visit_time_ms"],
            "platform": final_hit["platform"],
            "engine": final_hit["engine"],
            "query": final_hit["query"],
            "normalized_query": normalized_query,
            "url": final_hit["url"],
            "title": final_hit["title"],
            "raw_visit_ids": [hit["visit_id"] for hit in chain],
            "context": {
                "previous_query": previous_query,
                "next_content_keys": later_content_keys,
            },
        }
        search_records.append(record)
        previous_query = normalized_query
    return search_records


def count_prior_activity(content_history, content_key, current_start_ms):
    visits = 0
    sessions = set()
    window_start = current_start_ms - SEVEN_DAYS_MS
    for item in content_history[content_key]:
        if not (window_start <= item["ts_start_ms"] < current_start_ms):
            continue
        visits += item["visit_count"]
        sessions.add(item["session_id"])
    return visits, len(sessions)


def record_max_visit_id(record):
    raw_visit_ids = record.get("raw_visit_ids") or []
    if not raw_visit_ids:
        return None
    return max(raw_visit_ids)


def find_source_search(search_records, ts_start_ms):
    source = None
    for record in search_records:
        if record["ts_end_ms"] <= ts_start_ms:
            source = record
        else:
            break
    return source


def passes_content_threshold(foreground_seconds, visit_count_in_session, repeat_visits_7d, has_source_search):
    if foreground_seconds >= 20:
        return True
    if visit_count_in_session >= 2:
        return True
    if repeat_visits_7d >= 2:
        return True
    if has_source_search and foreground_seconds >= 5:
        return True
    return False


def content_behavior_signal_types(
    foreground_seconds,
    visit_count_in_session,
    repeat_visits_7d,
    has_source_search,
):
    signal_types = []
    if has_source_search:
        signal_types.append("search_to_content")
    if visit_count_in_session >= 2 or repeat_visits_7d >= 2:
        signal_types.append("repeated_visit")
    if foreground_seconds >= 20:
        signal_types.append("long_dwell")
    return signal_types


def emit_content_interest(session, content_history, search_records):
    grouped = defaultdict(list)
    for hit in session["hits"]:
        if hit["hit_type"] == "content_hit":
            grouped[hit["content_key"]].append(hit)

    output = []
    for content_key, group in grouped.items():
        group.sort(key=lambda hit: hit["visit_time_ms"])
        ts_start_ms = group[0]["visit_time_ms"]
        ts_end_ms = group[-1]["visit_time_ms"]
        visit_count_in_session = len(group)
        foreground_seconds = sum(max(hit["total_foreground_duration"] or 0, 0) for hit in group) / 1_000_000
        repeat_visits_7d, repeat_sessions_7d = count_prior_activity(content_history, content_key, ts_start_ms)
        source_search = find_source_search(search_records, ts_start_ms)
        has_source_search = source_search is not None

        if not passes_content_threshold(foreground_seconds, visit_count_in_session, repeat_visits_7d, has_source_search):
            content_history[content_key].append(
                {
                    "ts_start_ms": ts_start_ms,
                    "session_id": session["session_id"],
                    "visit_count": visit_count_in_session,
                }
            )
            continue

        first_referrer = next((hit["referrer_domain"] for hit in group if hit["referrer_domain"]), None)
        first_hit = group[0]

        record = {
            "record_id": f"content:{content_key}:{session['session_id']}",
            "kind": "content_interest",
            "session_id": session["session_id"],
            "ts_start_ms": ts_start_ms,
            "ts_end_ms": ts_end_ms,
            "platform": first_hit["platform"],
            "page_type": first_hit["page_type"],
            "content_key": content_key,
            "url": first_hit["url"],
            "canonical_url": first_hit["canonical_url"],
            "title": first_hit["title"],
            "raw_visit_ids": [hit["visit_id"] for hit in group],
            "context": {
                "referrer_domain": first_referrer,
                "source_search_record_id": None if source_search is None else source_search["record_id"],
                "source_query": None if source_search is None else source_search["normalized_query"],
                "visit_count": visit_count_in_session,
                "foreground_seconds": round(foreground_seconds, 3),
                "repeat_visits_7d": repeat_visits_7d,
                "repeat_sessions_7d": repeat_sessions_7d,
                "behavior_signal_types": content_behavior_signal_types(
                    foreground_seconds,
                    visit_count_in_session,
                    repeat_visits_7d,
                    has_source_search,
                ),
            },
        }
        output.append(record)
        content_history[content_key].append(
            {
                "ts_start_ms": ts_start_ms,
                "session_id": session["session_id"],
                "visit_count": visit_count_in_session,
            }
        )
    return output


def run_pipeline(history_db_path, config, profile_name, project_dir):
    rows = load_visits(history_db_path)
    exclusions, exclusion_source_meta = load_observation_exclusions(project_dir, config)
    projected_hits = []
    for row in rows:
        hit = classify_visit(row, config)
        if hit is not None:
            projected_hits.append(hit)

    hits, exclusion_filter_meta = filter_observation_exclusions(projected_hits, exclusions, config)

    sessions = build_sessions(hits)
    search_history_counts = defaultdict(int)
    content_history = defaultdict(list)
    records = []
    for session in sessions:
        search_records = emit_search_intents(session, search_history_counts)
        content_records = emit_content_interest(session, content_history, search_records)
        records.extend(search_records)
        records.extend(content_records)

    records.sort(key=lambda record: (record["ts_start_ms"], record["record_id"]))
    meta = {
        "browser": "chrome",
        "profile": profile_name,
        "extracted_at": iso_utc_now(),
        "source_visit_count": len(rows),
        "source_max_visit_id": None if not rows else max(row["visit_id"] for row in rows),
        "projected_hit_count": len(projected_hits),
        "retained_hit_count": len(hits),
        "retained_max_visit_id": None if not hits else max(hit["visit_id"] for hit in hits),
        "emitted_record_count": len(records),
        "emitted_max_visit_id": None if not records else max(
            visit_id
            for visit_id in (record_max_visit_id(record) for record in records)
            if visit_id is not None
        ),
    }
    meta.update(exclusion_source_meta)
    meta.update(exclusion_filter_meta)
    return records, meta


def write_jsonl(records, output_path):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(sanitize_output_value(record), ensure_ascii=False, sort_keys=True) + "\n")


def sanitize_output_value(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            if key in OUTPUT_FIELDS_TO_DROP:
                continue
            sanitized[key] = sanitize_output_value(item)
        return sanitized
    if isinstance(value, list):
        return [sanitize_output_value(item) for item in value]
    return value


def write_json(data, output_path):
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, sort_keys=True, indent=2)
        fh.write("\n")


def ensure_clean_dir(path):
    directory = Path(path)
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def load_json_if_exists(path):
    file_path = Path(path)
    if not file_path.exists():
        return None
    with file_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_previous_watermark(project_dir):
    state_root = Path(project_dir) / ".clawrec" / "clawrec-unified-events"
    latest_meta_path = state_root / "latest" / "meta.json"
    latest_evidence_path = state_root / "latest" / "evidence.jsonl"

    meta = load_json_if_exists(latest_meta_path)
    if meta is not None and meta.get("source_max_visit_id") is not None:
        return {
            "previous_run_id": meta.get("run_id"),
            "previous_source_max_visit_id": meta["source_max_visit_id"],
        }

    if not latest_evidence_path.exists():
        return None

    max_visit_id = None
    with latest_evidence_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            record = json.loads(line)
            visit_id = record_max_visit_id(record)
            if visit_id is None:
                continue
            if max_visit_id is None or visit_id > max_visit_id:
                max_visit_id = visit_id

    if max_visit_id is None:
        return None

    return {
        "previous_run_id": None if meta is None else meta.get("run_id"),
        "previous_source_max_visit_id": max_visit_id,
    }


def filter_incremental_records(records, previous_source_max_visit_id):
    if previous_source_max_visit_id is None:
        return list(records)

    output = []
    for record in records:
        visit_id = record_max_visit_id(record)
        if visit_id is not None and visit_id > previous_source_max_visit_id:
            output.append(record)
    return output


def persist_run(project_dir, records, meta):
    state_root = Path(project_dir) / ".clawrec" / "clawrec-unified-events"
    runs_root = state_root / "runs"
    latest_root = state_root / "latest"
    run_id = meta["run_id"]

    run_dir = ensure_clean_dir(runs_root / run_id)
    latest_dir = ensure_clean_dir(latest_root)

    run_meta_path = run_dir / "meta.json"
    run_evidence_path = run_dir / "evidence.jsonl"
    latest_meta_path = latest_dir / "meta.json"
    latest_evidence_path = latest_dir / "evidence.jsonl"

    write_json(meta, run_meta_path)
    write_jsonl(records, run_evidence_path)
    shutil.copy2(run_meta_path, latest_meta_path)
    shutil.copy2(run_evidence_path, latest_evidence_path)

    return {
        "state_root": str(state_root),
        "run_dir": str(run_dir),
        "latest_dir": str(latest_dir),
        "run_meta_path": str(run_meta_path),
        "run_evidence_path": str(run_evidence_path),
        "latest_meta_path": str(latest_meta_path),
        "latest_evidence_path": str(latest_evidence_path),
    }


def main():
    parser = argparse.ArgumentParser(description="Extract search and content evidence from Chrome History.")
    parser.add_argument("--history-db", required=True, help="Path to Chrome History SQLite database.")
    parser.add_argument("--config", required=True, help="Path to extractor config JSON.")
    args = parser.parse_args()

    config = load_config(args.config)
    full_snapshot = False
    output = None
    project_dir = "."
    profile_name = "Default"
    previous_watermark = None
    incremental_from_latest = not full_snapshot
    if incremental_from_latest:
        previous_watermark = load_previous_watermark(project_dir)
    records, meta = run_pipeline(args.history_db, config, profile_name, project_dir)
    if incremental_from_latest:
        previous_source_max_visit_id = None if previous_watermark is None else previous_watermark["previous_source_max_visit_id"]
        full_record_count = len(records)
        records = filter_incremental_records(records, previous_source_max_visit_id)
        meta["incremental_from_latest"] = True
        meta["base_emitted_record_count"] = full_record_count
        meta["emitted_record_count"] = len(records)
        meta["previous_run_id"] = None if previous_watermark is None else previous_watermark["previous_run_id"]
        meta["previous_source_max_visit_id"] = previous_source_max_visit_id
    else:
        meta["incremental_from_latest"] = False
    meta["run_id"] = run_id_utc_now()
    persistence = persist_run(project_dir, records, meta)
    meta.update(persistence)
    write_json(meta, Path(persistence["run_dir"]) / "meta.json")
    write_json(meta, Path(persistence["latest_dir"]) / "meta.json")
    if output:
        write_jsonl(records, output)
        meta["export_path"] = str(Path(output))
        write_json(meta, Path(persistence["run_dir"]) / "meta.json")
        write_json(meta, Path(persistence["latest_dir"]) / "meta.json")
    print(json.dumps(meta, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
