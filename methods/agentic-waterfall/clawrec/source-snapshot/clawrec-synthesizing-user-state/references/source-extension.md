# Source Extension

Read this reference only when source-extension trigger conditions are present during `clawrec-synthesizing-user-state`.

## Purpose

Maintain behavior-grounded source affordances and, when the strict gate passes, register one source as a persistent extended platform that can be used by future Search Instructions.

This is a state-synthesis responsibility. Do not create a separate top-level source-extension skill, and do not use `SourceExtension` as a `Platform` value.

## Trigger Conditions

Use this reference when packet evidence or existing state suggests any of these:

- a non-sensitive public source/domain/source family repeatedly appears as useful for a current need or recent interest;
- update packets show `search_to_content`, `repeated_visit`, or `long_dwell` behavior signals for the same source;
- feedback packets contain an explicit `click` on a displayed item from the same source;
- `USER_STATE.md` already has an active `## Source Affordance Memory` item that may now meet the extension gate.

Do not run source extension for ordinary state updates that only change topics, preferences, or negative signals.

## Inputs

Use only state-synthesis inputs:

- `.clawrec/clawrec-user-state/latest-update-packets.md`
- optional `.clawrec/clawrec-feedback/latest/feedback-packets.md`
- `.clawrec/clawrec-user-state/USER_STATE.md`
- `.clawrec/clawrec-user-state/STATE_UPDATES.md`
- `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md`

Do not read raw browser history, raw rendering click logs, search execution outputs, display data, or observation exclusions.

## Source Affordance Memory

Keep source affordances inside `USER_STATE.md` under:

```markdown
## Source Affordance Memory
```

Use lightweight list entries. Keep them compact enough to scan, but include the fields needed by planning and future synthesis:

```markdown
- [source.<source-id>] role: <role> | anchor: <topic> / <intent> | source: <public domain or source family> | retriever: <on_site_search|site_constrained_search|unknown> | confidence: <0.00-1.00> | evidence: <packet refs> | signals: <search_to_content,repeated_visit,long_dwell,feedback_click> | status: active|tentative|suppressed|retired | platform: <platform-id or none> | updated: YYYY-MM-DD
```

Rules:

- `source-id` is a stable lowercase slug scoped to the source affordance.
- `source` must be a public, non-sensitive domain or source family, not a private URL, account page, payment page, personal drive, inbox, localhost, or internal service.
- `role` describes why the source is useful, such as `official_reference`, `project_docs`, `expert_community`, `institutional_source`, `product_catalog`, or `domain_reference`.
- `anchor` must combine topic and intent. It must be specific enough for the planner to match it to Current Needs or Recent Interests.
- `confidence` is a calibrated synthesis confidence, not a score copied from one event.
- `signals` lists distinct strong behavior evidence types visible from update packets or feedback packets.
- `platform` is `none` until an extended platform is registered. After registration, set it to the exact dynamic platform id.
- Existing built-in platforms may be mentioned as source affordances, but source extension is meant to capture behavior-induced sources beyond the built-in set.

## Strong Evidence Types

The strict platform-registration gate needs at least two different strong evidence types. Two occurrences of one type are not enough.

Recognized strong evidence types:

| Evidence type | Packet support |
|---|---|
| `search_to_content` | Update packet has a search-to-content chain for the source, or a content card has `Behavior signals: search_to_content`. |
| `repeated_visit` | Update packet content card has `Behavior signals: repeated_visit`, or multiple packet handles show materially repeated visits to the same source family. |
| `long_dwell` | Update packet content card has `Behavior signals: long_dwell`. |
| `feedback_click` | Feedback packet has an explicit `click` record for a displayed card from the source. |

If an older packet lacks rendered behavior signals, use only what is visibly auditable from the packet text. Do not infer hidden dwell time or hidden repeat counts.

## Registration Gate

Register a new extended platform only when all conditions are true:

- the source-affordance entry is `active`;
- `confidence >= 0.7`;
- the source-affordance anchor topic and intent match a current active need or recent interest;
- at least two different strong evidence types support the source;
- the source is a stable public, non-sensitive website or source family;
- no active negative signal, topic suppression, platform suppression, or privacy risk blocks it;
- the current synthesis run has not already registered another new platform, unless the user explicitly requested multiple registrations;
- the platform id does not collide with built-in platform ids or existing dynamic platform ids.

Do not register:

