# Xiaohongshu

Use when the target platform is Xiaohongshu.

## Contents
- Goal
- Critical login rule
- Search rule
- Selection rule
- Entering notes
- Detail-page requirements
- Multi-note tasks
- Return

## Goal
Run a real 小红书 note-research workflow:
- open Xiaohongshu
- wait for manual login if required
- search a keyword
- switch to 图文 when the task is note-focused
- choose high-interaction notes
- enter note detail pages from the result page
- read full note text and useful comments
- compare multiple notes in one final answer

## Critical login rule
If the site shows a blocking login popup or `登录探索更多内容`, stop and wait for the user.
Reliable logged-in signals include:
- left navigation shows `我`
- blocking login popup is gone

## Search rule
Use the homepage search box, then press Enter.
Search result types usually include:
- 全部
- 图文
- 视频
- 用户

For note research tasks, prefer `图文`.

## Selection rule
Choose notes based on:
- visible interaction counts
- relevance to the keyword
- evidence of itinerary / route / planning / practical tips

Do not summarize a note from the cover alone.

## Entering notes
Prefer clicking into notes from the search results page instead of directly opening note URLs when avoidable, because direct opens can trigger anti-abuse blocks.

After the note is successfully opened, return the real detail URL when available.

Link priority for Xiaohongshu note outputs:
1. `https://www.xiaohongshu.com/explore/<note-id>?xsec_token=...&xsec_source=...`
2. `https://www.xiaohongshu.com/explore/<note-id>`
3. wrapper `search_result/...` URL only if nothing else was capturable, and label it clearly as a wrapper link that may not open directly

Do not treat `search_result/...` wrapper URLs as the final link when a real `explore/...` link can be captured from the opened detail page.
If only a wrapper/search-result URL was available, say so clearly instead of presenting it as a stable direct-open link.
If same-page overlay close behavior is unstable, preserve the search results context and prefer stable multi-page / multi-tab reading patterns rather than pretending the return step worked.

## Detail-page requirements
Read:
- title
- author
- publish date
- visible engagement counts
- full visible note body
- images if needed for route maps / itinerary cards / text split across images

Treat note text as author claims unless independently verified elsewhere in the same visible page. Separate visible facts, author claims, comment viewpoints, and your synthesis in the final answer.

If comments are useful, prioritize:
1. pinned comment if present
2. two additional high-value visible comments

## Multi-note tasks
Do not stop after one note if the user asked for multiple notes.
Default target: 3 notes.
Inspect the chosen set, then return one consolidated answer containing:
- each note’s core content
- links
- common points
- differences
- best-fit recommendation

## Return
Use the concise platform output style below, with real detail links when available, and distinguish note-body information from comment-based supplements.

### 搜索条件
- 平台：小红书
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 已使用筛选：<filters actually applied>
- 说明：<login / filter / limitation notes if any>

### 图文 1
- 标题：<title>
- 链接：<real detail URL>
- 作者：<author>
- 时间：<publish time if visible; if only month/day is visible, state that year was not visible>
- 互动数据：<赞 / 藏 / 评等可见数据>
- 作者主张：<2-4 sentences based on actual note body>
- 有信息量评论：
  - <置顶评论 if visible>
  - <高价值评论 1>
  - <高价值评论 2>

### 图文 2
- same fields

### 图文 3
- same fields

### 对比总结
- 共同点：<common themes>
- 差异点：<how they differ>
- 推荐顺序：
  1. <best first pick and why>
  2. <second pick and why>
  3. <third pick and why>
