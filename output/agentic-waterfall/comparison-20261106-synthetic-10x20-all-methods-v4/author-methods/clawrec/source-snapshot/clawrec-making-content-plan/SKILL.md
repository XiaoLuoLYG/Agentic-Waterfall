---
name: clawrec-making-content-plan
description: Creates a derived markdown content plan from ClawRec canonical user-state markdown. Use when OpenClaw needs retrieve-now display planning and executable Search Instructions for clawrec-executing-search-instruction from USER_STATE.md, STATE_UPDATES.md, and NEGATIVE_SIGNALS.md while respecting suppressions and writing only .clawrec/clawrec-content-plan/latest/PLAN.md.
---

# Making Content Plan

## Purpose

Turn ClawRec's canonical markdown user-state files into a compact content plan for downstream retrieval.

This Skill decides what should be retrieved and displayed now. It produces a derived planner handoff only. It does not retrieve content, generate recommendations, render UI, or mutate durable user state.

## Scope

Use this Skill when OpenClaw needs to create:

```text
.clawrec/clawrec-content-plan/latest/PLAN.md
```

from the canonical state files:

```text
.clawrec/clawrec-user-state/USER_STATE.md
.clawrec/clawrec-user-state/STATE_UPDATES.md
.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md
```

and the supported-platform indexes:

```text
skills/clawrec-executing-search-instruction/references/platform-index.md
.clawrec/clawrec-user-state/extended-platforms/index.md
```

The plan is for `clawrec-executing-search-instruction`. It is not a durable memory file and is not a recommendation result.

## Input Contract

Read only the canonical markdown state files and supported-platform indexes. Do not accept JSON objects, ad hoc in-memory stores, copied excerpts, or reformatted substitutes.

Read the files in this order:

1. `.clawrec/clawrec-user-state/USER_STATE.md` as the durable baseline.
2. `.clawrec/clawrec-user-state/STATE_UPDATES.md` as the recent planning delta.
3. `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md` as hard suppression constraints.
4. `skills/clawrec-executing-search-instruction/references/platform-index.md` as the repo-static platform index.
5. `.clawrec/clawrec-user-state/extended-platforms/index.md` as the optional user-state dynamic platform index, if it exists.

Use the current planning time as `now` unless the task explicitly gives a different basis time.

If any required state file or the repo-static platform index is missing, stop and report the missing path. Do not guess a replacement input format. If the dynamic platform index is missing, continue with built-in platforms only.

When standard sections are absent inside valid markdown files, treat those sections as empty. Ignore malformed or unsupported entries explicitly. Do not invent missing structure.

For exact section and field reminders, read `references/input-contract.md`.

## Output Contract

Write one derived markdown artifact:

```text
.clawrec/clawrec-content-plan/latest/PLAN.md
```

Create the output directory if needed:

```bash
mkdir -p .clawrec/clawrec-content-plan/latest
```

Write `PLAN.md` in this shape:

````markdown
# Content Plan

**Generated**: ISO-8601 timestamp
**Basis-Time**: ISO-8601 timestamp
**Artifact-Status**: derived

## Source Files

- `.clawrec/clawrec-user-state/USER_STATE.md`
- `.clawrec/clawrec-user-state/STATE_UPDATES.md`
- `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md`
- `skills/clawrec-executing-search-instruction/references/platform-index.md`
- `.clawrec/clawrec-user-state/extended-platforms/index.md` if present

## Display Plan

### [urgent_needs]
- Theme-Title: Right now
- Rationale: Current intents and retrieve-now items dominate the safe plan.
- Driving-State-Refs: intent.some-key, topic.other-key

## Search Instructions

### [search-001]
- Target-Column-Id: urgent_needs
- State-Key-Ref: intent.some-key
- Platform: arXiv
- Query: graph neural recommender benchmark
- Task-Goal: survey representative papers with attention to methods and applicable scenarios
- Requested-Count: 3
- User-Constraints:
  - paper_focus: methods and applicable scenarios

### [search-002]
- Target-Column-Id: urgent_needs
- State-Key-Ref: topic.other-key
- Platform: Bilibili
- Query: browser automation agents 教程
- Task-Goal: find and summarize practical walkthrough videos
````

Each Search Instruction must be independently executable by the downstream search skill. `Target-Column-Id` and `State-Key-Ref` are planner metadata. `Platform`, `Query`, `Task-Goal`, optional `Requested-Count`, and optional `User-Constraints` map directly to the downstream input fields `platform`, `query`, `task_goal`, `requested_count`, and `user_constraints`.

Do not return a parallel JSON plan.

## Workflow

