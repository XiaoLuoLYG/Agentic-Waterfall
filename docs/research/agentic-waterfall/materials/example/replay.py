"""Offline replay with real async dispatch over authored fixture tools. No model/network.
Run: python3 docs/research/agentic-waterfall/materials/example/replay.py
--write refreshes episode.json from scenario.json; default verifies the saved trace.
"""
import asyncio, copy, hashlib, json, sys
from datetime import datetime, timedelta
from pathlib import Path
ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent / "archive" / "agentic-feed-v1"))
from replay_complete_example import parse_output, require, instant
def dump(x): return json.dumps(x, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
def stamp(t): return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")

class FixtureRunner:
    def __init__(self, scenario):
        self.s = scenario
        self.state = {"version": 0, "records": []}
        self.pool, self.receipts, self.slates, self.responses = {}, [], [], []
        self.active_fetches = self.peak_fetches = 0
        self.done = set()

    def feed(self, cutoff):
        events = [e for e in self.s["event_log"] if instant(e["available_at"]) <= cutoff]
        opened = {e["exposure_id"]: e for e in events if e["type"] == "exposure"}
        closed = {e["exposure_id"] for e in events if e["type"] == "exposure_end"}
        visible = [e["item_id"] for xid,e in opened.items() if xid not in closed]
        latest = self.slates[-1] if self.slates else None
        queue = [] if latest is None else [x for x in latest["item_ids"] if not any(e["item_id"] == x and e["payload"]["slate_id"] == latest["slate_id"] for e in opened.values())]
        return {"visible_item_ids": visible, "queued_item_ids": queue}

    def observe(self, step):
        cutoff = instant(step["observed_at"])
        return {"schema_version":"awf-io/0.1","decision_id":step["decision_id"],"user_id":"示例用户","session_id":"一次手机摄影浏览",
          "observed_at":step["observed_at"],"trigger":step["trigger"],
          "dialogue":[m for m in self.s["user_dialogue"]+self.responses if instant(m["available_at"])<=cutoff],
          "behavior_events":[e for e in self.s["event_log"] if instant(e["available_at"])<=cutoff],
          "user_state":copy.deepcopy(self.state),
          "environment":{"snapshot_id":self.s["environment_snapshot"]["snapshot_id"],"candidate_pool":list(self.pool.values()),
            "feed":self.feed(cutoff),"source_catalog":self.s["environment_snapshot"]["source_catalog"],
            "in_flight":[],"tool_results":copy.deepcopy(self.receipts),"limits":{"max_recommend_items":3}}}

    async def execute(self, action, start):
        kind,args=action["kind"],action["arguments"]
        duration=.15
        if kind=="acquire":
            self.active_fetches+=1
            self.peak_fetches=max(self.peak_fetches,self.active_fetches)
            await asyncio.sleep(0)  # Yield so independent source calls truly overlap.
            duration=.9 if "视频来源" in args["source_ids"] else .4
            world=self.s["environment_snapshot"]
            items=[c for c in world["corpus"] if c["source_id"] in args["source_ids"] and c["content_type"] in args["content_types"]]
            if args["mode"]=="hot":
                hot=sum([world["retrieval_rules"]["hot"].get(s,[]) for s in args["source_ids"]],[])
                items=[c for c in items if c["id"] in hot]
            else:
                terms=args["query"].split()
                items=[c for c in items if any(t in c["title"]+" "+c["text"]+" "+" ".join(c["tags"]) for t in terms)]
            require(set(args["constraint_refs"])<={r["id"] for r in self.state["records"]},"unknown constraint")
            end=stamp(start+timedelta(seconds=duration))
            items=[{**copy.deepcopy(c),"available_at":end,"retrieval_action_id":action["action_id"],"snapshot_id":world["snapshot_id"]} for c in items[:args["limit"]]]
            for c in items:self.pool[c["id"]]=c
            result={"items":items,"source_calls":[{"source_id":s,"requested_query":args["query"],"executed_query":args["query"],"status":"success"} for s in args["source_ids"]]}
            self.active_fetches-=1
        elif kind=="update_state":
            require(args["base_version"]==self.state["version"],"stale state at commit")
            revised=copy.deepcopy(self.state)
            for edit in args["edits"]:
                if edit["op"]=="upsert":
                    r={**copy.deepcopy(edit["record"]),"updated_at":stamp(start+timedelta(seconds=duration))}
                    revised["records"]=[x for x in revised["records"] if x["id"]!=r["id"]]+[r]
                elif edit["op"]=="set_status":
                    r=next(r for r in revised["records"] if r["id"]==edit["record_id"])
                    r.update(status=edit["status"],updated_at=stamp(start+timedelta(seconds=duration)))
                else:raise ValueError("unknown patch")
            revised["version"]+=1;self.state=revised
            result={"state_version":revised["version"]}
        elif kind=="recommend":
            require(set(args["ordered_item_ids"])<=self.pool.keys(),"unseen item")
            # shortcut: authored scenario uses initial append then replace_pending;
            # arbitrary overlapping queued slates need the product queue implementation.
            sid=self.s["slate_names"][action["action_id"]]
            self.slates.append({"slate_id":sid,"action_id":action["action_id"],"item_ids":args["ordered_item_ids"],"available_at":stamp(start+timedelta(seconds=duration))})
            result={"slate_id":sid,"queued_item_ids":args["ordered_item_ids"]}
        elif kind=="respond":
            mid="助手回复："+action["action_id"]
            end=stamp(start+timedelta(seconds=duration))
            self.responses.append({"id":mid,"role":"assistant","text":args["text"],"occurred_at":end,"available_at":end,"target_refs":args["target_refs"]})
            result={"message_id":mid,"text":args["text"]}
        else:result=copy.deepcopy(args)
        return {"action_id":action["action_id"],"status":"success","started_at":stamp(start),"available_at":stamp(start+timedelta(seconds=duration)),"result":result,"error":None}

    async def run(self):
        trace=[]
        for step in self.s["steps"]:
            inp=copy.deepcopy(self.observe(step))
            out=parse_output(step["raw_output"],inp)
            todo=copy.deepcopy(out["actions"]); local_done=set();groups=[];receipts=[]
            cursor=instant(step["observed_at"])+timedelta(seconds=.1)
            while todo:
                ready=[a for a in todo if set(a["depends_on"])<=local_done]
                require(bool(ready),"cycle or missing dependency")
                require(not any(a["action_id"] in self.done for a in ready),"duplicate execution")
                groups.append({"started_at":stamp(cursor),"parallel_actions":[a["action_id"] for a in ready]})
                batch=await asyncio.gather(*(self.execute(a,cursor) for a in ready))
                batch.sort(key=lambda r:r["available_at"])
                self.receipts.extend(batch);receipts.extend(batch)
                for a in ready:local_done.add(a["action_id"]);self.done.add(a["action_id"]);todo.remove(a)
                cursor=max(instant(r["available_at"]) for r in batch)
            trace.append({"input":inp,"input_sha256":hashlib.sha256(dump(inp).encode()).hexdigest(),
              "raw_output":step["raw_output"],"parsed_output":out,"validation":{"valid":True,"errors":[]},
              "dispatch_groups":groups,"execution_results":receipts,"state_after":copy.deepcopy(self.state)})
        require(self.peak_fetches==2,"parallel acquisition was not exercised")
        for window in self.s["feedback_windows"]:
            slate=next(x for x in self.slates if x["slate_id"]==window["slate_id"])
            require(slate["item_ids"][window["position"]-1]==window["item_id"],"exposure mismatch")
        return {"metadata":self.s["metadata"],"run_meta":self.s["run_meta"],"environment_snapshot":self.s["environment_snapshot"],
          "decisions":trace,"event_log":self.s["event_log"],"dialogue_log":self.s["user_dialogue"]+self.responses,
          "slates":self.slates,"feedback_windows":self.s["feedback_windows"],
          "final_snapshot":{"state":self.state,"feed":self.feed(instant(self.s["metadata"]["ended_at"])+timedelta(seconds=1)),"termination_reason":"user_exit"},
          "validation_summary":{"decisions":len(trace),"max_parallel_source_calls":self.peak_fetches,"source_calls":sum(len(r["result"].get("source_calls",[])) for r in self.receipts),
             "timing_origin":"authored logical timestamps, not measured model/source latency"}}

async def main():
    scenario=json.loads((ROOT/"scenario.json").read_text())
    episode=await FixtureRunner(scenario).run()
    path=ROOT/"episode.json"
    if "--write" in sys.argv:path.write_text(json.dumps(episode,ensure_ascii=False,indent=2)+"\n")
    else:require(episode==json.loads(path.read_text()),"saved trace drift")
    # Meaningful boundary checks on the JSON-to-tools interface.
    inp=episode["decisions"][1]["input"]
    bad=json.loads(episode["decisions"][1]["raw_output"])
    bad["actions"][0]["arguments"]["ordered_item_ids"]=["工具从未返回的虚构内容"]
    for raw in ["{not-json",json.dumps(bad)]:
        try:parse_output(raw,inp)
        except (ValueError,TypeError,KeyError):pass
        else:raise AssertionError("invalid output accepted")
    print(json.dumps({"validation":"passed",**episode["validation_summary"],"negative_checks":2},ensure_ascii=False,indent=2))
if __name__=="__main__":asyncio.run(main())

