"""Independent lanes must preserve every task and every sequential user chain."""
import unittest
from partition_waterfall import partition


class PartitionChecks(unittest.TestCase):
    def test_disjoint_complete_and_ordered_with_whole_user_chains(self):
        tasks=[{'id':'a','dataset':'kuairec'}, {'id':'user-1','dataset':'clawrec'},
               {'id':'b','dataset':'kuairec'}, {'id':'user-2','dataset':'clawrec','previous':'user-1'},
               {'id':'c','dataset':'kuairand'}, {'id':'user-3','dataset':'clawrec','previous':'user-2'}]
        lanes=partition(tasks,{'a'})
        self.assertEqual(sorted(t['id'] for lane in lanes for t in lane),sorted(t['id'] for t in tasks))
        owner={t['id']:i for i,lane in enumerate(lanes) for t in lane}
        self.assertEqual(owner['user-1'],owner['user-2']);self.assertEqual(owner['user-1'],owner['user-3'])
        for lane in lanes:self.assertEqual(lane,[t for t in tasks if t in lane])
        self.assertEqual(lanes,partition(tasks,{'a'}))

    def test_completed_tasks_do_not_skew_remaining_independent_work(self):
        tasks=[{'id':str(i),'dataset':'kuairec'} for i in range(12)]
        lanes=partition(tasks,{'0','1','2','3'})
        self.assertEqual([sum(t['id'] not in {'0','1','2','3'} for t in lane) for lane in lanes],[4,4])

    def test_reject_missing_or_cyclic_dependencies_duplicates_and_mind(self):
        bad=[[{'id':'x','dataset':'clawrec','previous':'missing'}],
             [{'id':'x','dataset':'clawrec','previous':'y'},{'id':'y','dataset':'clawrec','previous':'x'}],
             [{'id':'x','dataset':'kuairec'},{'id':'x','dataset':'kuairec'}],
             [{'id':'x','dataset':'mind'}]]
        for tasks in bad:
            with self.subTest(tasks=tasks),self.assertRaises(ValueError):partition(tasks)


if __name__=='__main__':unittest.main()
