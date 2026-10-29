---
name: clawrec-orchestrating-search-execution
description: Orchestrates ClawRec search execution by reading executable Search Instruction blocks from .clawrec/clawrec-content-plan/latest/PLAN.md, validating Platform/Query/Task-Goal plus optional Requested-Count and User-Constraints, dispatching exactly one isolated subagent at a time against a visible user browser session, and writing auditable task/result/error artifacts under .clawrec/clawrec-search-execution/.
---

# Orchestrating Search Execution

## Purpose

Turn executable ClawRec Search Instruction blocks into an auditable search execution run.

This Skill performs sequential task decomposition and result collection only. It validates current-contract instructions, creates isolated execution tasks, dispatches each task to `clawrec-executing-search-instruction`, and records task-level indexes that point to executor-written canonical Markdown results. It does not create plans, browse platforms, inspect pages, summarize evidence, rank recommendations, parse result Markdown into display cards, render UI, or write user memory.

## Use When

Use this Skill when OpenClaw has:

```text
.clawrec/clawrec-content-plan/latest/PLAN.md
```

and needs standard run artifacts in:

```text
.clawrec/clawrec-search-execution/latest/
.clawrec/clawrec-search-execution/runs/<run_id>/
```

If there is no content plan, use the planning layer first. If the task is one ad hoc platform search without run artifacts, call `clawrec-executing-search-instruction` directly.

## Input Contract

Read only:

```text
.clawrec/clawrec-content-plan/latest/PLAN.md
skills/clawrec-executing-search-instruction/references/platform-index.md
.clawrec/clawrec-user-state/extended-platforms/index.md
```

The dynamic platform index is a platform registry owned by state synthesis. Reading it does not permit reading `USER_STATE.md`, `STATE_UPDATES.md`, `NEGATIVE_SIGNALS.md`, raw browser evidence, browsing history, previous search results, or surrounding prose to complete missing fields. `PLAN.md` is still the complete authority for what may be searched.

The current Search Instruction contract uses:

- Required planner metadata: bracket id, `Target-Column-Id`, `State-Key-Ref`.
- Required execution input: `Platform`, `Query`, `Task-Goal`.
- Optional execution input: `Requested-Count`, `User-Constraints`.

Missing `Requested-Count` or `User-Constraints` is valid. Do not add defaults.

If the dynamic platform index is absent, continue with the repo-static built-in platforms only.

Optional scheduler configuration may provide:

```json
{
  "run_id": "optional explicit run id",
  "max_concurrency": 1,
  "task_timeout_seconds": 900,
  "max_retries": 0,
  "stop_on_critical_error": false
}
```

Runtime rules:

- `run_id`: current timestamp-safe identifier.
- `max_concurrency`: fixed at `1`. Treat any provided value as `requested_max_concurrency`, ignore higher requested values, and record a warning in `RUN.md`.
- `task_timeout_seconds`: `900`.
- `max_retries`: `0`.
- `stop_on_critical_error`: `false` for task-level failures, `true` for invalid or inaccessible run setup.

## Browser Runtime Contract

Never use a headless browser for ClawRec search execution. Search execution requires a visible user browser session because platform login state, verification state, and visible page evidence are part of the task.

Resolve browser access once during run setup from OpenClaw config `browser.defaultProfile`:

- If `defaultProfile` is `user`, use DevTools MCP against the user's visible browser session.
- If `defaultProfile` is neither `user` nor `openclaw`, use that profile's CDP URL when available.
- If `defaultProfile` is `openclaw`, accept it only when it attaches to a visible logged-in user browser session.
- If the configured profile is missing, has no usable visible-browser attachment, or cannot be reached, ask the user to select or provide a usable visible browser profile. Do not downgrade to headless.

The orchestrator owns browser profile selection for planned runs. Resolve browser access before dispatch, record the selected browser access mode in run artifacts, and pass only that browser access instruction to each subagent worker. Workers must not choose headless mode or switch to an alternate browser profile.

Browser automation is sequential. Real visible browser sessions, login state, and platform pages are shared mutable resources, so `max_concurrency` is fixed at `1`. Each task may still run in an isolated subagent for model-context isolation; with `max_concurrency=1`, the active subagent has exclusive browser use during its task.

