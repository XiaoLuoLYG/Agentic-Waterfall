# 当前执行入口（2026-10-30）

四组公开实验按后续授权运行；MIND暂停。实时进度与同题比较边界见[当前实验总览](../../methods/agentic-waterfall/当前实验总览-20261030.md)。下文为保留的10月29日停止快照，不代表当前队列状态。

# Agentic Waterfall 实验总状态

## 当前：已停止执行，先整理计划

用户要求清理聊天后，九个已停止的实验子聊天均已归档，主控、研究主线、论文及活跃MVP聊天保留。归档不删除数据、代码、权重或结果；恢复须由用户明确决定。记录见shared/experiment-chat-archive-20261029.json与REGISTRY.json。

2026-10-29 14:34北京时间，NRMS训练PID22707、自动完成器22883、退出同步22990及其wrapper全部退出（SIGTERM，exit -15）。这是用户要求停止，不是训练正常完成或超时。全部模型/训练/下载/安装开关关闭，mind-1000 heartbeat已删除；不再由子聊天或自动任务向本对话发消息，不自动重启。

保留Waterfall的1000题输出（695有效交付/305失败）、TF-IDF的1000题输出、NRMS第1轮best权重77,687,072字节及日志。NRMS第2轮在875批后停止，没有生成本轮测试排名，没有读取新测试标签或评分。原元数据归档到shared/controller-checkpoints/mind-1000-pre-stop-metadata-20261029T0634Z.json；主控依据真实退出收据将run.json及completion-status.json纠正为stopped_by_user。停止证据见shared/controller-checkpoints/mind-1000-user-stop-20261029T0634Z.json。

两项离线工作在停止前已结束：AgentRecBench候选详情修复，以及盲选导入器和合成检查；模型调用、训练、下载、真人数据均为0。重新派发盲选没有守住用户“先不改”的边界；实际demo未修改，新离线文件保留但不启用，不继续工作，不把接口检查当效果比较。

## 九项实验两表（待确认）

