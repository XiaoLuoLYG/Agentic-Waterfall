# xuanji 来源接入与连通记录

2026-10-27。只读核对 xuanji 工作树（HEAD `6a327fb`），demo 实现为 `sources.mjs`。以下是公开查询的来源连通检查，不是推荐质量评测；没有改写原产品或配置，没有将密钥写入 demo 文件或前端。

## 配置与实际来源

统一配置：`/Users/luoyige/Documents/ChatGPT/waterfall/HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json`。

- 启用限制来自 `runtime.waterfall.sources.<id>.allowed`；本次 12 个原生来源均为 allowed。
- 凭据读取 `providers` 和 `composio`；本报告只记字段名和请求映射，不记录任何值。
- `runtime.waterfall.rssFeeds` 本次为空。`cnnews` 自带四个公开 RSS，与用户新增 RSS 配置不同。
- 来源注册表没有 `xiaohongshu`、`toutiao`、`gnews`；没有把小红书/头条搜索链接冒充接口。`globalnews` 真实实现是 Guardian + NewsAPI。
- `douban` 留有部分客户端路径，但未进入当前工厂与来源注册表，相关 MCP 地址也为空，本次不对外宣称可用。

实际模式以 `ToolGatewayClient.ets::configuredWaterfallSourceAdapters` 为准。`AggregateSearchSourceRegistry.ets` 的宽泛 search/interest 标记不能替代具体工厂能力。所有相对源码路径均从上述工作树开始：

- `entry/src/main/hive/waterfall/core/aiphone/runtime/WaterfallSourceAdapter.ets`
- `entry/src/main/hive/waterfall/core/aiphone/runtime/WaterfallAggregateSourceAdapter.ets`
- `entry/src/main/hive/waterfall/core/aiphone/runtime/AggregateSearchSourceRegistry.ets`
- `entry/src/main/hive/waterfall/core/aiphone/runtime/ToolGatewayClient.ets`
- `entry/src/main/hive/waterfall/core/aiphone/runtime/AggregateSearchClient.ets`
- `entry/src/main/hive/waterfall/core/aiphone/runtime/{YouTubeApiClient,BilibiliApiClient,ApplePodcastClient,TwitchSearchClient,GitHubPublicClient,SteamNewsClient,PublicFeedClient,GlobalNewsClient,ComposioDynamicBackend}.ets`
- `entry/src/main/hive/waterfall/core/composio/ComposioSessionClient.ets`
- `scripts/local-config.cjs`

## 本次实际检查

“成功”表示真实接口返回可归一化的内容与链接，不表示内容质量、封面加载、视频播放或长期稳定性已经验证。search 使用公开中性词：Bilibili `自然`、知乎 `科技`、GitHub `javascript`、其他 `nature`；explore 使用原生热门/最新/发现路径，不需要搜索词。

| Source ID | Search | Explore | 返回的原生内容形态 | 请求映射 |
|---|---|---|---|---|
| `youtube` | 成功，6 条 | **失败，provider HTTP 403** | video，标题/简介/封面/频道/日期 | Composio `YOUTUBE_SEARCH_YOU_TUBE` / `YOUTUBE_LIST_MOST_POPULAR_VIDEOS`，使用 ACTIVE YouTube 连接账户。当前实际适配器没有用旧 `YOUTUBE_API_KEY` 执行搜索。 |
| `bilibili` | 成功，6 条 | 不支持 | video，标题/简介/封面/作者/时长 | `api.bilibili.com/x/web-interface/search/all/v2?keyword=...&page=1`，沿用原客户端公开请求头。 |
| `x` | **失败，provider HTTP 402** | 不支持 | text | Composio `TWITTER_RECENT_SEARCH`；账户连接存在，但实际提供方返回 API credits depleted。配置/连接存在不能算可用。 |
| `hackernews` | 成功，6 条 | 不支持 | text | demo 保留 `hn.algolia.com/api/v1/search`，与 xuanji 的 `HACKERNEWS_SEARCH_POSTS` Composio传输不同，明确作为公开上游适配。 |
| `reddit` | 成功，6 条 | 不支持 | text，可能附封面 | Composio `REDDIT_SEARCH_ACROSS_SUBREDDITS`，`search_query`、`limit`；兼容完整与相对 permalink。 |
| `zhihu` | 成功，6 条 | 成功，6 条 | text，热榜有封面 | `developer.zhihu.com/api/v1/content/zhihu_search` 的 `Query/Count`；`hot_list` 的 `Limit`；Bearer 与时间戳只在服务端。 |
| `applepodcasts` | 成功，6 条 | 不支持 | text 节目卡与封面 | `itunes.apple.com/search`，media/entity=podcast，CN/US 对应查询语言；当前 demo 不提供节目音频播放。 |
| `twitch` | 成功，6 条 | 成功，4 条 | video 频道/直播卡与封面 | 客户端凭据换 app token；Helix search/channels。发现沿用科技分类直播+一个热门游戏直播。 |
| `github` | 成功，6 条 | 成功，4 条 | text | GitHub public repository search；发现包括近七天仓库以及 `openai/codex`、`microsoft/vscode` 最新 release。 |
| `steam` | 工厂未注册 | 成功，6 条 | text | `ISteamNews/GetNewsForApp/v2`，沿用 730、570、440 三个 app ID。 |
| `cnnews` | 工厂未注册 | 成功，6 条 | text，部分有封面 | 中国新闻网、IT 之家、少数派、爱范儿四个固定公开 RSS，交错合并、去重。 |
| `globalnews` | 成功，6 条 | 成功，6 条 | text，含封面 | Guardian `/search`；NewsAPI `/everything` 或 `/top-headlines`；两路交错，局部失败保留其他结果并带 warnings。 |
| `wikipedia`（额外保留） | 成功，6 条 | 不支持 | text | `zh.wikipedia.org/w/api.php` 的 query/search。不是 xuanji 原生来源。 |

