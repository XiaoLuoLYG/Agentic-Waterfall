"""Wait for all assigned outcomes, freeze them, then run the official evaluator."""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

root = Path(__file__).resolve().parent
run = root/'run'
code = root/'frozen/code'
sys.path[:0] = [str(code/'methods/agentic-waterfall/recagent'),
                str(code/'experiments/agentic-waterfall/agentrecbench/scripts')]
from score import safe_predictions, load_components

def load(path):
    return json.loads(Path(path).read_text())

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def save(path, value):
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    os.replace(tmp, path)

def main():
    launch = load(root/'launch.json')
    while True:
        progress = load(run/'progress.json')
        if progress['status']=='completed':
            break
        if progress['status']!='running':
            raise SystemExit(f"Scoring waits for a complete run. Queue status {progress['status']}.")
        try:
            os.kill(launch['pid'],0)
        except ProcessLookupError:
            raise SystemExit('Queue exited before completing its assignment.')
        time.sleep(5)
    plan = load(root/'plan.json')
    assert digest(root/'plan.json') == launch['manifest_sha256'] == progress['manifest_sha256']
    journal = [json.loads(line) for line in (run/'outcomes.jsonl').read_text().splitlines()]
    by_id = {row['id']:row for row in journal}
    assert len(by_id)==len(journal)==len(plan['commands'])==600
    groups = {}
    for cmd in plan['commands']:
        outcome = by_id[cmd['id']]
        path = Path(outcome['result_path'])
        assert digest(path)==outcome['result_sha256'] and outcome['category'] in ('terminal','method_failure')
        public = Path(cmd['public_task'])
        assert digest(public)==cmd['input_sha256'][str(public)]
        result = load(path)
        assert result['task_id']==cmd['task_id'] and result['status']==outcome['status']
        group = groups.setdefault((cmd['method'],cmd['domain']),[])
        group.append(({'task_id':cmd['task_id'],'candidates':load(public)['candidate_list']},result,public))
    dest = root/'evaluation'
    dest.mkdir(exist_ok=False)
    save(dest/'predictions-frozen.json',{'manifest_sha256':launch['manifest_sha256'],
         'outcomes_sha256':digest(run/'outcomes.jsonl'),'outcomes':by_id})
    evaluator = load_components().RecommendationEvaluator()
    metrics = {}
    for method in ('recagent','i2agent'):
        metrics[method] = {}
        all_labels, all_predictions = [], []
        for domain in ('amazon','goodreads','yelp'):
            tasks, rows, paths = zip(*groups[method,domain])
            assert len(tasks)==100
            predictions, invalid = safe_predictions(tasks,rows)
            labels = [load(p.parent.parent/'groundtruth'/f"groundtruth_{task['task_id']}.json")['ground truth']
                      for p,task in zip(paths,tasks)]
            assert all(label in task['candidates'] for label,task in zip(labels,tasks))
            all_labels.extend(labels)
            all_predictions.extend(predictions)
            metrics[method][domain]={'assigned':len(tasks),
               'not_applicable':sum(row['status']=='not_applicable' for row in rows),'invalid_task_ids':invalid,
               'metrics':evaluator.calculate_hr_at_n(labels,predictions,0).__dict__}
        metrics[method]['all']={'assigned':len(all_labels),
           'metrics':evaluator.calculate_hr_at_n(all_labels,all_predictions,0).__dict__}
    save(dest/'metrics.json',{'predictions_freeze_sha256':digest(dest/'predictions-frozen.json'),
         'denominator':'All official assigned tasks including failures and NA','methods':metrics})
    print(f"Scored {len(journal)} frozen assignments at {dest/'metrics.json'}.")

if __name__=='__main__':
    main()
