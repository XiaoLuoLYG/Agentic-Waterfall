# Waterfall: coordinated acquisition, ranking, and state updates

Create a camera-ready scientific architecture diagram for an ACL long paper. This is a proposed method, not an implemented result. Use a wide, compact canvas, approximately 2:1, with a white background. The final figure will span 160 mm in a two-column paper. Labels must remain readable at that size (roughly 8–10 pt); avoid paragraphs inside boxes.

## Scientific content

Waterfall adapts external state while keeping the language model and scoring backend frozen. The four actions are Edit, Acquire, Rank, and Hold. A correction does not automatically require another search. Both acquisition and ranking must read the same accepted state revision.

Show a left-to-right flow with a clearly routed feedback loop:

1. **Observations.** A small language bubble reads “Too advanced. Start with basics.” A compact event strip contains explicit reactions and exposure events. Preserve the distinction between card visibility and video playback; do not turn duration directly into a positive preference.
2. **Scoped shared state.** Two visibly distinct records: “Current task: beginner lessons” and “Persistent interest: photography.” An Edit arrow updates the task record while leaving the persistent record unchanged. Small supporting tags can indicate “evidence” and “revision.” Bounded edits are validated before acceptance. This entire scoped-state module is a proposed extension.
3. **Candidate-aware controller.** Show the accepted state, eligible unseen candidates, and remaining budget as its inputs. The key question is “Enough suitable candidates?” If enough candidates exist and an update is justified, Rank the existing pool. If there is a shortfall and budget remains, Acquire a bounded batch and reassess. If no update is justified, Hold the current state/order. Acquisition also stops at its cap or when repeated requests add no eligible items. A short slate is permitted when the pool stays insufficient. This controller is a proposed extension.
4. **Execution and display.** Acquire connects authorized content sources to the candidate pool. Rank connects the pool to a displayed slate. Use small flat document cards labeled A, B, C as illustrative item identifiers. The candidate cards and displayed cards should share their item colors. Draw the feedback path only from the displayed slate back to Observations. Do not draw feedback from unshown candidates.

Connect the accepted shared state to both acquisition queries and ranking context. Make that shared dependency clear without crossing a tangle of arrows. A small line beneath the controller may read “Frozen model · bounded actions.” This refers to runtime state adaptation, not parameter training.

## Visual direction

Use restrained, moderately rich academic illustration: blue for acquisition, purple for state, teal for ranking/display, and amber for feedback. Pale fills, dark readable text, thin outlines, consistent small line icons, and a few overlapping document cards provide enough visual detail. Flat 2D, aligned elements, generous internal padding, clear hierarchy. Avoid photos, realistic phones, robots, gradients, glossy icons, thick shadows, giant decorative headings, and an all-rectangle flowchart.

Use dashed outlines only for the proposed scoped state and candidate-aware controller; solid outlines for the existing component types such as observations, sources, candidate pool, ranking, and display. Include a tiny legend: “Dashed: proposed extension.” This does not claim the full connected system is implemented.

All text must be in English. The layout should explain the mechanism at a glance. Do not include performance numbers, reward curves, training arrows, or invented experiments. The photography example and item letters are explanatory examples, not measured data.
