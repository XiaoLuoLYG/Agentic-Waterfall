# Input contract

The planner accepts only the canonical markdown state files plus supported-platform indexes.

## Input files

- `.clawrec/clawrec-user-state/USER_STATE.md`
- `.clawrec/clawrec-user-state/STATE_UPDATES.md`
- `.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md`
- `skills/clawrec-executing-search-instruction/references/platform-index.md`
- optional `.clawrec/clawrec-user-state/extended-platforms/index.md`

Read them in that order. Do not replace them with JSON, in-memory objects, or custom markdown shapes.

If any required state file or the repo-static platform index is missing, stop and report the missing path. If the optional dynamic platform index is missing, continue with built-in platforms only.

## USER_STATE.md

Important sections:

- `## Current Intents`
- `## Short-Term Interests`
- `## Long-Term Interests`
- `## Cross-Platform Themes`
- `## Platform-Specific Preferences`
- `## Source Affordance Memory`
- `## Negative Signals Snapshot`
- `## Contradictions`
- `## Planner Brief`

Each state item follows the markdown shape defined by `clawrec-user-state`:

````markdown
### [STATE-KEY]
- **Label**: Human-readable label
- **Confidence**: 0.0 to 1.0
- **Status**: candidate | active | stable | cooling | suppressed | contradicted | expired
- **First-Seen**: YYYY-MM-DD
- **Last-Seen**: YYYY-MM-DD
- **Source-Platforms**: chrome, bilibili
- **Evidence-Refs**: UPD-20260414-001
- **Why-It-Matters**: one sentence
- **Expiry-Hint**: 72h | 14d | 90d | none
````

Use the exact bracketed key as the planner's stable reference whenever possible.

### Source Affordance Memory

Source affordances are lightweight list entries maintained by state synthesis:

```markdown
- [source.example] role: official_reference | anchor: topic / intent | source: example.com | retriever: site_constrained_search | confidence: 0.74 | evidence: Update Packet 2: S1 -> C1 | signals: search_to_content,feedback_click | status: active | platform: example-docs | updated: YYYY-MM-DD
```

Planning may use a source-affordance entry only when:

- `status` is `active`;
- `platform` is not `none`;
- the platform is active in the merged platform indexes;
- the anchor topic and intent match a Current Intent, Short-Term Interest, or selected planning candidate;
- no negative signal or platform suppression blocks it.

Do not create platforms from source-affordance entries. Platform registration is owned by `clawrec-synthesizing-user-state`.

## STATE_UPDATES.md

Use these as immediate-session context.

Strong fields:

- `**Priority**`
- `### Packet Summary`
- `### Strongest Evidence`
- `### Candidate Updates`
- `### Metadata`
  - `Source-Platforms`
  - `Contradiction`
  - `Review-Before`

Treat `Review-Before: planning` as a stronger planning signal than `retrieval`, `display`, or `feedback`.

When `### Candidate Updates` contains a concrete key string, that key can be used as `State-Key-Ref` even if the merge has not happened yet. Do not use `key_or_none` as a key.

## NEGATIVE_SIGNALS.md

Treat these as hard constraints.

Important fields:

- entry heading `## [NEG-YYYYMMDD-XXX] signal_key`
- `**Status**`
- `### Signal`
- `### Reason`
- `### Metadata`
  - `Platform`
  - `Suppress-Until`

If `Status` is active and `Suppress-Until` is `none`, treat the suppression as open-ended.
If `Status` is active and `Suppress-Until` is in the future, keep suppressing the topic or platform.
If `Suppress-Until` is in the past, do not continue suppressing it.

## Missing or unsupported markdown

When standard sections are absent inside otherwise valid markdown files:

- treat the missing section as empty
- do not invent a replacement section
- do not infer fields that are not present

When an entry is malformed:

- ignore the malformed entry explicitly
- keep processing supported entries
- do not convert the file into another format to recover it
