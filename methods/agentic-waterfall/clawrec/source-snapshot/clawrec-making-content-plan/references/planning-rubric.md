# Planning rubric

Use this file when you need deterministic defaults for precedence, decay, routing, and final balancing.

## Contents

- Candidate precedence defaults
- Status handling
- Expiry decay
- Update handling
- Column selection defaults
- Platform routing defaults
- Intent classification and routing guards
- Query writing defaults
- Negative filtering defaults
- Final balancing

## 1. Candidate precedence defaults

Treat the following as the default precedence order, from strongest to weakest:

1. `Planner Brief` items under `retrieve now`
2. `Current Intents`
3. recent `STATE_UPDATES.md` entries with `Review-Before: planning`
4. `Short-Term Interests`
5. `Cross-Platform Themes`
6. `Planner Brief` items under `maintain over time`
7. `Long-Term Interests`
8. `Platform-Specific Preferences`
9. `cooling` items only when they still have explicit support and there is remaining safe capacity

Within the same precedence layer, prefer:

- more recent `Last-Seen`
- higher `Confidence`
- clearer planning relevance in `Why-It-Matters`
- broader cross-platform support
- direct support from recent `STATE_UPDATES.md`

## 2. Status handling

Apply these status rules:

- `active`: usable by default
- `stable`: usable for durable themes
- `candidate`: usable only when directly reinforced elsewhere in state or updates
- `cooling`: secondary only; do not let it dominate the plan
- `suppressed`: never use
- `contradicted`: never use
- `expired`: never use

## 3. Expiry decay

Apply decay from `Last-Seen` relative to planning time.

### `72h`

- 0 to 72 hours: keep
- 73 to 120 hours: keep only if still directly relevant
- over 120 hours: drop unless rescued by a fresh planning update or a direct `retrieve now` instruction

### `14d`

- 0 to 14 days: keep
- 15 to 21 days: keep only when still clearly active
- over 21 days: usually drop unless still explicitly in `retrieve now`

### `90d`

- 0 to 90 days: keep
- 91 to 120 days: keep only for durable themes
- over 120 days: keep only for stable long-term items with explicit continuing support

### `none`

- no expiry penalty

## 4. Update handling

Use `STATE_UPDATES.md` as immediate momentum, not as unconditional truth.

Use an update more confidently when:

- `Priority` is `high`
- `Review-Before` is `planning`
- `Packet Summary` and `Strongest Evidence` clearly reinforce an existing key

Use an update more cautiously when:

- the update only affects display or feedback timing
- the update conflicts with established durable state

Do not promote an update into the plan when:

- `Contradiction` is `yes` and there is no stronger confirming evidence
- every candidate key is `key_or_none`

## 5. Column selection defaults

Default to a compact plan. Use fewer columns when the safe support is narrow.

### `urgent_needs`
Use for:

- `retrieve now` themes
- current intents
- fresh 72-hour signals
- time-sensitive topics

### `momentum_now`
Use for:

- recent planning-relevant surges
- new packet-driven curiosities
- short-term themes that deserve quick follow-up

### `deep_dives`
Use for:

- long-term learning
- project research
- sustained professional or hobby themes

### `cross_platform_mix`
Use for:

- one topic that deserves multiple retrieval modes
- broad themes where paper plus video plus answer, post, product, or news coverage makes sense

### `platform_picks`
Use for:

- platform-specific habits that should stay siloed
- trusted-source behavior on one platform

### `light_discovery`
Use sparingly for:

- safe, low-stakes exploration
- adjacent content that is explicitly supported elsewhere in state and does not violate constraints

## 6. Platform routing defaults

Choose platforms based on the topic and the user's demonstrated habit.

Only use active platform surface values from the merged platform indexes. Do not route through generic or platform-agnostic search engines.

Read the repo-static built-in index and the optional user-state dynamic index before routing:

```text
skills/clawrec-executing-search-instruction/references/platform-index.md
.clawrec/clawrec-user-state/extended-platforms/index.md
```

`generic_web` evidence can support the topic and query wording, but it must not be routed as a platform. `SourceExtension` is not a platform. When an interest comes from ordinary web browsing, select the most appropriate active indexed platform for the retrieval task.

When `USER_STATE.md` has an active `Source Affordance Memory` entry with a registered platform whose anchor topic and intent match the candidate, prefer that active extended platform before these built-in defaults, unless a negative signal or platform suppression blocks it.

These routing defaults help choose `Platform` and write `Task-Goal`; they do not create `Requested-Count` or `User-Constraints` by themselves.