共检查 17 个 xuanji 原生“来源×模式”组合：15 个返回内容，2 个失败；另有 Wikipedia search 成功。原生 12 个来源中，11 个至少一种模式返回内容。YouTube 仅 search 在本次检查中可用，不能把它的 explore 失败扩写成全部 YouTube 失败。

中国资讯的固定地址：

- `https://www.chinanews.com.cn/rss/scroll-news.xml`
- `https://www.ithome.com/rss/`
- `https://sspai.com/feed`
- `https://www.ifanr.com/feed`

## 服务端接口与错误边界

`loadSourceConfig(path?)` 的默认路径优先级：`XUANJI_CONFIG_FILE` → `MODEL_CONFIG_FILE` → 上述 xuanji 统一配置。返回仅供服务器持有的配置对象；原始对象不能进入 `/api/config`、运行日志或模型上下文。

`sourceCatalog(config)` 只返回公开字段：`id/name/modes/modalities/configured/allowed/transport/status`，有检查后还返回 `last_check` 和 `mode_checks`。其中 configured 只是凭据是否存在；启动时 status=unverified。实测结果保存在该配置对象对应的内存中，重启后重新显示未验证，不把本报告日期的成功永久硬编码为在线健康。某源不同模式一成一败时 status=partial。网络错误、超时、408/425/429/5xx 等暂时失败冷却五分钟后，mode_checks 恢复为 unverified，允许下一次实际请求重试；last_check 仍保留原错误与 retry_after，402/403 不自动过期。该机制不会后台轮询来源。

`acquireSource(action, config)` 返回：`source/query/mode/modality/status/items/completed_at`，失败时带脱敏 `error`，组合来源局部失败时带 `warnings`。`items` 具有稳定 ID、内容 hash、真实来源 ID、标题、摘要、主题、实际链接、`origin: live`、text/video 类型以及实际返回的封面、作者、日期、时长。返回上限为六条；单次 action 内的复合源可能进行多个 HTTP 请求。

请求端点是固定白名单，模型只能选择 source ID，不能提供任意 URL、工具名、账户或请求体。HTTPS 请求不自动跟随重定向；响应有 25 秒超时及 4 MiB 体积上限。错误只返回自定义代码或 HTTP 状态，不回传含凭据的原始请求 URL/提供方错误正文。结果链接过滤脚本、私网、本机和凭据 URL，封面统一 HTTPS。来源失败不会生成假内容或退回 seed。

Composio 社交搜索使用原代码固定工具 slug 和参数，但 demo 直接调用已授权账户的 `/tools/execute/<slug>`，省去动态工具发现；只执行上述公开读取操作。Hacker News 是明确披露的公共传输替换。RSS 采用受体积限制的四个既有来源解析，尚未实现用户任意新增 feed、RSS音频解析、分页和后台周期调度。

## 验证与未覆盖项

`node --test demos/agentic-feed/test/sources.test.mjs` 的 15 项测试覆盖：配置不外泄、真实模式、未知来源/非法参数不发请求、跨查询的稳定内容身份、恶意链接、重定向拒绝、错误脱敏、响应体上限、固定 Composio 操作、402 失败、YouTube 按模式保留结果、Bilibili 视频字段、RSS/CDATA/局部失败、empty 与 failed 的区别，以及直接请求、Composio 和复合来源的五分钟故障恢复边界。

尚未检查真实页面内的封面加载、音视频播放、用户长期使用或每个来源的质量；这属于 UI/集成验证。X 的额度与 YouTube 热门接口 403 仍是外部限制，没有充值、改账户或绕过权限。原 xuanji 工作树和配置未修改。

Bilibili 搜索按会话与关键词轮换请求第 1–50 页；请求页码和去重数量保留在结果中。已展示内容在截取六条之前过滤，原始规范化结果也会保留在 `raw_items` 中，供轨迹回溯。游标目前保存在服务进程内，重启后重新从第一页开始。
