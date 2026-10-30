"""One public AgentRecBench task through the candidate-complete RecAgent adapter."""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime,timezone
from pathlib import Path
from bench_paths import resolve_paths

ROOT=Path(__file__).resolve().parents[3]
EXPERIMENT=ROOT/'experiments/agentic-waterfall/agentrecbench'
CLIENT=ROOT/'experiments/agentic-waterfall/shared/model-call.mjs'
os.environ['TIKTOKEN_CACHE_DIR']=str(Path(__file__).parent/'cache')
sys.path.insert(0,str(EXPERIMENT/'scripts'))
from official_components import load_components
from adapter import load_task, validate_ranking
from recagent_all_candidates import load_recagent_all_candidates


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--task-id',type=int,default=0);parser.add_argument('--output',required=True);parser.add_argument('--domain',choices=['amazon','yelp','goodreads'],default='amazon');parser.add_argument('--full-tasks',action='store_true');parser.add_argument('--index');parser.add_argument('--allow-missing-metadata',action='store_true')
    args=parser.parse_args();
    if args.domain=='yelp' and args.full_tasks:args.allow_missing_metadata=True
    out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
    paths=resolve_paths(args.domain,args.full_tasks);taskdir=paths['taskdir']
    if paths['requires_index'] and not args.index:raise ValueError('complete task set requires a validated index')
    if args.full_tasks and not (taskdir/'download-manifest.json').exists():raise ValueError('full task set not verified')
    task=load_task(taskdir/f'tasks/task_{args.task_id}.json')
    if args.index:
        sys.path.insert(0,str(ROOT/'methods/agentic-waterfall/agentrecbench-data'))
        from indexed_tool import IndexedTool
        tool=IndexedTool(paths['data'],args.index,taskdir)
    else:tool=load_components().InteractionTool(str(paths['data']),str(taskdir))
    base_tool=tool
    if args.allow_missing_metadata:
        from tool_adapter import MissingItemAdapter
        tool=MissingItemAdapter(base_tool)
    original=load_recagent_all_candidates()
    def call(messages,temperature=0.1,max_tokens=1000,**_):
        req=out/'request.json';resp=out/'response.json'
        with req.open('x') as f:json.dump({'messages':messages,'temperature':temperature,'max_tokens':max_tokens},f,ensure_ascii=False,indent=2)
        # Cover the slot wait, shared gate, 60-second baseline HTTP call, and final accounting.
        proc=subprocess.run(['node',str(CLIENT),'--experiment','method-deployment','--request',str(req),'--output',str(resp)],capture_output=True,text=True,timeout=300)
        (out/'process.log').write_text(proc.stdout+proc.stderr)
        if not resp.exists():raise RuntimeError('missing receipt')
        receipt=json.loads(resp.read_text())
        if proc.returncode or receipt.get('status')!='success':raise RuntimeError(receipt.get('error','model failed'))
        if receipt.get('finish_reason')=='length':raise RuntimeError('model response truncated')
        return receipt['content']
    result={'method':'RecAgent-candidate-complete','dataset':f'AgentRecBench {args.domain} short_term',
            'task_id':args.task_id,'kind':'single_sample_live_smoke_no_metrics','status':'failed',
            'started_at':datetime.now(timezone.utc).isoformat()}
    try:
        agent=original.RecAgentAllCandidates(call);agent.set_interaction_tool(tool);agent.insert_task(task)
        result['ordered_item_ids']=validate_ranking(agent.workflow(),task.candidate_list)
        result['status']='submitted'
    except Exception as error:result['error']=f'{type(error).__name__}: {error}'
    if args.allow_missing_metadata:result['missing_item_ids']=tool.missing_item_ids;result['missing_user_ids']=tool.missing_user_ids;result['adaptation']='missing metadata represented by public IDs only'
    if hasattr(base_tool,'close'):base_tool.close()
    result['finished_at']=datetime.now(timezone.utc).isoformat()
    with (out/'result.json').open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({k:v for k,v in result.items() if k!='ordered_item_ids'}))
    if result['status']!='submitted':raise SystemExit(1)

if __name__=='__main__':main()
