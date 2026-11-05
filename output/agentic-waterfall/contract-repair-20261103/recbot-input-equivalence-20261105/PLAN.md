# RecBot 无 AIA：有效输入对齐与最小续跑

最终状态：617/617合法提交、0无效/未解决。Hit@10=69/617=11.183144%，NDCG@10=0.05418050065；Hit@20=130/617=21.069692%，NDCG@20=0.07850971782。预测先冻结，既有scorer与独立复算一致；613题实际cache分数与最终排序再次逐题核对通过，4题无正历史按原逻辑跳过。见 `acceptance.json`、`metrics.json`。

实际新Parser API为0，617个旧Parser逐题复用；617个新Planner成功收据均为1017。首轮5个运输deadline失败经严格核验及完整归档后只续接其Planner，612个已成功原生结果字节不变；没有方法失败重抽。另有37次HTTP429与10次未发送账本attempt，已逐ID核对；provider返回总tokens为5,301,966，未返回账单金额，未估算价格。见 `accounting.json`、`recovery-verification.json`。主表、原方法源码和原701失败档案均未改。

本目录只处理本轮明确授权的 `semantic-only-no-trained-AIA` 变体。原方法、Parser/Planner 提示词、`long_view===1` 历史选择、BGE 模型与原 `max_length=512` 推理逻辑保持不变。当前公共输入来自 `kuairand-window512-20261103/assignment.json`，使用完整公开文本和最近 512 条原始历史事件。不能直接调用 frozen/v6 的 RecBot unavailable 分支，也不使用其新的 BGE query token 策略。

`audit.jsonl` 逐题绑定原评分实际选中的 native result/input/request/response 与当前输入，记录每个阶段的新旧有效请求哈希和差异；`sourcehashes.json` 记录源文件字节哈希。评分投影中的 candidate ID 或原始整行 SHA 均不决定是否复用。审计不解析 evaluator target、不运行评分、不发送模型请求、不加载 embedding 模型。

617 题全部候选 ID 和顺序不变，但候选全文均有变化，整题旧结果可复用 0；617 个 Parser 请求完全一致，逐题复用其原始成功收据。617 个 Planner 请求均改变，需新请求；其中 6 题 `has_positive_history` 从 false 变为 true。没有仅 embedding 改变、两个 LLM 请求均可复用的实际题。613 题在新 Planner 通过原校验后需要本地 embedding；另 4 题新旧均无正历史且偏好为空，原逻辑跳过 embedding。

历史收据中 611 题的原模型名为 `DeepSeek-V4.1-Flash-1017`，另 6 题明确记为早期 `DeepSeek-V4.1-Flash`。根任务确认用户此前已接受二者为相同模型别名；没有服务端独立权重存证。原 Parser 输出均为空四数组，按输入一致复用原前缀，原收据与历史模型名保留。新 Planner 一律经当前 1017 wrapper 核验。

原 `kuairand:701:test:random` 的 100/101 Planner 输出仍保存在原目录，原 `filter without hard constraints` 失败不会被覆盖或改成成功。本轮其候选全文同样改变，因此允许为新输入生成一次 Planner；这是输入对齐。新响应若再次违反方法约束，仍立即记为方法失败，不补抽成功。

准备与离线核验：

```sh
node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/audit.mjs
node --test output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/test.mjs
node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/run-case.mjs kuairand:2:test:random --check
```

后续单题执行入口如下。本轮只准备和离线核验，尚未执行此命令；根任务复核后再发实际执行任务。脚本只创建本目录下该题的新 `execution/`，遇到已有目录会拒绝重抽。最小执行上界为 617 个新 Planner 阶段请求与最多 613 次本地语义打分，服务层重试数量由现有 transport 决定。

```sh
/usr/bin/sandbox-exec -f output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/labels-denied.sb node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/run-case.mjs kuairand:2:test:random --execute
```

