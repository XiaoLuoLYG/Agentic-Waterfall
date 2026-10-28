# Waterfall architecture visual proposal v3

Date: 2026-10-21.

This is a visual proposal in response to the user's rejection of the previous plain vector figures. It is saved independently as waterfall-architecture-v3.png. The existing paper and its two referenced figure PDFs have not been changed.

## Evidence used to select a stronger workflow

- [PaperBanana, Google Research](https://research.google/pubs/paperbanana-automating-academic-illustration-for-ai-scientists/): reference retrieval, layout/style planning, image generation and iterative critique; authors evaluate on 292 methodology diagram cases drawn from NeurIPS 2025. These are author-reported experiments, not an independent validation of this Waterfall figure.
- [Official PaperVizAgent implementation](https://github.com/google-research/papervizagent): 562 stars as displayed on the GitHub page at inspection. The official method diagram was visually inspected.
- [AutoFigure](https://github.com/ResearAI/AutoFigure): approximately 1.9k stars at inspection; authors announce ICLR 2026 acceptance and support for SVG / mxGraph outputs. The OpenReview PDF was blocked by a browser verification challenge, so the acceptance statement here is attributed to the authors' official repository.

The previously referenced 4-star academic-diagram repository was not used as the quality basis for this revision. Star counts are popularity signals, not quality measurements.

## What actually ran

The installed OpenAI imagegen skill and the built-in image generation tool were used: one initial generation followed by two targeted correction passes. Neither the official PaperBanana/PaperVizAgent framework nor AutoFigure was installed or executed. Their reported benchmark scores do not transfer to this output. No external API key was configured.

The initial prompt is waterfall-architecture-v3.prompt.md. Targeted corrections are waterfall-architecture-v3.corrections.md.

## Figure review

Visually reviewed after each generation. The first draft incorrectly routed candidate shortage to the candidate pool. Corrections route that action to Acquire, preserve direct reranking when enough candidates exist, restore Candidate pool -> Rank, connect shared state to the common acquisition/ranking context, and remove a dangling arrow.

- Richer semantic illustrations: example feed, layered scoped state, source cards, candidate pool, and displayed slate.
- The photography case, titles, event values and thumbnails are illustrative, not observations or experimental results.
- The validated Edit operation provides the accepted state to the controller and writes the shared memory.
- The proposed controller boundary is labelled; parameter updates are explicitly excluded.
- The dashed context line to Rank ends on the encompassing ranking region; the layout is a visual proposal, not a final vector schematic.

## Remaining limits

The output is a raster PNG. Labels and connections are not separately editable vector objects. No claim is made that it has passed final ACL print-size checks. The open TeX document, formal figure PDFs, and QA PDF were left untouched; no compilation was required for this preview-only change.

