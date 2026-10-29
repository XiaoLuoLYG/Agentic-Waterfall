---
name: clawrec-using-clawrec
description: Runbook entry point for using ClawRec. Use when the user asks to use ClawRec, run ClawRec, refresh ClawRec state, generate ClawRec recommendations or pages, settle ClawRec feedback, run a full ClawRec cycle, or asks which ClawRec skill to call next, including Chinese requests such as 刷新 ClawRec 状态, 生成 ClawRec 推荐/页面, 结算 ClawRec 反馈, 跑一轮 ClawRec, or 我现在该调用哪个 ClawRec skill.
---

# Using ClawRec

User-facing runbook for choosing the next ClawRec lifecycle skill.

This Skill is a thin entry point. It explains the correct stage order, required preconditions, and which existing ClawRec skill should handle the work. It does not execute the pipeline by itself and does not replace any stage skill.

## Purpose

Use this Skill when the user wants to operate ClawRec but has not named the exact lifecycle skill.

Common requests:

- use or run ClawRec;
- refresh ClawRec user state;
- generate ClawRec recommendations or a recommendation page;
- settle ClawRec display feedback;
- run one full ClawRec cycle;
- decide which ClawRec skill should be called next.

## Flow Selection

Choose the narrowest flow that satisfies the user's request.

### Refresh User State

Use when the user wants ClawRec to update memory from authorized browser behavior.

Order:

1. `clawrec-observing-browser-behavior`
2. `clawrec-synthesizing-user-state`

Preconditions:

- the user has authorized local browser evidence extraction;
- browser observation inputs are available or accepted by the user;
- state synthesis must read update packets, not raw browser history.

Expected handoff:

- observation writes `.clawrec/clawrec-unified-events/latest/evidence.jsonl`;
- synthesis writes `.clawrec/clawrec-user-state/USER_STATE.md`, `STATE_UPDATES.md`, `NEGATIVE_SIGNALS.md`, and `latest-update-packets.md`.

### Generate Recommendation Page

Use when the user wants a ClawRec recommendation page from existing user state.

Order:

1. `clawrec-making-content-plan`
2. `clawrec-orchestrating-search-execution`
3. `clawrec-curating-display-data`
4. `clawrec-rendering-generative-interface`

Preconditions:

- canonical user state exists under `.clawrec/clawrec-user-state/`;
- search execution can use a visible user browser session;
- headless browser execution is forbidden;
- rendering uses curated display data, not raw search output.

Expected handoff:

- planning writes `.clawrec/clawrec-content-plan/latest/PLAN.md`;
- orchestration writes `.clawrec/clawrec-search-execution/latest/`;
- curation writes `.clawrec/clawrec-display-data/latest/display-data.json`;
- rendering writes `.clawrec/clawrec-generative-interface/<session_id>/content/*.html` and displayed-card state.

### Settle Display Feedback

Use when the user wants to convert displayed recommendation-page interactions into state evidence.

Order:

1. `clawrec-collecting-display-feedback`
2. `clawrec-synthesizing-user-state`

Preconditions:

- a rendered ClawRec interface session exists;
- displayed-card manifest or latest display data is available;
- feedback collection is explicit;
- skip feedback must not be inferred from idle time, page reload, or session age.

Expected handoff:

- feedback collection writes `.clawrec/clawrec-feedback/latest/feedback-packets.md`;
- synthesis reads feedback packets and updates user state and negative signals.

### Full Cycle

Use when the user wants ClawRec to run one complete recommendation cycle from behavior evidence to rendered page.

Order:

1. `clawrec-observing-browser-behavior`
2. `clawrec-synthesizing-user-state`
3. `clawrec-making-content-plan`
4. `clawrec-orchestrating-search-execution`
5. `clawrec-curating-display-data`
6. `clawrec-rendering-generative-interface`

Preconditions:

- the user has authorized browser evidence extraction;
- visible user browser access is available for search execution;
- existing stage boundaries and artifact contracts remain in force.

After the user interacts with the rendered page, use the Settle Display Feedback flow when explicit feedback collection is requested.

## Lightweight Checks

Before routing, check only the minimum needed to choose the next stage:

- If the user asks to refresh state, start from observation unless they already point to existing UnifiedEvent evidence.
- If the user asks to generate a page, start from planning when canonical user state exists.
- If the user asks to settle feedback, start from feedback collection for a specific rendered session or displayed-card source.
- If the user asks for a full cycle, start from observation.

Do not perform artifact freshness diagnosis, recovery planning, or historical run comparison in the MVP. Those belong to future operator extensions or to the owning stage skill.

## Boundaries

Do not:

- read raw browser history directly;
- parse raw browser databases;
- mutate `.clawrec/clawrec-user-state/` directly;
- create or edit `PLAN.md` directly;
- open external platforms or run searches directly;
- curate display cards directly;
- render HTML directly;
- read raw rendering click logs as state evidence;
- infer skipped cards without explicit feedback collection;
- execute a hidden all-in-one pipeline script;
- repair missing artifacts or failed stages by guessing;
- duplicate internal rules from lifecycle skills.

Instead, route to the owning skill and let that skill enforce its input contract, output contract, and verification steps.

## Handoff Style

When using this Skill, tell the user which flow was selected and which stage skill comes next.

Keep the handoff concrete:

```text
Selected flow: Generate Recommendation Page
Next skill: clawrec-making-content-plan
Reason: canonical user state is the input for planning, and planning owns PLAN.md.
```

If a required precondition is unavailable, state the missing precondition and stop at the runbook boundary. Do not invent a substitute input.

## Verification

Before finishing a runbook response, verify:

- the selected flow matches the user's request;
- every listed stage is an existing ClawRec lifecycle skill;
- no stage is skipped when its artifact is required by the next stage;
- no raw upstream artifact is read by a downstream stage through this Skill;
- visible-browser and explicit-feedback requirements are stated when relevant;
- the response names the next skill to invoke.
