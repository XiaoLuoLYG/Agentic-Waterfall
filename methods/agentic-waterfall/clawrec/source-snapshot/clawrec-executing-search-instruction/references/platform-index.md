# Platform Index

Repo-static index of built-in ClawRec search platforms.

Consumers must merge this index with the user-state dynamic index when it exists:

```text
.clawrec/clawrec-user-state/extended-platforms/index.md
```

Use only rows whose `Status` is `active`. The dynamic index may add behavior-grounded extended platforms, but it must not replace or collide with built-in platform ids.

| Platform | Type | Reference | Status |
|---|---|---|---|
| YouTube | built-in | skills/clawrec-executing-search-instruction/references/youtube.md | active |
| Bilibili | built-in | skills/clawrec-executing-search-instruction/references/bilibili.md | active |
| Zhihu | built-in | skills/clawrec-executing-search-instruction/references/zhihu.md | active |
| 小红书 | built-in | skills/clawrec-executing-search-instruction/references/xiaohongshu.md | active |
| 新华网 | built-in | skills/clawrec-executing-search-instruction/references/xinhua.md | active |
| 人民网 | built-in | skills/clawrec-executing-search-instruction/references/people.md | active |
| 淘宝 | built-in | skills/clawrec-executing-search-instruction/references/taobao.md | active |
| 京东 | built-in | skills/clawrec-executing-search-instruction/references/jd.md | active |
| arXiv | built-in | skills/clawrec-executing-search-instruction/references/arxiv.md | active |