Do not pre-spawn, batch-create, queue, or keep alive multiple task subagents. At any moment there may be at most one task subagent that has been started and not yet completed or closed.

## Search Instruction Parsing

Parse only explicit blocks under `## Search Instructions` in `PLAN.md`. A block normally has a heading such as:

```markdown
### [search-001]
- Target-Column-Id: urgent_needs
- State-Key-Ref: intent.some-key
- Platform: arXiv
- Query: graph neural recommender benchmark
- Task-Goal: survey representative papers with attention to methods and applicable scenarios
- Requested-Count: 3
- User-Constraints:
  - paper_focus: method differences
```

`instruction_id` is the bracketed heading id, for example `search-001`.

Treat field names as exact contract names. Do not satisfy current required fields from legacy aliases such as `Target-Platform`, `Search-Goal`, `Filters`, `Content-Type`, `Expected-Count`, or `Keywords`.

## Validation

Each valid Search Instruction must have exactly one target platform and one planned query. The executor may later perform bounded supplemental queries under its own query-expansion rules, but the orchestrator does not add, split, or rewrite queries.

Before validating Search Instructions, merge supported-platform indexes:

- `skills/clawrec-executing-search-instruction/references/platform-index.md`
- optional `.clawrec/clawrec-user-state/extended-platforms/index.md`

Both indexes must use Markdown table columns `Platform`, `Type`, `Reference`, and `Status`. Use only `Status: active` rows. Reject malformed rows, missing reference files, duplicate ids, and dynamic/static platform collisions before dispatching affected tasks.

Required fields:

| PLAN field | Use | Execution input |
|---|---|---|
| bracket id | Scheduling trace | not passed as business input |
| `Target-Column-Id` | Planner metadata | not passed as business input |
| `State-Key-Ref` | Planner metadata | not passed as business input |
| `Platform` | Search platform | `platform` |
| `Query` | On-site search text | `query` |
| `Task-Goal` | Execution objective | `task_goal` |

`Target-Column-Id` must be non-empty. `State-Key-Ref` must be non-empty; use the literal value `none` only when the planner had no concrete state key.

Optional fields:

| PLAN field | Execution input | Rule |
|---|---|---|
| `Requested-Count` | `requested_count` | If present, must be a positive integer. |
| `User-Constraints` | `user_constraints` | If present, every field name must be allowed for the selected platform. |

Allowed `Platform` values are exactly the active platform ids in the merged platform index. `generic_web`, `SourceExtension`, search engines, and arbitrary unregistered domains are invalid.

Allowed `User-Constraints` fields for built-in platforms:

| Platform | Fields |
|---|---|
| `YouTube` | `content_type`, `upload_time`, `duration`, `sort_preference`, `selection_preference` |
| `Bilibili` | `sort_by`, `date_range`, `duration_range`, `selection_preference` |
| `Zhihu` | `time_range`, `sort_by`, `content_type`, `selection_preference` |
| `小红书` | `result_type`, `note_focus`, `media_focus`, `selection_preference` |
| `新华网` | `search_scope`, `sort_by`, `article_focus` |
| `人民网` | `exact_match`, `page_depth`, `article_focus` |
| `淘宝` | `price_constraint`, `style_constraint`, `function_constraint`, `sort_by`, `buyer_profile` |
| `京东` | `buying_intent`, `budget_constraint`, `visible_filter_request`, `function_constraint`, `qna_focus` |
| `arXiv` | `detail_page_preference`, `paper_focus` |

For extended platforms, `User-Constraints` is invalid unless a future validated contract explicitly defines allowed fields for that platform. The generated extended-platform reference owns search workflow details.

Record validation failures in `errors.jsonl`, mark the task `skipped`, and do not dispatch it:

- Missing, empty, or non-scalar required field: `missing_required_field`.
- Unsupported platform surface value: `invalid_platform`.
- Malformed or inconsistent platform index row: `invalid_platform_index`.
- Non-positive or non-integer `Requested-Count`: `invalid_requested_count`.
- Unknown `User-Constraints` field for the platform: `invalid_user_constraint`.

Do not infer whether a constraint value is better or worse. Unknown constraint fields are validation errors; do not delete, rename, map, or replace them. Missing optional fields are not failures.

## Task Mapping

