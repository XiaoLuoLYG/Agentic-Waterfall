# Hive 接入约定

本约定描述已实现的 ETS 版本，不代表已有 Rust ABI。

## 当前入口

- `WaterfallView`：挂载推荐/搜索与所有卡片交互；接收 `host`、`onExit`、`onSettings`。
- `WaterfallHostConfig`：提供模型设置、来源配置、分享服务地址、`storageScope`、可选记忆偏好投影。
- `LocalModelSettings`：沿用现有 provider、baseUrl、model、apiKey、customParametersJson、ignoreToolSurfaceUpdates 类型。

一个进程只挂载一个实例；来源注册表是进程级状态。配置在挂载前提供，变更后重挂生效。不同用户必须使用不同 storageScope；不要借用 DigitalMate 的存储目录或身份。Worker 在异步落盘后退出，同一scope重挂会等待旧Worker释放。

## 宿主接入

将 hos 的 `hive/waterfall` 原样放到 `entry/src/main/hive/waterfall`，复制其三个图标到 entry 资源，配置两个 Worker 打包入口。所需权限为网络与使用中麦克风。无需原生聊天库或 DM 账号。

宿主通过 `waterfallAppActive` 通知前后台，通过递增 `waterfallBackTick` 处理返回。退出时模块停止内容 Worker、作废迟到内容结果并落盘；宿主任务由宿主独立持有。首版拔出方式为删除组件挂载、模块目录和专用 Worker 入口；已在独立宿主副本中验证可构建。

## 实现替换边界

推荐和关键词搜索必须保持独立来源集合、游标与生命周期；不能因搜索耗尽而变为推荐。保留现有反馈、偏好、P/S/E策略、稳定可见窗口、收藏和库存恢复语义。网络/凭据失败必须真实返回，不得以示例卡片充当结果。

未来 Rust 版本需通过当前核心与宿主集成回归，再选择实际平台桥接方式。本次未定义未经验证的FFI结构或动态插件机制。

## 宿主任务桥接

`WaterfallView` 可接收 `tasksEnabled`、`task`（id/prompt/reply/running/failed）和 `taskProgress`。通过 `onTaskSubmit(text, taskId)` 返回是否接受任务，再由宿主发布新快照；`onOpenTask` 打开宿主对话。覆盖页面时保持挂载，设置 `hostVisible=false` 暂停媒体和语音；宿主不再提供聚合搜索工具或关键词搜索跳转。任务卡复用 DM 原实现。Rust 重写需继续遵守这些宿主所有权边界，本分支仍无 Rust 执行实现。

release 的聊天外壳复用 HyperAgent 原 UI、DM 的上下文轨迹面板及 Swiper 切页；这些属于宿主，不进入可插拔 Waterfall 模块。
