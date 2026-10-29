# JD.com

Use when the target platform is JD.com.

## Contents
- Goal
- Buying-intent rule
- Filter rule
- Budget fallback
- Results-page requirements
- Detail-page requirements
- Output format for JD buying-support tasks
- Return

## Goal
Run a real JD shopping-research workflow:
- open JD
- search a product keyword
- summarize the results page by price and function
- open 2-5 representative products from the results page
- inspect visible specs, review tags, comments, and Q&A when helpful
- end with a recommendation sheet when the user is clearly trying to buy

## Buying-intent rule
Do not summarize mechanically.
Infer the user’s actual goal first, for example:
- 性价比高
- 通勤
- 学生用
- 高性能
- 音质优先
- 降噪优先
- 苹果生态

Use that goal to decide:
- which subcategories matter
- which products deserve detail-page verification
- what the final recommendation should optimize for

## Filter rule
If the user explicitly asks for a visible filter interaction such as hover on `价格区间`, try it first.
If the widget is unstable, say so clearly.
Do not fake it.

## Budget fallback
If the price-range widget is unstable, keep the workflow browser-first and use budget-constrained on-site search terms such as:
- `蓝牙耳机 500元左右`
- `蓝牙耳机 1000元以内`

State clearly that budget control was done through the on-site search query rather than a precise price widget.

## Results-page requirements
Before opening any detail page, summarize:
- visible category chips
- price bands
- functional tracks
- which products seem representative for the user’s buying goal

## Detail-page requirements
Collect when visible:
- full product title
- link
- store name
- price
- subsidy / ranking / review counts
- concrete specs
- review tags
- high-information user-review points
- `问大家` clues when useful

For JD buying-support tasks, after opening each chosen detail page, default to reading the visible review area (`大家评` / 买家评价) before finalizing the summary.
Do not stop at specs only.
If actual review text is visible, include a short `用户评论概述` section for each product based on:
- repeated praise themes
- repeated complaint / limitation themes if visible
- whether feedback matches the product's claimed positioning

Only summarize user comments when actual review text is visible on the page.
Review tags alone can support the summary, but should not replace visible review text when text is already present.

## Output format for JD buying-support tasks
Default to a compact Markdown structure that stays consistent with the other `Platform Research` platform outputs, while keeping commerce-specific decision fields:

```md
### 搜索条件
- 平台：京东
- 原始关键词：**<provided query>**
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 已使用筛选：**<actual filters used>**
- 说明：<budget control / widget limitations / stock notes if any>

### 结果 1
- 标题：**<title>**
- 链接：<real detail URL>
- 作者 / 来源 / 店铺 / UP主：**<store name>**
- 时间：—
- 互动 / 价格 / 元数据：**<price / review count / rank / major tags>**
- 内容概述：  
  <3-6 sentences based on the opened detail page, visible specs, review tags, user-review points, and useful Q&A clues>
- 用户评论概述：  
  <2-4 sentences summarizing visible user-review text and repeated themes>
- 适合人群：**<who should buy it>**

### 结果 2
- same fields

### 结果 3
- same fields

### 对比总结
- 共同点：  
  <shared strengths / same category / same budget band>
- 差异点：  
  <comfort vs ANC vs sound quality vs ecosystem vs sport vs office>
- 推荐先看：**<best first pick>**  
  <why>

### 2-3 个购买建议
1. **如果你最在意 <goal>**  
   选 **<product>**  
   - 理由：<short buyer-facing reason>
2. **如果你最在意 <goal>**  
   选 **<product>**  
   - 理由：<short buyer-facing reason>
3. **如果你最在意 <goal>**  
   选 **<product>**  
   - 理由：<short buyer-facing reason>
```

## Return
Prefer:
- 3-5 products for broad market research
- 2-3 products for immediate buying-decision support

For immediate buying-decision tasks:
- summarize the results page by category / price band first
- open 2-3 representative detail pages
- read the visible review section on each chosen detail page when possible
- include a short `用户评论概述` block for each product by default
- end with a shortlist recommendation, not just neutral summaries
- avoid recommending suspicious refurb / inventory-machine / unclear third-party goods unless the user explicitly wants that route
