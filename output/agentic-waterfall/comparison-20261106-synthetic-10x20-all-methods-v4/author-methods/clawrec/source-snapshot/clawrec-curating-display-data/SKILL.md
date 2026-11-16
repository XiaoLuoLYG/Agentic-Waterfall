---
name: clawrec-curating-display-data
description: Curates ClawRec search execution outputs into rendering-ready display data. Use when .clawrec/clawrec-search-execution/latest/ and .clawrec/clawrec-content-plan/latest/PLAN.md exist and OpenClaw needs sectioned cards with title, source, href, summary, and optional local asset_path for clawrec-rendering-generative-interface.
---

# Curating Display Data

## Purpose

Turn the latest ClawRec search execution package into display data that `clawrec-rendering-generative-interface` can render directly.

This Skill uses model judgment to read natural-language `worker_output`, extract page-level cards, sort cards inside their planned section, and write auditable display-data artifacts. It does not browse, retrieve, rerun search, generate HTML, or mutate user state.

## Scope

Read only:

```text
.clawrec/clawrec-search-execution/latest/
.clawrec/clawrec-content-plan/latest/PLAN.md
```

Required search execution files:

```text
RUN.md
tasks.jsonl
results.jsonl
errors.jsonl
meta.json
```

Write:

```text
.clawrec/clawrec-display-data/runs/<run_id>/
.clawrec/clawrec-display-data/latest/
```

Create output directories before writing:

```bash
mkdir -p .clawrec/clawrec-display-data/runs/<run_id> .clawrec/clawrec-display-data/latest
```

Use the `run_id` from `.clawrec/clawrec-search-execution/latest/meta.json`. Do not create a separate curation run id. Do not read historical search runs.

## Required Input Check

Before curating, confirm:

```bash
test -s .clawrec/clawrec-search-execution/latest/results.jsonl
test -s .clawrec/clawrec-search-execution/latest/tasks.jsonl
test -s .clawrec/clawrec-search-execution/latest/meta.json
test -f .clawrec/clawrec-search-execution/latest/errors.jsonl
test -s .clawrec/clawrec-content-plan/latest/PLAN.md
```

If a required input is missing, stop and report the missing path. `errors.jsonl` may be empty, but it must exist.

## Input Model

`results.jsonl` is structured JSONL, but each successful line's `worker_output` may still be natural language. Do not require card-level JSON and do not use scripts to parse `worker_output`.

One `results.jsonl` line is one search task result. One search task may contain one page or many pages. A display card must represent one web page or one clickable detail page, not a whole search task.

Use `PLAN.md` to parse `## Display Plan` in order:

```markdown
### [urgent_needs]
- Theme-Title: Build right now
- Rationale: ...
```

Map each result's `target_column_id` to its Display Plan column. Preserve the Display Plan section order exactly.

## Display Output Contract

Write `display-data.json` with rendering fields only:

```json
{
  "sections": [
    {
      "label": "Right now",
      "topic": "Build right now",
      "cards": [
        {
          "card_id": "search-001-card-001",
          "title": "Card title",
          "source": "Source name",
          "href": "https://example.org/detail",
          "summary": "Display summary",
          "asset_path": "/local/path/image.png"
        }
      ]
    }
  ]
}
```

Rules:

- `sections` must be non-empty for a successful display-data output.
- `topic` is the matching Display Plan `Theme-Title`.
- `label` is a short human-readable category derived from the column id and theme, for example `urgent_needs` -> `Right now`. Do not hardcode a global mapping table.
- `cards` must be non-empty for every emitted section.
- Every card requires `title`, `source`, `href`, and `summary`.
- `card_id` is optional upstream; generate a stable id when absent, such as `<instruction_id>-card-001`.
- `asset_path` is optional. Include it only when the upstream output provides a local path and that path exists.
- Do not put evidence notes, task ids, exclusion reasons, or ranking rationale in `display-data.json`.

If no displayable cards remain, do not publish an empty `display-data.json` as success. Write audit files when possible and report that no rendering-ready cards were available.

## Curation Workflow

1. Run the required input check.
2. Read `PLAN.md`; parse Display Plan columns, `Theme-Title`, and section order.
3. Read search `meta.json`; use its `run_id`.
4. Read `tasks.jsonl`, `results.jsonl`, and `errors.jsonl`.
5. Ignore failed, blocked, skipped, empty, or invalid worker outputs as display sources; record them in audit output when relevant.
6. For each successful task, read `worker_output` and identify page-level results.
7. For each page-level result, extract:
   - `title`: page, product, video, article, note, answer, or paper title;
   - `source`: channel, uploader, author, store, news source, paper source, or the best visible source name;
   - `href`: real detail link or other clickable outbound page link;
   - `summary`: upstream display-ready summary when present, otherwise a concise summary grounded only in that page's worker output;
   - `asset_path`: a supplied local image path when present and valid.
