import sqlite3
import unittest
from run_kuairand import claim_next, finish_job, SOURCE, HERE


class QueueTests(unittest.TestCase):
    def test_uses_test_inputs_and_stops_on_unresolved_attempt(self):
        self.assertEqual(SOURCE.name, 'public-inputs.jsonl')
        self.assertEqual(HERE.name, 'kuairand')
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (task INTEGER,decision_id TEXT,method TEXT,status TEXT,attempt INTEGER,PRIMARY KEY(task,method))')
        db.execute('INSERT INTO jobs VALUES(0,"kuairand:1:test:random","mars","pending",0)');db.commit()
        job=claim_next(db)
        with self.assertRaisesRegex(RuntimeError,'unresolved running'):claim_next(db)
        finish_job(db,job,'submitted')
        self.assertIsNone(claim_next(db))
