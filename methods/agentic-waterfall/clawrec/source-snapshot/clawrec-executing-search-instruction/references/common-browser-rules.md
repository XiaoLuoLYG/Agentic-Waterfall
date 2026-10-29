# Common Browser Rules

Read this file when executing any `executing-search-instruction` workflow that depends on real browser interaction.

## Contents
- Browser runtime
- Browser truth first
- Query expansion and search-condition disclosure
- Login / verification gates
- Result page vs detail page
- Real detail links
- Re-snapshot and tabs
- Multi-result tasks
- Comments / reviews
- UGC evidence boundaries
- Fallback rules
- Failure reporting
- Final self-check

## 0. Browser runtime

Use only a visible user browser session for ClawRec search execution. Never use a headless browser.

For orchestrated runs, follow the `browser_access` instruction selected by `clawrec-orchestrating-search-execution`. For direct ad hoc use, resolve browser access from OpenClaw config `browser.defaultProfile` and require a visible user browser attachment. If only headless execution is available, stop and report: `visible user browser session required but unavailable; headless browser is forbidden`.

## 1. Browser truth first

Never say a workflow step succeeded unless it visibly succeeded in the browser.
Examples:
- do not claim a filter was applied unless the page visibly changed or the filter state is visible
- do not claim a detail page was read unless it was actually opened
- do not claim comments were extracted unless actual comment text is visible

Do not silently downgrade to external web search and present it as on-site browsing. For a registered extended platform, a visible search engine with `site:<registered scope>` is allowed only when the loaded platform reference explicitly defines that workflow; snippets remain candidate discovery only, and summaries must come from opened target-site detail pages.

## 2. Query expansion and search-condition disclosure

Start with the provided query. Use at most two supplemental queries, and only under the bounded query expansion rules in `SKILL.md`.

Every final output must disclose search conditions with these fields. If a platform reference uses a shorter `关键词` field, expand it to this structure:

```markdown
- 原始关键词：<provided query>
- 补充关键词：无 | <numbered supplemental queries>
- 扩展原因：无 | <reason>
- 扩展边界：仅使用原始关键词 | <boundary statement>
- 已使用筛选：<filters actually applied>
```

Do not continue searching from new keywords discovered in opened results. Do not use supplemental queries to change the task direction.

## 3. Login / verification gates

If a platform shows:
- QR login
- slider / captcha
- risk-control gate
- blocking login popup

Then:
- stop
- ask the user to complete it manually
- resume only after the page clearly shows an unblocked logged-in state

## 4. Result page vs detail page

Treat them as separate evidence layers.

Result page is for:
- candidate selection
- visible metrics
- visible filters
- initial classification

Detail page is for:
- actual content summary
- richer metadata
- comments / reviews
- final link capture

Do not mix these two layers in the final answer.

## 5. Real detail links

When possible, return the real detail-page URL, not a wrapper/search-result URL.
If a result-page wrapper is all that could be captured, say so clearly.

## 6. Re-snapshot and tabs

Re-run `snapshot` after:
- page transitions
- filter changes
- opening dropdowns/panels
- tab changes
- major scrolling
- entering detail pages

Do not reuse old refs across changed page states.

Some platforms open in a new tab or page. If this happens:
- use `tabs`
- identify the correct target page
- switch with `focus`
- continue only after confirming the target page is active

## 7. Multi-result tasks

When the user asks for multiple results:
- inspect the requested set first
- then return one consolidated answer
- avoid fragmented one-item-at-a-time output unless the user explicitly asked for incremental updates

## 8. Comments / reviews

The presence of a comments header is not enough.
Only summarize comments or reviews after actual comment/review text becomes visible.
If comments or reviews did not load, say so in the final answer.

## 9. UGC evidence boundaries

For community or user-generated platforms, distinguish:
- visible facts: title, link, author, publish time, engagement counts
- author claims
- comment or audience viewpoints
- worker synthesis across multiple results

Do not present author claims or comments as verified facts. If the platform only shows month and day, output that visible month/day and state that the year was not visible.

## 10. Fallback rules

Fallbacks must keep the task faithful to platform-native browsing. Do not remove evidence boundaries just because a fallback was used.

### Native control fallback

Trigger:
- a native filter, sort, budget, or platform control is visible but unstable, not capturable, or cannot be confirmed after a reasonable attempt

Allowed:
- use on-site keyword terms that encode the intended constraint
- continue from visible natural results
- use the platform's official search page or visible result list

Forbidden:
- claim the original native control succeeded when it did not visibly succeed
- replace the platform workflow with external web search

Final disclosure:
- state the native control that failed or was unconfirmed
- state the substitute action used
- state what remains unverified

### Direct platform URL fallback

Trigger:
- homepage click-through, search submission, tab behavior, or selected-result navigation is unstable

Allowed:
- directly open a known platform search URL
- directly open a verified platform detail URL already selected from visible evidence
- directly open an official platform search page after the platform entry point was verified when the platform reference allows it

Forbidden:
- use an off-site search engine as if it were the platform's own search
- direct-open unrelated results that were not selected from platform evidence
- for extended platforms, accept off-scope pages or search snippets as detail evidence

Final disclosure:
- state that a direct platform URL was used
- identify whether it was a search URL or detail URL
- state any step that was bypassed or not verified

### Wrapper/detail link fallback

Trigger:
- a stable real detail URL cannot be captured, but a wrapper/search-result URL is available

Allowed:
- return the wrapper/search-result URL when no better link is available
- label the link clearly as a wrapper or search-result link

Forbidden:
- present a wrapper/search-result URL as a stable direct detail link
- omit the link limitation when it affects reproducibility

Final disclosure:
- label the link type
- state whether a real detail URL was unavailable

### Page fetch helper fallback

Trigger:
- a platform reference explicitly allows lightweight page fetch as a page-summary helper

Allowed:
- use the helper according to the platform reference

Forbidden:
- present the helper as the browser search workflow itself
- use the helper to invent evidence that was not available from the referenced page

Final disclosure:
- state that a page-summary helper was used when it matters to evidence boundaries
- state what was still verified in the browser workflow

## 11. Failure reporting

When a step fails, state:
- which step failed
- what was still verified
- what was not verified
- whether a fallback path was used

Headless browser startup, headless timeout, or missing visible browser attachment is not a platform block. Report it as browser runtime failure with: `visible user browser session required but unavailable; headless browser is forbidden`.

This is better than guessing or overstating completion.

## 12. Final self-check

Before answering, verify:
- visible user browser session used
- no headless browser used
- original query and supplemental queries disclosed
- supplemental query count is at most two
- search page confirmed
- filter state confirmed or disclosed as unconfirmed
- detail page opened or disclosed as unopened
- comment/review text visible or disclosed as unloaded
- link type labeled as real detail link or wrapper/search-result link
- evidence boundaries and fallback path stated
