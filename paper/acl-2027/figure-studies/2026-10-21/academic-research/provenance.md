# Figure provenance and claim trace

## Method actually used

Repository: https://github.com/imbad0202/academic-research-skills

Pinned source commit: `3224a27a2571cefef0fddfd437004cb006f2b0cb`.

Read and applied:

- `academic-paper/agents/visualization_agent.md`: concept-map selection, self-contained Python code, readable typography, accessible labels, captions, LaTeX inclusion, quality gates, and trace packaging.
- `academic-paper/references/statistical_visualization_standards.md`: concept maps for concept relationships, restrained categorical colors, no misleading outcome marks, and readable paper-size typography.
- `academic-paper/references/vlm_figure_verification.md`: rendered-image review with at most two refinement cycles and an explicit source-to-caption trace.

Matplotlib constructs every node, glyph, label, and routed connector. No repository image-generation script or remote model was invoked. These inputs are concepts and directed relationships, so statistical axis, unit, confidence-interval, and statistical-data gates are inapplicable. The user-requested 160 mm width and approximately 2:1 aspect ratio take precedence over generic figure-size defaults. Captions remain outside the image, following the existing ACL paper's format.

## Primary source mapping

Source manuscript: `paper/acl-2027/official-template/acl_latex.tex`.

| Visual content | Source lines |
| --- | --- |
| Proposed controller and implementation boundary | 94, 148–175, 256–264 |
| Correction changes task difficulty without erasing photography | 107–109 |
| Bounded validation and common accepted state | 113–117 |
| Candidate sufficiency, Acquire / Rank / Hold, reassessment | 121–136 |
| Frozen scoring parameters | 142–144 |
| Matched starts with different candidate pools | 193, 212 |
| Scheduled instructions and slate-conditional feedback | 196–198 |
| Independent feedback generator and usefulness judge | 198, 251 |
| Useful distinct items and ranking quality | 89, 228–233 |
| Recovery exposures and inappropriate persistent edits | 235–236 |
| Source calls, tokens, update latency | 238–239 |
| No measured results | 256 |

Supplementary task briefs, used for accuracy constraints rather than copied layout:

- `paper/acl-2027/figure-generation/architecture-compact.md`
- `paper/acl-2027/figure-generation/evaluation.md`

All three source file SHA-256 hashes are recorded in `verification.json`. The drawing script hash is recorded in `checks.json`.

## Figure/table trace

The figures remain alternatives outside the manuscript. Therefore the current manuscript does not cite these new files, and `supported_manuscript_claims` is intentionally empty rather than falsely claiming integration. The source map above states the claims each visual is designed to explain. The statements are specifications, not empirical findings.

```yaml
figure_table_trace:
  - artifact_id: architecture-academic-study
    source_data:
      dataset_id: waterfall-method-concepts-not-numerical-data
      file: paper/acl-2027/official-template/acl_latex.tex
    transformation:
      script: draw_figures.py
      hash: eae376fcd33e7fab8781b2bdb7e019f871370050af0cfb86699d4155cdc973d2
    caption_claim: "The proposed controller applies bounded shared-state edits and checks candidate sufficiency and budget before Acquire, Rank, or Hold; it does not train model parameters."
    supported_manuscript_claims: []
    limitations:
      - "Proposed controller; no implementation or efficacy validation is shown."
      - "Item letters and the beginner/photography state are illustrative."
      - "Thresholds, failure branches, and asynchronous scheduling are not expanded in the compact drawing."
  - artifact_id: evaluation-academic-study
    source_data:
      dataset_id: waterfall-planned-evaluation-concepts-not-experimental-results
      file: paper/acl-2027/official-template/acl_latex.tex
    transformation:
      script: draw_figures.py
      hash: eae376fcd33e7fab8781b2bdb7e019f871370050af0cfb86699d4155cdc973d2
    caption_claim: "The planned comparison matches starting conditions, releases a common correction, keeps each method's state, pool, slate, and feedback independent, and separates evaluation labels from policy inputs."
    supported_manuscript_claims: []
    limitations:
      - "Protocol illustration only; no measurements, superiority claim, or final horizon is shown."
      - "Document letters are identifiers, not relevance grades."
      - "The collection edge summarizes full-trajectory slates and logs; costs come from execution logs rather than the usefulness judge."
```