1. Read the canonical markdown inputs in the required order.
2. Extract only supported markdown sections and fields.
3. Build the candidate pool from current needs, planning updates, interests, themes, and preferences.
4. Apply hard exclusions from status fields, negative signals, platform suppressions, and planner avoid rules.
5. Merge the repo-static and user-state dynamic supported-platform indexes.
6. Apply recency and expiry rules relative to the basis time.
7. Classify candidate intent before routing.
8. Choose up to 4 display columns with distinct purposes.
9. Read `references/search-instruction-fields-by-platform.md`.
10. Generate compact Search Instructions that match the downstream input contract.
11. Write `.clawrec/clawrec-content-plan/latest/PLAN.md`.
12. Run the manual self-check before handoff.

## Planning Rules

Build the candidate pool from these sources in descending precedence:

1. `Planner Brief` items under `retrieve now`
2. `Current Intents`
3. recent `STATE_UPDATES.md` entries marked `Review-Before: planning`
4. `Short-Term Interests`
5. `Cross-Platform Themes`
6. `Planner Brief` items under `maintain over time`
7. `Long-Term Interests`
8. `Platform-Specific Preferences`

Use `STATE_UPDATES.md` as a short-horizon planning signal, not as a replacement for durable state. A candidate key from an update is usable only when it is concrete and not `key_or_none`.

If a candidate is supported by `generic_web` browsing evidence, use that evidence only to preserve the user's intent, write the query, and choose among active platforms from the merged platform indexes. Do not output `generic_web` as a Search Instruction `Platform`.

If `USER_STATE.md` has an active `## Source Affordance Memory` entry with a registered `platform` value and the entry's anchor topic and intent match the candidate, prefer that active extended platform before falling back to built-in routing defaults, unless a negative signal or platform suppression blocks it.

Exclude anything that is:

- `suppressed`
- `contradicted`
- `expired`
- explicitly blocked in `NEGATIVE_SIGNALS.md`
- explicitly mirrored in `Negative Signals Snapshot`
- explicitly listed in `Planner Brief` under `avoid or down-rank`

Also exclude any platform whose suppression is still active:

- if `Suppress-Until` is `none`, treat the suppression as open-ended
- if `Suppress-Until` is a future date, keep the suppression active
- if `Suppress-Until` is in the past, do not keep suppressing that platform

If a topic overlaps a blocked topic and the separation is not explicitly supported elsewhere in state, drop it instead of rewriting it into a new interpretation.

Respect `Expiry-Hint` relative to `Last-Seen`:

- `72h`: keep only while fresh; drop once clearly stale unless directly reinforced by a fresh planning update or `retrieve now`
- `14d`: use for live short-term interests; remove once clearly outside the window unless still explicitly active
- `90d`: use for durable but still living interests
- `none`: no expiry-based penalty

Prefer more recent, higher-confidence, directly supported entries over weaker or older ones. Do not use score tables or filler heuristics.

For deterministic precedence, decay, and routing defaults, read `references/planning-rubric.md`.

## Intent Classification Before Routing

Classify each candidate before choosing platforms or writing queries. Use the classification to preserve the user's actual intent instead of maximizing source variety.

Use these intent classes:

| Intent class | Typical evidence | Routing rule |
|---|---|---|
| `engineering_workflow` | tutorials, tools, workflows, configuration, practical guides, debugging, Claude Code, Codex, Cursor, Vibe Coding | prefer practical sources such as 小红书, Bilibili, Zhihu, YouTube, official docs, GitHub, or a matching active extended platform when supported by the merged platform index |
| `tool_pricing_or_plan` | plan, subscription, package, token quota, credits, cost, limits, pricing, API cost comparisons | prefer 小红书, Zhihu, Bilibili, official product/pricing sources, or a matching active extended platform when supported; keep subscription/plan semantics distinct from API pay-as-you-go pricing |
| `product_or_model_update` | model name, version, release, technical report, product update | prefer official/product sources and technical explainers; use arXiv only with direct paper or technical-report evidence |
| `academic_research` | paper, survey, benchmark, arXiv, OpenReview, citation, method, experiment | arXiv is appropriate |
| `terminology_lookup` | translation, "英文怎么说", concept lookup, acronym clarification | keep the plan narrow; do not expand into cross-platform themes |
| `ambiguous_search_only` | repeated searches with no content follow | preserve the original terms and plan disambiguation queries |

### arXiv gate

Use `arXiv` only when the selected topic itself has direct evidence of academic intent: paper, survey, benchmark, OpenReview, arXiv, citation, technical report, academic method interest, or a concrete model/method whose evidence entered a paper or technical report page. A separate tentative academic signal must not route an engineering topic to arXiv.

