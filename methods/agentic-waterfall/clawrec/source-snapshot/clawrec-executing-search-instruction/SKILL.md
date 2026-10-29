---
name: clawrec-executing-search-instruction
description: "Executes browser-first search instructions for active indexed built-in and behavior-extended platforms. Use when the task must search in a visible user browser session, load the platform reference selected from the platform indexes, write canonical Markdown results, save per-result primary images, and return verified links with summaries or comparisons."
---

# Executing Search Instruction

Browser-first unified search instruction for active indexed user-facing platforms.

Execution requires a visible user browser session. Never use a headless browser for ClawRec search execution.

## Platform Discovery

Before choosing a platform reference, read the repo-static platform index:

```text
references/platform-index.md
```

Also read the user-state dynamic index when it exists:

```text
.clawrec/clawrec-user-state/extended-platforms/index.md
```

Both indexes use Markdown table columns `Platform`, `Type`, `Reference`, and `Status`. Use only `Status: active` rows. Reject malformed rows, missing references, duplicate ids, and dynamic ids that collide with built-in ids.

Built-in platform groups are declared in `references/platform-index.md`:

- Community: `Zhihu`, `小红书`
- Video: `YouTube`, `Bilibili`
- News: `新华网`, `人民网`
- Commerce: `淘宝`, `京东`
- Academic: `arXiv`

Extended platform ids come only from `.clawrec/clawrec-user-state/extended-platforms/index.md`.

## Out of scope

- Platforms not active in the merged platform indexes are not covered by this skill.
- If the user asks for an unsupported platform, state that this skill does not cover that platform.
- Do not replace built-in platform-native browsing with external web search and present it as on-site browsing.
- For extended platforms, use search-engine `site:` discovery only when the loaded extended-platform reference explicitly defines that workflow. Treat search snippets as candidate discovery only.
- Do not use or launch a headless browser.
- Do not output platform JSON as the canonical result format.
- Do not write a duplicate structured result file that repeats the Markdown content.

## Browser Runtime Contract

Use a visible user browser session because login state, verification state, and visible page evidence are part of the task.

For orchestrated runs, follow the `browser_access` instruction selected by `clawrec-orchestrating-search-execution`. Do not switch profiles, launch a headless browser, or choose an alternate browser mode.

For direct ad hoc use, resolve browser access from OpenClaw config `browser.defaultProfile`:

- If `defaultProfile` is `user`, use DevTools MCP against the user's visible browser session.
- If `defaultProfile` is neither `user` nor `openclaw`, use that profile's CDP URL when available.
- If `defaultProfile` is `openclaw`, accept it only when it attaches to a visible logged-in user browser session.
- If no usable visible browser session is available, ask the user to select or provide one. Do not downgrade to headless.

If browser access fails because only headless execution is available, report: `visible user browser session required but unavailable; headless browser is forbidden`.

## Orchestrated Artifact Contract

For orchestrated runs, the task envelope must include:

```json
{
  "task_id": "task_001",
  "artifact_paths": {
    "result_markdown_path": ".clawrec/clawrec-search-execution/runs/<run_id>/tasks/task_001/RESULT.md",
    "asset_dir": ".clawrec/clawrec-search-execution/runs/<run_id>/assets/task_001/"
  },
  "platform_reference": {
    "type": "built-in",
    "path": "skills/clawrec-executing-search-instruction/references/bilibili.md"
  },
  "execution_input": {
    "platform": "Bilibili",
    "query": "毕业答辩 PPT 制作 教程",
    "task_goal": "find representative Bilibili tutorials"
  }
}
```

The final Markdown answer is the canonical task result. In orchestrated runs:

- Write the complete final Markdown to `artifact_paths.result_markdown_path`.
- Return the same Markdown content to the orchestrator.
- Write exactly one canonical `RESULT.md` per task.
- Do not write a second structured result file that duplicates the same result content.
- If `artifact_paths.result_markdown_path` or `artifact_paths.asset_dir` is missing, report a worker failure instead of inventing paths.
- If `platform_reference.path` is missing, not active in the merged platform indexes, or does not point to an existing Markdown file, report a worker failure instead of selecting a different reference.