Default mapping:

```text
one Search Instruction -> one execution task -> one clawrec-executing-search-instruction run
```

Create stable task ids in plan order: `task_001`, `task_002`, `task_003`.

Do not combine multiple Search Instructions into one task. Do not split a single instruction into multiple planned query variants. If the plan needs multiple distinct task directions, the planner must create multiple Search Instruction blocks.

Write every parsed instruction to `tasks.jsonl`. Use `skipped` for instructions that fail validation, with unavailable task fields omitted or set to `null` consistently. Valid tasks start as `pending` and are later updated to `running`, `success`, or `failed`.

For valid tasks, record platform registry metadata in task audit fields:

- `platform_type`: `built-in` or `extended`;
- `platform_reference_path`: the Markdown reference selected from the merged platform index.

These are audit/routing metadata. They must not become planner fields or business input.

## Dispatch Contract

Dispatch each valid task to `clawrec-executing-search-instruction` as one isolated task. Metadata, browser access, and artifact paths are runtime envelope fields; they must not be mixed into business input.

Each task should run in an isolated subagent when supported. Dispatch one task subagent, wait for that subagent to finish or time out, collect its output, close it when supported, and only then dispatch the next task. Never start another task subagent while a previous task subagent is still running, waiting, queued, or unclosed.

The subagent may use only the current task envelope, must not inspect other tasks or prior outputs, and must not perform global orchestration, cross-task reasoning, plan repair, ranking, deduplication, result parsing, or display-data assembly. The orchestrator alone owns task decomposition, result collection, status tracking, error recording, browser profile selection, and run-level audit summaries.

Dispatch envelope:

```json
{
  "task_id": "task_001",
  "instruction_id": "search-001",
  "browser_access": {
    "profile": "user-cdp",
    "mode": "visible_cdp",
    "headless": false
  },
  "artifact_paths": {
    "result_markdown_path": ".clawrec/clawrec-search-execution/runs/20260513T175657/tasks/task_001/RESULT.md",
    "asset_dir": ".clawrec/clawrec-search-execution/runs/20260513T175657/assets/task_001/"
  },
  "platform_reference": {
    "type": "built-in",
    "path": "skills/clawrec-executing-search-instruction/references/arxiv.md"
  },
  "execution_input": {
    "platform": "arXiv",
    "query": "graph neural recommender benchmark",
    "task_goal": "survey representative papers with attention to methods and applicable scenarios",
    "requested_count": 3,
    "user_constraints": {
      "paper_focus": "method differences"
    }
  }
}
```

`execution_input` may contain only `platform`, `query`, `task_goal`, and optional `requested_count` / `user_constraints` from `PLAN.md`. `platform_reference` is envelope metadata selected from the merged platform index. `browser_access` must never allow headless execution. `artifact_paths` tells the worker where to write the canonical Markdown result and task assets.

Worker instruction:

- This is one platform and one planned query.
- Use the provided `browser_access`; do not choose another browser profile.
- Never use a headless browser.
- Use the provided `platform_reference` path after reading `references/common-browser-rules.md`; do not substitute another platform reference.
- Write the complete final Markdown to `artifact_paths.result_markdown_path`.
- Save per-result primary images under `artifact_paths.asset_dir`.
- Use only `execution_input` as search business input.
- Do not read other Search Instructions or prior task outputs.
- Do not add plan-external platforms or constraints.
- You may use bounded supplemental queries only as allowed by `clawrec-executing-search-instruction`; disclose original query, supplemental queries, reason, and boundary in `RESULT.md`.
- Return platform-specific Markdown for the current task.
- If login, CAPTCHA, risk control, permission, or visible-page access blocks execution, return the blocking reason and stop.

Retries are allowed only for the same task input, same `browser_access`, and same `artifact_paths` after dispatch failure or worker crash. Do not retry with headless mode, bypass platform access blocks, or change the task.

## Output Contract

Create both a run snapshot and a latest pointer:

```text
.clawrec/clawrec-search-execution/runs/<run_id>/
.clawrec/clawrec-search-execution/latest/
```

The run directory contains root audit files plus task and asset directories:

```text
RUN.md
tasks.jsonl
results.jsonl
errors.jsonl
meta.json
tasks/<task_id>/RESULT.md
assets/<task_id>/<item_id>/primary_image.<ext>
```

