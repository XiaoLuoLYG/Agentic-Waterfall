# Examples

Use these examples to match the `PLAN.md` artifact shape and planning behavior.

The examples mostly use built-in platforms for readability. They are not a complete platform allowlist; real planning must read the repo-static and user-state dynamic platform indexes before choosing `Platform`.

## Contents

- Example 1: fresh project need plus durable learning theme
- Example 2: platform suppression changes routing
- Example 3: purchase task with explicit constraints
- Example 4: engineering workflow must not become academic search
- Example 5: search-only Token Plan ambiguity

## Example 1: fresh project need plus durable learning theme

### Input sketch from canonical markdown state

- `planner_brief.retrieve_now`: `"llm-eval-stack"`, `"browser-automation-agents"`
- `current_intents`: active item `llm-eval-stack`
- `short_term_interests`: active item `browser-automation-agents`
- `cross_platform_themes`: active item `agent-observability`
- `long_term_interests`: stable item `applied-ml-systems`
- `platform_specific_preferences.youtube`: stable item `ml-systems-talks`
- `negative_signals_snapshot`: `"crypto trading"`

### Good `PLAN.md` output shape

````markdown
# Content Plan

**Generated**: 2026-04-15T09:30:00+08:00
**Basis-Time**: 2026-04-15T09:30:00+08:00
**Artifact-Status**: derived

## Source Files

- `.clawrec/clawrec-user-state/USER_STATE.md`
- `.clawrec/clawrec-user-state/STATE_UPDATES.md`
- `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md`
- `skills/clawrec-executing-search-instruction/references/platform-index.md`
- `.clawrec/clawrec-user-state/extended-platforms/index.md` if present

## Display Plan

### [urgent_needs]
- Theme-Title: Build right now
- Rationale: Current state emphasizes llm-eval-stack and browser-automation-agents as immediate priorities.
- Driving-State-Refs: llm-eval-stack, browser-automation-agents

### [cross_platform_mix]
- Theme-Title: Across formats
- Rationale: Agent observability appears as a cross-platform theme worth covering with papers, video, and explainers.
- Driving-State-Refs: agent-observability

### [deep_dives]
- Theme-Title: Keep learning
- Rationale: Applied ml systems remains a stable long-term theme that should be maintained over time.
- Driving-State-Refs: applied-ml-systems, ml-systems-talks

## Search Instructions

### [search-001]
- Target-Column-Id: urgent_needs
- State-Key-Ref: llm-eval-stack
- Platform: arXiv
- Query: llm eval stack benchmark
- Task-Goal: survey representative papers with attention to methods and applicable scenarios
- User-Constraints:
  - paper_focus: benchmark methods

### [search-002]
- Target-Column-Id: urgent_needs
- State-Key-Ref: browser-automation-agents
- Platform: Bilibili
- Query: browser automation agents 教程
- Task-Goal: find and summarize practical walkthrough videos for an active implementation interest

### [search-003]
- Target-Column-Id: cross_platform_mix
- State-Key-Ref: agent-observability
- Platform: Zhihu
- Query: agent observability comparison
- Task-Goal: compare representative explainers and explain key differences

### [search-004]
- Target-Column-Id: cross_platform_mix
- State-Key-Ref: agent-observability
- Platform: YouTube
- Query: agent observability tutorial
- Task-Goal: find and summarize practical walkthrough videos

### [search-005]
- Target-Column-Id: deep_dives
- State-Key-Ref: ml-systems-talks
- Platform: YouTube
- Query: applied ml systems talk
- Task-Goal: find representative talks for durable learning
````

Why this is good:

- the plan has 3 columns with distinct purposes
- one cross-platform theme is actually routed to multiple platforms
- queries are short and executable
- Search Instructions use `Platform`, `Query`, and `Task-Goal`
- optional constraints use a platform-allowed `User-Constraints` field
- no blocked topic appears

## Example 2: platform suppression changes routing

### Input sketch from canonical markdown state

- cross-platform theme: `japan-city-trips`
- platform-specific xiaohongshu preference: `tokyo-food-maps`
- negative signal: active xiaohongshu suppression until next week
- maintain-over-time: `budget-flight-hacking`

### Better behavior

- do not emit xiaohongshu queries while the suppression is active
- keep the cross-platform travel theme alive on safe platforms such as Zhihu and Bilibili if the topic itself is not blocked
- move any xiaohongshu-only preference out of the plan until the suppression expires

### Good `PLAN.md` output sketch

````markdown
# Content Plan

**Generated**: 2026-04-15T11:00:00+08:00
**Basis-Time**: 2026-04-15T11:00:00+08:00
**Artifact-Status**: derived

## Source Files

- `.clawrec/clawrec-user-state/USER_STATE.md`
- `.clawrec/clawrec-user-state/STATE_UPDATES.md`
- `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md`
- `skills/clawrec-executing-search-instruction/references/platform-index.md`
- `.clawrec/clawrec-user-state/extended-platforms/index.md` if present

## Display Plan

### [urgent_needs]
- Theme-Title: Trip planning
- Rationale: The current state shows a live city-trip theme, but xiaohongshu is temporarily suppressed.
- Driving-State-Refs: japan-city-trips

