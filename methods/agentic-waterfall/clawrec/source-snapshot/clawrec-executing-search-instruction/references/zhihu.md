# Zhihu

Use when the target platform is Zhihu.

## Contents
- Goal
- Login rule
- Verified current filter path
- Preferred stable workflow
- Selection rule
- Detail-page requirements
- Output format for multi-answer Zhihu tasks
- Return

## Goal
Run a real Zhihu workflow:
- open Zhihu
- wait for manual login or verification if required
- search a keyword
- apply visible time/sort filters when available
- prioritize high-like / high-heat results
- open representative answers or articles
- return links plus concise content summaries

## Login rule
If Zhihu shows login, QR, slider verification, or risk-control gates, stop and wait for the user.
Do not pretend login completed.

## Verified current filter path
On the currently verified UI, a stable path is often:
1. results page
2. `筛选`
3. choose time such as `一周内` / `一月内`
4. choose sort such as `最多赞同`
5. optional content-type narrowing such as `只看回答` or `只看文章`

If the filter panel is collapsed, expand it before concluding the time filter is unavailable.

## Preferred stable workflow
For multi-result Zhihu tasks, prefer this exact order:
1. open Zhihu in the real browser
2. confirm no login / risk-control gate is blocking the page
3. search the keyword on-site
4. apply visible filters on the results page and verify the filter state is visible
5. identify the top requested results from the filtered results page first
6. capture the real detail URLs for the chosen results first
7. then open the chosen detail URLs one by one directly
8. summarize only after the detail pages have actually been opened

This is the default stable path for Zhihu.
Do not rely on a long chain of brittle sequential result-card clicks after filtering if the detail URLs are already visible.
Once the selected answer links are confirmed, prefer directly opening those verified URLs one by one.

## Selection rule
Prioritize in this order:
1. results with visible high 赞同 counts
2. results with the strongest visible interaction signals
3. results clearly centered on the keyword
4. answers over weak aggregation cards unless the user asked for articles

If exact likes are not visible, say 高互动 / 高热度 instead of inventing like counts.

## Detail-page requirements
Collect when visible:
- title
- final URL
- author
- timestamp
- support/like count
- comments / favorites / heat indicators
- core content points

If the result is a question page with multiple answers, prefer the visibly top-liked relevant answer.

## Output format for multi-answer Zhihu tasks
Default to this compact Markdown structure unless the user asks for another format:

```md
# 问题
**<keyword>**
- 平台：知乎
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 筛选：**<actual filters used>**

# 回答 1
- **标题 / 链接**：<title + url>
- **一句话总结**：<one-sentence takeaway>
- **主要内容**：<2-4 bullets or short sentences>
- **特点**：<angle / style / who it suits>

# 回答 2
- **标题 / 链接**：...
- **一句话总结**：...
- **主要内容**：...
- **特点**：...

# 回答 3
- **标题 / 链接**：...
- **一句话总结**：...
- **主要内容**：...
- **特点**：...

# 对比
- **共同点**：...
- **不同点**：...

# 阅读建议
- **先看**：...
- **原因**：...
```

## Return
For multiple-result tasks, end with:
- compact per-result summaries
- links
- a comparison of common points and differences
- a short reading recommendation