`latest/` must let downstream systems find the same task result files and assets, either by mirroring them or by pointing to the run snapshot. Do not rewrite facts already recorded by executor Markdown.

The orchestrator must also write search-execution observation exclusions for the run-level browser execution window:

```text
.clawrec/clawrec-observation-exclusions/search-execution/runs/<run_id>/exclusions.jsonl
.clawrec/clawrec-observation-exclusions/search-execution/runs/<run_id>/meta.json
.clawrec/clawrec-observation-exclusions/search-execution/latest/exclusions.jsonl
.clawrec/clawrec-observation-exclusions/search-execution/latest/meta.json
```

Use the bundled helper after the search execution run `meta.json` has `started_at`, `finished_at`, and `dispatched_task_count`:

```bash
python3 skills/clawrec-orchestrating-search-execution/scripts/write_observation_exclusions.py \
  --run-dir .clawrec/clawrec-search-execution/runs/<run_id>
```

Do not write search-execution exclusions into a shared `.clawrec/clawrec-observation-exclusions/latest/` file. The observer reads producer-specific latest files and merges them.

When correcting a previous collection in the same run, also write `corrections.jsonl` or preserve both initial and corrected result files. Do not silently replace placeholder or invalid outputs while leaving the original run narrative as a clean success.

Use newline-delimited JSON for `.jsonl` files. Preserve task order by `task_id`.

### `tasks.jsonl`

Each line records one parsed executable task and its final status:

```json
{
  "run_id": "20260513T175657",
  "task_id": "task_001",
  "instruction_id": "search-001",
  "target_column_id": "urgent_needs",
  "state_key_ref": "intent.some-key",
  "platform": "arXiv",
  "platform_type": "built-in",
  "platform_reference_path": "skills/clawrec-executing-search-instruction/references/arxiv.md",
  "query": "graph neural recommender benchmark",
  "task_goal": "survey representative papers with attention to methods and applicable scenarios",
  "requested_count": 3,
  "user_constraints": {
    "paper_focus": "method differences"
  },
  "status": "pending|running|success|failed|skipped",
  "created_at": "..."
}
```

When optional fields are absent, omit them or set them to `null` consistently. Do not treat absence as a validation error.

### `results.jsonl`

Each success line is a task result index, not the full worker output and not a parsed result copy:

```json
{
  "run_id": "20260513T175657",
  "task_id": "task_001",
  "instruction_id": "search-001",
  "target_column_id": "urgent_needs",
  "state_key_ref": "intent.some-key",
  "platform": "Bilibili",
  "query": "毕业答辩 PPT 制作 教程",
  "task_goal": "find representative Bilibili tutorials for graduation defense PPT creation",
  "status": "success",
  "result_format": "platform_specific_markdown",
  "result_markdown_path": ".clawrec/clawrec-search-execution/runs/20260513T175657/tasks/task_001/RESULT.md",
  "asset_dir": ".clawrec/clawrec-search-execution/runs/20260513T175657/assets/task_001/",
  "summary": "Bilibili task returned 3 tutorial videos with verified detail links, visible engagement data, comment status, comparison notes, recommendation order, and per-item primary image blocks.",
  "result_count": 3,
  "primary_image_status_summary": {
    "saved": 3,
    "not_visible": 0,
    "not_available": 0,
    "capture_failed": 0
  },
  "execution_input": {
    "platform": "Bilibili",
    "query": "毕业答辩 PPT 制作 教程",
    "task_goal": "find representative Bilibili tutorials for graduation defense PPT creation",
    "requested_count": 3
  },
  "collected_at": "..."
}
```

`result_markdown_path` is required and must point to a non-empty executor-written `RESULT.md`. `summary` is an index-level task summary, preferably worker-provided or artifact-level; it must not summarize item evidence or replace `RESULT.md`. Optional audit fields such as `result_markdown_char_count` or `result_markdown_sha256` are allowed, but they must not become another result copy.

Do not copy the full Markdown into `results.jsonl`. Do not save a duplicate parsed worker result. Do not convert platform-specific Markdown into a generic `results[]` schema, recommendation cards, rankings, or display fields.

