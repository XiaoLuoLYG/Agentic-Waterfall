"""Validate and replay one authored Waterfall example. No model or network calls.
Usage: python3 replay_complete_example.py
This is a research-fixture checker, not the demo's production execution layer.
"""
import copy
import hashlib
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
KINDS = {"acquire", "recommend", "update_state", "respond", "idle"}
PARAMS = {
    "acquire": {"source_ids", "mode", "query", "target_id", "content_types", "constraint_refs", "limit"},
    "recommend": {"ordered_item_ids", "delivery"},
    "update_state": {"base_version", "edits"},
    "respond": {"kind", "text", "target_refs"},
    "idle": {"mode", "task_id"},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def instant(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def digest(value):
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode()).hexdigest()


def parse_output(raw, observation):
    """Parse data only; never eval model text or turn it into shell commands."""
    output = json.loads(raw)
    require(isinstance(output, dict), "output must be an object")
    require(output.get("decision_id") == observation["decision_id"], "wrong decision")
    actions = output.get("actions")
    require(isinstance(actions, list) and bool(actions), "actions must be nonempty")
    ids = [a.get("action_id") for a in actions if isinstance(a, dict)]
    require(len(ids) == len(actions) and all(isinstance(x, str) and x for x in ids), "invalid action IDs")
    require(len(set(ids)) == len(ids), "duplicate action IDs")
    require(sum(a.get("kind") == "update_state" for a in actions) <= 1, "multiple state patches")
    known = {x["id"] for x in observation["dialogue"] + observation["behavior_events"]}
    known |= {x["id"] for x in observation["user_state"]["records"]}
    known |= {x["action_id"] for x in observation["environment"]["tool_results"]}
    arrived = {x["id"] for x in observation["environment"]["candidate_pool"]}
    sources = {s["source_id"]: s for s in observation["environment"]["source_catalog"]}
    seen = set()
    for action in actions:
        kind = action.get("kind")
        require(kind in KINDS, "unknown action")
        require(isinstance(action.get("evidence_refs"), list), "missing evidence refs")
        require(set(action["evidence_refs"]) <= known, "unknown evidence")
        deps = action.get("depends_on")
        require(isinstance(deps, list) and set(deps) <= seen, "dependency must precede its action")
        args = action.get("arguments")
        require(isinstance(args, dict) and PARAMS[kind] <= args.keys(), "missing arguments")
        if kind == "recommend":
            ordered = args["ordered_item_ids"]
            require(isinstance(ordered, list) and bool(ordered), "empty slate")
            require(len(ordered) == len(set(ordered)), "duplicate item in slate")
            require(set(ordered) <= arrived, "recommendation contains an unseen item")
            require(len(ordered) <= observation["environment"]["limits"]["max_recommend_items"], "slate too long")
            require(args["delivery"] in {"append", "replace_pending"}, "unknown delivery")
        elif kind == "acquire":
            require(isinstance(args["source_ids"], list) and bool(args["source_ids"]), "empty sources")
            require(isinstance(args["limit"], int) and not isinstance(args["limit"], bool) and args["limit"] > 0, "bad limit")
            for sid in args["source_ids"]:
                require(sid in sources and sources[sid]["status"] == "available", "unavailable source")
                require(args["mode"] in sources[sid]["modes"], "unsupported mode")
                require(bool(args["content_types"]) and set(args["content_types"]) <= set(sources[sid]["content_types"]), "unsupported type")
            if args["mode"] == "search":
                require(isinstance(args["query"], str) and bool(args["query"].strip()), "missing search query")
        elif kind == "update_state":
            require(args["base_version"] == observation["user_state"]["version"], "stale state")
            require(isinstance(args["edits"], list) and bool(args["edits"]), "empty patch")
        elif kind == "idle":
            require(args["mode"] in {"keep", "wait", "end_task"}, "unknown idle mode")
        elif kind == "respond":
            require(args["kind"] in {"answer", "explain", "clarify"} and isinstance(args["text"], str), "invalid response")
        seen.add(action["action_id"])
    return output


def replay(bundle):
    state = copy.deepcopy(bundle["initial_snapshot"]["user_state"])
    pool, receipts, seen_actions = {}, [], set()
    world = bundle["environment_snapshot"]
    corpus = world["corpus"]
    all_events, all_dialogue = bundle["event_log"], bundle["dialogue_log"]
    final = bundle["final_snapshot"]
    require(not bundle["metadata"]["eligible_for_analysis"], "illustration must not be research evidence")
    require(bundle["run_meta"]["model"]["invoked"] is False, "this fixture must not claim model execution")
    for item in corpus:
        require(hashlib.sha256(item["text"].encode()).hexdigest() == item["content_sha256"], "content hash mismatch")
    require(hashlib.sha256(bundle["run_meta"]["system_prompt"].encode()).hexdigest() == bundle["run_meta"]["system_prompt_sha256"], "prompt hash mismatch")
    for step in bundle["decisions"]:
        inp = step["input"]
        cutoff = instant(inp["observed_at"])
        require(digest(inp) == step["input_sha256"], "input hash mismatch")
        require(hashlib.sha256(step["raw_output"].encode()).hexdigest() == step["raw_output_sha256"], "output hash mismatch")
        require(set(inp) == {"schema_version", "decision_id", "user_id", "session_id", "observed_at", "trigger", "dialogue", "behavior_events", "user_state", "environment"}, "unexpected input field")
        require(inp["behavior_events"] == [e for e in all_events if instant(e["available_at"]) <= cutoff], "missing or future event")
        require(inp["dialogue"] == [m for m in all_dialogue if instant(m["available_at"]) <= cutoff], "missing or future dialogue")
        require(inp["user_state"] == state, "state snapshot mismatch")
        require(inp["environment"]["candidate_pool"] == list(pool.values()), "candidate snapshot mismatch")
        require(inp["environment"]["tool_results"] == receipts, "receipt snapshot mismatch")
        require(inp["environment"]["source_catalog"] == world["source_catalog"], "source catalog mismatch")
        visible = [w["item_id"] for w in bundle["feedback_windows"] if instant(w["started_at"]) <= cutoff < instant(w["observation_end_at"])]
        last_slate = next((s for s in reversed(bundle["slates"]) if instant(s["available_at"]) <= cutoff), None)
        queued = [] if last_slate is None else [i for i in last_slate["item_ids"] if not any(e["type"] == "exposure" and e["item_id"] == i and e["payload"]["slate_id"] == last_slate["slate_id"] for e in inp["behavior_events"])]
        # shortcut: this fixture uses one append on an empty queue, then replace_pending;
        # general interleaved append/slate replay belongs to the future collection runner.
        require(inp["environment"]["feed"] == {"visible_item_ids": visible, "queued_item_ids": queued}, "feed mismatch")
        out = parse_output(step["raw_output"], inp)
        require(out == step["parsed_output"] and step["validation"] == {"valid": True, "errors": []}, "parse trace mismatch")
        require(len(out["actions"]) == len(step["execution_results"]), "missing receipt")
        for action, receipt in zip(out["actions"], step["execution_results"]):
            aid, kind, args = action["action_id"], action["kind"], action["arguments"]
            require(aid not in seen_actions, "action executed twice")
            require(aid == receipt["action_id"] and receipt["status"] == "success" and receipt["error"] is None, "fixture receipt mismatch")
            require(cutoff <= instant(receipt["started_at"]) <= instant(receipt["available_at"]), "receipt time mismatch")
            for dep in action["depends_on"]:
                parent = next(r for r in receipts if r["action_id"] == dep)
                require(instant(parent["available_at"]) <= instant(receipt["started_at"]), "dependency not finished")
            if kind == "update_state":
                revised = copy.deepcopy(state)
                for edit in args["edits"]:
                    if edit["op"] == "upsert":
                        record = copy.deepcopy(edit["record"])
                        record["updated_at"] = receipt["available_at"]
                        revised["records"] = [r for r in revised["records"] if r["id"] != record["id"]] + [record]
                    elif edit["op"] == "set_status":
                        record = next(r for r in revised["records"] if r["id"] == edit["record_id"])
                        record.update(status=edit["status"], updated_at=receipt["available_at"])
                    else:
                        raise ValueError("unknown state edit")
                revised["version"] += 1
                state = revised
                require(receipt["result"] == {"state_version": state["version"]}, "state receipt mismatch")
            elif kind == "acquire":
                require(set(args["constraint_refs"]) <= {r["id"] for r in state["records"]}, "unknown constraint")
                candidates = [c for c in corpus if c["source_id"] in args["source_ids"] and c["content_type"] in args["content_types"]]
                if args["mode"] == "hot":
                    ids = sum([world["retrieval_rules"]["hot"].get(s, []) for s in args["source_ids"]], [])
                    candidates = [c for c in candidates if c["id"] in ids]
                else:
                    terms = args["query"].split()
                    candidates = [c for c in candidates if any(term in c["title"] + " " + c["text"] + " " + " ".join(c["tags"]) for term in terms)]
                fetched = [{**c, "available_at": receipt["available_at"], "retrieval_action_id": aid, "snapshot_id": world["snapshot_id"]} for c in candidates[:args["limit"]]]
                require(receipt["result"]["items"] == fetched, "query replay mismatch")
                for item in fetched:
                    pool[item["id"]] = item
            elif kind == "recommend":
                slate = next(s for s in bundle["slates"] if s["action_id"] == aid)
                require(slate["item_ids"] == args["ordered_item_ids"], "slate mismatch")
                require(receipt["result"] == {"slate_id": slate["slate_id"], "queued_item_ids": slate["item_ids"]}, "queue receipt mismatch")
            elif kind == "idle":
                require(receipt["result"] == args, "idle receipt mismatch")
            else:
                msg = next(m for m in all_dialogue if m["id"] == receipt["result"]["message_id"])
                require(msg["role"] == "assistant" and msg["text"] == args["text"], "reply not recorded")
            receipts.append(receipt)
            seen_actions.add(aid)
        require(step["state_after"] == state, "post-state mismatch")
    require(state == final["user_state"], "final state mismatch")
    require(final["in_flight"] == [], "unfinished tools not accounted for")
    end = next(e for e in all_events if e["id"] == final["termination_event_id"])
    require(end["type"] == "session_end" and end["payload"]["reason"] == final["termination_reason"], "missing session end")
    exposure_events = [e for e in all_events if e["type"] == "exposure"]
    for window in bundle["feedback_windows"]:
        e = next(e for e in exposure_events if e["exposure_id"] == window["exposure_id"])
        slate = next(s for s in bundle["slates"] if s["slate_id"] == window["slate_id"])
        require(slate["item_ids"][window["position"] - 1] == window["item_id"] == e["item_id"], "exposure position mismatch")
        feedback = [x["id"] for x in all_events if x["exposure_id"] == window["exposure_id"] and x["type"] not in {"exposure", "exposure_end"}]
        require(feedback == window["feedback_event_ids"], "feedback linkage mismatch")
        require(window["observation_status"] == "complete" and instant(window["observation_end_at"]) >= instant(window["started_at"]), "window mismatch")
    labels = bundle["evaluation_private"]
    require(instant(labels["assessed_at"]) > instant(final["ended_at"]), "survey timestamp mismatch")
    target = next(m for m in all_dialogue if m["id"] == labels["adaptation_target"]["message_id"])
    judged_useful = {x["item_id"] for x in labels["adaptation_target"]["item_labels"] if x["satisfies_request"]}
    first = min((e for e in exposure_events if instant(e["occurred_at"]) > instant(target["occurred_at"]) and e["item_id"] in judged_useful), key=lambda e: instant(e["occurred_at"]))
    require(first["exposure_id"] == labels["expected_checks"]["first_matching_exposure_id"], "adaptation exposure mismatch")
    require(pool[first["item_id"]]["content_type"] == "article", "wrong adapted modality")
    unexposed = set(labels["expected_checks"]["unexposed_items"])
    require(unexposed.isdisjoint(e["item_id"] for e in exposure_events), "unexposed item got a false exposure")
    return {"data_origin": bundle["metadata"]["data_origin"], "eligible_for_analysis": False,
            "decisions": len(bundle["decisions"]), "actions": len(seen_actions),
            "source_calls": sum(len(r["result"].get("source_calls", [])) for r in receipts),
            "actual_exposures_in_example": len(exposure_events),
            "adaptation_seconds_in_authored_timeline": (instant(first["occurred_at"]) - instant(target["occurred_at"])).total_seconds(),
            "authored_usefulness_rating": labels["questions"][0]["answer"],
            "real_world_photography_success": labels["real_world_outcome"]["answer"]}


def negative_checks(bundle):
    step = bundle["decisions"][1]
    raw, inp = step["raw_output"], step["input"]
    bad_id = json.loads(raw)
    bad_id["actions"][0]["arguments"]["ordered_item_ids"] = ["not_returned_by_any_tool"]
    for bad in ["{broken", json.dumps(bad_id)]:
        try:
            parse_output(bad, inp)
        except (ValueError, TypeError, KeyError):
            pass
        else:
            raise AssertionError("invalid output accepted")
    patch = bundle["decisions"][2]
    stale = json.loads(patch["raw_output"])
    stale["actions"][0]["arguments"]["base_version"] = 999
    try:
        parse_output(json.dumps(stale), patch["input"])
    except ValueError:
        pass
    else:
        raise AssertionError("stale memory update accepted")


if __name__ == "__main__":
    bundle = json.loads((ROOT / "complete-example.json").read_text())
    summary = replay(bundle)
    negative_checks(bundle)
    print(json.dumps({"validation": "passed", "negative_checks": 3, "summary": summary}, ensure_ascii=False, indent=2))

