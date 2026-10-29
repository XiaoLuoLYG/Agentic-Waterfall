"""Finish authorized non-training data preparation after the verified download exits."""
import json,os,subprocess,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent;DATA=ROOT/'datasets/agentic-waterfall/kuairand-1k';status=HERE/'caption-finalization-status.json'
def save(value):status.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
def run(args,**kwargs):
    subprocess.run(args,cwd=ROOT,check=True,**kwargs)
def main():
    pid=int(sys.argv[1]);save({'status':'waiting_for_download','pid':pid,'training':False,'model_calls':0})
    while True:
        try:os.kill(pid,0)
        except ProcessLookupError:break
        time.sleep(15)
    try:
        manifest=DATA/'captions-full-20261029-manifest.json'
        if not manifest.exists() or not json.loads(manifest.read_text()).get('official_md5_verified'):raise RuntimeError('download did not complete with official checksum')
        run([sys.executable,str(HERE/'attach_captions.py')]);input_path=DATA/'model-36-caption-verified-v2/public-inputs.jsonl'
        with input_path.open('rb') as source,(HERE/'caption-36-preflight.log').open('wb') as log:
            run(['node',str(ROOT/'experiments/agentic-waterfall/kuairand/scripts/preflight.mjs')],stdin=source,stdout=log,stderr=subprocess.STDOUT)
        cohort=ROOT/'methods/agentic-waterfall/protocols/kuairand-common-35-caption-v2-20261029'
        run([sys.executable,str(HERE/'cohort.py'),'--input',str(input_path),'--output',str(cohort)])
        old=json.loads((ROOT/'methods/agentic-waterfall/protocols/kuairand-common-35-basic-v2-20261029/manifest.json').read_text());new=json.loads((cohort/'manifest.json').read_text())
        if old['selected_task_ids']!=new['selected_task_ids'] or new['eligible']!=35 or new['ineligible']!=1:raise ValueError('caption addition changed the frozen cohort')
        for method in ('clawrec','i2agent','mars','recbot','generic-agent'):
            out=ROOT/f'methods/agentic-waterfall/{method}/runs/kuairand-35-caption-preflight-20261029'
            run([sys.executable,str(ROOT/'methods/agentic-waterfall/batch_public.py'),'--input',str(cohort/'inputs-eligible.jsonl'),'--method',method,'--dataset','kuairand','--count','35','--output',str(out)])
        save({'status':'data_and_preflight_complete','tasks':36,'common_cohort':35,'ineligible':1,'labels_read':False,'training':False,'model_calls':0,'live_caption_validation':'still_required'})
    except Exception as e:
        save({'status':'failed','error':str(e),'training':False,'model_calls':0});raise
if __name__=='__main__':main()