If the worker does not write `RESULT.md`, writes an empty file, or only returns a summary without the canonical file, record `collect_failure` or `worker_failure`; do not mark the task success.

### Worker output validity

A successful worker output must be concrete, self-contained, related to the task, and backed by a non-empty `RESULT.md`. Treat these as `invalid_worker_output` or `collect_failure` instead of success:

- missing or empty `RESULT.md`;
- placeholder phrases such as `see run artifacts`, `see previous run artifacts`, `results were collected successfully`, `stored elsewhere`, `todo`, or `placeholder`;
- output that only says the task succeeded without links, selected results, summaries, blocking details, or platform-specific evidence;
- output that is clearly unrelated to the task.

### Query expansion disclosure

The executor may use bounded supplemental queries. Do not require a structured `query_expansion` field in `results.jsonl`, and do not require every selected result to identify which query found it. Inspect `RESULT.md` and keep task status as `success` when the output is concrete and self-contained, even if supplemental queries were used.

When supplemental queries are reported, `RESULT.md` should disclose original query, supplemental queries, reason for expansion, and expansion boundary. If supplemental queries exceed executor limits, introduce a new concrete entity outside disambiguation, shift search focus, or are driven by keywords discovered in opened results, record the issue in `RUN.md` quality notes. Do not convert the task to failed solely for disclosed query expansion problems when `RESULT.md` is otherwise concrete and self-contained.

### `errors.jsonl`

Each line records one parse, validation, dispatch, execution, timeout, collection, or output-shape failure:

```json
{
  "run_id": "20260513T175657",
  "task_id": "task_004",
  "instruction_id": "search-004",
  "stage": "parse|validate|dispatch|execute|collect",
  "error_type": "invalid_user_constraint",
  "message": "User-Constraints contains field 'duration' for Zhihu; allowed fields are time_range, sort_by, content_type, selection_preference.",
  "recoverable": true,
  "recommended_action": "Regenerate PLAN.md with platform-allowed User-Constraints fields."
}
```

Allowed error types: `plan_missing`, `no_search_instructions`, `missing_required_field`, `invalid_platform`, `invalid_platform_index`, `invalid_requested_count`, `invalid_user_constraint`, `dispatch_failure`, `blocked`, `timeout`, `worker_failure`, `empty_worker_output`, `invalid_worker_output`, `collect_failure`.

Use `blocked` when platform login, CAPTCHA, risk control, permission, or visible-page access prevents execution. Use `worker_failure` with `visible user browser session required but unavailable; headless browser is forbidden` for browser-session failure. Use `collect_failure` when the worker appears to finish but canonical `RESULT.md` is missing or empty. Use `invalid_worker_output` when output is unrelated, placeholder-only, or claims success without task evidence.

### `RUN.md`

Write a human-readable audit summary with:

- run id, input `PLAN.md` path, executor IO contract reference, output paths, and scheduler configuration;
- platform index paths, dynamic-index presence, active platform count, and any platform-index validation failures;
- browser access summary and ignored concurrency warning if applicable;
- total, valid, dispatched, successful, failed, and skipped task counts;
- platform distribution using surface platform values;
- schema validation failures, execution failures, blocked tasks, placeholder failures, and collection failures;
- result artifact completeness: `RESULT.md` success count, missing/empty result files, asset directory availability, and primary image status summary;
- query expansion disclosure counts and quality notes when supplemental queries were used;
- correction records when prior invalid or placeholder outputs were replaced;
- tasks without optional `Requested-Count` or `User-Constraints`;
- output files available for downstream integration.

`RUN.md` must not contain final recommendations, display cards, rewritten search plans, generated UI text, hidden failure summaries, or full task result Markdown.

### `meta.json`

Record run metadata:

