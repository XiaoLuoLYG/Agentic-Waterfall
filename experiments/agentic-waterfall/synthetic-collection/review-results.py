"""Verify completed runs, compare their scores, and account for failed cases."""
import hashlib
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from statistics import mean


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checkpoint_key(row):
    return row["user"], row["round"]


def category(error):
    if re.search(r"request_gate_(?:call_deadline_exceeded|wait_exceeds_\d+s)", error):
        return "队列超时"
    if re.search(r"SIGINT|SIGTERM|api_request_aborted|api_draining|operation was aborted", error, re.I):
        return "中止"
    if "data_inspection_failed" in error:
        return "服务端内容审核"
    if re.search(r"Unpurchased|No verified flash API slot|model_http_(?:401|403)", error, re.I):
        return "API 权限"
    if re.search(r"429|timeout|transport|interrupted|model_http_50[234]", error, re.I):
        return "API 传输"
    return "方法或评分输出"


def failed_methods(analysis, run):
    for row in analysis["checkpoints"]:
        for method, item in row["methods"].items():
            if item["status"] == "failed":
                error = item.get("error") or "原因未记录"
                yield {"user": row["user"], "round": row["round"], "method": method,
                       "run_id": item["run_id"], "stage": run.name, "reason": category(error), "error": error}


def failed_labels(run):
    for path in (run / "comparison/studies").glob("*/*/labels/*.json"):
        label = read(path)
        if label["status"] in ("failed", "interrupted"):
            error = label.get("error") or "原因未记录"
            yield {"user": path.parents[2].name, "round": int(path.parents[1].name),
                   "question_id": label["question_id"], "mode": label["mode"],
                   "stage": run.name, "reason": category(error), "error": error}


def checked_labels(root, analysis, judge_model):
    statuses = Counter()
    for row in analysis["checkpoints"]:
        study = root / "comparison/studies" / row["user"] / str(row["round"])
        questions = read(study / "questions.json")
        for question in questions["ratings"] + questions["blind"]:
            label = read(study / "labels" / (question["id"] + ".json"))
            assert label["question_id"] == question["id"]
            assert label["material_sha256"] == question["material_sha256"]
            assert label["config_sha256"] == analysis["config_sha256"]
            statuses[label["status"]] += 1
            if label["status"] in ("answered", "unable"):
                assert label["provider_model"].lower() == judge_model.lower()
    coverage = analysis["coverage"]
    assert statuses["answered"] + statuses["unable"] == coverage["label_answers"]
    assert statuses["unavailable"] == coverage["label_protocol_unavailable"]
    assert sum(statuses.values()) == coverage["labels_total"] == coverage["labels_done"]


def checked_run(root):
    analysis = read(root / "comparison/analysis.json")
    plan = read(root / "plan.json")
    frozen = read(root / "comparison/manifest.json")["frozen"]
    coverage = analysis["coverage"]
    assert analysis["status"] == "completed" and analysis["integrity"]["passed"]
    assert coverage["done"] == coverage["total"] == plan["method_slots"]
    assert coverage["contexts_done"] == coverage["contexts_total"] == plan["checkpoints"]
    for checkpoint in analysis["checkpoints"]:
        for method, row in checkpoint["methods"].items():
            path = root / "comparison/runs" / checkpoint["user"] / str(checkpoint["round"]) / (method + ".json.gz")
            assert digest(path) == row["run_file_sha256"], f"Run hash mismatch: {path}"
    checked_labels(root, analysis, frozen["judge_model"]["name"])
    return analysis, plan, frozen


def dcg(row):
    cards = row["cards"]
    if len(cards) != 5 or any((card.get("interest") or {}).get("status") != "rated" for card in cards):
        return None
    return sum(card["interest"]["rating"] / math.log2(card["rank"] + 1) for card in cards)


