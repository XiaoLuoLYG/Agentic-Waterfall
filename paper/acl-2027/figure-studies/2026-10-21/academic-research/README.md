# Waterfall concept figures: academic-research workflow

Two alternative figures drawn with runnable Matplotlib code using the `visualization_agent` concept-map path from `imbad0202/academic-research-skills`. This is a diagram study, not a statistical visualization or completed experiment.

## Files and reproduction

- `architecture.png` and `evaluation.png`: 1889 × 992 pixels, 300 dpi, intended physical size 160 × 84 mm.
- `architecture.svg` and `evaluation.svg`: vector paths plus editable SVG text; Arial with a sans-serif fallback.
- `draw_figures.py`: complete drawing code; writes both PNGs, SVGs, and `checks.json` beside itself.
- `captions.md` and `figures.tex`: full captions and optional LaTeX inclusion.
- `provenance.md`: source-to-figure trace and scope limits.
- `checks.json`: actual render-time font-size and text-bound checks.
- `verification.json`: actual raster metadata, SVG text counts, line-versus-text checks, and source/output SHA-256 hashes.

Run from any working directory with Python and Matplotlib installed:

```sh
python draw_figures.py
```

The environment used for this package was isolated from the application and project runtimes:

```sh
/Users/luoyige/.local/share/research-figure-tools/matplotlib-venv/bin/python \
  /Users/luoyige/Documents/ChatGPT/waterfall/paper/acl-2027/figure-studies/2026-10-21/academic-research/draw_figures.py
```

The bundled Python did not contain Matplotlib. A local venv was created with the bundled Python 3.12 and Matplotlib 3.10.8 installed there. No application dependencies were changed. No model API, API key, image-generation endpoint, or synthetic numerical dataset was used.

## Actual verification

- Reviewed both rendered PNGs against the method and protocol text in manuscript Sections 4 and 6.
- Inspected the initial render and one refined render. The refinement moved the evaluation feedback labels away from the common-instruction line and removed an overlap with the collection label; it also clarified the scoring backend and unwanted state-edit label.
- Both final images contain only fonts of 8 pt or larger at their actual 160 mm drawing width. They must not be reduced below 160 mm without reassessing legibility.
- Both final renders have zero text boxes outside the canvas and zero pairwise text-box overlaps.
- A separate check found zero intersections between Matplotlib line paths and text bounding boxes. This check is geometric; the semantic correctness of arrows was inspected visually, not certified by an automated score.
- PNG metadata reports approximately 300 dpi (299.9994 after integer metadata conversion). SVGs contain 30 and 56 editable text elements respectively.
- The architecture uses one controller and exactly one Acquire and one Rank executor. The same state rail terminates at both. Only displayed content feeds the feedback return.
- The two evaluation lanes have equal visual weight, distinct item identifiers, and within-lane feedback. The common instruction is released at Round 2. The judge has no reverse arrow to the policy.
- Text, glyphs, direct labels, line patterns, and lane position carry meaning independently of color. No decorative gradients, shadows, 3D effects, curves implying outcomes, or numeric results are present.

VLM-style visual verification status: **PASS_WITH_NOTES**, two inspected renders, one refinement cycle. No numerical visual-quality score was generated. A physical print proof, dedicated color-vision simulation, and final manuscript compilation were not run. The root agent also visually reviewed both final PNGs.

## Limits

These diagrams explain proposed mechanisms and planned evaluation; they do not establish implementation correctness or effectiveness. Document letters and state glyphs are constructed explanatory examples. The evaluation output arrow summarizes the full trajectory log; it is not limited to the last illustrated slate. The usefulness judge supplies usefulness labels, while execution logs supply cost measures. Detailed shortfall handling, threshold choices, source-failure branches, and later rounds remain in the text and are not expanded into additional boxes.

No main TeX file, official figure, or PDF was changed or generated. The optional LaTeX snippet uses the PNG exports to avoid a new SVG-to-PDF build requirement. SVG text may reflow if edited on a machine with a different font.