```json
{
  "run_id": "20260513T175657",
  "schema_version": "search_instruction_v2",
  "plan_path": ".clawrec/clawrec-content-plan/latest/PLAN.md",
  "platform_index_path": "skills/clawrec-executing-search-instruction/references/platform-index.md",
  "dynamic_platform_index_path": ".clawrec/clawrec-user-state/extended-platforms/index.md",
  "dynamic_platform_index_present": false,
  "active_platform_count": 9,
  "planner_contract": "docs/clawrec-content-plan-search-instruction-contract-change-plan.md",
  "executor_io_contract": "docs/clawrec-executing-search-instruction-io-contract.md",
  "output_dir": ".clawrec/clawrec-search-execution/runs/<run_id>/",
  "latest_dir": ".clawrec/clawrec-search-execution/latest/",
  "tasks_dir": ".clawrec/clawrec-search-execution/runs/<run_id>/tasks/",
  "assets_dir": ".clawrec/clawrec-search-execution/runs/<run_id>/assets/",
  "started_at": "...",
  "finished_at": "...",
  "task_count": 0,
  "valid_task_count": 0,
  "dispatched_task_count": 0,
  "success_count": 0,
  "error_count": 0,
  "max_concurrency": 1,
  "requested_max_concurrency": 1,
  "concurrency_warning": null,
  "browser_default_profile": "user-cdp",
  "browser_access_mode": "visible_cdp",
  "browser_access_profile": "user-cdp",
  "headless_browser_allowed": false,
  "task_timeout_seconds": 900,
  "observation_exclusion_latest_path": ".clawrec/clawrec-observation-exclusions/search-execution/latest/exclusions.jsonl"
}
```

### Observation Exclusions

`exclusions.jsonl` has one run-level record when `dispatched_task_count > 0`; it is empty when no task was dispatched and therefore no browser execution window needs exclusion.

The run-level record shape is:

```json
{
  "schema_version": "clawrec_observation_exclusion_v1",
  "record_type": "observation_exclusion",
  "producer": "search-execution",
  "run_id": "20260513T175657",
  "exclusion_id": "exclude:search-execution:20260513T175657",
  "reason": "agent_search_execution",
  "applies_to": ["search_hit", "content_hit"],
  "match": {
    "window_start_ms": 1780000000000,
    "window_end_ms": 1780000900000
  },
  "source": {
    "artifact": ".clawrec/clawrec-search-execution/runs/20260513T175657/meta.json",
    "search_execution_run_id": "20260513T175657",
    "browser_access_mode": "visible_cdp",
    "browser_access_profile": "user-cdp",
    "started_at": "...",
    "finished_at": "...",
    "dispatched_task_count": 3
  },
  "created_at": "..."
}
```

This artifact is not user behavior evidence and must not be read by state synthesis. It exists only so `clawrec-observing-browser-behavior` can filter agent-owned browser activity before emitting UnifiedEvent evidence.

## Workflow

1. Verify `PLAN.md` exists and is readable.
2. Create `run_id`, run directory, `tasks/`, `assets/`, and `latest` directory.
3. Resolve visible browser access from `browser.defaultProfile`; stop before dispatch if no usable visible browser session is available.
4. Fix `max_concurrency` at `1`; if a higher value was requested, record a warning and ignore it.
5. Read and validate the repo-static platform index plus the optional dynamic platform index.
6. Parse Search Instruction blocks in plan order.
7. Validate each instruction against the current contract and merged active platform set.
8. Write parsed tasks to `tasks.jsonl`; write invalid instructions to `errors.jsonl` with `skipped` task status.
9. For each valid task, create its `RESULT.md` path and asset directory path, then dispatch one subagent with those artifact paths and platform reference metadata.
10. Wait for that subagent to complete or time out, collect and close it, then move to the next task.
11. Verify `RESULT.md` exists and is non-empty before marking success.
12. Write a task result index line to `results.jsonl`; write no full Markdown or parsed result copy there.
13. Validate worker output for placeholders and self-contained task evidence.
14. Inspect disclosed query expansion and record quality notes without failing otherwise concrete successful outputs.
15. Update final task statuses.
16. Write `results.jsonl`, `errors.jsonl`, `RUN.md`, and `meta.json`.
17. Run `write_observation_exclusions.py` for the run-level search-execution window.
18. Copy or atomically mirror the completed run files, task results, assets, and search-execution observation exclusions into their `latest/` directories.
19. Run the verification checklist before handoff.

## Failure Handling

Plan-level failures stop execution after writing `RUN.md` and `meta.json` when possible. Plan-level failures include missing `PLAN.md`, unreadable input, unwritable output directory, no parseable Search Instruction blocks, or no usable visible browser session during run setup. For browser-session setup failure, also write an `errors.jsonl` line with `stage: "dispatch"`, `error_type: "worker_failure"`, and the required visible-browser message when possible.

