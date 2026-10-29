"""Summarize actual, unique model receipts without exporting prompt content."""
import argparse,json,re
from pathlib import Path
from cost_reporting import summarize_usage

def collect_runs(paths):
    calls=[];seen=set();replayed=0;missing_results=0;failed_without_receipt=0;status={}
    for root in map(Path,paths):
        result_path=root/'result.json'
        if not result_path.exists():missing_results+=1;continue
        result=json.loads(result_path.read_text());label=result.get('status','unknown');status[label]=status.get(label,0)+1
        skip=set(result.get('replayed_stages',[]));fresh=0
        for p in sorted(root.glob('*.json')):
            n=p.name
            if not (n=='response.json' or n.startswith('response-') or n.endswith('.response.json') or n.endswith('.error.json')):continue
            data=json.loads(p.read_text());receipt=data.get('receipt',data);attempt=receipt.get('attempt_id')
            if not attempt:continue
            stage=re.fullmatch(r'response-(\d+)\.json',n)
            if stage and int(stage.group(1)) in skip:replayed+=1;continue
            if attempt in seen:continue
            seen.add(attempt);fresh+=1;calls.append({k:receipt.get(k) for k in ('attempt_id','status','requested_model','provider_response_model','usage','duration_ms')})
        if label=='failed' and fresh==0 and not skip:failed_without_receipt+=1
    count=len(calls) if not missing_results and not failed_without_receipt else None
    usage=summarize_usage([{'model_request_count':count,'model_calls':calls}])
    return {'runs':len(paths),'run_statuses':status,'replayed_receipts':replayed,'runs_missing_result':missing_results,'failed_runs_without_receipt':failed_without_receipt,'resource_usage':usage,'note':'counts unique saved non-replayed requests; cost and local computation need independent evidence'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--method',required=True);p.add_argument('--runs',nargs='+',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    result={'method':a.method,**collect_runs(a.runs)}
    with Path(a.output).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps(result,ensure_ascii=False))
if __name__=='__main__':main()
