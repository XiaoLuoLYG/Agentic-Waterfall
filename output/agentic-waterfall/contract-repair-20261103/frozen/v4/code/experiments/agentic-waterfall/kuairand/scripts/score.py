#!/usr/bin/env python3
import argparse,json,pathlib
from protocol import evaluate
def main():
    p=argparse.ArgumentParser();p.add_argument('--tasks',type=pathlib.Path,required=True);p.add_argument('--predictions',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
    tasks=[json.loads(x) for x in a.tasks.read_text().splitlines() if x.strip()]
    predictions={}
    for line in a.predictions.read_text().splitlines():
        r=json.loads(line);key=r.get('task_id',r.get('decision_id'))
        if not key:raise ValueError('prediction requires task_id or decision_id')
        if key in predictions:raise ValueError('duplicate prediction task')
        predictions[key]=r
    result=evaluate(tasks,predictions);a.output.write_text(json.dumps(result,indent=2));print(json.dumps(result['groups'],indent=2))
if __name__=='__main__':main()
