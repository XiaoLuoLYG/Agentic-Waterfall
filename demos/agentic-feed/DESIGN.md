# Waterfall personal feed

The primary surface is **Read**: a person opens their own feed, finds something worth reading or watching, and gives a small amount of feedback. Account setup, preferences and memory are **Operate** surfaces. The user explicitly prioritized personal use; the previous research-first layout is replaced without changing the underlying record semantics.

## Product direction

The entry path is login → choose interests (optional) → open the personal feed. Registration only asks for a local username, password and display name. Returning users resume the account's current session. No feed requests or exposure recording happen before authentication. Credentials never enter localStorage.

The first useful actions are visible together: open an article, like or dismiss it, and type a direction for the next recommendation. `更新推荐` has a visible loading state and shows actual server progress labels. Cards use real titles, summaries and image URLs; a missing image produces a text card. Video cards link to the original source and do not pretend to provide an embedded player.

Personal navigation has three destinations: 发现, 为你记住, 偏好设置. 推荐对比 and 记录与轨迹 are inside a secondary 研究工具 disclosure. The main feed does not expose policy IDs, JSON, storage versions or experiment controls. Those remain available in the research view.

## Visual authority

The palette and calm card hierarchy inherit the existing 璇玑 shallow-purple surface, inspected in `HyperAgent/docs/design/xuanji-20261018/validation/spaces-purple-final.jpeg` and its native `theme/DesignTokens.ets`. This web app uses readable solid surfaces; it does not imitate native glass wallpaper or invent a new decorative asset system.

- Canvas `#f5f4f8`, sidebar `#eeedf5`, content `#ffffff`, main text `#272532`.
- Accent `#6650bc`, selected surface `#eae4f8`, secondary text `#6d687b`.
- Dark mode: canvas `#1c1b22`, content `#27252f`, accent `#b7a1ec`; optional system preference.
- System Chinese sans throughout. Fixed type scale: 30 px page headings, 19–21 px content titles, 13–14 px content/form text, 11–12 px metadata.
- One consistent authored 24 px stroke icon family. Only the Waterfall wordmark has a simple geometric mark.
- Cards: 14 px corner radius and a single 1 px edge. Shadows are reserved for floating notices and the mobile research menu.
- Two-column reading cards on desktop, one column on phones; optional list layout. Left navigation becomes a four-item bottom bar on phones. Secondary personal rail disappears below 1180 px, with its information still available in the personal pages.
- Only purposeful motion: active state changes, small media hover and the request activity dot. Reduced motion disables animation.

## Personal settings

The interface edits only the server-owned settings contract: `interests`, `sources`, `contentTypes`, `layout`, `theme`, `density`, `language`, and optional `displayName`. Custom interests allow up to eight, each at most 40 characters. Empty source settings mean all configured sources; a manual selection must retain at least one available source. Unconfigured sources are disabled. Health is described from real source status: available, partially available, temporarily unavailable, or checked when used. Image-only controls appear only when a configured source actually supports that modality.

The memory page uses plain questions for profile, durable memory and current context. Agent-derived entries are separately visible and can be cleared while preserving historical events. Distribution charts are computed from actual slate sources and recorded like counts, not invented metrics.

## Record semantics

Every article retains its original session, track, reference, content ID and position. Visible exposure begins only for an authenticated account, at least 50% intersection, active page and focused window. End records await their associated saved starts. Logout waits for pending exposure writes; a late recommendation cannot render into a different login. Blinded alternatives have no like/comment controls, and their evaluation labels stay on the blind track.

## Validation scope

The Impeccable context script was run once for the target; onboard, operate, new-work and craft-floor guidance informed this scoped redesign. The explicit user brief and existing native visual evidence settle the direction, so no new concept tournament or raster artwork is needed. The root agent owns one batched desktop/mobile interaction and screenshot pass, followed by at most one confirmation pass after concrete fixes.

## 2026-10-27 已确认的新方向

以上原记录描述的是上一版；新方向以 `PRODUCT.md` 和本次用户确认的需求为准。入口改为用户名与人或 Agent 类型，后接可选的人类画像或必填的 Agent 画像。人的首页是双列连续信息流，文字输入固定在底部；Agent 账号使用可开始、暂停的操作记录。内容来源入口和画像入口保留，评测与轨迹可视化不在本次界面。保留已有浅紫色作为原版视觉参考，并以内容可读性和轻量交互为首要目标。

## 2026-10-28 重做的桌面界面

此版以真实内容为中心，采用白色和冷灰底色、蓝色操作强调、双列错落卡片、单一固定输入框与简短侧栏。画像只有一个编辑区域；来源、画像、账号切换和数据导出是唯一常用入口。已看到的内容保留，尚未看到的内容可随交互重新排序。B 站和其他来源继续跳转原网站，不把返回时间当成真实观看时长。
