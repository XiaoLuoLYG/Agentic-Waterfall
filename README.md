# Waterfall Anything

独立的 Waterfall 内容发现模块，目标是作为 HyperAgent Hive 中可在编译时接入或移除的能力。

| 分支 | 内容 |
| --- | --- |
| **rust（默认）** | 项目约定与未来 Rust 替换范围，本次未实现 Rust 代码 |
| [hos](https://github.com/XiaoLuoLYG/waterfall-anything/tree/hos) | 从 DigitalMate 抽取的 ETS / ArkTS 模块及回归测试 |
| [release](https://github.com/XiaoLuoLYG/waterfall-anything/tree/release) | 只承载 Waterfall 的最小 HarmonyOS 应用 |

HarmonyOS 版本保留推荐、关键词搜索、多来源与 RSS、P/S/E 调度、偏好反馈、收藏、阅读与媒体、评论、分享、语音和阅读 AI。宿主不再依赖 DM 的账号、主聊天、分身或其他业务。

模块入口为 `WaterfallView` 与 `WaterfallHostConfig`。宿主提供模型/来源配置、独立存储范围和可选记忆投影；模块负责内容状态与平台界面。首版只支持编译时插拔，不含远程插件安装。接入、后台落盘和退出约定见 [接口约定](docs/hive-contract.md)。

来源：DigitalMate `release_20260818` 的 `f70603d0db5939a3a68d23176686c18d1ecb31f3`，宿主脚手架参考 HyperAgent `56ae4eb56414955dd3c3065e4788cc4dcb357708`。两个来源均为私有仓库，本仓库保持私有，未新设开源许可证。

已通过 347 项主机 Hypium 兼容测试、239 项 Node 回归、HarmonyOS 完整应用构建，以及拔出模块后的宿主构建。测试边界见 [hos 验证记录](https://github.com/XiaoLuoLYG/waterfall-anything/blob/hos/docs/validation.md)。真机签名/安装的当前状态单独记录在 [release 真机记录](https://github.com/XiaoLuoLYG/waterfall-anything/blob/release/docs/device-validation.md)。

Rust 后续替换内容处理、来源调度和排序核心，保持现有宿主契约与用户行为。平台 UI、语音与分享仍由 HarmonyOS 层承担；本分支目前不含运行库、FFI 或占位算法。
