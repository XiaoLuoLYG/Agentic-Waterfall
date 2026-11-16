---
name: clawrec-synthesizing-user-state
description: Maintains ClawRec user state from structured behavior evidence and explicit display feedback packets. Use when converting UnifiedEvent evidence or .clawrec/clawrec-feedback/latest/feedback-packets.md into auditable USER_STATE.md, STATE_UPDATES.md, NEGATIVE_SIGNALS.md, source-affordance memory, and behavior-grounded extended-platform updates for downstream planning.
---

# Synthesizing User State

## Purpose

Turn already-structured behavior evidence into durable, reviewable ClawRec user state.

This Skill preserves an audit trail: generate readable update packets first, then use those packets to update the user state files. It does not consume raw browser history or write long-term conclusions directly from raw events.

It can also consume explicit display feedback packets produced by `clawrec-collecting-display-feedback`. Feedback packets are downstream recommendation-page interaction evidence, not browser UnifiedEvent evidence.

When packet evidence shows a strong public source affordance, this Skill may also register a behavior-grounded extended platform for future search. The full source-extension rules live in `references/source-extension.md` and should be read only when source-extension trigger conditions are present.

## Scope

Use this Skill when ClawRec needs to maintain:

- current needs and active intent;
- recent interests;
- durable long-term preferences;
- cross-platform topics;
- platform-specific preferences;
- source-affordance memory;
- behavior-grounded extended platforms;
- negative signals such as rejection, avoidance, fatigue, skips, and explicit disinterest;
- a concise planning summary for downstream recommendation, retrieval, and display modules.

Inputs come from upstream structured evidence, usually:

```text
.clawrec/clawrec-unified-events/latest/evidence.jsonl
```

Optional explicit feedback input:

```text
.clawrec/clawrec-feedback/latest/feedback-packets.md
```

Outputs are:

```text
.clawrec/clawrec-user-state/USER_STATE.md
.clawrec/clawrec-user-state/STATE_UPDATES.md
.clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md
.clawrec/clawrec-user-state/latest-update-packets.md
```

When a source-extension gate passes, this Skill also writes:

```text
.clawrec/clawrec-user-state/extended-platforms/index.md
.clawrec/clawrec-user-state/extended-platforms/<platform-id>.md
```

## Required Initialization

Before writing state, ensure the state directory and files exist:

```bash
mkdir -p .clawrec/clawrec-user-state
[ -f .clawrec/clawrec-user-state/USER_STATE.md ] || printf "# User State\n\nDurable user model for ClawRec.\n\n---\n" > .clawrec/clawrec-user-state/USER_STATE.md
[ -f .clawrec/clawrec-user-state/STATE_UPDATES.md ] || printf "# State Updates\n\nAppend-only evidence and incremental state changes.\n\n---\n" > .clawrec/clawrec-user-state/STATE_UPDATES.md
[ -f .clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md ] || printf "# Negative Signals\n\nSuppressed topics, rejections, fatigue, and avoid patterns.\n\n---\n" > .clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md
```

Run commands from the project root so relative paths resolve under `.clawrec/`.

## Required Packet Step

Always create the readable update packet file before changing user state:

```bash
python3 skills/clawrec-synthesizing-user-state/scripts/build_update_packets.py \
  --input .clawrec/clawrec-unified-events/latest/evidence.jsonl \
  > .clawrec/clawrec-user-state/latest-update-packets.md
```

Use `.clawrec/clawrec-user-state/latest-update-packets.md` as the evidence source for state decisions. Do not skip this step and do not reinterpret raw event files directly into long-term memory.

## Optional Feedback Packet Step

When display feedback has been explicitly collected, read:

```text
.clawrec/clawrec-feedback/latest/feedback-packets.md
```

This file is produced by:

```bash
python3 skills/clawrec-collecting-display-feedback/scripts/collect_feedback.py \
  --manifest .clawrec/clawrec-generative-interface/<session_id>/state/displayed-cards.json \
  --events .clawrec/clawrec-generative-interface/<session_id>/state/events \
  --session-id <session_id>
```

Do not read raw `.clawrec/clawrec-generative-interface/<session_id>/state/events` directly during state synthesis. Use the feedback packet file and cite its feedback handles.

## Workflow

1. Run the required initialization.
2. Run the required packet step.
3. Read `latest-update-packets.md`, `USER_STATE.md`, `STATE_UPDATES.md`, and `NEGATIVE_SIGNALS.md`.
4. If `.clawrec/clawrec-feedback/latest/feedback-packets.md` exists and feedback integration is requested, read it as additional explicit feedback evidence.
5. If source-extension trigger conditions are present, read `references/source-extension.md`.
6. Derive a state update from packet evidence only.
7. Append an entry to `STATE_UPDATES.md` with evidence references and changed state.
8. Update `USER_STATE.md` to reflect the current usable state, including `## Source Affordance Memory` when relevant.
9. Update `NEGATIVE_SIGNALS.md` for explicit rejection, skipped content, disinterest, fatigue, avoid patterns, temporary suppression, or feedback-derived weak downrank signals.
10. If the source-extension gate passes, write or update the dynamic extended-platform index and exactly one generated platform reference by default.
11. Verify that every new state claim has packet evidence or is marked as tentative.

## Evidence Rules