def report(old_root, final_root):
    assert read(final_root / "progress.json")["status"] == "completed"
    old, old_plan, old_frozen = checked_run(old_root)
    new, new_plan, new_frozen = checked_run(final_root)
    for field in ("dataset_manifest_sha256", "comparison_cutoffs_sha256", "pools", "methods"):
        assert old_plan[field] == new_plan[field], field
    for field in ("dual_pools", "limits", "blind_protocol", "methods"):
        assert old_frozen[field] == new_frozen[field], field
    for field in ("method_model", "judge_model"):
        for key in ("name", "temperature", "thinking", "max_tokens"):
            before, after = old_frozen[field][key], new_frozen[field][key]
            assert before.lower() == after.lower() if key == "name" else before == after
    for rel in ("plan.json", "comparison/manifest.json", "comparison/analysis.json"):
        expected, = (expected for path, expected in new_plan["preserved"].items()
                     if path.endswith(f"/{rel}"))
        assert digest(old_root / rel) == expected, rel
    assert digest(old_root / "comparison/input-lineage.json") == digest(final_root / "comparison/input-lineage.json")
    assert new_frozen["routing"]["agent_starter_count"] == 0
    assert new_frozen["routing"]["bm25_bge_scope"] == "eligible_C0"
    assert set(new_frozen["routing"]["agent_base_search"]) == {"waterfall", "clawrec"}
    assert set(new_frozen["routing"]["extension_search_after_base"]) == {"waterfall", "clawrec"}
    assert new_frozen["routing"]["network_sources"] is False

    old_rows = {checkpoint_key(row): row for row in old["checkpoints"]}
    new_rows = {checkpoint_key(row): row for row in new["checkpoints"]}
    assert set(old_rows) == set(new_rows) and len(new_rows) == new_plan["checkpoints"]
    for key, row in old_rows.items():
        for field in ("subset", "input_sha256", "public_input_sha256", "captured_at"):
            assert row[field] == new_rows[key][field], (key, field)

    method_attempts = {}
    stage = final_root
    seen = set()
    while stage and stage not in seen:
        seen.add(stage)
        analysis = read(stage / "comparison/analysis.json")
        for row in failed_methods(analysis, stage):
            method_attempts.setdefault((row["user"], row["round"], row["method"], row["run_id"]), row)
        prior = read(stage / "plan.json").get("continued_from")
        stage = stage.parent / Path(prior).name if prior else None
    remaining_methods = list(failed_methods(new, final_root))
    remaining_labels = list(failed_labels(final_root))
    assert len(remaining_methods) == sum(row["failed"] for row in new["coverage"]["methods"].values())
    assert len(remaining_labels) == new["coverage"]["label_failures"]
    rerun_cases = {(row["user"], row["round"], row["method"]) for row in method_attempts.values()}
    successful_retries = sum(new_rows[user, round_]["methods"][method]["status"] == "submitted"
                             for user, round_, method in rerun_cases)
    names = {"waterfall": "Waterfall", "clawrec": "ClawRec", "i2agent": "i²Agent",
             "recagent": "RecAgent", "fixed-retrieval": "BM25+BGE"}
    before, after = (analysis["by_subset"]["all"] for analysis in (old, new))
    blind_counts = [summary["blind"]["outcomes"]["selected"] for summary in (before, after)]
    for analysis in (old, new):
        for subset, group in analysis["by_subset"].items():
            rows = [row for row in analysis["checkpoints"] if subset == "all" or row["subset"] == subset]
            ballots = [ballot for row in rows for ballot in row["blind"]]
            outcomes, votes = Counter(), Counter()
            for ballot in ballots:
                selected = ballot["selected_methods"]
                assert bool(selected) == (ballot["outcome"] == "selected")
                assert len(selected) == len(set(selected)) and set(selected) <= set(new["method_ids"])
                outcomes[ballot["outcome"]] += 1
                for method in selected:
                    votes[method] += 1 / len(selected)
            assert len(ballots) == group["blind"]["expected_choices"]
            for outcome, count in group["blind"]["outcomes"].items():
                assert outcomes[outcome] == count
            for method, value in group["blind"]["votes_by_method"].items():
                assert math.isclose(votes[method], value, abs_tol=1e-10)
            for method, metrics in group["methods"].items():
                scored = [dcg(row["methods"][method]) for row in rows]
                rated = [value for value in scored if value is not None]
                assert len(rated) == metrics["dcg_at_5_denominator"]
                if rated:
                    assert math.isclose(mean(rated), metrics["mean_dcg_at_5"], abs_tol=1e-10)
                interest = [card["interest"]["rating"] for row in rows for card in row["methods"][method]["cards"]
                            if (card.get("interest") or {}).get("status") == "rated"]
                assert len(interest) == metrics["rated_cards"]
                if interest:
                    assert math.isclose(mean(interest), metrics["mean_card_interest"], abs_tol=1e-10)
    score = lambda value: "—" if value is None else f"{value:.3f}"
    share = lambda votes, total: f"{votes / total:.1%}" if total else "—"
    lines = [
        "# Waterfall 合成数据主对比总表", "",
        f"两轮使用同一批 {len({key[0] for key in new_rows})} 名用户和 {len(new_rows)} 个检查点。"
        "已逐点核对公开输入、时间截点、候选池、方法预算、模型版本和盲评规则。", "",
        "旧轮使用共享的 20 条起始候选，Waterfall 和 ClawRec 可以追加检索。新轮两者从空候选开始，先搜小池，再按需扩展。"
        "BM25+BGE 在全部未浏览的小池条目上召回。RecAgent 和 i²Agent 使用各自协议要求的排序候选。"
        "新轮有效记录来自百炼与原网关，两段使用同名的 DeepSeek-V4.1-Flash-1017。", "",
        "| 方法 | 兴趣均分 旧 → 新 | DCG@5 旧 | **DCG@5 新** | 同检查点 DCG@5 差值 | 盲选得票占比 旧 → 新 | 完整五条 旧 → 新 |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for method in new["method_ids"]:
        old_metric, new_metric = (summary["methods"][method] for summary in (before, after))
        pairs = [(dcg(old_rows[key]["methods"][method]), dcg(new_rows[key]["methods"][method])) for key in old_rows]
        common = [b - a for a, b in pairs if a is not None and b is not None]
        votes = [share(summary["blind"]["votes_by_method"][method], count)
                 for summary, count in zip((before, after), blind_counts)]
        paired = f"{mean(common):+.3f}（{len(common)}）" if common else "—"
        lines.append(f"| {names[method]} | {score(old_metric['mean_card_interest'])} → {score(new_metric['mean_card_interest'])} | "
                     f"{score(old_metric['mean_dcg_at_5'])}（{old_metric['dcg_at_5_denominator']}） | "
                     f"**{score(new_metric['mean_dcg_at_5'])}**（{new_metric['dcg_at_5_denominator']}） | {paired} | "
                     f"{votes[0]} → {votes[1]} | {old_metric['complete_lists']} → {new_metric['complete_lists']} |")
    lines.extend(["", f"DCG@5 括号里是五条均获评分的检查点数。配对差值只取同一方法两轮都可评分的检查点。"
                  f"盲选得票占比的分母为实际选出卡片的票数，旧轮 {blind_counts[0]:,}，新轮 {blind_counts[1]:,}。", ""])
    for subset, name in (("behavior_ambiguity", "行为歧义"), ("interactive_revision", "交互修订")):
        left, right = (analysis["by_subset"][subset] for analysis in (old, new))
        changes = "，".join(f"{names[m]} {score(left['methods'][m]['mean_dcg_at_5'])} → {score(right['methods'][m]['mean_dcg_at_5'])}"
                            for m in new["method_ids"])
        lines.append(f"{name}有 {right['checkpoints']} 个检查点。DCG@5（旧 → 新）为 {changes}。")
    reasons = Counter(row["reason"] for row in remaining_methods)
    lines.extend(["", f"历次失败涉及 {len(rerun_cases)} 个方法检查点，其中 {successful_retries} 个在最终运行中提交了推荐。"
                  f"最终仍有 {len(remaining_methods)} 个方法失败和 {len(remaining_labels)} 个评分失败。"])
    if reasons:
        lines.append("最终方法失败包括" + "、".join(f"{reason} {count} 个" for reason, count in reasons.items()) + "。")
    ineligible = {names[m]: after["methods"][m]["method_status"]["not_applicable"] for m in new["method_ids"]
                  if after["methods"][m]["method_status"]["not_applicable"]}
    if ineligible:
        lines.append("、".join(f"{m} 有 {n} 个检查点缺少协议所需的历史" for m, n in ineligible.items()) + "。")
    lines.extend(["", "逐例原因和补跑去向见 failure-audit.json。表格支持本次候选访问协议下的比较。"
                  "模型服务的切换与候选协议变更都应随结果披露。", ""])
    print("\n".join(lines))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python3 review-results.py PREVIOUS_RUN_DIR FINAL_RUN_DIR")
    report(*(Path(path).resolve() for path in sys.argv[1:]))