统一计划已移入[研究主方案第5节](../../docs/research/agentic-waterfall/01-研究主方案.md#5-用哪些实验回答这些问题)：一表列五套公开基准与模拟一致性，另一表单列跨系统内容评分、盲选和五组消融，保留比较方法、训练要求、进度与下一步。新增比较及资源安排仍待确认；全部执行停止，盲选继续暂停。此处保留真实运行与归档证据，不再重复维护计划表。

## 历史：此前恢复与运行安排（已被上方停止指令覆盖）
正式运行仍为MIND，另已派发AgentRecBench候选输入修复和盲选demo导入适配两项有限离线工作；执行聊天均使用gpt-6.1-terra/xhigh；三种方法固定为NRMS、现有TF-IDF、Waterfall。用户已选定1000题，先看结果再扩大：已按哈希固定1000个新留出曝光，旧32题不作新测试；18题输入过长仍计失败，不换容易题。NRMS全部125572训练曝光、31393验证曝光、CPU2，按验证AUC早停，最多10epoch/30h硬超时；每epoch纯训练估计2.15h。单训练槽保持开放，Waterfall完成后模型槽已关闭；真实PID/开始以mind/STATUS.md及最新巡查为准。上述两项离线工作均禁止模型请求、训练、下载及新真人数据；其余六项无新运行。

新请求预算：全局1086（历史86+最多1000新增），MIND累计1014；每题1次决策，失败不自动重试。API仍用玄玑配置DeepSeek-V4.1-Flash，经api.jiuwenappless.com，计该API账号；执行助手Terra使用Codex额度，两者分开。1000题首调用约780–818万tokens为估计，实际计账；无法确认货币单价。客户端预算上限已按此次授权更新，13项离线测试通过，测试未产生真实请求。

跟进heartbeat `mind-1000` 已启用，30分钟检查一次，正常进行时安静；完成后输出同1000题的指标、失败率、用户级差值不确定性、实际消耗和结论边界，并关闭资源及删除巡查。

11:56已实际启动：NRMS训练PID22707、TF-IDF排序PID22709、Waterfall排序PID22708；日志为mind/logs/20261029T035652Z-{nrms-full,tfidf-1000,waterfall-1000}.log。三者预测全部提交前不读取测试答案。此处PID仅为启动收据，实时状态以日志/退出记录为准；当前尚无这1000题的效果结论。

13:58巡查：Waterfall已于13:42完成固定1000题（exit0）：695份合法排序、305份失败（30.5%），全部ID及顺序与预选清单一致，695份合法输出和1000份TF-IDF均通过完整候选排列核验。失败包括276次动作执行失败、18次输入过长、7次单调用耗尽未提交、3次JSON无效、1次超时；不修答案、不重试、不换题。新增请求982次，已报告7,378,985 tokens，1次超时usage未知；全局1068/1086、MIND996/1014，无在途请求。主控已关闭MIND模型开关，剩余18次额度不使用。NRMS仍在第1轮5450/5871步，最近批loss 1.1969，首次验证未完成；训练、离线完成器和退出同步进程仍在运行。可用35.31GiB；源代码/输入哈希与冻结记录一致。尚未读取测试标签或评分，继续既定训练与同样本离线对比。核验记录：shared/controller-checkpoints/mind-1000-waterfall-complete-20261029T0558Z.json。

14:22实测NRMS第1轮已完成：训练7857.66秒、完整验证397.48秒，共约2小时18分钟；验证AUC 0.63799，已进入第2轮。这是选权重的验证结果，不是1000题测试结果。按首轮外推3–10轮约6.9–22.9小时总运行时间，仅作估算；具体由验证早停决定，30h硬上限不变。

真人采集先指导操作：现有demo已有真人浏览/匿名盲选/JSON导出；没有发现0–3逐条评分的3轮入口。本轮只读代码和公开静态页（GET 127.0.0.1:4177返回200），没有访问个人data、修改或重启demo。步骤见shared/COLLECTION_GUIDE.md。以下收尾清单为此前完成的事实，非本次新增成果。

## 用户要求立即收尾后的清单（2026-10-29）

已停止推进：九个实验与主控的模型、训练、下载、环境安装开关均关闭；定时巡查已删除。保留数据、代码、结果与失败日志，不另启任务。

**数据现已统一到[仓库datasets/agentic-waterfall](../../datasets/agentic-waterfall/README.md)**，共8.72GB（含已有解压/派生数据）。下面表中的旧位置现在是兼容链接，仍可访问；迁移没有复制数据、没有新增下载或训练。用户要求“永远不要擅自扩大范围”已写入长期偏好与COORDINATION.md。

| 数据 | 已下载范围与原始文件大小 | 位置（相对本目录） | Waterfall适配结果 |
|---|---|---|---|
| ClawRec-SimBench | 全部42模拟用户/210事件；源码与数据包1.70MB | clawrec/upstream/ClawRec-6eeb309c47430f91280e9845a98fb56a68dc0d90/clawrec-simbench/ | ClawRec状态/规划5事件完成；Waterfall完整推荐比较未跑 |
| AgentRecBench | 仅Amazon短历史，332.40MB；未下Yelp/Goodreads | agentrecbench/data/amazon-short/ | 3题首次全失败，修复后3题合法；公平效果比较未完成 |
| MIND-small | train/dev/utils三包共239.12MB | mind/data/ | 10题中8题合法、2题无效 |
| KuaiRand-1K | 包1.135GB，选择解压1.246GB；可用文本记录329条、35.5KB | kuairand/data/ | 时间修复后2题，1题合法、1题失败；失败备用排序命中不算模型命中 |
| KuaiRec | 数据包431.96MB＋文本1.96MB | kuairec/data/raw/ | 首4人全失败；修复后2名故障代表用户合法，不是正式效果样本 |

大小为十进制MB/GB的保留原始文件，不等于网络流量或整个目录占用。KuaiRand曾读取400.03MB旧流后停止，新有界前缀读取482.70MB，只保留所需行。当前数据目录含解压/派生文件：MIND约874MB、KuaiRand约5.51GB、KuaiRec约1.99GB、AgentRecBench约332MB；ClawRec解压数据约9.67MB。

整个实验目录du实测14,212,603,904 bytes（约14.21GB/13.24GiB，含代码、环境、结果和重复派生版本），高于初始12GiB目标约1.24GiB；没有删文件来隐藏占用。

| 原主线评测 | 直白含义 | 当前实际工作 |
|---|---|---|
| 盲选 | 不显示系统名字，让人选更想看的推荐 | 写了匿名展示/导入/计分工具；0真人 |
| 逐系统评分 | 对一个系统每轮5条内容逐条打0–3分 | 写了三轮记录/评分工具；0真人 |
| 五组消融 | 分别关掉表达、行为、自由选动作、新获取、状态更新，看哪项有用 | 写了五个开关并做合成检查/少量模型调用；无有效效果对比 |
| 模拟一致性 | 检查AI用户的评分/选择是否接近真人 | 写了评价工具、装LightGBM；没有真人验证或训练 |

范围核查：已read_thread回读研究聊天01a18198-f3a3-7172-9bd8-36f57aefb6fd。主方案第5节列NRMS、SASRec、LightGCN对照；评测细则第66、84、96行明确训练，第268–270行列LambdaMART/LightGBM的模拟数据用途。训练的是这三个推荐对照；Waterfall仅调用已有大模型API，LightGBM仅安装未拟合。小样本规模与工程实现是执行选择，不等于用户逐项指定或完整协议验收。方向有依据，但正式实验未完成；主线要求的实际三轮真人样本尚未交付。

## Material Passport
Origin Skill: academic-research-suite / experiment-agent；Mode: run；更新：2026-10-29 10:20 Asia/Shanghai；Verification: PARTIAL（真实子集与合成接口分别标注）。

**4项已有公开数据上的训练/推荐指标，2项只有部分真实模型流程，3项只有合成数据工具验证。九项都没有完成正式效果实验。** KuaiRand v2及文本接入已结束；刚核对九个实验聊天均idle，无活动下载、训练或模型请求。首轮资源开关全部关闭，空闲巡查heartbeat已删除。此前的“首轮完成”仅指小规模部署与故障诊断阶段，不能理解为论文实验完成。

已有真实指标：MIND、AgentRecBench、KuaiRec、KuaiRand。部分模型流程：ClawRec、五组消融。只有工具链：跨系统盲选、逐系统评分、模拟用户一致性。

后续阻塞分两类：公开基准主要还有我们需要完成的算法/检索实现、输出稳定性、同版本同预算与扩量工作；真人三项还缺真实曝光与标签。ClawRec缺共同冻结内容环境，LLM-SRec缺GPU/大模型训练资源。不能把所有未完成项笼统称为外部阻塞。

## 资源与公共实现
- Apple M5 Pro、24GiB；10:18检查可用磁盘43,494,658,048 bytes（约40.5GiB）。首轮新增目标<=12GiB，保留>=20GiB；未购云资源，未下载完整大模型。
- 并发上限：2大下载、1训练、2模型请求。当前全部资源槽释放；各目录CONTROL.json模型/训练/大下载开关关闭。
- 模型配置/实际返回均为 DeepSeek-V4.1-Flash；2次主控纯合成连通/动作检查成功。所有实验经过 shared/model-client.mjs 原子记账，失败同样扣额。
- 当前全局 **86/120 API请求**、830,891 tokens；全部HTTP成功不等于动作有效。货币费用未知，不使用未经核对单价换算。实时累计见 shared/model-ledger.json；快照命令 `python3 experiments/agentic-waterfall/shared/controller_snapshot.py`。
- 已分配累计上限：controller2、ClawRec24、AgentRecBench24、MIND14、KuaiRand16、KuaiRec12、消融24，共116，另4未分配。已用分别2/11/17/14/9/10/23；盲选/评分/模拟0。剩余额度不是重复实验的理由。
- 公共原型 shared/runtime.mjs 当前v0.1.3，23项合同检查通过。支持表达/行为/长期状态、按需获取/推荐/更新/不行动、依赖与失败回执、五消融、状态版本及来源隔离。CLI与API见 shared/README.md。旧demo仅只读核配置，无个人data访问或服务修改。
- shared/releases/保存旧运行器与hash；新输出带加载时runtime_source_sha256。明确缺项见 shared/IMPLEMENTATION_GAPS.md：并行工具执行、精确32k/整决策60秒预算、完整语义检索、持久崩溃恢复、原论文全部组件与真人证据均未完成。

## 九项实验：真实阶段与下一步

|实验|实际完成|仍在进行/阻塞|证据入口|
|---|---|---|---|
|ClawRec-SimBench|1.70MB源码包、42用户/210事件；首用户5事件state→plan模型链完成；11请求含1次输出截断失败|完整获取/curation/judge缺独立冻结网页语料；不报告推荐Hit/NDCG|clawrec/STATUS.md、results/manifest.json|
|AgentRecBench|Amazon完整短窗口块332.4MB；3题原版基线+Waterfall；首次Waterfall3失败，修复诊断同3题3提交|其余领域/窗口未跑；Baseline666未找到；官方基线仅传最后候选的缺陷保留披露|agentrecbench/results/short-amazon-3-v1、short-amazon-3-v2-waterfall-diagnostic|
|MIND|三包239.1MB；固定32题TF-IDF/热度；NRMS4096曝光1epoch真实训练；Waterfall固定10题8提交2无效|无效完整排名仍在；10题运行器0.1.1/0.1.2混用，标兼容版本诊断；未追加模型重试|mind/STATUS.md、results/manifest.json、results/nrms/|
|KuaiRand|时间修复后的v2完成；SASRec40步、2题；Waterfall同2题1合法/1失败；329条所需视频记录取得，261条时长核验后挂文本，68条只用基础元数据|旧3题结果因时间缺陷隔离；v2唯一Waterfall命中来自失败备用排序，不能算模型命中；完整LLM-SRec、收敛训练未做|kuairand/STATUS.md、results/v2-summary.json、results/manifest.json|
|KuaiRec|zip431.96MB+文本1.96MB；big/small重叠0；LightGCN64用户10epoch、BM25 dev16；原Waterfall4失败，定向修复2/2提交|修复2人由故障类别选取，不能当无偏效果；完整BM25+BGE未部署|kuairec/STATUS.md、results/manifest.json|
|跨系统盲选|匿名导出、四类选择、随机左右、重复/缺失与共享runtime接入；合成4用户32主对比+4重复；i2Agent源码与无模型契约已部署|无真人标签；未接现有demo服务；i2Agent完整R0/真实模型未运行|blind-comparison/STATUS.md、results/manifest.json、results/iagent-source-manifest.json|
|逐系统评分|19检查通过；直接计分/共享runtime各3×5槽，复用15作者标签；状态0→1→2；评论与行为分通道|needs-human-data；RecBot/MARS仅来源审计及明确缺组件的接口，不冒充原算法|content-rating/STATUS.md、results/manifest.json|
|五组消融|20本地来源检查、11共享验收；六条件三轮90槽合成回放；真实模型8条件首轮6提交2失败，修复两项输入消融提交|公开full因候选不相关仍无交付；无真人效果；23请求；不用无表达SimBench声称表达增益|ablations/STATUS.md、results/manifest.json|
|模拟一致性|26检查通过；6合成身份、18截止点、180评分/36盲选；三组训练契约/请求准备|needs-human-data；0模型/0拟合；LightGBM4.6.0环境/原生Dataset验证完成，新增8.51MB|simulator/STATUS.md、results/manifest.json|

## 已实测数字（各自分母与版本，不作跨表胜负）

- **MIND，10固定曝光，含失败后备：** Waterfall AUC 0.570327 / MRR 0.235286 / NDCG@5 0.214387 / @10 0.296358；2/10无效排名，8/10需要已披露的空数组语法规范化。TF-IDF同10题 AUC 0.697875 / MRR 0.214385 / NDCG@5 0.258417 / @10 0.313380。见 results/paired-v011-subset10.json（文件名不代表所有输出同版本）。
- **NRMS，32曝光：** AUC 0.540850 / MRR 0.216337 / NDCG@5 0.202063 / @10 0.286527；6179正例实例、194 batches、1epoch约256秒。只是短训，未声称收敛；不可与上面10题均值直接比较。
- **KuaiRec，16开发用户：** LightGCN Recall@10 0.034340 / NDCG@10 0.315824；BM25-only诊断 0.002859 / 0.026480。LightGCN只用big的64用户、6045正边、3层64维训练10epoch约7.73秒。不是完整语义基线比较。
- **KuaiRec修复诊断，2故障代表用户：** Waterfall Recall@10 0.011212 / NDCG@10 0.163880；原dev4全部失败按0保留。2人和16人不同分母，不能直接横比。
- **AgentRecBench，Amazon短窗口3题：** 原版官方基线HR@1/3/5=0/0.333/0.333；Waterfall首次0/3有效，修复同3题诊断HR=0.333/1/1。官方prompt缺陷、方法调用/温度差异和工程重跑均保留，不作方法优越结论。
- **KuaiRand v2，2题：** SASRec Hit/NDCG@10/20均0.5。Waterfall仅1/2合法，合法题未命中；另一题推荐了候选池外的历史ID，预定备用乱序恰好命中，因此含备用规则的Hit=0.5不可归功于模型。329ID记录全部取得，68条时长不可核验不使用其caption；不声称文本全覆盖。源为2026发布的事后静态补充，不声称2022实时可用。
- **ClawRec、消融、真人评分/盲选、模拟一致性：** 没有可报告的正式推荐效果/真人结论。合成3轮累计27等数值只验算工具链。

## 源码版本与下载可复核性
- ClawRec `6eeb309c47430f91280e9845a98fb56a68dc0d90`；AgentSocietyChallenge final `3f575247a5778d34c3ae6b0297139c7d4a3597fd`，数据HF `288f7f09ca0387e5169a61b219047aea397e4b06`。
- MIND评分器 `47fb9852c97814d80ccf9c658d6b81f5c930b510`；recommenders `b6b7d2b87a1185747f70a742a68dcae1dddebbfd`；MIND包HF `2115068f457b577f93a268fffe22373e45727d89`。
- KuaiRec `a22f13b07d8b9d6b15e0cec2e97393f2bb0c40b3`；LightGCN `947ca2b3b1d2d3545b114145710cb06c4e57b3d2`。
- SASRec原TF `e3738967fddab206d6eeb4fda433e7a7034dd8b1`；实际CPU适配取LLM-SRec作者PyTorch SASRec，源码 `b81019ca655fb759cee895924b8b6c7cc0f0cce9`；不称原TF运行。
- i2Agent `e546d17848fadbcaf00e4022aa949289d7e7900b`；RecSim参考 `55e50e4be736d222ffe8c2477ed1981b40f91605`；LightGBM4.6.0 tag `d02a01ac6f51d36c9e62388243bcb75c3b1b1774`。
- 新公共/适配代码未自动提交或推送；各manifest保存文件SHA。全部下载URL/字节/MD5/SHA及许可证按实验记录，范围块SHA不冒充完整文件SHA。

## 失败与下一步
- 保留Azure409/HF401、环境依赖失败、KuaiRec重复正边/CSV CR解析、ClawRec输出截断、MIND重复/缺失ID、公共语法/来源隔离/字节膨胀等真实失败。原始数据与原始输出不覆盖。
- ClawRec另发现26/210事件的可见next_content_keys指向隐藏步骤；适配器仅按可见内容过滤引用，并保存原包，不能声称语义无泄漏完备证明。
- SASRec、caption、LightGBM环境结果已收齐，当前运行/配额关闭。下一轮优先稳定Waterfall完整候选输出并冻结版本，在同一预选样本和预算下重跑；补齐BM25+BGE与共同内容环境后再扩量。真人三项须先接实际曝光记录并获得真实标签。
- 当前PID/精确命令/日志以各实验STATUS与logs/*.exit.json为准，已完成LightGCN/NRMS进程不继续标为运行。主控快照 shared/controller-snapshot.json 只收集结果库存和预算，不读取隐藏标签。

## 历史调度记录（以下不是当前运行状态）

### 09:39 KuaiRand时间完整性修复
- 原3题基础metadata诊断不能用于有效效果表：2/3题date=04-22但time_ms为04-21 23:51/23:54；按date训练窗可包含其未来。原101项全排序3/3失败；前20项诊断3/3合法，但仍有该时间问题。
- 主控授权保留date窗/目标规则/seed，增加全局训练已结束事件截止，重建v2训练/C/候选并记录差异；不可评目标不改选。先审计再同40steps短训/同3题模型。MIND剩6额度转KuaiRand，总分配不变116。原7请求与旧结果全部保留。

### 09:44 调度交接
- 八项已完成首轮或仅余外部阻塞，其CONTROL模型/训练/大下载均关闭，保留累计配额与全部结果；不为用完额度反复运行。
- KuaiRand：v2统一截止1650553294007（2022-04-21 23:01:34.007+08:00），需剔除13,504次晚训练曝光/3,447次未完成正反馈。prepare-real-v2日志位于kuairand/logs/20261029T014204499318Z-prepare-real-v2.log。
- 旧caption流PID94399在09:38启动，200,015,872B/268s，旧闭包在v2之前冻结；主控已撤回下载槽，脚本将在已有100MB checkpoint退出并保留partial。不要自动重开全3.22GB流；先核v2缺失ID，再批准有界range/片段来源验证，不把partial SHA冒充官方全流MD5。
- KuaiRand仍有唯一训练槽，可同40steps跑时间合规v2；模型累计16已用7余9，时间/文本闭包检查通过前不调用。全局仍84/120、775,972tokens。
- LightGBM环境验证完成，0拟合/校准/模型；盲选18、评分19、模拟26项离线检查通过。

### 09:47 当时状态
- 旧caption流已在400,031,744B退出1（主控撤槽），partial/原日志保留；不是完整文件MD5通过。v2准备已退出0。
- v2原3目标中仅2题仍可评，不替换第3个目标。新语义闭包329 ID，与旧闭包共享129 ID，另200 ID待有界获取；见kuairand/results/v2-candidate-closure-audit.json。
- SASRec v2已真实完成40步、CPU2线程、约17.79秒。2道可评dev标准题Hit@10/20与NDCG@10/20均0.5；这是时间修复后的极小子集结果，不与旧有时间问题的3题均值横比，未声称收敛。
- 当前剩余可独立工作是v2文本闭包与Waterfall小运行；主控heartbeat已更新为明确继续该步骤，其他八项不重复耗额。全部独立工作完成且只剩外部条件时自动停止巡查。

### 09:51 文本接入已给具体执行权限
- 已审读caption-range-plan.json：512MiB边界观测ID约4,915,000，高于v2闭包最大ID4,365,421。主控批准一次0..536870911有界前缀，536,870,912B上限，全部329精确ID找到可提前结束，仅保留需要的记录<=100MB。
- 探测Content-Range为空，因此正式获取必须区分真实206与200的有界GET前缀；读取器硬限实际字节，严格CSV/ID/时长检查，不冒称全文件MD5。该具体许可替代之前50MB定位探测，CONTROL已更新。
- KuaiRand可自主完成下载验证与两道可评题模型运行，累计16请求上限不变。当前其余训练/模型任务均已收尾，heartbeat继续监督这一步。