Example: a single tentative `OpenReview` lookup does not justify sending `Vibe Coding / AI-assisted programming` to arXiv when the Vibe Coding evidence is tutorials, tools, and workflow posts.

### Search-only ambiguity rule

When a candidate is supported only by repeated searches with no content follow, treat it as unresolved and ambiguous. Do not broaden it into a research theme. Prefer disambiguation queries that preserve the original terms and identify likely meanings.

Example: repeated `token plan` searches should become disambiguation around Token Plan, Coding Plan, subscription plans, credits, and token quota semantics. Do not broaden it to generic `AI agent token pricing`, which may mean API pay-as-you-go pricing rather than subscription plans.

### Ambiguous proper nouns

For ambiguous proper nouns, preserve disambiguating context from state evidence. Do not shorten a concrete product or model query into a broad survey query.

Example: if the state says `MiMo v2.5 Pro`, prefer `Xiaomi MiMo V2.5 Pro Token Plan` or, when academic evidence exists, `Xiaomi MiMo language model reasoning`. Avoid generic `mimo reasoning model survey`.

### Cross-platform themes

A cross-platform theme must represent complementary retrieval modes for the same user task, not a platform mix for its own sake. Do not add academic papers to an engineering workflow theme unless that same theme has direct academic evidence.

### Duplicate search instructions

Before finalizing, compare selected queries and task goals. If two instructions only restate the same topic, split them into distinct task angles or remove one. For example, split AI coding into workflow practice versus plan/pricing tradeoffs rather than emitting two generic tool recommendation searches.

## Display Columns

Create up to 4 columns. Never invent topics just to reach a target count.

Use these column patterns when supported by state:

- `urgent_needs`: retrieve-now items, current intents, and time-sensitive work
- `momentum_now`: fresh planning-relevant state updates and active short-term interests
- `deep_dives`: durable learning, research, or project themes
- `cross_platform_mix`: themes that should be searched on multiple platforms
- `platform_picks`: safe platform-specific preferences
- `light_discovery`: adjacent low-risk exploration explicitly supported by state

Every column must have a distinct purpose. Every `Rationale` must mention the main state drivers in plain language. Do not create empty columns. Shrink the plan when support is sparse or heavily suppressed.

## Query and Routing Rules

Before emitting any Search Instruction, read `references/search-instruction-fields-by-platform.md`.

Each Search Instruction must satisfy these rules:

- `Target-Column-Id` matches a generated display column exactly.
- `State-Key-Ref` is the exact supporting state key whenever available; use `none` only when no concrete key exists.
- `Platform` is an active platform value from the merged repo-static and user-state dynamic platform indexes.
- `Query` is short platform-native search text, not an instruction sentence.
- `Task-Goal` is required and states the task type and intended use.
- `Requested-Count` is optional; output it only when state, planner brief, or explicit user intent requires a fixed positive integer.
- `User-Constraints` is optional; output it only when directly supported, and only with field names allowed for that platform. For extended platforms, omit `User-Constraints` unless a future validated contract explicitly defines allowed fields for that platform.
- Queries are materially distinct.
- Each column has 1 to 4 instructions.

Do not output:

- `Content-Type` as a generic field
- `Require-Detail-Summary`
- `Require-Comments-Or-Reviews`
- `Comparison-Required`
- browser workflow, evidence validation, platform defaults, or execution-layer strategy as input fields

When a task needs content type, sorting, budget, duration, article focus, buying intent, or paper focus, place it under `User-Constraints` only if the platform reference allows that field and the state provides direct support.

If `Platform`, `Query`, or `Task-Goal` cannot be determined from supported state, skip that Search Instruction.

For a selected `Cross-Platform Theme`, emit instructions across at least 2 distinct safe active platforms. If active suppression leaves fewer than 2 safe platforms, do not select that item as a cross-platform theme.

Platform discovery rules:

- Read `skills/clawrec-executing-search-instruction/references/platform-index.md`.
- If present, read `.clawrec/clawrec-user-state/extended-platforms/index.md`.
- Both indexes must use Markdown table columns `Platform`, `Type`, `Reference`, and `Status`.
- Use only `Status: active` rows.
- Reject malformed rows, missing references, duplicate ids, and dynamic ids that collide with built-in ids.
- `generic_web`, `SourceExtension`, unrestricted `web`, search engines, and arbitrary unregistered domains are not valid `Platform` values.

Use these built-in routing defaults when no matching active source affordance or extended platform is stronger:

