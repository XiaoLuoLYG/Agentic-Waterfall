# Search Instruction Fields by Platform

Use this reference before writing any `## Search Instructions` entry in `PLAN.md`.

## Contents

- Field model
- Platform discovery
- Optional field rules
- Platform-specific user constraints
- Task-goal examples

## Field Model

Each Search Instruction has two field groups.

Planner metadata:

| Field | Required | Rule |
|---|---:|---|
| `Target-Column-Id` | yes | Must match a generated `## Display Plan` column id. |
| `State-Key-Ref` | yes | Use the exact supporting state key; use `none` only when no concrete key exists. |

Execution input:

| PLAN field | Downstream field | Required | Rule |
|---|---|---:|---|
| `Platform` | `platform` | yes | Must use an active platform value from the merged platform indexes. |
| `Query` | `query` | yes | Short platform-native search text. |
| `Task-Goal` | `task_goal` | yes | States the task type and intended use. |
| `Requested-Count` | `requested_count` | no | Positive integer only when directly supported by state or planner brief. |
| `User-Constraints` | `user_constraints` | no | Only directly supported platform-specific constraints from the table below. For extended platforms, omit unless a future validated contract defines allowed fields. |

Do not output generic `Content-Type`, old boolean fields, browser workflow, evidence validation, platform defaults, or execution-layer strategy as Search Instruction fields.

## Platform Discovery

Before writing or validating `Platform`, merge these indexes:

```text
skills/clawrec-executing-search-instruction/references/platform-index.md
.clawrec/clawrec-user-state/extended-platforms/index.md
```

Both indexes use this Markdown table shape:

| Platform | Type | Reference | Status |
|---|---|---|---|
| `<platform-id>` | `built-in` or `extended` | repo- or project-relative Markdown reference path | `active`, `suppressed`, or `retired` |

Use only `Status: active` rows. If the dynamic index is absent, continue with the repo-static built-in index only.

Reject malformed rows, missing reference paths, duplicate platform ids, or dynamic ids that collide with built-in platform ids.

The repo-static index currently declares these built-in platforms:

- `YouTube`
- `Bilibili`
- `Zhihu`
- `小红书`
- `新华网`
- `人民网`
- `淘宝`
- `京东`
- `arXiv`

`generic_web` may appear upstream as user-state evidence, but it is not an executable platform value. Use generic-web-derived interests only to preserve intent, shape the query, choose among active indexed platforms, and write the task goal.

`SourceExtension` is not a platform value. Source extension can create registered extended platforms, and only those registered active platform ids may appear in `PLAN.md`.

## Optional Field Rules

Output `Requested-Count` only when the canonical state, planner brief, or explicit user intent requires a fixed number of results. Do not use it to restate platform defaults.

Output `User-Constraints` only when a constraint is directly supported. Do not add sorting, filtering, budget, content type, detail-page preference, comment requirements, or review requirements only to improve quality.

For built-in platforms, use the field lists below.

For extended platforms, omit `User-Constraints` unless a future validated platform contract explicitly defines allowed fields and the orchestrator accepts them. Extended platform search workflow details belong in the generated platform reference file, not in planner fields.

If `Platform`, `Query`, or `Task-Goal` cannot be determined, omit the Search Instruction.

## Built-In Platform-Specific User Constraints

### YouTube

| Field | Use only when |
|---|---|
| `content_type` | The user requires videos, Shorts, channels, or playlists. |
| `upload_time` | The user requires today, this week, this month, this year, or another upload range. |
| `duration` | The user requires a video length range. |
| `sort_preference` | The user explicitly asks for a sorting preference. |
| `selection_preference` | The user explicitly prefers official matches, highest visible views, most relevant results, or similar selection criteria. |

### Bilibili

| Field | Use only when |
|---|---|
| `sort_by` | The user requires 综合排序, 最多播放, 最新发布, 最多弹幕, 最多收藏, or another visible sort. |
| `date_range` | The user requires a date range. |
| `duration_range` | The user requires a duration range. |
| `selection_preference` | The user explicitly prefers high play count, high danmaku, newest, official, or another selection criterion. |

### Zhihu

| Field | Use only when |
|---|---|
| `time_range` | The user requires a time filter. |
| `sort_by` | The user requires a sort such as most upvoted. |
| `content_type` | The user requires answers only or articles only. |
| `selection_preference` | The user explicitly prefers high upvotes, high interaction, articles, answers, or a specific angle. |

### 小红书

| Field | Use only when |
|---|---|
| `result_type` | The user requires all, image-text notes, videos, or users. |
| `note_focus` | The user asks for routes, itineraries, plans, practical tips, pitfalls, recommendations, or another note focus. |
| `media_focus` | The user explicitly wants route maps, itinerary cards, or text inside images read. |
| `selection_preference` | The user explicitly prefers high interaction, newest, image-text, video, or another content type. |

### 新华网

| Field | Use only when |
|---|---|
| `search_scope` | The user requires searching full news text or titles only. |
| `sort_by` | The user requires sorting by time or relevance. |
| `article_focus` | The user asks for policy interpretation, topic-centered articles, latest updates, official reports, or another article focus. |

### 人民网

| Field | Use only when |
|---|---|
| `exact_match` | The user requires exact matching. |
| `page_depth` | The user requires deeper result pages or more results. |
| `article_focus` | The user asks for strong relevance, body mentions, duplicate distribution detection, or another article focus. |

### 淘宝

| Field | Use only when |
|---|---|
| `price_constraint` | The user gives a budget, price range, or price preference. |
| `style_constraint` | The user gives style, material, fit, appearance, or similar preferences. |
| `function_constraint` | The user gives function, use case, compatibility, or similar constraints. |
| `sort_by` | The user explicitly requires sorting. |
| `buyer_profile` | The user gives a buyer profile such as student, commuter, gift, or personal use. |

### 京东

| Field | Use only when |
|---|---|
| `buying_intent` | The user gives a purchase goal such as value, commute, student use, performance, audio quality, noise cancellation, or Apple ecosystem. |
| `budget_constraint` | The user gives a budget, price range, or price preference. |
| `visible_filter_request` | The user explicitly asks to use a visible filter control such as price range. |
| `function_constraint` | The user gives function, specification, use case, ecosystem, or similar constraints. |
| `qna_focus` | The user explicitly asks to inspect `问大家` or Q&A clues. |

### arXiv

| Field | Use only when |
|---|---|
| `detail_page_preference` | The user explicitly prefers html, abs, or PDF. |
| `paper_focus` | The user asks to focus on contributions, method differences, applicable scenarios, a direction, or a task. |

## Task-Goal Examples

Use specific goals:

| Task type | `Task-Goal` example |
|---|---|
| Representative results | `find representative results for the current topic` |
| Content summary | `summarize selected results based on visible detail pages` |
| Multi-result comparison | `compare representative results and explain key differences` |
| Buying advice | `compare products for a purchase decision under the stated constraints` |
| Audience viewpoints | `summarize visible audience or buyer viewpoints for the selected results` |
| Paper research | `survey representative papers with attention to methods and applicable scenarios` |
| Practical guide | `collect practical notes and summarize useful itinerary or planning advice` |

Do not use vague goals such as `search`, `retrieve`, or `recommend`.
