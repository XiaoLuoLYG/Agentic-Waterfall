import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
sys.path.insert(0,str(HERE.parent))
spec=importlib.util.spec_from_file_location('formal_fixed',HERE/'run_fixed.py')
fixed=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixed)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

class RetryTest(unittest.TestCase):
    def run_case(self,statuses,expected):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);methods=root/'methods/agentic-waterfall';(methods/'clawrec').mkdir(parents=True)
            (methods/'clawrec/fixed_candidates.mjs').write_text('method');(methods/'paper-reproductions-run.mjs').write_text('runner')
            base=root/'formal/fixed-candidates/mind/clawrec';task=base/'task-000000';task.mkdir(parents=True)
            raw=b'{"observation":{"decision_id":"case-1"}}\n';(task/'public-input.jsonl').write_bytes(raw);inp=root/'input.jsonl';inp.write_bytes(raw)
            (base/'manifest.json').write_text(json.dumps({'input_sha256':digest(raw),'runner_sha256':digest(b'runner'),'method_source_sha256':digest(b'method')}))
            (root/'experiment-plan.json').write_text(json.dumps({'jobs':[{'dataset':'mind','method':'clawrec','tasks':1,'input':str(inp),'input_sha256':digest(raw)}]}))
            outcomes=iter(statuses)
            def fake(command,**kwargs):
                dest=Path(command[5]);dest.mkdir();status=next(outcomes)
                (dest/'result.json').write_text(json.dumps({'status':status,'error':'invalid ranking' if status=='failed' else None}))
                return type('Process',(),{'stdout':'','stderr':''})()
            fixed.STOP.clear()
            with patch.object(fixed,'ROOT',root),patch.object(fixed,'METHODS',methods),patch.object(fixed.subprocess,'run',fake),patch.object(sys,'argv',['run_fixed.py','--workers','1']):
                fixed.main()
            events=[json.loads(x)['outcome'] for x in (root/'formal/fixed-events.jsonl').read_text().splitlines()]
            self.assertEqual(events,expected)
            self.assertEqual((task/'run').is_symlink(),statuses[-1]=='submitted')

    def test_one_invalid_output_is_retried(self):
        self.run_case(['failed','submitted'],['retrying_output','submitted'])

    def test_repeated_invalid_output_stops_without_final_result(self):
        self.run_case(['failed','failed'],['retrying_output','method_failure'])
