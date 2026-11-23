import numpy as np
from sklearn.metrics import roc_auc_score


def dcg_score(y_true, y_score, k=10):
    order = np.argsort(y_score)[::-1]
    y_true = np.take(y_true, order[:k])
    gains = 2 ** y_true - 1
    discounts = np.log2(np.arange(len(y_true)) + 2)
    return np.sum(gains / discounts)


def ndcg_score(y_true, y_score, k=10):
    best = dcg_score(y_true, y_true, k)
    actual = dcg_score(y_true, y_score, k)
    return actual / best


def mrr_score(y_true, y_score):
    order = np.argsort(y_score)[::-1]
    y_true = np.take(y_true, order)
    rr_score = y_true / (np.arange(len(y_true)) + 1)
    return np.sum(rr_score) / np.sum(y_true)


def scoring(truth_f, sub_f):
    aucs = []
    mrrs = []
    ndcg5s = []
    ndcg10s = []
    for truth, sub in zip(truth_f, sub_f):
        ta = truth.strip().split(" ")
        sa = sub.strip().split(" ")
        assert ta[0] == sa[0]
        y_true = np.array(eval(ta[1]), dtype=float)
        y_score = 1.0 / np.array(eval(sa[1]), dtype=float)
        aucs.append(roc_auc_score(y_true, y_score))
        mrrs.append(mrr_score(y_true, y_score))
        ndcg5s.append(ndcg_score(y_true, y_score, 5))
        ndcg10s.append(ndcg_score(y_true, y_score, 10))
    return np.array([np.mean(aucs), np.mean(mrrs), np.mean(ndcg5s), np.mean(ndcg10s)])
