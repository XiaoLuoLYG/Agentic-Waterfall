# Waterfall Anything

可嵌入 Hive 的内容发现模块。

| 分支 | 用途 |
| --- | --- |
| `rust`（默认） | 后续 Rust 重写。本分支目前只有设计和来源说明，没有 Rust 实现。 |
| `hos` | 当前 ETS/ArkTS 模块、来源适配器、UI 与测试。 |
| `release` | 使用同一份模块的独立 HarmonyOS App。 |

来源：DigitalMate `release_20260818`，提交 `f70603d0db5939a3a68d23176686c18d1ecb31f3`；应用骨架参考 HyperAgent `56ae4eb56414955dd3c3065e4788cc4dcb357708`。

首版采用编译时插拔。模块拥有推荐、搜索、偏好、库存和内容展示，宿主提供应用上下文、模型与来源配置。Rust 重写完成后再验证与 ETS 的行为一致性，当前没有完成该替换。

私有仓库，尚未授予开源许可。不要提交凭据、签名文件或用户数据。
