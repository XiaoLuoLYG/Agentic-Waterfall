import hashlib
import unittest
from fetch_agentrecbench import check_entries, git_blob_id, retry_delay


class DownloadTests(unittest.TestCase):
    def test_rate_limit_obeys_server_delay_and_backoff(self):
        self.assertEqual(retry_delay('180', 0), 180)
        self.assertEqual(retry_delay(None, 2), 240)

    def test_git_blob_hash(self):
        self.assertEqual(git_blob_id(b'abc'), hashlib.sha1(b'blob 3\0abc').hexdigest())

    def test_requires_matching_official_task_and_truth_ids(self):
        task=[{'type':'file','path':'task/classic/amazon/tasks/task_0.json'}]
        truth=[{'type':'file','path':'task/classic/amazon/groundtruth/groundtruth_0.json'}]
        self.assertEqual(check_entries('classic','amazon',task,truth),[0])
        truth[0]['path']='task/classic/amazon/groundtruth/groundtruth_1.json'
        with self.assertRaisesRegex(ValueError,'ID sets mismatch'):check_entries('classic','amazon',task,truth)

    def test_rejects_unexpected_path(self):
        with self.assertRaises(ValueError):
            check_entries('classic','amazon',[{'type':'file','path':'task/classic/amazon/tasks/../../outside'}],[])
