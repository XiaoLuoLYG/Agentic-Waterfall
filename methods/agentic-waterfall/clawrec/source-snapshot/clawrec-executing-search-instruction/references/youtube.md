# YouTube

Use when the target platform is YouTube.

## Goal
Run a real YouTube workflow:
- search a query
- use visible filters
- skip ads and promoted results
- open representative videos
- read title, channel, views, date, description
- scroll until comments are truly visible
- summarize both the video and the comment-section viewpoint

## Critical rules
- If login blocks normal browsing, wait for the user.
- Do not summarize the video from the title alone.
- Do not treat sponsored results as organic results.
- Do not claim comment extraction succeeded unless actual comment text is visible.

## Typical filter dimensions
- 类型：影片 / Shorts / 頻道 / 播放清單
- 上传时间：今天 / 本周 / 本月 / 今年
- 时长：4分钟以下 / 4-20分钟 / 20分钟以上
- 排序：按用户要求或当前可见最佳匹配

## Detail-page requirements
On the video page, collect:
- title
- channel
- URL
- view count
- publish date / age
- likes if visible
- description

If description is collapsed, expand `更多` / `Show more` when visible.

Practical verified pattern from real runs:
- open the target watch URL directly
- use a very short wait or immediate `snapshot`
- this can surface the top video area before the page drops into lower recommendations
- once the top area is visible, capture title/channel/likes/views first
- then click the visible `...更多` / `更多` control under the video metadata block to expand description
- only after description capture should you page down in batches to the comments area
- if you page down too early, the page may fall into recommendation flow and make the top area harder to recover

If the page already fell into recommendation flow before top metadata was captured:
- reopen the same watch URL
- use immediate `snapshot`
- capture title / channel / description entry first
- do not rely on `Home` alone to recover the top area

## Comment loading rule
A verified YouTube path may require many page-down presses.
Keep scrolling in batches until the page visibly shows:
- comment count
- sorting controls
- actual comment author names and comment text

Useful signals:
- `留言`
- `最熱門留言`
- `最新`
- visible comment text

## Comment extraction priority
- top visible high-heat comments
- comments with actual opinions or takeaways
- de-prioritize meme-only comments unless they reflect dominant sentiment
- if comments are dominated by a recent event, fandom wave, movie tie-in, or meme context, say so clearly instead of treating the thread as a timeless baseline sentiment

## Return
Use the concise fixed YouTube output style below.

### 检索条件
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 类型：<type if applied>
- 上传时间：<time filter if applied>
- 时长：<duration filter if applied>
- 选择规则：<top result / strongest official match / highest visible views>

### 视频信息
- 标题：<title>
- 频道：<channel>
- 链接：<url>
- 基础数据：<views / date / likes if visible>
- 视频内容大意：<2-4 sentence summary based on actual page description>

### 高热评论
- <comment or theme 1>
- <comment or theme 2>
- <comment or theme 3>

### 评论区整体观点
- <1-3 sentence synthesis>

### 简要结论
- <why this video was chosen and what the comments are mainly saying>
