import sqlite3
import unittest
from run_mind import claim_next, finish_job


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('CREATE TABLE jobs (task INTEGER, decision_id TEXT, method TEXT, status TEXT, attempt INTEGER, PRIMARY KEY(task,method))')
        self.db.execute('INSERT INTO jobs VALUES(0,"a","mars","pending",0)')
        self.db.execute('INSERT INTO jobs VALUES(1,"b","mars","pending",0)')
        self.db.commit()

    def test_never_skip_unresolved_attempt_after_interruption(self):
        first = claim_next(self.db)
        self.assertEqual(first['decision_id'], 'a')
        with self.assertRaisesRegex(RuntimeError, 'unresolved running'):
            claim_next(self.db)
        finish_job(self.db, first, 'submitted')
        self.assertEqual(claim_next(self.db)['decision_id'], 'b')

    def test_failed_job_is_not_counted_as_submitted(self):
        first = claim_next(self.db)
        finish_job(self.db, first, 'failed')
        self.assertEqual(self.db.execute('select status from jobs where task=0').fetchone()[0], 'failed')
        with self.assertRaisesRegex(RuntimeError, 'failed task'):
            claim_next(self.db)


if __name__ == '__main__':
    unittest.main()
