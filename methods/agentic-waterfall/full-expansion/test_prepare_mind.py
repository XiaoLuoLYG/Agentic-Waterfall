import json
import sqlite3
import tempfile
import subprocess
import sys
import unittest
from pathlib import Path
from prepare_mind import build_index


def sample(name, history):
    return {'observation': {'decision_id': name, 'behavior_events': [{'item': {'id': str(i)}} for i in range(history)],
                            'environment': {'candidate_pool': [{'id': 'a'}]}}}


class IndexTests(unittest.TestCase):
    def test_fresh_cli_needs_no_previous_experiment(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'inputs.jsonl').write_text(json.dumps(sample('fresh', 2))+'\n')
            subprocess.run([sys.executable, str(Path(__file__).with_name('prepare_mind.py')),
                            '--source', str(p/'inputs.jsonl'), '--output', str(p/'index.sqlite'), '--expected-total', '1'], check=True, capture_output=True)
            manifest = json.loads((p/'index.manifest.json').read_text())
            self.assertEqual(manifest['eligible'], 1)
            self.assertEqual(manifest['legacy'], 0)
            self.assertIsNone(manifest['legacy_source'])

    def test_all_methods_and_ineligible_without_duplicate_legacy(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'full').write_text(''.join(json.dumps(x)+'\n' for x in [sample('a', 2), sample('b', 1), sample('c', 2)]))
            (p/'old').write_text(json.dumps(sample('a', 2))+'\n')
            result = build_index(p/'full', p/'old', p/'index', expected_total=3, expected_old=1)
            self.assertEqual(result['eligible'], 2)
            with sqlite3.connect(p/'index') as db:
                rows = db.execute('select decision_id, method from jobs order by decision_id, method').fetchall()
            self.assertEqual(len(rows), 9)
            self.assertFalse(any(x[0] == 'a' for x in rows))
            self.assertNotIn(('b', 'i2agent'), rows)
            self.assertIn(('c', 'i2agent'), rows)

    def test_mismatched_legacy_public_candidates_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            a, b = sample('a', 2), sample('a', 2)
            b['observation']['environment']['candidate_pool'][0]['id'] = 'different'
            (p/'full').write_text(json.dumps(a)+'\n')
            (p/'old').write_text(json.dumps(b)+'\n')
            with self.assertRaisesRegex(ValueError, 'legacy input mismatch'):
                build_index(p/'full', p/'old', p/'index', expected_total=1, expected_old=1)


if __name__ == '__main__':
    unittest.main()
