import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from prepare_kuairand import build_index


def sample(name, positives):
    return {'observation': {'decision_id': name,
        'behavior_events': [{'id': str(i), 'payload': {'long_view': 1 if i < positives else 0, 'caption_status': 'verified'}} for i in range(2)],
        'environment': {'candidate_pool': [{'id':'a', 'caption_status':'verified'}]}}}


class IndexTests(unittest.TestCase):
    def test_test_split_all_methods_and_old_ids(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'full').write_text(''.join(json.dumps(x)+'\n' for x in [sample('a:test:x',2),sample('b:test:x',1),sample('c:test:x',2)]))
            old = sample('a:test:x',2)
            del old['observation']['environment']['candidate_pool'][0]['caption_status']
            for e in old['observation']['behavior_events']: del e['payload']['caption_status']
            (p/'old').write_text(json.dumps(old)+'\n'+json.dumps(sample('d:dev:x',2))+'\n')
            result = build_index(p/'full', p/'old', p/'db', 3, 1)
            self.assertEqual(result['eligible'], 2)
            with sqlite3.connect(p/'db') as db:
                rows=db.execute('select decision_id,method from jobs').fetchall()
            self.assertEqual(len(rows), 9)
            self.assertNotIn(('b:test:x','i2agent'), rows)
            self.assertFalse(any(r[0]=='a:test:x' for r in rows))

    def test_old_candidate_change_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); (p/'full').write_text(json.dumps(sample('a:test:x',2))+'\n')
            x=sample('a:test:x',2);x['observation']['environment']['candidate_pool'][0]['id']='z';(p/'old').write_text(json.dumps(x)+'\n')
            with self.assertRaisesRegex(ValueError,'legacy input mismatch'):
                build_index(p/'full',p/'old',p/'db',1,1)