- Cite packet evidence with packet numbers and handles, such as `Update Packet 2: S1 -> C1`.
- Keep single, ambiguous, or curiosity-like actions tentative. Do not promote them to durable preferences.
- Treat repeated, recent, cross-session, or query-to-content chains as stronger evidence than isolated visits.
- Treat `generic_web` `content_interest` records as upstream interest evidence only. They may support Current Needs, Recent Interests, Long-Term Preferences, or Cross-Platform Topics, but they should not create a generic executable platform preference.
- Treat update-packet `Behavior signals` such as `search_to_content`, `repeated_visit`, and `long_dwell` as auditable source-affordance evidence when they are visible in the packet.
- Record explicit refusal, skips, downvotes, "not interested", repeated abandonment, or avoidance as negative signals instead of neutral interests.
- Treat feedback `click` records as weak positive display evidence. A single click may reinforce a current need, recent interest, platform preference, or cross-platform topic when consistent with other evidence, but must not create a durable long-term preference by itself.
- Treat card-level feedback `skip` records as weak negative evidence for the specific displayed card or source only.
- Treat section-level feedback `topic_skip` records as weak topic downrank evidence because every displayed card in that section was skipped at explicit collection time.
- Do not create hard suppressions from MVP click/skip feedback alone.
- Do not register an extended platform from one evidence type alone. Source-extension registration requires the strict gate in `references/source-extension.md`.
- Do not store complete private browsing records, account identifiers, secrets, keys, or long raw text excerpts.
- Prefer compact topic labels and normalized descriptions over copied titles or URLs.
- Mention a non-sensitive generic-web domain only when it appears repeatedly or materially clarifies the evidence. The domain is a source clue, not a recommendation surface.
- When evidence conflicts, keep both the positive and negative side visible and let negative signals reduce priority.

## State File Structure

Use this structure for `USER_STATE.md`:

```markdown
# User State

## Planner Summary
- [Short, current summary for downstream planning.]

## Current Needs
- [Need] | evidence: [packet refs] | status: active/tentative | updated: YYYY-MM-DD

## Recent Interests
- [Interest] | evidence: [packet refs] | status: active/tentative | updated: YYYY-MM-DD

## Long-Term Preferences
- [Preference] | evidence: [packet refs] | confidence: durable/emerging | updated: YYYY-MM-DD

## Cross-Platform Topics
- [Topic] | platforms: [platforms] | evidence: [packet refs] | updated: YYYY-MM-DD

## Platform Preferences
- [Platform]: [preference] | evidence: [packet refs] | updated: YYYY-MM-DD

## Source Affordance Memory
- [source.example] role: official_reference | anchor: topic / intent | source: example.com | retriever: site_constrained_search | confidence: 0.74 | evidence: Update Packet 2: S1 -> C1; Feedback Packet 1: card_x | signals: search_to_content,feedback_click | status: active | platform: example-docs | updated: YYYY-MM-DD

## Negative Signal Summary
- [Avoid/downrank/suppress item] | source: NEGATIVE_SIGNALS.md | updated: YYYY-MM-DD
```

Append entries to `STATE_UPDATES.md` using:

```markdown
## YYYY-MM-DD HH:MM State Update

### Evidence Used
- [Packet refs and short evidence summary.]

### Changes
- Added: [state item]
- Updated: [state item]
- Downgraded/Expired: [state item]
- No Change: [evidence that was insufficient]

### Rationale
- [Concise reason grounded in evidence.]
```

Use this structure for `NEGATIVE_SIGNALS.md`:

```markdown
## Active Negative Signals
- [Topic/content/platform/pattern] | action: avoid/downrank/suppress | evidence: [packet refs] | updated: YYYY-MM-DD | review: YYYY-MM-DD or event-based

## Resolved or Expired Negative Signals
- [Signal] | resolution: [reason] | evidence: [packet refs] | updated: YYYY-MM-DD
```

## Boundaries

Do not:

- collect browser history;
- parse raw browser databases;
- bypass the update packet step;
- read raw rendering click logs directly instead of feedback packets;
- read observation exclusions as state evidence;
- generate recommendations, search results, or UI content;
- turn one weak behavior into a stable preference;
- turn `generic_web` or `SourceExtension` into a Search Instruction platform;
- create a separate source-extension skill;
- register arbitrary websites as executable platforms without source-affordance memory and the source-extension gate;
- put provenance, evidence refs, confidence, status, or trigger rationale into generated extended-platform reference files;
- turn one skipped card into a topic-level suppression;
- preserve full browsing logs, credentials, secrets, private account data, or large raw excerpts;
- hide negative signals inside positive preference sections;
- invent evidence, platforms, topics, confidence, or expiration dates not supported by packets.

Downstream modules should read the user state files, especially `Planner Summary`, instead of reinterpreting raw browsing evidence.

## Verification

After updating state, check:

```bash
test -s .clawrec/clawrec-user-state/latest-update-packets.md
test -s .clawrec/clawrec-user-state/USER_STATE.md
test -s .clawrec/clawrec-user-state/STATE_UPDATES.md
test -s .clawrec/clawrec-user-state/NEGATIVE_SIGNALS.md
```

Then inspect the changed markdown files. Confirm that new state claims reference packet evidence and that negative signals are stored in `NEGATIVE_SIGNALS.md`.

If source extension ran, also confirm that `USER_STATE.md` has a `## Source Affordance Memory` entry, `STATE_UPDATES.md` records the gate decision, and any generated `.clawrec/clawrec-user-state/extended-platforms/<platform-id>.md` file is a pure search instruction reference with no provenance, confidence, status, or evidence fields.