### [deep_dives]
- Theme-Title: Travel strategy
- Rationale: Budget flight hacking is a durable long-term theme to maintain.
- Driving-State-Refs: budget-flight-hacking

## Search Instructions

### [search-001]
- Target-Column-Id: urgent_needs
- State-Key-Ref: japan-city-trips
- Platform: Zhihu
- Query: 东京 3日 行程 攻略
- Task-Goal: collect practical notes and summarize useful itinerary or planning advice

### [search-002]
- Target-Column-Id: urgent_needs
- State-Key-Ref: japan-city-trips
- Platform: Bilibili
- Query: 东京 旅游 攻略
- Task-Goal: find and summarize practical walkthrough videos

### [search-003]
- Target-Column-Id: deep_dives
- State-Key-Ref: budget-flight-hacking
- Platform: Zhihu
- Query: 廉价机票 经验
- Task-Goal: find representative explainers for a durable travel strategy theme
````

Why this is good:

- suppression is respected at the platform level
- the theme still survives on safe platforms
- the plan stays truthful instead of inventing alternate platform-specific content
- no `Content-Type` or old boolean fields appear

## Example 3: purchase task with explicit constraints

### Input sketch from canonical markdown state

- current intent: `commute-headphones`
- planner brief retrieve-now asks for three commuting noise-cancelling headphone options
- durable preference says budget is `1000 元以内`

### Good Search Instruction with constraints

````markdown
### [search-001]
- Target-Column-Id: platform_picks
- State-Key-Ref: commute-headphones
- Platform: 京东
- Query: 降噪耳机 通勤
- Task-Goal: compare products for a purchase decision under the stated constraints
- Requested-Count: 3
- User-Constraints:
  - buying_intent: 通勤 降噪优先
  - budget_constraint: 1000 元以内
````

Why this is good:

- `Requested-Count` comes from the planner brief
- `buying_intent` and `budget_constraint` are allowed 京东 constraints
- the instruction avoids platform defaults and execution workflow details

## Example 4: engineering workflow must not become academic search

### Input sketch from canonical markdown state

- recent interest: `Vibe Coding / AI-assisted programming`
- evidence: repeated searches for tutorials, tools, workflows
- content engaged: Xiaohongshu posts about guides, Claude Code setup, workflow practices
- separate tentative signal: one `OpenReview` lookup

### Bad behavior

Do not route the Vibe Coding theme to arXiv only because an unrelated tentative academic signal exists:

````markdown
### [search-001]
- Target-Column-Id: cross_platform_mix
- State-Key-Ref: recent_interest.vibe_coding
- Platform: arXiv
- Query: LLM code generation survey benchmark
- Task-Goal: survey representative papers on LLM-based code generation with attention to methods and benchmarks
````

Why this is bad:

- the Vibe Coding evidence is engineering workflow evidence, not academic research evidence
- `LLM code generation survey benchmark` changes the task into academic evaluation
- a separate tentative `OpenReview` signal does not override the selected topic's own evidence

### Good behavior

````markdown
### [momentum_now]
- Theme-Title: Vibe Coding engineering workflow
- Rationale: Repeated searches and engaged content point to practical AI-assisted coding tools, setup, and workflow.
- Driving-State-Refs: recent_interest.vibe_coding

### [search-001]
- Target-Column-Id: momentum_now
- State-Key-Ref: recent_interest.vibe_coding
- Platform: 小红书
- Query: vibe coding Claude Code 工作流
- Task-Goal: collect practical workflow notes and common pitfalls for AI-assisted coding

### [search-002]
- Target-Column-Id: momentum_now
- State-Key-Ref: recent_interest.vibe_coding
- Platform: Bilibili
- Query: vibe coding AI编程 实战 工作流
- Task-Goal: find and summarize practical walkthrough videos for AI-assisted coding
````

## Example 5: search-only Token Plan ambiguity

### Input sketch from canonical markdown state

- current need: `token plan`
- evidence: repeated Xiaohongshu searches
- content follow: none

### Good behavior

Treat this as unresolved ambiguity. Keep the original terms and clarify meanings around subscription-style AI coding plans.

````markdown
### [urgent_needs]
- Theme-Title: Token Plan disambiguation
- Rationale: The user repeatedly searched token plan without stable content follow, so the plan should first clarify its meaning in AI tool and subscription-plan contexts.
- Driving-State-Refs: current_need.token_plan

### [search-001]
- Target-Column-Id: urgent_needs
- State-Key-Ref: current_need.token_plan
- Platform: 小红书
- Query: token plan coding plan
- Task-Goal: identify practical meanings of Token Plan in AI coding tool and subscription-plan contexts

### [search-002]
- Target-Column-Id: urgent_needs
- State-Key-Ref: current_need.token_plan
- Platform: Zhihu
- Query: Token Plan Coding Plan 区别
- Task-Goal: compare representative explanations of Token Plan and Coding Plan as subscription or quota models
````

Avoid:

- `AI agent token pricing`, which may mean API pay-as-you-go pricing
- `Claude Code token 消耗`, which adds a concrete tool entity not needed for disambiguation
- `AI 编程 套餐 对比`, which is too broad and no longer preserves the original query