8. Keep text-complete cards even when image data is absent or unusable; omit invalid `asset_path`.
9. Exclude non-page-level material, duplicates, missing required fields, and items not relevant to the section theme.
10. Sort cards only within their section. Keep section order from `PLAN.md`.
11. Write `display-data.json`, `candidates.jsonl`, `excluded.jsonl`, `CURATION.md`, and `meta.json` to both `runs/<run_id>/` and `latest/`.
12. Run the verification checklist.

Sorting principle:

```text
Prefer results that better match the Theme-Title and Task-Goal, have stronger evidence, have usable detail links, include local images, avoid duplication, and provide higher display value.
```

Do not use score tables, fixed weights, or card-count limits. Do not truncate a section only to match `Requested-Count`.

## Audit Outputs

### `candidates.jsonl`

Write one JSON object per page-level candidate considered:

```json
{
  "run_id": "<run_id>",
  "task_id": "task_001",
  "instruction_id": "search-001",
  "target_column_id": "urgent_needs",
  "section_topic": "Build right now",
  "platform": "Bilibili",
  "title": "...",
  "source": "...",
  "href": "https://...",
  "summary": "...",
  "asset_path": "/local/path.png",
  "decision": "included|excluded",
  "reason": "..."
}
```

Extra evidence notes may appear here. They must not appear in `display-data.json`.

### `excluded.jsonl`

Write one JSON object per excluded page-level candidate or unusable task output. Use specific reasons such as:

- `blocked_task`
- `failed_task`
- `invalid_worker_output`
- `not_page_level_result`
- `missing_title`
- `missing_source`
- `missing_href`
- `missing_summary_evidence`
- `duplicate_href`
- `not_relevant_to_theme`
- `remote_image_not_supported`
- `local_image_missing`

Do not silently drop excluded material.

### `CURATION.md`

Summarize:

- source search run id;
- `PLAN.md` path;
- Display Plan sections;
- candidate, included, and excluded counts by section;
- main exclusion reasons;
- image handling notes;
- sections with no displayable cards;
- output paths.

`CURATION.md` is an audit summary, not user state, search evidence, a rewritten plan, or HTML.

### `meta.json`

Use machine-readable metadata:

```json
{
  "run_id": "<run_id>",
  "source_search_run_id": "<run_id>",
  "schema_version": "display_data_v1",
  "plan_path": ".clawrec/clawrec-content-plan/latest/PLAN.md",
  "search_execution_dir": ".clawrec/clawrec-search-execution/latest/",
  "output_dir": ".clawrec/clawrec-display-data/runs/<run_id>/",
  "latest_dir": ".clawrec/clawrec-display-data/latest/",
  "section_count": 0,
  "candidate_count": 0,
  "included_count": 0,
  "excluded_count": 0,
  "image_asset_count": 0,
  "created_at": "..."
}
```

## Boundaries

Do not:

- read historical search runs;
- read raw browser evidence or user-state files;
- create or modify content plans;
- open a browser or access external platforms;
- rerun search or enrich results from the web;
- use scripts for extraction, transformation, or validation;
- treat one search task as one card when it contains multiple pages;
- invent titles, sources, links, summaries, images, or recommendation claims;
- use remote image URLs as `asset_path`;
- create placeholder images or placeholder cards;
- include local image paths that do not exist;
- generate HTML or modify rendering runtime files;
- save output as user memory, retrieval evidence, or final recommendations.

## Verification

Before handoff, confirm:

```bash
test -s .clawrec/clawrec-display-data/latest/display-data.json
test -s .clawrec/clawrec-display-data/latest/candidates.jsonl
test -f .clawrec/clawrec-display-data/latest/excluded.jsonl
test -s .clawrec/clawrec-display-data/latest/CURATION.md
test -s .clawrec/clawrec-display-data/latest/meta.json
```

Then inspect the outputs and confirm:

- `display-data.json` is valid JSON.
- `sections` is non-empty.
- section order matches `PLAN.md` Display Plan order after dropping sections with no included cards.
- every section has `label`, `topic`, and non-empty `cards`.
- every card has `title`, `source`, `href`, and `summary`.
- every card represents one web page or clickable detail page.
- every included `asset_path` is a local path that exists.
- invalid or missing image paths did not remove otherwise complete text cards.
- excluded tasks and candidates are recorded with reasons.
- `display-data.json` contains only rendering fields.
