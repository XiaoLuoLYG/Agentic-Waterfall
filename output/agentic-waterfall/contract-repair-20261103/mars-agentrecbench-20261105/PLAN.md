# MARS × AgentRecBench implementation and execution plan

The user authorized this addition on 2026-11-05: validate a small batch's input, output and scoring, then run all 300 tasks if acceptance passes. RecBot is independently audited against the current KuaiRand inputs; reuse every identical effective stage, rerun only changed stages. No AIA dependency is required for that approved RecBot variant.

Use the existing paper-aligned MARS implementation and prompt templates pinned in `frozen/v6/code`, rather than the older workspace prototype. Keep retrospective extraction over all visible comments, the native 15-event ranking memory, native score sorting and candidate tie order. Map each complete public comment into a MARS event without losing review or item fields. Supply the same public user metadata, category, location, 20 candidate IDs/texts and original task denominator used by the other fixed-candidate controls.

1. Test the projection on populated and empty histories, missing metadata and malformed/duplicate candidate pools. Freeze all 300 assignments and every code/input hash before paid calls.
2. Generate exactly six domain dimensions from ten deterministic, public candidate descriptions per domain, without labels. Freeze three domain configurations before pilot inference.
3. Reuse the existing six-task pilot selection (two tasks per domain). Validate each request/receipt, all 20 scores and native ordering. Freeze predictions, run the existing official evaluator and an independent Hit@5 calculation. Only output/contract/scoring failures block the full phase; do not select prompts or resample by pilot scores.
4. Run the remaining tasks through the existing SQLite model transport, shared three-key scheduling and service limits. Reuse pilot outputs; preserve genuine model failures at zero under the original denominator. Recover only transport faults or proven engineering defects from exact successful prefixes.
5. Freeze all predictions before reading labels; official score and independent recomputation must match. Publish the accepted numbers directly in both main tables, retaining method-adaptation notes.

Touches: new run-local adapter, CLI, controller, tests, assignments, requests/receipts and acceptance artifacts; final table/state updates. Existing frozen methods, datasets, controls, API limits, other experiments and paper/demo remain unchanged. No training/downloads or new automations.
