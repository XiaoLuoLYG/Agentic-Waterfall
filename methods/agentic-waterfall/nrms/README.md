# NRMS baseline

MIND-small 的 NRMS 对照。模型实现来自 Microsoft Recommenders 的 `NRMSModel`；本目录是训练、预测和打分入口。

路径相对本目录。`train.py` 读取 `data/MINDsmall_train` 与 `data/MINDsmall_dev`，并把权重写到 `checkpoints/nrms_ckpt`。`predict.py` 写出 `predictions/nrms-small-dev.jsonl`，`score.py` 用 `scoring/` 里的 MIND 评分器计算 AUC、MRR、NDCG@5/10。词向量、词表和用户表放在 `utils/MINDsmall_utils/`。`nrms.yaml`、`embedding.npy`、`word_dict.pkl`、`uid2index.pkl` 缺任何一个时，`train.py` 会从 Hugging Face 的 Recommenders/MIND 下载 `MINDsmall_utils.zip`。本目录不附带这些文件。

数据、权重、训练日志和 checkpoint 不在本目录。训练前把 MIND-small 放到 `data/MINDsmall_train` 与 `data/MINDsmall_dev`。