| Platform | Best for | Typical task goal |
|---|---|---|
| `arXiv` | academic papers, preprints, surveys, benchmarks | survey representative papers |
| `Bilibili` | demos, explainers, tutorials, walkthroughs | find and summarize practical walkthrough videos |
| `京东` | product listings, specs, buyer reviews, price-oriented comparisons | compare products for a purchase decision |
| `淘宝` | product listings, merchant pages, shopping discovery, style or configuration variants | find product options under stated preferences |
| `小红书` | practical tips, travel, shopping, lifestyle, local recommendations | collect practical notes and planning advice |
| `Zhihu` | q and a, explainers, comparisons, opinions | compare representative answers or explainers |
| `YouTube` | demos, lectures, talks, walkthroughs | find and summarize practical or educational videos |
| `新华网` | official Chinese news, announcements, policy, public-interest reporting | find official news or policy reporting |
| `人民网` | official Chinese news, policy interpretation, public-interest reporting, commentary | find official news, policy interpretation, or commentary |

## 7. Intent classification and routing guards

Classify each candidate before routing. Intent class controls platform choice more strongly than generic platform variety.

| Intent class | Use when evidence shows | Routing guard |
|---|---|---|
| `engineering_workflow` | tutorials, tools, workflows, configuration, practical guides, debugging, Vibe Coding, Claude Code, Codex, Cursor | use practical/tutorial/community/video sources; do not use arXiv without direct academic evidence in this same topic |
| `tool_pricing_or_plan` | subscription plans, token quota, credits, cost, limits, Coding Plan, Token Plan | keep subscription/plan semantics distinct from API pay-as-you-go pricing; do not broaden to generic agent token pricing |
| `product_or_model_update` | model/version/release/update/technical report | keep product/model names and versions; use arXiv only when paper/technical-report evidence is present |
| `academic_research` | paper, survey, benchmark, arXiv, OpenReview, citations, methods | arXiv is appropriate |
| `terminology_lookup` | translation, acronym, "英文怎么说", concept lookup | keep narrow; avoid cross-platform expansion |
| `ambiguous_search_only` | repeated searches without content follow | plan disambiguation; do not create broad research themes |

Apply these hard guards:

- A tentative academic signal elsewhere in state must not route an engineering topic to arXiv.
- Search-only signals should preserve original terms and clarify possible meanings.
- Ambiguous proper nouns need disambiguating context, for example `Xiaomi MiMo`, not generic `mimo`.
- Cross-platform themes must provide complementary retrieval modes for one user task, not platform variety for its own sake.
- Source-affordance-backed platform choices must match both topic and intent, not only the same domain or source family.

## 8. Query writing defaults

Write short, platform-native queries.

Good patterns:

- `topic latest`
- `topic release notes`
- `topic tutorial`
- `topic best practices`
- `topic comparison`
- `topic survey`
- `topic benchmark`
- `topic 教程`
- `topic 实战`
- `topic 对比`
- `topic 经验`
- `topic 评测`
- `topic 政策`

Avoid:

- full natural-language instructions
- very long query strings
- adding a year to timeless topics unless recency is truly important
- generic search-engine operators or platform workarounds
- `site:` workarounds in `PLAN.md`; site-constrained discovery belongs in a registered extended-platform reference
- vague filler words that do not change retrieval quality
- broad academic query forms for engineering workflow interests
- removing product/version qualifiers from ambiguous model or product names
- changing subscription-plan topics into API pay-as-you-go pricing topics

## 9. Negative filtering defaults

Before finalizing a query, compare it against:

- active entries in `NEGATIVE_SIGNALS.md`
- `## Negative Signals Snapshot` in `USER_STATE.md`
- `Planner Brief` entries under `avoid or down-rank`

Also avoid blocked platforms if their suppression is active.

When a theme overlaps a blocked topic, choose one of two actions only:

1. drop it entirely, or
2. narrow to a clearly separate, safe subtopic that is explicitly supported elsewhere in state

Prefer dropping over risky reinterpretation.

## 10. Final balancing

Target this default shape when the input is healthy:

- 2 to 4 columns
- 1 to 4 search instructions per column
- at least 2 platforms when a chosen cross-platform theme supports it
- 1 or 2 dominant high-priority themes
- 1 durable secondary theme
- at least 1 genuinely cross-platform theme if available

When the input is sparse, heavily contradicted, or heavily suppressed, shrink the plan rather than inventing content.