Task-level failures are recorded and execution continues. Task-level failures include schema errors, invalid platforms, invalid user constraint fields, dispatch failure, platform access blocks, timeout, worker failure, missing or empty `RESULT.md`, empty worker output, invalid worker output, and collection failure.

If a worker reports unavailable visible browser access, headless browser startup, or headless browser startup timeout after dispatch, record `error_type: "worker_failure"`. The message must include: `visible user browser session required but unavailable; headless browser is forbidden`. Treat this as a browser runtime contract violation, not a platform `blocked` result.

If a worker initially returned a placeholder or invalid output and a later correction is collected, keep an append-only correction record. A correction must state the affected task, previous issue, correction action, and new status.

Never:

- fabricate results;
- silently skip failed instructions;
- mark a blocked platform as no results;
- mark summary-only output as success;
- add plan-external platforms or constraints;
- substitute a different platform reference than the merged index selected;
- use or permit headless browser execution;
- rewrite `PLAN.md`;
- hide failures inside prose summaries.

## Boundaries

Do not:

- create or modify user state;
- create a new content plan;
- infer platforms, queries, task goals, requested counts, or user constraints;
- read raw browser evidence or prior search results;
- open browsers or access external platforms directly;
- summarize detail pages, comments, reviews, papers, or products;
- capture, download, select, generate, or repair primary images;
- parse executor Markdown into structured display data;
- rank, deduplicate, or recommend final content;
- create recommendation cards or HTML;
- save duplicate parsed worker results;
- copy full `RESULT.md` content into `results.jsonl`;
- expand outside the merged active platform indexes.

Adjacent responsibilities:

- `clawrec-making-content-plan` decides what should be searched.
- `clawrec-orchestrating-search-execution` isolates, dispatches, tracks, and indexes planned searches.
- `clawrec-executing-search-instruction` performs one real platform search, writes `RESULT.md`, and saves primary images.
- Downstream integration reads `RESULT.md` and assets to structure, rank, deduplicate, and display results.

## Verification

Before handoff, confirm:

```bash
test -s .clawrec/clawrec-search-execution/latest/RUN.md
test -s .clawrec/clawrec-search-execution/latest/tasks.jsonl
test -f .clawrec/clawrec-search-execution/latest/results.jsonl
test -f .clawrec/clawrec-search-execution/latest/errors.jsonl
test -s .clawrec/clawrec-search-execution/latest/meta.json
test -f .clawrec/clawrec-observation-exclusions/search-execution/latest/exclusions.jsonl
test -s .clawrec/clawrec-observation-exclusions/search-execution/latest/meta.json
```

Then inspect artifacts and confirm:

- every valid task has `Platform`, `Query`, and `Task-Goal`;
- tasks missing `Requested-Count` or `User-Constraints` can still dispatch;
- every platform is active in the merged platform index;
- every built-in `User-Constraints` field matches the built-in constraint table;
- extended-platform tasks have no `User-Constraints` unless a future validated contract explicitly permits them;
- every valid task records `platform_type` and `platform_reference_path`;
- dispatch business input contains only executor IO contract fields;
- browser access uses a visible user browser mode and never allows headless execution;
- `max_concurrency` is `1`, with higher requested values recorded as warnings;
- no task was pre-spawned, queued, or run while another task subagent was active;
- every success line in `results.jsonl` has `result_markdown_path`;
- every `result_markdown_path` points to an existing non-empty `RESULT.md`;
- `results.jsonl` does not copy full Markdown, use summary-only success, save duplicate parsed results, or contain generic `results[]`;
- if `RESULT.md` contains local primary image paths, the orchestrator only records the task asset directory and does not alter image status;
- every failed or skipped task has an error line;
- every successful worker output is concrete and not a placeholder;
- disclosed supplemental queries are kept as success but noted in `RUN.md` when they exceed executor boundaries;
- invalid instructions are recorded with current-contract error types;
- `latest/` can locate the same `RESULT.md` files and assets as `runs/<run_id>/`.
- search-execution observation exclusions use the run-level `started_at`/`finished_at` window, apply to `search_hit` and `content_hit`, and are written only under the `search-execution/` producer namespace.
