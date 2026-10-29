# Taobao

Use when the target platform is Taobao.

## Goal
Run a real Taobao shopping-research workflow:
- start from Taobao search results
- summarize the results page first
- classify visible options by price and style/function
- open 3-5 representative item pages from the results page
- inspect parameter / detail / review sections when visible
- return links plus buyer-oriented pros/cons

## Core rules
- Always start from Taobao search results whenever possible.
- Do not chain from one detail page into another item.
- For each sample item, return to the original search-results context before opening the next one.
- Prefer opening items in a new tab/page/window if the automation path supports it.
- If new-tab control is unstable, opening the chosen item URL directly is allowed only after it has been selected from the results page.

## Search nuance
Normal search submission can be flaky.
If the homepage does not transition reliably, direct search URLs are a valid browser-first fallback.

## What to do on the results page first
Extract:
- suggested chips / subtypes
- sorting controls
- visible prices
- payment counts
- store trust signals
- style/function buckets

## What to do on each detail page
Scroll down until a mid-page detail block becomes visible when possible.
Look for:
- `用户评价`
- `参数信息`
- `图文详情`

Extract:
- item title
- link
- store
- price
- payment volume
- visible parameters and material / fit / style clues
- review tags and high-information review points when visible

## Return
For each item:
- title
- link
- price
- visible parameter/style signals
- review insights or a transparent note that review access was partial
- pros / cons
- suitable buyer type
