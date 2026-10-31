import sqlite3
import unittest
import tempfile
import threading
import time
from pathlib import Path
from unittest.mock import patch
import run_kuairand as queue
from run_kuairand import claim_next, finish_job, SOURCE, HERE


class QueueTests(unittest.TestCase):
    def test_parallel_pool_finishes_each_job_once_and_keeps_one_local_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);path=root/'mind-index.sqlite';db=sqlite3.connect(path)
            db.execute('CREATE TABLE jobs (task INTEGER,decision_id TEXT,method TEXT,status TEXT,attempt INTEGER,PRIMARY KEY(task,method))')
            jobs=[(n,f'case-{n}',method) for n in range(8) for method in ('mars','recbot')]
            db.executemany('INSERT INTO jobs VALUES(?,?,?,"pending",0)',jobs);db.commit()
            lock=threading.Lock();seen=[];active=0;peak=0;local=0;local_peak=0
            def execute(job,policy):
                nonlocal active,peak,local,local_peak
                with lock:
                    seen.append((job['task'],job['method']));active+=1;peak=max(peak,active)
                    local+=job['method']=='recbot';local_peak=max(local_peak,local)
                time.sleep(.02)
                with sqlite3.connect(path,timeout=10) as worker:finish_job(worker,job,'submitted')
                with lock:active-=1;local-=job['method']=='recbot'
                return True
            queue.STOP=False
            with patch.object(queue,'HERE',root),patch.object(queue,'resource_problem',return_value=None),patch.object(queue,'run_claimed',side_effect=execute):
                self.assertEqual(queue.run_parallel(db,queue.FIRST_COMPLETE,8),'complete')
            self.assertEqual(len(seen),len(jobs));self.assertEqual(len(set(seen)),len(jobs))
            self.assertGreater(peak,1);self.assertLessEqual(peak,8);self.assertEqual(local_peak,1)
            self.assertEqual(db.execute('SELECT count(*) FROM jobs WHERE status="submitted"').fetchone()[0],len(jobs));db.close()

    def test_parallel_owner_claims_distinct_jobs_but_never_adopts_unknown_running_work(self):
        db=sqlite3.connect(':memory:')
        db.execute('CREATE TABLE jobs (task INTEGER,decision_id TEXT,method TEXT,status TEXT,attempt INTEGER,PRIMARY KEY(task,method))')
        db.executemany('INSERT INTO jobs VALUES(?,?,?,"pending",0)',[(0,'case-0','recbot'),(0,'case-0','mars'),(1,'case-1','recbot'),(1,'case-1','mars')]);db.commit()
        first=claim_next(db,owned_running=set(),exclude_methods={'mars'})
        owned={(first['task'],first['method'])}
        second=claim_next(db,owned_running=owned,exclude_methods={'recbot'})
        self.assertNotEqual((first['task'],first['method']),(second['task'],second['method']))
        with self.assertRaisesRegex(RuntimeError,'unresolved running'):
            claim_next(db,owned_running=owned)
        owned.add((second['task'],second['method']))
        third=claim_next(db,owned_running=owned,exclude_methods={'recbot'})
        self.assertEqual(third['method'],'mars')

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
