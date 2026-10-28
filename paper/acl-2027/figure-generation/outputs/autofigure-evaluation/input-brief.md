# Paired multi-round evaluation under a common budget

Create a scientific evaluation-protocol diagram for an ACL long paper, using editable SVG. This is a planned experiment, not results. Use a wide, compact canvas approximately 2.1:1. It will span 160 mm in the paper; all labels must remain readable at roughly 8–10 pt after scaling. Prefer a clear timeline with two matched lanes over a generic flowchart.

## Scientific content

At the left, a single shared setup branches into two independent trajectories. Label it “Same initial history, sources, model, and budget.” Both methods have the same scoring backend and tool access. Each may acquire different candidates and show a different slate. Do not imply that the candidate pool remains identical across methods.

Use two lanes labeled “Matched baseline” and “Waterfall controller.” Show three illustrative rounds, aligned vertically across the lanes. In each round, distinguish a small state record from the slate of items that is actually displayed. The sequence within each lane is:

state and available candidates → action choice → displayed slate → feedback → next state.

Use short labels and small document cards to make this legible. Slate letters such as A, B, C are item identifiers, not relevance grades. The lanes can show different item letters, but do not encode one method as consistently better, use green/red correctness marks, or attach numerical outcomes. Three rounds illustrate the protocol, not a fixed experimental horizon.

A common scheduled instruction before round 2 reads “Too advanced. Start with basics.” It is released at the same step to both methods; neither policy sees future instructions. Behavioral reactions are conditional on each method's own displayed slate. Draw the feedback arrows within the corresponding lane only. Do not feed reactions about an unshown item into either method. A subtle note can read “Feedback on shown items only.”

On the right or in a compact lower band, collect outputs from both trajectories into an independent, method-blind usefulness assessment. This judge is separate from the policy and any feedback simulator. Its labels are used for evaluation and must not feed back to the controller. Indicate a human audit without inventing a sample size. Synthetic feedback, when used, should be marked as simulated.

Summarize three measurement groups with concise headings and small line icons:
- “Useful distinct items”: count useful content once per duplicate group, plus ranking quality.
- “Adaptation”: exposures needed after a goal correction, plus inappropriate persistent edits.
- “Cost”: source calls, tokens, and update latency.

Include a small note: “Protocol illustration; no measured outcomes.” Do not fabricate curves, bars, scores, confidence intervals, sample sizes, or user-study results.

## Visual direction

Match a companion architecture figure: white canvas, dark text, restrained blue, purple, teal, and amber. Purple marks state, teal marks displayed content, amber marks feedback. Use thin lines, pale lane accents, a few compact stacked records and flat document icons. The baseline lane can use muted blue and the Waterfall lane muted teal, with equal visual weight. No gradients, shadows, photorealism, robots, app-dashboard cards, or huge titles. Use whitespace and alignment for structure; avoid excessive nested boxes. This should look like a polished paper explanation figure, not a promotional infographic.