实际执行时脚本动态安装现有 `transport-retry/register.mjs`，经 frozen client 使用共享 SQLite 账本、现有三 key 调度与 RPM 门控。校验并遵守每 key 并发上限 10/16/10、每 key RPM 50，不提高限制或 90 秒锁等待。原成功 Parser 响应作为明确的逐题复用收据保存，不产生新 API 账单。模型调用失败后保留请求和错误；不在本脚本加入模型逻辑重试、全量控制器、训练或主表写入。

本地 embedding 使用原 Python 虚拟环境、原 semantic/retrieval 源码和同一 BGE-M3 权重路径，通过原 gpu_lock 串行化本地模型负载。审计流式核验了权重 SHA-256 与缓存 revision；实际单题执行检查已核验权重的大小和 mtime，避免每题重复读取 2.27 GB 权重以计算哈希。若文件被替换、资源检查失败或脚本/数据漂移，应先重新审计，不能绕过。

初始输入审计没有加载 BGE。随后根任务明确授权本地校准和613题预计算，并在ledger修复完成后授权小批、冻结评分与剩余Planner执行；各阶段已完成。

## 已核验的常驻本地服务

`resident-bge.py` 在独立进程中只缓存原 tokenizer/model 两个 loader 的返回实例，直接调用原 `semantic.score` 与原 `retrieval.embeddings` 函数。原 batch8、逐题 texts 顺序、padding、truncation512、float32/MPS、normalized CLS 和 numpy 点积逐行保留，不跨题拼批，不缓存向量，不改原 methods 文件。

`local-calibration/calibration.json` 记录了真实 Apple M5 Pro / 24 GB / MPS 校准：6题中1题为空历史，另5题每候选 semantic/negative 分数全部 `np.array_equal`，排序全部一致。原5个单题进程耗时28.45秒；常驻推理12.53秒，含首次加载14.31秒。基准与常驻原始分数、源码及权重指纹均保留。

经额外授权，`precompute-embeddings.mjs` 已在 labels-denied sandbox 中以单GPU服务完成613题的完整有效embedding payload。5题严格校准分数直接复用；4题无正历史不算。逐题结果按完整payload SHA原子落盘到 `embedding-precompute/scores/`，记录模型/实现指纹和数值哈希；这里只是确定性本地打分，不是方法预测。实际耗时1519.272秒，状态见 `embedding-precompute/progress.json`。

## 已准备的API与评分入口

`controller.mjs` 的36个slot只覆盖新Planner模型调用，回执返回即释放；原Planner校验、等待本地cache和排行都在slot之外。API与单GPU各自运行，API不等待613题全部算完。原校验通过后才按完全相同payload SHA读取cache；Planner失败的cache不进入方法结果。

小批先执行6题并冻结，再用既有KuaiRand scorer和独立复算校验。通过后full复用这6题，仅发其余611个新Planner。原生方法失败保持零分与分母；运输、账本、设备失败保留为未解决，禁止进入评分freeze。重复执行不会重抽已有方法失败。

执行前已运行 `amend-transport.mjs --write`，只为授权的 `transport-retry/model-client.mjs` 与 `ledger-store.mjs` 更新运输引用并追加前后SHA证据。原617题审计和模型权重没有重跑。下列执行顺序已完成并保留以供审计；已冻结结果会阻止重复执行：

```sh
node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/amend-transport.mjs --write
node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/controller.mjs --check pilot
/usr/bin/sandbox-exec -f output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/labels-denied.sb node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/controller.mjs --execute pilot
python3 output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/score-after-freeze.py pilot
/usr/bin/sandbox-exec -f output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/labels-denied.sb node output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/controller.mjs --execute full
python3 output/agentic-waterfall/contract-repair-20261103/recbot-input-equivalence-20261105/score-after-freeze.py full
```

pilot/full分别写不可覆盖的预测freeze及SHA。scorer仅在完整freeze验证后读取evaluator target；逐题与aggregate指标须和独立复算一致，结果写 `pilot-metrics.json` / `metrics.json`。Full仍保持617分母。全程不改既有主表。