For direct ad hoc use without `artifact_paths`, return Markdown in the response and do not invent ClawRec run paths.

## Routing

Always read:
- `references/common-browser-rules.md`
- `references/platform-index.md`

If present, read:
- `.clawrec/clawrec-user-state/extended-platforms/index.md`

For orchestrated runs, verify the provided `platform_reference.path` matches the active row for `execution_input.platform`, then read that single reference.

For direct ad hoc use, resolve the requested platform from the merged active index and read only its `Reference` file.

Do not load all platform references unless the user asks for cross-platform work.

## Universal Workflow

1. Identify the target platform and confirm it is active in the merged platform indexes.
2. Open the platform or reference-defined discovery entry point in the selected visible user browser session.
3. If login or verification blocks the task, stop and wait for the user.
4. Follow the loaded platform reference for the primary search workflow. Built-in platforms search on-site first; extended platforms may use on-site search or reference-defined `site:` constrained discovery.
5. Use bounded query expansion only when needed and only within the rules below.
6. Apply visible platform-native filters when relevant.
7. Select representative results from visible evidence.
8. Save each selected result's primary image or record a factual image status.
9. Open result detail pages when the task requires content summaries.
10. Summarize only evidence that was actually visible or otherwise disclosed under the relevant platform rule.
11. Return one consolidated Markdown answer for multi-result tasks unless the user asks for incremental updates.
12. For orchestrated runs, write the same Markdown to `RESULT.md`.

## Bounded Query Expansion

The provided `query` is the planned query. Start with it. You may use at most two supplemental queries without planner pre-authorization when they are needed for platform search quality.

Allowed supplemental query types:

- translation between Chinese and English;
- platform-language adaptation;
- synonym or near-synonym expansion;
- retrying poor initial results while preserving the same search focus;
- disambiguation, where only disambiguation may add a concrete entity qualifier, such as `Xiaomi` for `MiMo`.

Forbidden supplemental query types:

- continuing the search from new keywords discovered in already-opened results;
- adding a concrete entity that is not needed for disambiguation;
- changing the search focus or research direction;
- broad rewrites with little overlap.

If supplemental queries are used, disclose them in the final Markdown:

```markdown
### 搜索条件
- 平台：<platform>
- 原始关键词：<provided query>
- 补充关键词：
  1. <supplemental query>
  2. <supplemental query if used>
- 扩展原因：<why expansion was necessary>
- 扩展边界：<state that no result-discovered keywords were used and task focus was preserved>
- 已使用筛选：<filters actually applied>
```

If no supplemental query was used, still disclose `原始关键词`, `补充关键词：无`, `扩展原因：无`, and `扩展边界：仅使用原始关键词`.

If a query remains ambiguous after bounded expansion, include a query diagnosis instead of silently changing task direction.

## Primary Image Contract

Every returned post, video, article, answer, paper, or product result must include one primary image block. The block is part of the result item, not a separate result copy.

For orchestrated runs, save primary images under:

```text
.clawrec/clawrec-search-execution/runs/<run_id>/assets/<task_id>/<item_id>/primary_image.<ext>
```

Rules:

- `<task_id>` comes from the orchestrator.
- `<item_id>` is stable within the task: `item_001`, `item_002`, `item_003`.
- `<ext>` must match the actual saved format, such as `jpg`, `png`, or `webp`.
- Use `状态：saved` only after the local image file was written successfully.
- If the image is not visible, unavailable, blocked, or cannot be saved, use `not_visible`, `not_available`, or `capture_failed` with a factual explanation.
- Do not invent image paths.
- Do not use a remote image URL as `本地路径`.
- Do not use platform logos, ads, recommendation-slot images, or images that cannot be confirmed as belonging to the current result.

Primary image type by built-in platform:

| Platform | Type | Selection rule |
|---|---|---|
| `Bilibili` | `video_cover` | Prefer the current video card preview image on the search results page. |
| `YouTube` | `video_cover` | Prefer the current video card thumbnail on the search results page. |
| `小红书` | `post_first_image` | Prefer the current note card preview image on the search results page. |
| `淘宝` | `product_main_image` | Prefer the current item card preview image on the search results page. |
| `京东` | `product_main_image` | Prefer the current product card preview image on the search results page. |
| `新华网` | `article_lead_image` | Use the article detail page lead image; do not use logo, ad, or recommendation images. |
| `人民网` | `article_lead_image` | Use the article detail page lead image; do not use logo, ad, or recommendation images. |
| `Zhihu` | `answer_image` | Use the first meaningful image in the answer or article; mark `not_available` if none exists. |
| `arXiv` | `paper_figure` | Use the first meaningful figure from the HTML or paper page; mark `not_available` if none exists. |

For extended platforms, use `source_detail_image` when a meaningful image is visible on the opened target-site detail page and can be confirmed as belonging to the current result. If no suitable image is visible or available, mark `not_available`. Do not use search-engine thumbnails, source logos, ads, or recommendation-slot images.

For `Bilibili`, `YouTube`, `小红书`, `淘宝`, and `京东`, save the search-result preview image when selecting the candidate. Continue detail-page reading afterward, but do not replace a confirmed search-page primary image unless it cannot be confirmed as belonging to the result.

Use this Markdown block inside every result item, after link/author/source/basic metrics and before content summary or comments:

```markdown
- 首图：
  - 类型：<video_cover | post_first_image | article_lead_image | answer_image | paper_figure | product_main_image | source_detail_image>
  - 状态：<saved | not_visible | not_available | capture_failed>
  - 本地路径：<.clawrec/.../primary_image.ext 或 null>
  - 原始图片URL：<visible/source image URL if available, else null>
  - 图片来源页面：<search results URL or detail page URL where the image was confirmed>
  - 说明：<short factual note>
```

This contract overrides platform references when they omit a primary image block.

## Output

Use the platform-specific Markdown structure in the matching reference file, with the primary image block added to every concrete result item.

The generic default is:
- 搜索条件
- 结果组
- 对比总结

Platform references may use different top-level sections when that better fits the platform. Preserve their platform-specific format and still include primary image blocks.

For UGC or community platforms, distinguish:

- visible facts, such as title, link, author, publish time, and visible engagement counts;
- author claims;
- comment or audience viewpoints;
- worker synthesis across multiple results.

Do not present author claims or comment viewpoints as verified facts. If a page only shows month and day, output the visible month/day and state that the year was not visible; do not silently infer a year. State comment or review loading status explicitly, and summarize comments/reviews only after actual text is visible.

Markdown must preserve platform reference details: search conditions, original and supplemental queries, real detail links, visible facts and metrics, authors/sources/stores/paper metadata, content summaries, comment/review/Q&A status, useful excerpts, comparison notes, recommendation or reading order, and every result's primary image block.

## Final Self-Check

Before answering or writing `RESULT.md`, verify:

- visible user browser session was used;
- no headless browser was used;
- target platform was active in the merged platform indexes;
- the loaded platform reference path matched the active index row or orchestrator-provided `platform_reference`;
- search page was confirmed;
- original query and any supplemental queries were disclosed;
- supplemental queries, if any, are at most two and stay within bounded query expansion rules;
- filter state was confirmed, or the unconfirmed filter state is disclosed;
- detail pages were opened, or unopened detail pages are disclosed;
- comment/review text was actually visible, or unloaded comments/reviews are disclosed;
- link type is labeled as a real detail link or wrapper/search-result link;
- every returned result has a primary image block;
- primary image type matches the platform mapping;
- for extended platforms, primary images come from opened target-site detail pages only;
- `saved` image status corresponds to an actual local file path;
- no remote image URL is used as a local path;
- no logo, ad, recommendation-slot image, or unbound image is used as a primary image;
- missing images use `not_visible`, `not_available`, or `capture_failed` with a reason;
- for orchestrated runs, canonical Markdown was written to `artifact_paths.result_markdown_path`;
- Markdown output preserves detail evidence, comment/review status, comparison notes, and recommendation or reading order required by the platform reference;
- evidence boundaries and any platform-permitted fallback path are stated.
