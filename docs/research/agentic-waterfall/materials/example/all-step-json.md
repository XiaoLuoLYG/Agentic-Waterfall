# 每一步：用户操作 → 输入 → JSON → 工具 → 内容

**所有名称都直接可读。** 例如“手机跟拍足球：四个动作”同时用作样例内容标识。完整未删字段在 [episode.json](episode.json)；下方输入展示影响决策的字段，输出保留原始全部字段。每一步的完整历史仍随实际 input 保存。

这是作者编写的数据。来源工具实际运行于本地固定内容环境，未调用真实模型或网络。

并行规则：先解析 JSON，再按 depends_on 找可运行的动作。同一组内两路来源查询同时启动；需要它们结果的下一次模型决策在返回后发生。

## 1. 新用户进来，先随便刷

这是冷启动。Agent 没有历史，先调用图文来源的热榜；此时不编造具体内容。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [],
  "behavior_events": [
    {
      "type": "session_start",
      "item_id": null,
      "payload": {
        "history_available": false
      }
    }
  ],
  "user_state": {
    "version": 0,
    "records": []
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": []
    },
    "candidate_pool": [],
    "tool_results": [],
    "source_catalog": [
      {
        "source_id": "图文来源",
        "modes": [
          "search",
          "hot"
        ],
        "content_types": [
          "article"
        ],
        "status": "available"
      },
      {
        "source_id": "视频来源",
        "modes": [
          "search"
        ],
        "content_types": [
          "video"
        ],
        "status": "available"
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "首次浏览",
  "actions": [
    {
      "action_id": "获取初始热榜",
      "kind": "acquire",
      "arguments": {
        "source_ids": [
          "图文来源"
        ],
        "mode": "hot",
        "query": null,
        "target_id": null,
        "content_types": [
          "article"
        ],
        "constraint_refs": [],
        "limit": 3
      },
      "evidence_refs": [
        "用户事件1：session_start"
      ],
      "depends_on": []
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：获取初始热榜

**工具真正返回：**

- 获取初始热榜 → 手机摄影：先观察光线；十分钟做一份早餐；周末读一本短篇小说

## 2. 热榜返回，Agent 决定第一屏

工具返回三个真实样例内容后，Agent 才能选择它们；队列工具只排好顺序，页面真正可见后另记曝光。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [],
  "behavior_events": [],
  "user_state": {
    "version": 0,
    "records": []
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": []
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      }
    ],
    "tool_results": [
      {
        "action_id": "获取初始热榜",
        "status": "success",
        "result": {
          "items": [
            {
              "id": "手机摄影：先观察光线",
              "content_type": "article",
              "text": "先看光从哪里来。顺光适合记录细节，侧光可突出层次。"
            },
            {
              "id": "十分钟做一份早餐",
              "content_type": "article",
              "text": "准备燕麦、水果和酸奶，按口味搭配。"
            },
            {
              "id": "周末读一本短篇小说",
              "content_type": "article",
              "text": "从短篇开始，读完记下最喜欢的一幕。"
            }
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "热榜返回后",
  "actions": [
    {
      "action_id": "推荐初始内容",
      "kind": "recommend",
      "arguments": {
        "ordered_item_ids": [
          "手机摄影：先观察光线",
          "十分钟做一份早餐",
          "周末读一本短篇小说"
        ],
        "delivery": "append"
      },
      "evidence_refs": [
        "获取初始热榜"
      ],
      "depends_on": []
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：推荐初始内容

**工具真正返回：**

- 推荐初始内容 → {"slate_id": "初始推荐列表", "queued_item_ids": ["手机摄影：先观察光线", "十分钟做一份早餐", "周末读一本短篇小说"]}

## 3. 用户读了摄影文章并收藏，没有说话

本轮没有新发言。打开、22 秒前台阅读和收藏关联同一摄影内容。Agent 记录本次经历，再据此搜索；不把一次行为改成永久偏好。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [],
  "behavior_events": [
    {
      "type": "exposure",
      "item_id": "手机摄影：先观察光线",
      "payload": {
        "slate_id": "初始推荐列表",
        "position": 1,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "open",
      "item_id": "手机摄影：先观察光线",
      "payload": {}
    },
    {
      "type": "dwell",
      "item_id": "手机摄影：先观察光线",
      "payload": {
        "duration_ms": 22000,
        "surface": "detail",
        "foreground": true
      }
    },
    {
      "type": "save",
      "item_id": "手机摄影：先观察光线",
      "payload": {
        "value": true
      }
    },
    {
      "type": "exposure_end",
      "item_id": "手机摄影：先观察光线",
      "payload": {
        "observation_status": "complete"
      }
    },
    {
      "type": "exposure",
      "item_id": "十分钟做一份早餐",
      "payload": {
        "slate_id": "初始推荐列表",
        "position": 2,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "exposure_end",
      "item_id": "十分钟做一份早餐",
      "payload": {
        "observation_status": "complete"
      }
    }
  ],
  "user_state": {
    "version": 0,
    "records": []
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": [
        "周末读一本短篇小说"
      ]
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      }
    ],
    "tool_results": [
      {
        "action_id": "推荐初始内容",
        "status": "success",
        "result": {
          "slate_id": "初始推荐列表",
          "queued_item_ids": [
            "手机摄影：先观察光线",
            "十分钟做一份早餐",
            "周末读一本短篇小说"
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "收藏之后",
  "actions": [
    {
      "action_id": "记录本次摄影浏览",
      "kind": "update_state",
      "arguments": {
        "base_version": 0,
        "edits": [
          {
            "op": "upsert",
            "record": {
              "id": "本次摄影浏览经历",
              "kind": "episode",
              "key": "observed_interest",
              "value": "本次打开并收藏手机摄影内容",
              "scope": "session",
              "scope_id": "一次手机摄影浏览",
              "status": "active",
              "basis": "observed",
              "evidence_refs": [
                "用户事件3：open",
                "用户事件4：dwell",
                "用户事件5：save"
              ]
            }
          }
        ]
      },
      "evidence_refs": [
        "用户事件3：open",
        "用户事件4：dwell",
        "用户事件5：save"
      ],
      "depends_on": []
    },
    {
      "action_id": "搜索手机摄影图文",
      "kind": "acquire",
      "arguments": {
        "source_ids": [
          "图文来源"
        ],
        "mode": "search",
        "query": "手机 摄影",
        "target_id": null,
        "content_types": [
          "article"
        ],
        "constraint_refs": [],
        "limit": 6
      },
      "evidence_refs": [
        "用户事件3：open",
        "用户事件5：save"
      ],
      "depends_on": [
        "记录本次摄影浏览"
      ]
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：记录本次摄影浏览
- 执行：搜索手机摄影图文

**工具真正返回：**

- 记录本次摄影浏览 → {"state_version": 1}
- 搜索手机摄影图文 → 手机摄影：先观察光线；手机摄影：构图的三个练习；手机拍足球：基础设置；手机跟拍足球：四个动作；手机拍运动：开拍检查单；运动摄影镜头怎么选

## 4. 摄影搜索返回，Agent 补充后续内容

搜索已返回摄影内容。Agent 选择构图练习和器材文章排队；这时用户尚未表达不买器材。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [],
  "behavior_events": [],
  "user_state": {
    "version": 1,
    "records": [
      {
        "kind": "episode",
        "value": "本次打开并收藏手机摄影内容",
        "scope": "session",
        "status": "active",
        "basis": "observed"
      }
    ]
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": [
        "周末读一本短篇小说"
      ]
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      },
      {
        "id": "手机摄影：构图的三个练习",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：基础设置",
        "content_type": "article"
      },
      {
        "id": "手机跟拍足球：四个动作",
        "content_type": "article"
      },
      {
        "id": "手机拍运动：开拍检查单",
        "content_type": "article"
      },
      {
        "id": "运动摄影镜头怎么选",
        "content_type": "article"
      }
    ],
    "tool_results": [
      {
        "action_id": "记录本次摄影浏览",
        "status": "success",
        "result": {
          "state_version": 1
        }
      },
      {
        "action_id": "搜索手机摄影图文",
        "status": "success",
        "result": {
          "items": [
            {
              "id": "手机摄影：先观察光线",
              "content_type": "article",
              "text": "先看光从哪里来。顺光适合记录细节，侧光可突出层次。"
            },
            {
              "id": "手机摄影：构图的三个练习",
              "content_type": "article",
              "text": "先固定主体，再比较横竖构图，最后观察画面边缘。"
            },
            {
              "id": "手机拍足球：基础设置",
              "content_type": "article",
              "text": "擦净镜头，在光线充足时拍摄，提前熟悉连拍操作。"
            },
            {
              "id": "手机跟拍足球：四个动作",
              "content_type": "article",
              "text": "站稳身体，提前对准移动方向，平稳转动上身，动作结束后继续保持一秒。"
            },
            {
              "id": "手机拍运动：开拍检查单",
              "content_type": "article",
              "text": "确认电量与存储。选择安全站位，先练习跟随移动，再开始连续拍摄。"
            },
            {
              "id": "运动摄影镜头怎么选",
              "content_type": "article",
              "text": "比较焦段、重量和价格，再决定是否购买专用镜头。"
            }
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "摄影检索返回后",
  "actions": [
    {
      "action_id": "推荐摄影内容",
      "kind": "recommend",
      "arguments": {
        "ordered_item_ids": [
          "手机摄影：构图的三个练习",
          "运动摄影镜头怎么选"
        ],
        "delivery": "replace_pending"
      },
      "evidence_refs": [
        "搜索手机摄影图文"
      ],
      "depends_on": []
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：推荐摄影内容

**工具真正返回：**

- 推荐摄影内容 → {"slate_id": "摄影推荐列表", "queued_item_ids": ["手机摄影：构图的三个练习", "运动摄影镜头怎么选"]}

## 5. 用户说：用手机拍足球，不买器材

先更新当前任务及不买器材/短教程要求。视频搜索与图文搜索都依赖这次更新，彼此没有依赖，因此在同一调度组并行。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [
    {
      "role": "user",
      "text": "周末想用手机拍孩子踢球，不买器材，先给我短教程。",
      "target_refs": [
        "手机摄影：构图的三个练习"
      ]
    }
  ],
  "behavior_events": [
    {
      "type": "exposure",
      "item_id": "手机摄影：构图的三个练习",
      "payload": {
        "slate_id": "摄影推荐列表",
        "position": 1,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "open",
      "item_id": "手机摄影：构图的三个练习",
      "payload": {}
    },
    {
      "type": "dwell",
      "item_id": "手机摄影：构图的三个练习",
      "payload": {
        "duration_ms": 19000,
        "surface": "detail",
        "foreground": true
      }
    },
    {
      "type": "exposure_end",
      "item_id": "手机摄影：构图的三个练习",
      "payload": {
        "observation_status": "complete"
      }
    }
  ],
  "user_state": {
    "version": 1,
    "records": [
      {
        "kind": "episode",
        "value": "本次打开并收藏手机摄影内容",
        "scope": "session",
        "status": "active",
        "basis": "observed"
      }
    ]
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": [
        "运动摄影镜头怎么选"
      ]
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      },
      {
        "id": "手机摄影：构图的三个练习",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：基础设置",
        "content_type": "article"
      },
      {
        "id": "手机跟拍足球：四个动作",
        "content_type": "article"
      },
      {
        "id": "手机拍运动：开拍检查单",
        "content_type": "article"
      },
      {
        "id": "运动摄影镜头怎么选",
        "content_type": "article"
      }
    ],
    "tool_results": [
      {
        "action_id": "推荐摄影内容",
        "status": "success",
        "result": {
          "slate_id": "摄影推荐列表",
          "queued_item_ids": [
            "手机摄影：构图的三个练习",
            "运动摄影镜头怎么选"
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "提出拍摄需求",
  "actions": [
    {
      "action_id": "更新手机足球拍摄需求",
      "kind": "update_state",
      "arguments": {
        "base_version": 1,
        "edits": [
          {
            "op": "upsert",
            "record": {
              "id": "手机足球拍摄任务",
              "kind": "task",
              "key": "goal",
              "value": "找到可照着做的手机足球拍摄教程",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户提出手机拍足球的需求"
              ]
            }
          },
          {
            "op": "upsert",
            "record": {
              "id": "本任务不买器材",
              "kind": "constraint",
              "key": "shopping",
              "value": "不看器材购买建议",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户提出手机拍足球的需求"
              ],
              "polarity": "avoid",
              "strength": "hard"
            }
          },
          {
            "op": "upsert",
            "record": {
              "id": "本任务偏好短教程",
              "kind": "preference",
              "key": "length",
              "value": "短教程",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户提出手机拍足球的需求"
              ],
              "polarity": "prefer",
              "strength": "soft"
            }
          }
        ]
      },
      "evidence_refs": [
        "用户提出手机拍足球的需求"
      ],
      "depends_on": []
    },
    {
      "action_id": "搜索手机足球视频",
      "kind": "acquire",
      "arguments": {
        "source_ids": [
          "视频来源"
        ],
        "mode": "search",
        "query": "手机 足球",
        "target_id": null,
        "content_types": [
          "video"
        ],
        "constraint_refs": [
          "本任务不买器材",
          "本任务偏好短教程"
        ],
        "limit": 2
      },
      "evidence_refs": [
        "用户提出手机拍足球的需求"
      ],
      "depends_on": [
        "更新手机足球拍摄需求"
      ]
    },
    {
      "action_id": "同时搜索手机足球图文",
      "kind": "acquire",
      "arguments": {
        "source_ids": [
          "图文来源"
        ],
        "mode": "search",
        "query": "手机 足球",
        "target_id": null,
        "content_types": [
          "article"
        ],
        "constraint_refs": [
          "本任务不买器材",
          "本任务偏好短教程"
        ],
        "limit": 6
      },
      "evidence_refs": [
        "用户提出手机拍足球的需求"
      ],
      "depends_on": [
        "更新手机足球拍摄需求"
      ]
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：更新手机足球拍摄需求
- 并行启动：搜索手机足球视频；同时搜索手机足球图文

**工具真正返回：**

- 更新手机足球拍摄需求 → {"state_version": 2}
- 同时搜索手机足球图文 → 手机摄影：先观察光线；手机摄影：构图的三个练习；手机拍足球：基础设置；手机跟拍足球：四个动作；手机拍运动：开拍检查单；运动摄影镜头怎么选
- 搜索手机足球视频 → 手机拍足球：一分钟基础演示；手机拍足球：两分钟跟拍演示

## 6. 两路搜索返回，Agent 选择短教程

两个来源返回后，Agent 同时看到图文和视频候选。这次挑两条短视频；图文留在候选池中，仍可用于后续变化。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [],
  "behavior_events": [],
  "user_state": {
    "version": 2,
    "records": [
      {
        "kind": "episode",
        "value": "本次打开并收藏手机摄影内容",
        "scope": "session",
        "status": "active",
        "basis": "observed"
      },
      {
        "kind": "task",
        "value": "找到可照着做的手机足球拍摄教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "constraint",
        "value": "不看器材购买建议",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "preference",
        "value": "短教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      }
    ]
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": [
        "运动摄影镜头怎么选"
      ]
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      },
      {
        "id": "手机摄影：构图的三个练习",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：基础设置",
        "content_type": "article"
      },
      {
        "id": "手机跟拍足球：四个动作",
        "content_type": "article"
      },
      {
        "id": "手机拍运动：开拍检查单",
        "content_type": "article"
      },
      {
        "id": "运动摄影镜头怎么选",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：一分钟基础演示",
        "content_type": "video"
      },
      {
        "id": "手机拍足球：两分钟跟拍演示",
        "content_type": "video"
      }
    ],
    "tool_results": [
      {
        "action_id": "更新手机足球拍摄需求",
        "status": "success",
        "result": {
          "state_version": 2
        }
      },
      {
        "action_id": "同时搜索手机足球图文",
        "status": "success",
        "result": {
          "items": [
            {
              "id": "手机摄影：先观察光线",
              "content_type": "article",
              "text": "先看光从哪里来。顺光适合记录细节，侧光可突出层次。"
            },
            {
              "id": "手机摄影：构图的三个练习",
              "content_type": "article",
              "text": "先固定主体，再比较横竖构图，最后观察画面边缘。"
            },
            {
              "id": "手机拍足球：基础设置",
              "content_type": "article",
              "text": "擦净镜头，在光线充足时拍摄，提前熟悉连拍操作。"
            },
            {
              "id": "手机跟拍足球：四个动作",
              "content_type": "article",
              "text": "站稳身体，提前对准移动方向，平稳转动上身，动作结束后继续保持一秒。"
            },
            {
              "id": "手机拍运动：开拍检查单",
              "content_type": "article",
              "text": "确认电量与存储。选择安全站位，先练习跟随移动，再开始连续拍摄。"
            },
            {
              "id": "运动摄影镜头怎么选",
              "content_type": "article",
              "text": "比较焦段、重量和价格，再决定是否购买专用镜头。"
            }
          ]
        }
      },
      {
        "action_id": "搜索手机足球视频",
        "status": "success",
        "result": {
          "items": [
            {
              "id": "手机拍足球：一分钟基础演示",
              "content_type": "video",
              "text": "演示清洁镜头、提前取景与启动连拍。"
            },
            {
              "id": "手机拍足球：两分钟跟拍演示",
              "content_type": "video",
              "text": "演示稳定站位、跟随移动和保留动作结束后的画面。"
            }
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "两路检索返回后",
  "actions": [
    {
      "action_id": "推荐短视频教程",
      "kind": "recommend",
      "arguments": {
        "ordered_item_ids": [
          "手机拍足球：一分钟基础演示",
          "手机拍足球：两分钟跟拍演示"
        ],
        "delivery": "replace_pending"
      },
      "evidence_refs": [
        "用户提出手机拍足球的需求",
        "搜索手机足球视频"
      ],
      "depends_on": []
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：推荐短视频教程

**工具真正返回：**

- 推荐短视频教程 → {"slate_id": "短视频推荐列表", "queued_item_ids": ["手机拍足球：一分钟基础演示", "手机拍足球：两分钟跟拍演示"]}

## 7. 用户说：基础会了，只看图文步骤

只看图文是当前任务的明确要求。先提交状态更新，再重排已取得的两篇图文；不用再发起一次搜索。未展示的视频从待看队列移走，已有曝光记录不改写。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [
    {
      "role": "user",
      "text": "基础设置我会了，只看图文，给我跟拍的具体步骤。",
      "target_refs": [
        "手机拍足球：一分钟基础演示",
        "手机足球拍摄任务"
      ]
    }
  ],
  "behavior_events": [
    {
      "type": "exposure",
      "item_id": "手机拍足球：一分钟基础演示",
      "payload": {
        "slate_id": "短视频推荐列表",
        "position": 1,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "play",
      "item_id": "手机拍足球：一分钟基础演示",
      "payload": {
        "duration_ms": 15000,
        "surface": "detail",
        "foreground": true,
        "interval_started_at": "2026-10-27T02:01:19.000Z"
      }
    },
    {
      "type": "exposure_end",
      "item_id": "手机拍足球：一分钟基础演示",
      "payload": {
        "observation_status": "complete"
      }
    }
  ],
  "user_state": {
    "version": 2,
    "records": [
      {
        "kind": "episode",
        "value": "本次打开并收藏手机摄影内容",
        "scope": "session",
        "status": "active",
        "basis": "observed"
      },
      {
        "kind": "task",
        "value": "找到可照着做的手机足球拍摄教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "constraint",
        "value": "不看器材购买建议",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "preference",
        "value": "短教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      }
    ]
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": [
        "手机拍足球：两分钟跟拍演示"
      ]
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      },
      {
        "id": "手机摄影：构图的三个练习",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：基础设置",
        "content_type": "article"
      },
      {
        "id": "手机跟拍足球：四个动作",
        "content_type": "article"
      },
      {
        "id": "手机拍运动：开拍检查单",
        "content_type": "article"
      },
      {
        "id": "运动摄影镜头怎么选",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：一分钟基础演示",
        "content_type": "video"
      },
      {
        "id": "手机拍足球：两分钟跟拍演示",
        "content_type": "video"
      }
    ],
    "tool_results": [
      {
        "action_id": "推荐短视频教程",
        "status": "success",
        "result": {
          "slate_id": "短视频推荐列表",
          "queued_item_ids": [
            "手机拍足球：一分钟基础演示",
            "手机拍足球：两分钟跟拍演示"
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "要求改为图文",
  "actions": [
    {
      "action_id": "更新只看图文的要求",
      "kind": "update_state",
      "arguments": {
        "base_version": 2,
        "edits": [
          {
            "op": "upsert",
            "record": {
              "id": "已经掌握基础设置",
              "kind": "fact",
              "key": "knowledge",
              "value": "本次手机拍摄的基础设置已会",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户要求只看图文步骤"
              ]
            }
          },
          {
            "op": "upsert",
            "record": {
              "id": "本任务只看图文",
              "kind": "constraint",
              "key": "content_type",
              "value": "article",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户要求只看图文步骤"
              ],
              "polarity": "prefer",
              "strength": "hard"
            }
          },
          {
            "op": "upsert",
            "record": {
              "id": "本任务需要具体步骤",
              "kind": "preference",
              "key": "support",
              "value": "跟拍的具体操作步骤",
              "scope": "task",
              "scope_id": "手机足球拍摄任务",
              "status": "active",
              "basis": "user_stated",
              "evidence_refs": [
                "用户要求只看图文步骤"
              ],
              "polarity": "prefer",
              "strength": "soft"
            }
          }
        ]
      },
      "evidence_refs": [
        "用户要求只看图文步骤"
      ],
      "depends_on": []
    },
    {
      "action_id": "推荐跟拍图文步骤",
      "kind": "recommend",
      "arguments": {
        "ordered_item_ids": [
          "手机跟拍足球：四个动作",
          "手机拍运动：开拍检查单"
        ],
        "delivery": "replace_pending"
      },
      "evidence_refs": [
        "用户要求只看图文步骤",
        "搜索手机摄影图文"
      ],
      "depends_on": [
        "更新只看图文的要求"
      ]
    }
  ]
}
```

**解析后工具怎样调用：**

- 执行：更新只看图文的要求
- 执行：推荐跟拍图文步骤

**工具真正返回：**

- 更新只看图文的要求 → {"state_version": 3}
- 推荐跟拍图文步骤 → {"slate_id": "图文步骤推荐列表", "queued_item_ids": ["手机跟拍足球：四个动作", "手机拍运动：开拍检查单"]}

## 8. 用户说：够了，准备离开

结束的是这次找教程任务。Agent 更新任务并发出结束回复，运行器停止本任务的继续补充；用户实际退出另由网页记录。

**给 Agent 的数据：**原始 input 包括当时所有已知记录。此处对 dialogue/behavior_events/tool_results 只展示相对上一步新增部分；记忆和候选展示当前值。

```json
{
  "dialogue": [
    {
      "role": "user",
      "text": "这两条够了，我去试试。",
      "target_refs": [
        "手机足球拍摄任务",
        "手机跟拍足球：四个动作",
        "手机拍运动：开拍检查单"
      ]
    }
  ],
  "behavior_events": [
    {
      "type": "exposure",
      "item_id": "手机跟拍足球：四个动作",
      "payload": {
        "slate_id": "图文步骤推荐列表",
        "position": 1,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "open",
      "item_id": "手机跟拍足球：四个动作",
      "payload": {}
    },
    {
      "type": "dwell",
      "item_id": "手机跟拍足球：四个动作",
      "payload": {
        "duration_ms": 44000,
        "surface": "detail",
        "foreground": true
      }
    },
    {
      "type": "save",
      "item_id": "手机跟拍足球：四个动作",
      "payload": {
        "value": true
      }
    },
    {
      "type": "exposure_end",
      "item_id": "手机跟拍足球：四个动作",
      "payload": {
        "observation_status": "complete"
      }
    },
    {
      "type": "exposure",
      "item_id": "手机拍运动：开拍检查单",
      "payload": {
        "slate_id": "图文步骤推荐列表",
        "position": 2,
        "surface": "feed",
        "visible_ratio": 0.75,
        "visible_ms": 1000
      }
    },
    {
      "type": "open",
      "item_id": "手机拍运动：开拍检查单",
      "payload": {}
    },
    {
      "type": "dwell",
      "item_id": "手机拍运动：开拍检查单",
      "payload": {
        "duration_ms": 24000,
        "surface": "detail",
        "foreground": true
      }
    },
    {
      "type": "exposure_end",
      "item_id": "手机拍运动：开拍检查单",
      "payload": {
        "observation_status": "complete"
      }
    }
  ],
  "user_state": {
    "version": 3,
    "records": [
      {
        "kind": "episode",
        "value": "本次打开并收藏手机摄影内容",
        "scope": "session",
        "status": "active",
        "basis": "observed"
      },
      {
        "kind": "task",
        "value": "找到可照着做的手机足球拍摄教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "constraint",
        "value": "不看器材购买建议",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "preference",
        "value": "短教程",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "fact",
        "value": "本次手机拍摄的基础设置已会",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "constraint",
        "value": "article",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      },
      {
        "kind": "preference",
        "value": "跟拍的具体操作步骤",
        "scope": "task",
        "status": "active",
        "basis": "user_stated"
      }
    ]
  },
  "environment": {
    "feed": {
      "visible_item_ids": [],
      "queued_item_ids": []
    },
    "candidate_pool": [
      {
        "id": "手机摄影：先观察光线",
        "content_type": "article"
      },
      {
        "id": "十分钟做一份早餐",
        "content_type": "article"
      },
      {
        "id": "周末读一本短篇小说",
        "content_type": "article"
      },
      {
        "id": "手机摄影：构图的三个练习",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：基础设置",
        "content_type": "article"
      },
      {
        "id": "手机跟拍足球：四个动作",
        "content_type": "article"
      },
      {
        "id": "手机拍运动：开拍检查单",
        "content_type": "article"
      },
      {
        "id": "运动摄影镜头怎么选",
        "content_type": "article"
      },
      {
        "id": "手机拍足球：一分钟基础演示",
        "content_type": "video"
      },
      {
        "id": "手机拍足球：两分钟跟拍演示",
        "content_type": "video"
      }
    ],
    "tool_results": [
      {
        "action_id": "更新只看图文的要求",
        "status": "success",
        "result": {
          "state_version": 3
        }
      },
      {
        "action_id": "推荐跟拍图文步骤",
        "status": "success",
        "result": {
          "slate_id": "图文步骤推荐列表",
          "queued_item_ids": [
            "手机跟拍足球：四个动作",
            "手机拍运动：开拍检查单"
          ]
        }
      }
    ]
  }
}
```

**Agent 输出原文：**

```json
{
  "decision_id": "说内容够了",
  "actions": [
    {
      "action_id": "完成本次找教程任务",
      "kind": "update_state",
      "arguments": {
        "base_version": 3,
        "edits": [
          {
            "op": "set_status",
            "record_id": "手机足球拍摄任务",
            "status": "completed"
          }
        ]
      },
      "evidence_refs": [
        "用户说内容够了"
      ],
      "depends_on": []
    },
    {
      "action_id": "暂停本任务的推荐",
      "kind": "idle",
      "arguments": {
        "mode": "end_task",
        "task_id": "手机足球拍摄任务"
      },
      "evidence_refs": [
        "用户说内容够了"
      ],
      "depends_on": [
        "完成本次找教程任务"
      ]
    },
    {
      "action_id": "回复结束确认",
      "kind": "respond",
      "arguments": {
        "kind": "answer",
        "text": "好，先到这里。",
        "target_refs": [
          "手机足球拍摄任务"
        ]
      },
      "evidence_refs": [
        "用户说内容够了"
      ],
      "depends_on": []
    }
  ]
}
```

**解析后工具怎样调用：**

- 并行启动：完成本次找教程任务；回复结束确认
- 执行：暂停本任务的推荐

**工具真正返回：**

- 完成本次找教程任务 → {"state_version": 4}
- 回复结束确认 → {"message_id": "助手回复：回复结束确认", "text": "好，先到这里。"}
- 暂停本任务的推荐 → {"mode": "end_task", "task_id": "手机足球拍摄任务"}

## 这个例子怎样进入评测

到“只看图文步骤”的相同截止点，各算法各交一条内容，再匿名让人选最想看哪条。把此选择作为独立的选择题记录；当前这条完整使用轨迹仍只记录实际执行系统的内容和反馈。见 [评测协议](../references/evaluation-details.md) 与 [选择题样例](next-item-choice.json)。

运行 `python3 docs/research/agentic-waterfall/materials/example/replay.py` 可以复核每步记录，并验证两路来源调用确实并发进入本地工具。样例里的时刻为编写的逻辑时间，不是实际模型延迟。
