# People.cn

Use when the target platform is People.cn.

## Goal
Run a real 人民网 site-search workflow:
- open 人民网 homepage
- enter the search page
- search a keyword
- enable `精确匹配` when useful
- collect page 1 or later-page results
- open result pages and verify the real content

## Core rules
- Do not summarize from titles alone.
- People search often returns mention-only articles that only reference the keyword in body text.
- Verify whether the article is truly about the keyword.

## High-value controls
- `精确匹配` is often the best narrowing control.
- `下一页` should be used for deeper result collection when needed.

## Classification rule for articles
Mark results as one of:
- 强相关
- 正文提及但非主题
- 重复分发 / 近重复结果

## Return
For each selected result:
- title
- timestamp
- source if visible
- article URL
- type judgement
- concise verified summary
