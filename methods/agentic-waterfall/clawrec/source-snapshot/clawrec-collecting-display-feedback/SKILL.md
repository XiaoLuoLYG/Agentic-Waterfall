---
name: clawrec-collecting-display-feedback
description: Collects explicit ClawRec display feedback from a rendered interface session by comparing displayed cards with rendering click events, then writes card-level click/skip records, section aggregates, and feedback packets under .clawrec/clawrec-feedback/.
---

# Collecting Display Feedback

## Purpose

Convert recommendation-page interactions into an auditable feedback artifact for state synthesis.

This Skill is the bridge from rendered interface sessions to user state. It does not render pages, collect browser history, search external platforms, or update `USER_STATE.md` directly.

## Scope

Use this Skill after the user has viewed a ClawRec rendered interface session and the caller explicitly decides to finalize feedback for that session.

MVP feedback actions:

- `click`: a displayed card has at least one `link-click` event.
- `skip`: a displayed card has no matching click event at explicit collection time.

Do not infer `skip` on server idle timeout, page reload, or a fixed elapsed time.

## Input Contract

Run from the project root. Required inputs:

```text
--events .clawrec/clawrec-generative-interface/<session_id>/state/events
```

Displayed cards come from one of:

```text
--manifest .clawrec/clawrec-generative-interface/<session_id>/state/displayed-cards.json
--display-data .clawrec/clawrec-display-data/latest/display-data.json
```

Prefer `--manifest` when it exists because it records the exact card ids that were rendered in the session. Use `--display-data` only when collecting from a publication that was rendered directly from that display data.

Optional inputs:

```text
--session-id <session_id>
--run-id <run_id>
--output-root .clawrec/clawrec-feedback
--exclusion-output-root .clawrec/clawrec-observation-exclusions/display-feedback
```

If `--session-id` is omitted, the collector tries to infer it from the `--events` path.

## Required Command

Use the bundled collector. Do not hand-edit feedback artifacts from `state/events`.

```bash
python3 skills/clawrec-collecting-display-feedback/scripts/collect_feedback.py \
  --manifest .clawrec/clawrec-generative-interface/<session_id>/state/displayed-cards.json \
  --events .clawrec/clawrec-generative-interface/<session_id>/state/events \
  --session-id <session_id>
```

If no displayed-card manifest was written, use the display-data fallback:

```bash
python3 skills/clawrec-collecting-display-feedback/scripts/collect_feedback.py \
  --display-data .clawrec/clawrec-display-data/latest/display-data.json \
  --events .clawrec/clawrec-generative-interface/<session_id>/state/events \
  --session-id <session_id>
```

## Output Contract

The collector writes both a run snapshot and a latest pointer:

```text
.clawrec/clawrec-feedback/runs/<run_id>/
.clawrec/clawrec-feedback/latest/
```

Each directory contains:

```text
feedback.jsonl
section-feedback.jsonl
unmatched-events.jsonl
feedback-packets.md
COLLECTION.md
meta.json
```

The collector also writes display-feedback observation exclusions with the same `run_id`:

```text
.clawrec/clawrec-observation-exclusions/display-feedback/runs/<run_id>/
.clawrec/clawrec-observation-exclusions/display-feedback/latest/
```

Each observation-exclusion directory contains:

```text
exclusions.jsonl
meta.json
```

`feedback.jsonl` has one record per displayed card. Each line contains:

- `schema_version`: `clawrec_feedback_v1`
- `record_type`: `card_feedback`
- `action`: `click` or `skip`
- `session_id`
- `card_id`
- `title`
- `source`
- `href`
- `section_label`
- `topic`
- `section_index`
- `card_index`
- `click_count`
- `first_clicked_at_ms`
- `last_clicked_at_ms`
- `collected_at`

`section-feedback.jsonl` has one aggregate record per displayed section. A section uses `action: "topic_skip"` only when every displayed card in that section was skipped. Sections with at least one click use `action: "section_has_click"` and must not be treated as topic-level negative feedback.

`feedback-packets.md` is the state-synthesis handoff. State synthesis must read this packet file rather than raw rendering events.

`unmatched-events.jsonl` records `link-click` events that did not match any displayed card by `cardId` or `href`.

`exclusions.jsonl` records clicked-card outbound URLs that browser observation must not turn into browser-derived behavior evidence. A display-feedback exclusion has:

- `schema_version`: `clawrec_observation_exclusion_v1`
- `record_type`: `observation_exclusion`
- `producer`: `display-feedback`
- `reason`: `display_feedback_click`
- `applies_to`: `["content_hit"]`
- `match.url`: clicked card `href`
- `match.window_start_ms`: first click timestamp minus 10 seconds
- `match.window_end_ms`: last click timestamp plus 2 minutes
- `source`: feedback provenance including `feedback_id`, `session_id`, `card_id`, and `href`

## Feedback Semantics

- A click is positive but weak evidence. It may reinforce a current need, recent interest, platform preference, or cross-platform topic when consistent with existing state.
- A single click must not create a durable long-term preference by itself.
- A card-level skip is weak negative evidence about that displayed card or source. A single skipped card must not become a hard suppression.
- A section-level `topic_skip` is a weak downrank signal for the section topic because every displayed card in that section was ignored at explicit collection time.
- If any card in a section was clicked, unclicked sibling cards remain card-level skips only; the section topic must not be marked skipped.

## Boundaries

Do not:

- update `USER_STATE.md`, `STATE_UPDATES.md`, or `NEGATIVE_SIGNALS.md` directly;
- read raw browser history or `.clawrec/clawrec-unified-events/`;
- infer feedback without explicit collection;
- treat page reloads, server shutdown, or idle timeout as skip triggers;
- invent displayed cards that are absent from the manifest or display data;
- treat unmatched click events as state evidence;
- write feedback into `.clawrec/clawrec-unified-events/`.
- write observation exclusions into a shared global latest file; use the `display-feedback/latest/` producer namespace.

## Verification

After collection, confirm:

```bash
test -s .clawrec/clawrec-feedback/latest/feedback.jsonl
test -s .clawrec/clawrec-feedback/latest/section-feedback.jsonl
test -f .clawrec/clawrec-feedback/latest/unmatched-events.jsonl
test -s .clawrec/clawrec-feedback/latest/feedback-packets.md
test -s .clawrec/clawrec-feedback/latest/COLLECTION.md
test -s .clawrec/clawrec-feedback/latest/meta.json
test -f .clawrec/clawrec-observation-exclusions/display-feedback/latest/exclusions.jsonl
test -s .clawrec/clawrec-observation-exclusions/display-feedback/latest/meta.json
```

Then inspect the artifacts and confirm:

- every displayed card has exactly one `feedback.jsonl` record;
- clicked cards are not marked as skipped;
- duplicate click events are deduplicated into one card-level `click` with `click_count > 1`;
- a section uses `topic_skip` only when all cards in that section are skipped;
- malformed input fails loudly instead of producing partial success.
- clicked cards with timestamps write `display_feedback_click` observation exclusions for their `href` and click-time window.