- `generic_web`;
- `SourceExtension`;
- a private, sensitive, account, inbox, payment, checkout, drive, localhost, internal, or unstable source;
- a source that only has one evidence type, even if repeated many times;
- a source whose public domain/source family cannot support either observed on-site search or stable `site:` constrained discovery;
- a source currently suppressed by topic, platform, or negative-signal state.

Weak source affordances may stay in `USER_STATE.md` as `tentative`, but they must not become executable platforms.

## Dynamic Platform Artifacts

When the registration gate passes, write or update:

```text
.clawrec/clawrec-user-state/extended-platforms/index.md
.clawrec/clawrec-user-state/extended-platforms/<platform-id>.md
```

The dynamic index is a Markdown table:

```markdown
# Extended Platform Index

| Platform | Type | Reference | Status |
|---|---|---|---|
| openai-docs | extended | .clawrec/clawrec-user-state/extended-platforms/openai-docs.md | active |
```

Rules:

- `Platform` is the exact future `PLAN.md` platform value.
- `Platform` should equal the filename stem.
- Dynamic platform ids are lowercase filesystem-safe slugs.
- `Type` is always `extended`.
- `Reference` is a project-relative path to the generated Markdown search instruction file.
- `Status` is `active`, `suppressed`, or `retired`.
- Missing dynamic index means no extended platforms have been registered yet. Create it only when the first platform is registered.
- Consumers ignore non-`active` rows. Do not delete suppressed or retired rows just to hide them.

The repo-static built-in index is:

```text
skills/clawrec-executing-search-instruction/references/platform-index.md
```

Dynamic platform ids must not duplicate any built-in platform id from the static index.

## Extended Platform File

Each `<platform-id>.md` file is a pure search instruction reference for `clawrec-executing-search-instruction`. It must teach the executor how to search and verify the target site.

Do not put these fields in the platform file:

- provenance;
- packet evidence refs;
- confidence;
- trigger rationale;
- source-affordance status;
- user-state summaries;
- negative-signal reasoning.

Those belong in `USER_STATE.md` and `STATE_UPDATES.md`.

Recommended file shape:

```markdown
# <Platform display name>

Use when the target platform is `<platform-id>`.

## Source Scope

- Accepted domain/source family: `<domain-or-source-family>`
- Reject results outside this scope.

## Search Workflow

1. <Open observed on-site search URL or homepage search path, or use search engine `site:<scope> <query>`.>
2. <Apply visible source-specific query style or filters if observed.>
3. Select candidates only from target-site pages under the accepted scope.
4. Open detail pages before summarizing.

## Evidence Boundaries

- Search result snippets are candidate discovery only.
- Summaries must come from opened target-site detail pages.
- Label wrapper/search-result links when a stable detail URL cannot be captured.
- Do not use off-scope pages as evidence.

## Output

Use the generic executor output structure with search conditions, selected results, primary image blocks, and comparison notes.
```

## Choosing Search Workflow

Prefer observed on-site search only when update packets clearly show an on-site search box, on-site search URL, or verified on-site search workflow for the source.

If no on-site search workflow was observed, use a visible search engine with a `site:<domain-or-source-family>` query as the primary discovery path.

`site:` search for an extended platform is not generic web browsing:

- it is limited to the registered source scope;
- it is only candidate discovery;
- snippets are not detail-page evidence;
- accepted results must be target-site detail pages;
- summaries must come from opened target-site pages;
- if the source cannot be represented by a stable public domain or source family, do not register it.

## Audit Trail

When source extension changes state, append `STATE_UPDATES.md` with:

- source-affordance entry changed or added;
- evidence handles used;
- distinct strong evidence types observed;
- gate decision: registered, not registered, suppressed, retired, or no change;
- dynamic platform id and reference path when registered;
- reason for no registration when the gate fails.

Update `USER_STATE.md` so the source-affordance entry and `platform` field match the outcome.

## Verification

After a source-extension synthesis run, inspect:

- `USER_STATE.md` has or updates `## Source Affordance Memory`;
- `STATE_UPDATES.md` records evidence handles and the gate decision;
- if a platform was registered, `.clawrec/clawrec-user-state/extended-platforms/index.md` exists and contains exactly one row for the new platform, with `Status: active`;
- the referenced `<platform-id>.md` exists;
- the platform file contains search instructions only, with no provenance/confidence/status/evidence fields;
- the dynamic id does not collide with static platform ids in `skills/clawrec-executing-search-instruction/references/platform-index.md`;
- no run registers more than one new platform unless the user explicitly requested multiple registrations.