- `arXiv`: academic papers, preprints, surveys, benchmarks
- `Bilibili`: videos, demos, walkthroughs, tutorial content
- `京东`: product listings, specs, buyer reviews, price-oriented comparisons
- `淘宝`: product listings, merchant pages, shopping discovery, style or configuration variants
- `小红书`: practical tips, travel, shopping, lifestyle, hands-on recommendations
- `Zhihu`: answers, explainers, comparisons, opinionated analysis
- `YouTube`: videos, demos, lectures, talks, walkthroughs
- `新华网`: official Chinese news, announcements, policy, public-interest reporting
- `人民网`: official Chinese news, policy interpretation, public-interest reporting, commentary

Items from `Platform-Specific Preferences` must stay on their own platform unless the same underlying topic is independently present in a safe cross-platform section.

Items from `Source Affordance Memory` should stay on their registered `platform` when the anchor topic and intent match the current candidate and the platform is active in the merged index.

Match query language to the topic and platform habit:

- prefer Chinese for `Bilibili`, `京东`, `淘宝`, `小红书`, `Zhihu`, `新华网`, and `人民网` when the state or evidence is Chinese-first
- prefer English for `arXiv` and `YouTube` unless the user's state clearly supports another language
- preserve product names, framework names, and proper nouns exactly

Use short, search-native query strings:

- urgent updates: `topic roadmap`, `topic release notes`, `topic latest`
- research: `topic survey`, `topic benchmark`, `topic paper`
- learning: `topic tutorial`, `topic guide`, `topic best practices`
- evaluation: `topic comparison`, `topic pros cons`, `topic review`
- shopping: `topic 评测`, `topic 对比`, `topic 官方旗舰店`
- news: `topic 最新`, `topic 政策`, `topic 发布`
- Chinese video or q and a: `topic 教程`, `topic 实战`, `topic 对比`, `topic 经验`

Do not blindly add a year to evergreen queries. Add time anchors only when the topic is obviously time-sensitive.

## Boundaries

Do not:

- infer missing interests from weak or ambiguous evidence;
- override active suppressions;
- invent filler topics to satisfy layout diversity;
- accept non-markdown state input;
- return a parallel JSON plan;
- target any platform outside the merged active platform indexes;
- emit `generic_web` or `SourceExtension` as a platform;
- use unrestricted or platform-agnostic search engines, including generic `web`, `google`, `bing`, `baidu`, or `other`;
- encode `site:` search workarounds in `PLAN.md`; site-constrained discovery belongs only inside a registered extended-platform reference;
- route an engineering workflow or tool-plan topic to `arXiv` without direct academic evidence inside that same topic;
- convert search-only ambiguous signals into broad research themes;
- use cross-platform columns as platform variety without a shared user task;
- retrieve platform content or summarize search results;
- render interface content;
- mutate durable user state.

Durable state belongs in `.clawrec/clawrec-user-state/`. This Skill writes only the derived content plan artifact.

## Reference Files

Read these only when needed:

- `references/input-contract.md` for markdown file paths and field reminders
- `references/planning-rubric.md` for deterministic precedence, decay, and routing defaults
- `references/search-instruction-fields-by-platform.md` for Search Instruction execution inputs, platform values, optional requested counts, and platform-specific user constraints
- `references/examples.md` for example `PLAN.md` artifacts
- `skills/clawrec-executing-search-instruction/references/platform-index.md` plus optional `.clawrec/clawrec-user-state/extended-platforms/index.md` for active supported platforms

## Manual Self-Check

Before handoff, manually confirm that:

1. every Search Instruction contains `Platform`, `Query`, and `Task-Goal`;
2. every `Platform` is active in the merged platform indexes;
3. every `Target-Column-Id` exists in `## Display Plan`;
4. every `State-Key-Ref` is a real supporting key or exactly `none`;
5. every `Requested-Count`, if present, is a directly supported positive integer;
6. every `User-Constraints` field name, if present, belongs to that platform's allowed list;
7. no instruction outputs generic `Content-Type` or old boolean fields;
8. no instruction encodes browser workflow, evidence validation, platform defaults, or execution-layer strategy as input;
9. no instruction targets a blocked platform or blocked topic;
10. no unrestricted or platform-agnostic search engine, `generic_web`, or `SourceExtension` is used;
11. no selected key comes from a `suppressed`, `contradicted`, or `expired` item;
12. any selected cross-platform theme is routed across at least 2 safe active platforms;
13. every selected topic has an intent class and the platform routing matches that class;
14. `arXiv` is used only when the selected topic itself has direct academic evidence;
15. search-only ambiguous signals are planned as disambiguation, not broad research;
16. repeated Search Instructions are materially different in task angle;
17. source-affordance-backed platform choices match the candidate anchor topic and intent;
18. the plan artifact is valid markdown in the documented shape.

Use this manual self-check only.
