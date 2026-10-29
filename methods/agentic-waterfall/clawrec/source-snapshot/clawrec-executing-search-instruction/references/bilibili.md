# Bilibili

Use when the target platform is Bilibili.

## Goal
Run a real Bilibili video workflow:
- open Bilibili
- wait for login if first access requires it
- search the keyword
- use `更多筛选` and visible filters when relevant
- open representative videos
- read actual descriptions and metadata
- scroll until comments load
- summarize both the video and comment-section viewpoint

## Critical rules
- Do not continue through a blocked login gate.
- Do not summarize from titles alone.
- Do not claim comment extraction succeeded unless actual comment text is visible.
- Skip ads and non-target promotional results.

## High-value filters
Common adjustable dimensions include:
- 排序：综合排序 / 最多播放 / 最新发布 / 最多弹幕 / 最多收藏
- 日期范围：最近一天 / 最近一周 / 最近半年
- 时长范围：10分钟以下 / 10-30分钟 / 30-60分钟 / 60分钟以上

Treat these as user-adjustable rather than hardcoded defaults.

## Detail-page requirements
Collect:
- title
- uploader
- publish time
- play count
- danmaku count
- likes if visible
- description

## Comment extraction priority
Once comments are visible, collect:
- pinned comment if present (`置顶`)
- several useful hot comments under `最热`
- high-information replies when they materially change interpretation

For current verified Bilibili behavior:
- you must first scroll down to the actual `评论` section; reaching the video page is not enough
- after the comment area first appears, wait a bit longer and refresh the snapshot again
- the first visible comment block may still only show `正在玩命加载…`
- current verified wait rule: after comments are visible but still loading, wait **at least 15 seconds** before the next snapshot attempt
- only extract `置顶评论` or useful comments after real comment text becomes visible
- if comments are still loading after waiting, say so explicitly instead of inventing comment content

## When filters are unstable
- Do not claim the filter succeeded unless the filter state is visible or the result set clearly reflects a confirmed applied state.
- If the filter UI is not stably capturable, continue with a clearly labeled fallback selection from visible natural results.
- In the final answer, distinguish between:
  - confirmed filters
  - visible-but-unconfirmed matching results

## Non-standard result pages
- If the selected result is a collection, playlist-like page, multi-part page, or other non-standard video detail page, do not treat it like a normal single-video page by default.
- If comment loading or page structure is unstable on that page type, switch to a more standard single-video result when possible.
- If you keep the non-standard result, label the limitation clearly instead of fabricating a normal single-video interpretation.

## Return
Use the concise platform output style below.

### 搜索条件
- 平台：B站
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <why supplemental queries were used>
- 扩展边界：<query expansion boundary>
- 已使用筛选：<filters actually applied>
- 说明：<login / filter / limitation notes if any>

### 视频 1
- 标题：<title>
- 链接：<real video URL>
- UP主：<uploader>
- 发布时间：<publish time if visible>
- 基础数据：<播放 / 弹幕 / 点赞 / 评论等可见数据>
- 内容概述：<2-4 sentences based on actual page content>
- 评论状态：<actual comment loading state>
- 有信息量评论：
  - <置顶评论 if visible>
  - <高赞/高信息量评论 1>
  - <高赞/高信息量评论 2>

### 视频 2
- same fields

### 视频 3
- same fields

### 对比总结
- 共同点：<common themes>
- 差异点：<how they differ>
- 推荐顺序：
  1. <best first pick and why>
  2. <second pick and why>
  3. <third pick and why>
