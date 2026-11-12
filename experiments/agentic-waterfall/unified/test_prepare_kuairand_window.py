import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'kuairand/scripts'))
from protocol import evaluate


class KuaiRandWindowTest(unittest.TestCase):
    def test_relocated_source_keeps_last_512_events_and_original_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            full = Path(directory) / 'full'
            cases = full / 'cases'
            cases.mkdir(parents=True)
            output = Path(directory) / 'window'
            task = 'kuairand:1:test:standard'
            name = 'kuairand-1-test-standard.jsonl'
            candidates = [{'id': f'kuairand:{i}'} for i in range(101)]
            history = [{'id': str(i)} for i in range(514)]
            observation = dict(decision_id=task, behavior_events=history,
                               environment={'candidate_pool': candidates})
            row = dict(observation=observation, run_meta={'content_scope': 'complete text'})
            raw = (json.dumps(row) + '\n').encode()
            (cases / name).write_bytes(raw)
            assignment = dict(task_id=task, input_path='/archived/machine/cases/' + name,
                              input_line=0, input_offset=0, input_bytes=len(raw),
                              history_events=len(history), sha256=hashlib.sha256(raw).hexdigest())
            (full / 'assignment.jsonl').write_text(json.dumps(assignment) + '\n')

            run = subprocess.run([sys.executable, str(HERE / 'prepare_kuairand_window.py'),
                                  '--full-source', str(full), '--output', str(output)],
                                 capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            data = (output / 'inputs' / name).read_bytes()
            projected = json.loads(data)
            self.assertEqual(projected['observation']['behavior_events'], history[-512:])
            self.assertEqual(projected['observation']['environment']['candidate_pool'], candidates)
            self.assertEqual(projected['run_meta'], {
                'content_scope': 'complete text', 'history_policy': 'recent-512-visible-events-v1',
                'archived_history_events': 514,
            })
            recorded = json.loads((output / 'assignment.json').read_text())['cases'][0]
            self.assertEqual(recorded['sha256'], hashlib.sha256(data).hexdigest())
            self.assertEqual(recorded['retained_history_count'], 512)
            self.assertEqual(recorded['candidate_ids'], [item['id'] for item in candidates])

    def test_failed_delivery_counts_zero_even_when_target_is_first_candidate(self):
        tasks = [dict(task_id='t', eligible=True, split='test', stratum='standard',
                      candidate_ids=[1, 2], target=1)]
        score = evaluate(tasks, {'t': {'status': 'failed'}})
        self.assertEqual(score['groups']['all']['n'], 1)
        self.assertEqual(score['groups']['all']['invalid'], 1)
        self.assertEqual(score['groups']['all']['Hit@10'], 0)
        self.assertEqual(score['groups']['all']['NDCG@10'], 0)


if __name__ == '__main__':
    unittest.main()
