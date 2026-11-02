# Waterfall unified core implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** One Waterfall implementation for local, GitHub research and deployed demo, confirmed bugs fixed, Chinese quality-first prompts; no experiment reruns.

**Architecture:** Retain the existing unified runEpisode and v20 demo adapters. Merge confirmed receipt-consumption fixes into that core; old active runtime paths only forward. Publish the same verified files to Sites and its existing Linux compute backend.

**Tech Stack:** Existing Node ESM, Python adapters, Sites/Cloudflare and existing Linux service; no new dependencies.

**Spec:** User instruction of 2026-11-02 and output/agentic-waterfall/optimization-plan-20261102/REPORT.md in the parent workspace.

## Global Constraints

- Preserve dirty local demo files, historical frozen predictions, scores, user data and method state.
- No training, benchmark reruns, new data, test-label-driven tuning or resource purchases.
- All model-facing Waterfall prose in Chinese; JSON fields/tool identifiers retain protocol spelling.
- Quality first, autonomous action selection, sufficient retrieval; preserve actual platform/protocol limits without new cost-driven limits.
- Preserve v20 live sourcing, feedback priority, early delivery, nonexclusive preferences and private storage.

## Review Focus

- Metadata arrives after an early ranking without introducing a new ID.
- A memory record carries old evidence references into a new decision.
- Fixed-workflow and channel-removal variants retain appropriate history lookup.
- Existing legacy CLI callers need automatic model transport while unified callers inject it.
- Public Site and private compute process must report the same actual core hash.

### Task 1: Restore the deployed baseline in the owning research checkout

**Files:** existing demos/agentic-feed-site v20 tracked sources; plan and ledger.
**Interfaces:** v20 runDemo and runEpisode remain unchanged at baseline.
- [ ] Import the known deployed v20 source without data/dependencies; retain confirmed-fix test files.
- [ ] Run existing late-evidence tests; observe v20 metadata-consumption failures.

### Task 2: Fix shared execution and tool contracts

**Files:** demos/agentic-feed-site/lib/waterfall/waterfall-core.mjs; experiments/agentic-waterfall/unified/late-evidence.test.mjs; relevant runtime, history and AgentRecBench tests/adapter.
**Interfaces:** existing runEpisode/createRuntime action schemas remain compatible.
- [ ] Merge the confirmed receipt-consumption changes only, preserving v20 pending acquisitions.
- [ ] Add failing then passing checks for cross-round evidence, appropriate variant history lookup and metadata-tool limit semantics.
- [ ] Run shared core/demo/adapter suites; preserve unknown-reference and heldout-label rejection.

### Task 3: Unify entry points and replace prompt prose

**Files:** shared/runtime.mjs, demos/agentic-feed/unified-demo.mjs and input helpers where duplicated; canonical core prompt and dynamic messages; source hash file; prompt/entrypoint regression checks.
**Interfaces:** legacy model transport is injected by a forwarding adapter; all action logic stays canonical.
- [ ] Make active duplicate controllers forward while historical releases remain immutable.
- [ ] Replace SYSTEM_PROMPT plus dynamic Waterfall instructions with complete Chinese input/action guidance and general examples.
- [ ] Run all relevant Node/Python tests and a Site build; record actual hash.

### Task 4: Review, synchronize and publish

**Files:** release receipt and verification document; existing source deployment package.
**Interfaces:** existing Sites project and Linux service, existing local demo data.
- [ ] Fresh whole-branch code review, resolve material findings and rerun affected checks.
- [ ] Commit/push research; sync only reviewed changes into local mirrors and Sites source checkout.
- [ ] Update compute code without changing secrets/data; no in-flight work interrupted.
- [ ] Publish Site, verify local/repo/package/remote hashes and a bounded synthetic model smoke, no benchmark rerun.
- [ ] Record what changed, tests, deployment version, limitations and no experiment reruns.
