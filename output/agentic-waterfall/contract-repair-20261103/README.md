# 已验收实验源码审计快照 · 2026-11-05

这里归档本批实际使用的源码、测试、提示词模板与协议说明。复制文件保持原字节与相对层级；[SOURCE-SHA256.json](SOURCE-SHA256.json) 给出每个文件相对于本目录的路径、原工作区路径、大小和 SHA-256。它是源码审计快照，不是已上传的数据集，也不保证克隆后可以自动重跑全量实验。

归档包括共享 SQLite/WAL 运输与限流、AgentRecBench 两项固定候选对照与续跑、MARS AgentRecBench 及获准的五题分类纠正、RecBot 当前输入对齐/缓存/验收/计分、fixed 输入一致性审计与复算，以及对应监控检查。没有改写模型、提示词、方法、预算或原有成功结果。MARS 五题修订保留原 extract，只增加每题一次 category 选择并完成此前未执行的两个原生阶段；原协议与此次事后修订应分别解释。

数据、原始任务和评论、真实模型请求/回执、预测/评分产物、账本、运行日志、运行配置、凭证、权重、向量索引、真实校准/cache 以及离线模拟运行产物均不上传。`prompts.json` 是方法自身的提示词源码。另按明确白名单保留 MARS 三个域及 `preflight/mars-domain.json` 的六维度算法配置，它们只含域名、物品类别和六个维度，不含生成用的十条描述或任何回执。ClawRec 的两个原生 skill 提示词及其 LICENSE 同时保留。测试内的 `fixture`、合成候选和临时配置字符串是内联合成测试内容，不是实际凭证或实验数据。

## 绑定与带外依赖

- 保留了原始绝对路径、模块 URL、SHA 校验和冻结产物路径。它们对原本地侧载材料仍有效；不能通过修改这些绑定来绕过验收或自动获得新运行授权。
- `frozen/approved-recbot-semantic-source-20261105/` 单独保存本批实际使用的无 AIA 语义源码与本地 GPU 锁。它不会覆盖仓库 `methods/` 中完整方法的可用性入口。RecBot 的 Parser/Planner 和原 512-token BGE 路径均按原版本保留，AIA 缺失不阻塞用户批准的语义变体。
- `frozen/fixed-native-source-20261105/` 保存 fixed 实际旧原生调用链的源码；原运行仍绑定本地冻结目录、资源策略/探针、模型、索引及输入。公共检索的词法 admission 补丁没有被移植进该固定 RRF 方法。
- AR 官方评测器、原始数据遮蔽工具、真实 assignment 与验收产物，RecBot 的原始请求/逐题审计和本地校准文件，以及 GPU Python 环境和模型权重均需带外提供。训练和付费执行不属于本快照的验证。
- `transport-retry/model-response.mjs` 是既有 frozen parser 的同字节副本，便于直接解析该源码；运行时 register 仍保留原 frozen 模块 URL 和共享账本绑定。

## 离线验证

具体命令、通过数、未运行测试和缺失依赖见 [SNAPSHOT-VERIFICATION.json](SNAPSHOT-VERIFICATION.json)。已完成 61 项独立合成单元测试和 7 组 monitor 自检；所有已运行测试命令均加操作系统网络拒绝规则，仅使用内联合成对象或临时测试文件，未调用模型 API、未加载权重或启动 GPU 推理。71 份 MJS 与 38 份 Python 源码另通过语法解析。最初的宽泛筛选仍选中了两个需要带外文件的测试；其缺文件结果如实记录，随后用明确的纯合成测试选择完成验证，没有为凑通过而复制或虚构侧载材料。

可直接执行的关键 Node 测试包括 `mars-agentrecbench-20261105/adapter.test.mjs`（5 项）、`category-format-repair-20261105/category.test.mjs`（3 项），以及运输/限流/账本测试。SQLite 需支持 `node:sqlite`，模块 hook 需支持 `registerHooks`。运输测试在临时目录创建模拟配置与账本、替换 HTTP，48 进程测试的历史记录全部合成。

有些原测试刻意读取真实回执或校准文件：`recbot-input-equivalence-20261105/test.mjs`、controller 的校准 cache 检查、运输的两项原生回执重放测试、register 的原 plan SHA 检查，以及部分 AR/fixed 真实续跑测试。这些源文件完整保留，但禁止为运行它们复制真实材料、伪造验收数据或修改测试逻辑；验证记录明确列出未运行部分。

同题、公开输入和分母可在各自冻结协议下比较；不据此宣称严格等调用/等成本、相同有效历史窗口或完整原论文复现。本批的详细结果与验收原件保留在原本地实验档案，发布结果表由主任务另行核验。
