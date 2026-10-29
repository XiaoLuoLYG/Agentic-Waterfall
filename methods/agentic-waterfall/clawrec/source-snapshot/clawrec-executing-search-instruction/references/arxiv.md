# arXiv

Use when the target platform is arXiv.

## Goal
Run a real arXiv paper-search workflow:
- open arXiv search in the browser
- search the keyword
- inspect at least 3 representative result cards
- open abs or html pages for chosen papers
- summarize abstract-level contributions and method differences

## Search pattern
A stable browser search URL is:
- `https://arxiv.org/search/?searchtype=all&query=<关键词>&start=0`

## What to collect from results
- paper title
- arXiv ID
- authors
- category
- abstract preview

## Preferred detail pages
- abs page: `https://arxiv.org/abs/<ID>`
- html page: `https://arxiv.org/html/<ID>v1`

Prefer html when readable, because it is easier to inspect than PDF.

## Return
Use this fixed arXiv output style.

### 搜索条件
- 平台：arXiv
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 已使用筛选：<filters actually applied>
- 说明：<whether HTML pages were opened, and any limitations>

### 论文 1
- 标题：<title>
- 链接：<prefer html page; abs/pdf when useful>
- arXiv：<id>
- 时间：<submission date if visible>
- 问题：
  - <what problem the paper addresses>
- 方法：
  - <core method>
- 创新点：
  - <main novelty>
- 适用场景：
  - <where this method is useful>

### 论文 2
- same fields

### 论文 3
- same fields

### 对比总结
- 共同点：<common themes>
- 差异点：<how they differ>
- 推荐顺序：
  1. <best first pick and why>
  2. <second pick and why>
  3. <third pick and why>
