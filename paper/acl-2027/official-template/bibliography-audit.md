# Bibliography audit — 2026-10-20

Scope: seven requested works. This file proposes citation metadata only; no `.tex` or `.bib` file was changed. Formal publication records take precedence over an older arXiv status. “Preprint” below means that this audit did not verify a formal venue, not that publication elsewhere is impossible.

## Citation decisions

| Work | Recommended record | Version / provenance |
|---|---|---|
| ClawRec | **arXiv, 2026**; DOI `10.48550/arXiv.2607.23779` | [arXiv v1](https://arxiv.org/abs/2607.23779v1), submitted 2026-07-26; current record has no journal reference. |
| RecBot | **KDD 2026, V.2, pp. 4580–4591**; DOI `10.1145/3770855.3817619` | [KDD official paper index](https://kdd2026.kdd.org/papers/) and [ACM-deposited Crossref record](https://api.crossref.org/works/10.1145/3770855.3817619). Earlier [arXiv v2](https://arxiv.org/abs/2509.21317v2), revised 2025-10-01, still says “Under Review”; do not use that stale status. See author discrepancy below. |
| MARS | **arXiv, 2026**; DOI `10.48550/arXiv.2605.14401` | [arXiv v2](https://arxiv.org/abs/2605.14401v2), revised 2026-05-15. **“MARS:” is not part of the paper title.** |
| InteRecAgent | **ACM Transactions on Information Systems, 43(4), 2025**; DOI `10.1145/3731446` | [ACM-deposited Crossref record](https://api.crossref.org/works/10.1145/3731446); online 2025-06-16, pages 1–33. Author repository still has an older “Just Accepted” citation. Earlier [arXiv v3](https://arxiv.org/abs/2308.16505v3), revised 2024-01-30; first submitted 2023-08-31. |
| RRCM | **arXiv, 2026**; DOI `10.48550/arXiv.2605.07129` | [arXiv v2](https://arxiv.org/abs/2605.07129v2), revised 2026-09-27. |
| RAR | **arXiv, 2026**; DOI `10.48550/arXiv.2604.04457` | [arXiv v2](https://arxiv.org/abs/2604.04457v2), revised 2026-04-13. **“RAR:” is not part of the paper title.** |
| iAgent | **Findings of ACL 2025, pp. 18056–18084**; DOI `10.18653/v1/2025.findings-acl.928` | [ACL Anthology official BibTeX](https://aclanthology.org/2025.findings-acl.928.bib). Cite Findings, not ACL main; the official record is sufficient without an arXiv citation. |

## Two issues to retain during manuscript integration

1. **RecBot author metadata conflict.** The formal KDD/Crossref order begins **Jiakai Tang, Wen Chen, Yujie Luo, Xunke Xi, ...**, whereas the older arXiv order begins **Jiakai Tang, Yujie Luo, Xunke Xi, Fei Sun, ...**. Use the formal order. However, KDD lists **Yi Chao** and Crossref encodes `Chao, Yi`; the [authors’ research-group BibTeX](https://ict-star.github.io/publications/) encodes `Yi, Chao` (**Chao Yi**). The proposed entry faithfully follows the formal publication metadata and flags this unresolved given/family-name conflict; it is not a determination of the person’s correct name.
2. **Formal metadata is verified, formal full-text equivalence is not.** ACM full-text access for RecBot/InteRecAgent was unavailable in this audit. Their previously inspected arXiv/author-source method descriptions must not be described as a verified line-by-line match to the final published versions. Do not invent final-paper section/page references. The preprints remain useful reading links, but should not replace the confirmed formal publication records by default.

## Suggested BibTeX

Entries are normalized for conventional BibTeX/ACL use. For preprints, `url` pins the inspected version; the DOI refers to the work. For formal publications, fields come from the linked official metadata, with title capitalization protected. No unverified acceptance venue or experimental claim is added.

```bibtex
@misc{wu2026clawrec,
  title = {{ClawRec}: A Claw-Native Recommender System},
  author = {Wu, Chenghao and Ou, Kesha and Wang, Xiaolei and Zheng, Bowen
            and Li, Bingqian and Liu, Enze and Zhao, Wayne Xin
            and Li, Weitao and Zhang, Long and Chen, Sheng and Wen, Ji-Rong},
  year = {2026},
  howpublished = {arXiv preprint arXiv:2607.23779},
  eprint = {2607.23779},
  archivePrefix = {arXiv},
  primaryClass = {cs.IR},
  doi = {10.48550/arXiv.2607.23779},
  url = {https://arxiv.org/abs/2607.23779v1}
}

% Follows formal ACM/Crossref metadata.
% Unresolved: author-group BibTeX has "Yi, Chao" instead of "Chao, Yi".
@inproceedings{tang2026recbot,
  title = {Interactive Recommendation Agent with Active User Commands},
  author = {Tang, Jiakai and Chen, Wen and Luo, Yujie and Xi, Xunke
            and Chao, Yi and Chen, Dian and Gao, Zhujin and Li, Yang
            and Sun, Fei and Feng, Xueyang and Dai, Sunhao and Chen, Xu
            and Wu, Jian and Jiang, Yuning and Zheng, Bo},
  booktitle = {Proceedings of the 32nd ACM SIGKDD Conference on Knowledge
               Discovery and Data Mining V.2},
  year = {2026},
  month = aug,
  publisher = {Association for Computing Machinery},
  pages = {4580--4591},
  doi = {10.1145/3770855.3817619},
  url = {https://doi.org/10.1145/3770855.3817619}
}

@misc{shen2026mars,
  title = {Agentic Recommender System with Hierarchical Belief-State Memory},
  author = {Shen, Xiang and Zhou, Yuhang and Wu, Yifan and Zhao, Zhuokai
            and Lin, Siyu and Huang, Lei and Zhong, Qianqian
            and Zhang, Lizhu and Zhang, Benyu and Fan, Xiangjun and Yan, Hong},
  year = {2026},
  howpublished = {arXiv preprint arXiv:2605.14401},
  eprint = {2605.14401},
  archivePrefix = {arXiv},
  primaryClass = {cs.CL},
  doi = {10.48550/arXiv.2605.14401},
  url = {https://arxiv.org/abs/2605.14401v2}
}

@article{huang2025interecagent,
  title = {Recommender {AI} Agent: Integrating Large Language Models
           for Interactive Recommendations},
  author = {Huang, Xu and Lian, Jianxun and Lei, Yuxuan and Yao, Jing
            and Lian, Defu and Xie, Xing},
  journal = {ACM Transactions on Information Systems},
  volume = {43},
  number = {4},
  year = {2025},
  month = jun,
  pages = {1--33},
  publisher = {Association for Computing Machinery},
  doi = {10.1145/3731446},
  url = {https://doi.org/10.1145/3731446}
}

@misc{li2026rrcm,
  title = {{RRCM}: Ranking-Driven Retrieval over Collaborative
           and Meta Memories for {LLM} Recommendation},
  author = {Li, Shijun and Belligundu, Pranav and Wei, Tianxin
            and Yang, Wooseong and Wang, Yu and Ghosh, Joydeep},
  year = {2026},
  howpublished = {arXiv preprint arXiv:2605.07129},
  eprint = {2605.07129},
  archivePrefix = {arXiv},
  primaryClass = {cs.IR},
  doi = {10.48550/arXiv.2605.07129},
  url = {https://arxiv.org/abs/2605.07129v2}
}

@misc{yue2026rar,
  title = {Retrieval Augmented Conversational Recommendation
           with Reinforcement Learning},
  author = {Yue, Zhenrui and Zhuang, Honglei and Qin, Zhen and He, Zhankui
            and Zeng, Huimin and McAuley, Julian and Wang, Dong},
  year = {2026},
  howpublished = {arXiv preprint arXiv:2604.04457},
  eprint = {2604.04457},
  archivePrefix = {arXiv},
  primaryClass = {cs.IR},
  doi = {10.48550/arXiv.2604.04457},
  url = {https://arxiv.org/abs/2604.04457v2}
}

@inproceedings{xu-etal-2025-iagent,
  title = {i{A}gent: {LLM} Agent as a Shield between User and Recommender Systems},
  author = {Xu, Wujiang and Shi, Yunxiao and Liang, Zujie and Ning, Xuying
            and Mei, Kai and Wang, Kun and Zhu, Xi and Xu, Min
            and Zhang, Yongfeng},
  editor = {Che, Wanxiang and Nabende, Joyce and Shutova, Ekaterina
            and Pilehvar, Mohammad Taher},
  booktitle = {Findings of the Association for Computational Linguistics: ACL 2025},
  month = jul,
  year = {2025},
  address = {Vienna, Austria},
  publisher = {Association for Computational Linguistics},
  pages = {18056--18084},
  doi = {10.18653/v1/2025.findings-acl.928},
  url = {https://aclanthology.org/2025.findings-acl.928/}
}
```

Exact metadata endpoints used for the two ACM entries: [RecBot BibTeX export](https://api.crossref.org/works/10.1145/3770855.3817619/transform/application/x-bibtex), [InteRecAgent BibTeX export](https://api.crossref.org/works/10.1145/3731446/transform/application/x-bibtex). These exports reflect publisher-deposited records; the RecBot name conflict above remains visible rather than silently corrected.
