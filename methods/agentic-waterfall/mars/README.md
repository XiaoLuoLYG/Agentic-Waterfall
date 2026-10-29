# MARS 论文复现版

基于 [Agentic Recommender System with Hierarchical Belief-State Memory](https://arxiv.org/html/2605.14401v2) 自行实现，**不是作者源码，也未验证论文数值可复现**。`mars.mjs` 提供独立用户三级状态（事件、偏好、画像）、回顾模式和持续更新模式；支持 extract、boost、demote、merge、forget、synthesize，以及按论文每批 10 个候选进行独立 0–10 分打分、排序。事件窗口15、分类容量8、规划间隔3、+0.1/−0.2、遗忘阈值0.1/5、5次变更后合成。

复现差异：作者代码及确切提示未公开；本实现自写模型提示，抽取返回整份偏好，合并采用证据数加权强度；分类由模型命名，暂未按每个数据域预先生成固定六类。计划跳过时保留待处理事件，因论文未完整披露跳过的处理细节。使用用户现有模型而非论文模型。持续模式已有合成多轮信息测试，**尚没有真实多轮模型验证**；请求失败不会提交新状态。

MIND 公共输入的真实测试：`runs/mind-0-paper-based-20261029/`，3 次调用分别完成抽取、合成、候选评分，4 个候选全部返回，未读答案；这只证明一条回顾链可执行。KuaiRec 单样本的 78 条历史与 100 个候选已通过 12 次真实调用全部返回；KuaiRand 单样本 64 条历史与 101 个候选已通过 13 次真实调用全部返回。记录分别在 `runs/kuairec-0-paper-based-20261029/` 和 `runs/kuairand-0-paper-based-20261029/`。MIND、KuaiRec 批量和持续运行的公平预算仍需预先固定。

单行入口：

```sh
node methods/agentic-waterfall/paper-reproductions-run.mjs mars \
  experiments/agentic-waterfall/mind/runs/benchmark-1000-v1/inputs.jsonl 0 \
  methods/agentic-waterfall/mars/runs/RUN_ID
```

KuaiRand 的入口在上述参数后追加 `kuairand`。KuaiRec 的入口在上述参数后追加 `kuairec POOL_JSON CATALOG_JSON`；POOL_JSON 必须绑定当前 `context_id` 和 `acquired_ids`，候选由调用方预先取得，见总目录说明。以上命令需要调用开关和预算已由实验执行者按计划开启。
