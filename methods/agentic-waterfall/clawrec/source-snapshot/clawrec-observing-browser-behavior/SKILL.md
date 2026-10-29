---
name: clawrec-observing-browser-behavior
description: Observes authorized local Chrome browsing behavior by running the fixed Chrome History extractor. Use when ClawRec needs browser-derived behavior evidence, search intent events, content interest events, session links, or run metadata from a local Chrome History SQLite database.
---

# Observing Browser Behavior

## Purpose

Extract authorized local Chrome History evidence into ClawRec UnifiedEvent files. This Skill observes what happened in the browser: page visits, search queries, foreground dwell signals, and navigation/session relationships.

It produces behavior evidence only. It does not infer user interests, generate recommendations, retrieve cross-platform content, or decide user intent.

Before emitting behavior evidence, the extractor applies ClawRec observation exclusions from producer-specific latest files. These exclusions prevent ClawRec-owned browser activity, such as display-feedback clicks and orchestrated search execution, from being emitted as user behavior evidence.

## Scope

Use this Skill only when the user has authorized local browser evidence extraction and provides or accepts these inputs:

- Chrome History SQLite database path
- Extractor configuration path

Default inputs:

```bash
--history-db "$HOME/Library/Application Support/Google/Chrome/Default/History"
--config skills/clawrec-observing-browser-behavior/scripts/extractors.json
```

Optional exclusion inputs are discovered automatically when present:

```text
.clawrec/clawrec-observation-exclusions/display-feedback/latest/exclusions.jsonl
.clawrec/clawrec-observation-exclusions/search-execution/latest/exclusions.jsonl
```

Do not create or read a shared `.clawrec/clawrec-observation-exclusions/latest/exclusions.jsonl` file; observation exclusions use per-producer latest files and the observer merges them at extraction time.

## Required Command

Run the bundled extractor; do not handwrite SQLite queries or reimplement extraction logic.

```bash
python3 skills/clawrec-observing-browser-behavior/scripts/extract_evidence.py \
  --history-db "$HOME/Library/Application Support/Google/Chrome/Default/History" \
  --config skills/clawrec-observing-browser-behavior/scripts/extractors.json
```

The command must be run from the project root so output paths resolve under `.clawrec/clawrec-unified-events/`.

## Output Contract

The extractor writes:

- `.clawrec/clawrec-unified-events/latest/evidence.jsonl`
- `.clawrec/clawrec-unified-events/latest/meta.json`
- `.clawrec/clawrec-unified-events/runs/<run_id>/evidence.jsonl`
- `.clawrec/clawrec-unified-events/runs/<run_id>/meta.json`

`evidence.jsonl` is JSON Lines. Each line is one UnifiedEvent. Current event kinds are:

- `search_intent`: search engine, search query, normalized query, URL, title, time range, `session_id`, platform, and limited context links.
- `content_interest`: content key, canonical URL, title, page type, time range, `session_id`, platform, limited context links, and optional aggregate behavior signals such as `search_to_content`, `repeated_visit`, and `long_dwell`.

`content_interest` may include `platform: generic_web` and `page_type: webpage` for safe ordinary HTTP/HTTPS pages on non-whitelisted domains. These records are upstream interest evidence only; by themselves they do not add a downstream executable search or recommendation platform.

`meta.json` records run audit metadata such as browser, profile, `run_id`, extraction time, source visit counts, retained hit counts, emitted record counts, incremental watermark fields, and output paths.

When observation exclusions are present, `meta.json` also records count-only audit fields:

- `configured_observation_exclusion_source_paths`
- `consumed_observation_exclusion_source_paths`
- `observation_exclusion_record_count`
- `projected_hit_count`
- `excluded_hit_count`
- `exclusion_reason_counts`
- `exclusion_producer_counts`
- `exclusion_source_counts`

The observer does not write excluded browsing details to `evidence.jsonl` or to a separate excluded-evidence file in the MVP.

## Boundaries

Do not:

- infer interests, preferences, goals, or recommendations from the events;
- send raw browsing behavior to external content platforms;
- collect non-browser local behavior such as desktop app usage, file edits, clipboard content, calendar activity, or IDE activity;
- bypass browser or OS permissions;
- attempt to recover incognito history, protected site details, hidden records, or data outside the authorized Chrome History database;
- merge identities across devices or browser profiles unless the user explicitly supplies that already-authorized input for a separate downstream process;
- post-process extractor output into conclusions for recommendation modules.
- infer observation exclusions from feedback or search execution artifacts directly; consume only the producer-specific `exclusions.jsonl` files.

## Handoff

Treat the generated `latest/` files as the downstream handoff. They are standardized evidence and run audit artifacts, not long-term raw browsing logs and not final recommendation input.

If downstream modules need the data, pass file paths and metadata, not copied raw logs. Preserve the `runs/<run_id>/` snapshot for auditability.

## Verification

After running the extractor, verify these files exist:

```bash
test -s .clawrec/clawrec-unified-events/latest/meta.json
test -f .clawrec/clawrec-unified-events/latest/evidence.jsonl
```

Then inspect `meta.json` for `run_id`, `latest_evidence_path`, `latest_meta_path`, and `emitted_record_count`. Report the paths and counts; do not summarize the user's browsing content unless explicitly asked and authorized.

If observation exclusions exist, also confirm `excluded_hit_count` and the count maps are present in `meta.json`. Do not inspect or report excluded browsing content because the MVP persists exclusion audit only as counts.
