# Xinhua

Use when the target platform is Xinhua.

## Contents
- Goal
- Verified browser nuance
- Search-page behavior
- Verified sort-control interaction
- Preferred stable workflow
- Interpretation rules
- Output format for multi-article Xinhua tasks
- Return

## Goal
Run a real 新华网 site-search workflow:
- open 新华网 homepage
- verify the `站内搜索` entry exists
- enter the search flow
- search a keyword
- compare `按时间排序` and `按相关度排序` when useful
- open representative articles and summarize them

## Verified browser nuance
The most reliable verified path is:
1. open `https://www.news.cn/`
2. confirm `站内搜索` is visible
3. if homepage click works, continue normally
4. if homepage click does not visibly navigate, directly open `https://so.news.cn/`

This still counts as the real browser workflow because the homepage search entry was verified first.

## Search-page behavior
Typical elements on `so.news.cn`:
- search textbox
- `搜索` button
- search scope radios:
  - `在新闻全文中`
  - `仅在新闻标题中`
- sort dropdown:
  - `按时间排序`
  - `按相关度排序`

Default scope:
- prefer `在新闻全文中` unless the user explicitly wants title-only matching

## Verified sort-control interaction
For current verified UI behavior, prefer this exact interaction:
1. run the search first so the result list is visible
2. use the sort control inside the **result area** (`搜索结果排序方式`) rather than relying on the top compact header control
3. click the result-area sort button to expand the dropdown
4. then click the popup option `按相关度排序`
5. confirm success only when the result-area sort text visibly changes to `按相关度排序`

Do not assume the top compact sort text changed the actual result sort.
The reliable confirmation is the visible result-area state after the popup selection.

## Preferred stable workflow
For multi-result Xinhua tasks, prefer this order:
1. open 新华网首页 and verify `站内搜索`
2. enter or directly open the official search page
3. search the keyword on-site
4. try to set the requested sort mode such as `按相关度排序`
5. for current UI, open the sort dropdown from the **result area** and choose the popup option such as `按相关度排序`
6. if the sort control is unstable, say so clearly and continue with verified official results that are visibly on-topic
7. capture the real article URLs from the result page first
8. open the chosen official article pages one by one
9. summarize only after the article pages were actually opened

Do not claim `按相关度` succeeded unless the page visibly shows the changed sort state.
If the sort control fails but the official result list is visible, continue with the best verified official items and state the limitation explicitly.

## Interpretation rules
- Time sort often returns recent full-text hits, not necessarily the most on-topic titles.
- Relevance sort is usually better for topic-centered research.
- For policy-like keywords, prefer clearly official Xinhua pages that are centered on the topic, not mention-only hits.

## Output format for multi-article Xinhua tasks
Default to this compact Markdown structure unless the user asks for another format:

```md
# 问题
**<keyword>**
- 平台：新华网
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 筛选：**<actual filters used>**
- 说明：<sort/filter limitations if any>

# 回答 1
- **标题 / 链接**：<title + url>
- **一句话总结**：<one-sentence takeaway>
- **主要内容**：<2-4 short sentences>
- **特点**：<angle / style>

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
For each selected article:
- title
- timestamp
- URL
- concise verified summary

For multi-result tasks, end with:
- compact per-result summaries
- links
- common points and differences
- a short reading suggestion

If article pages are inconvenient to read in browser snapshot, use a lightweight page fetch as a page-summary helper, but do not misrepresent it as the search workflow itself.
