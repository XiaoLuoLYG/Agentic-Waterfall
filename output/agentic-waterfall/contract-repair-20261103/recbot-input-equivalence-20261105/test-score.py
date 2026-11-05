import importlib.util
import math
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('recbot_score', HERE / 'score-after-freeze.py')
scorer = importlib.util.module_from_spec(spec); spec.loader.exec_module(scorer)


class ScoreChecks(unittest.TestCase):
    def test_failure_stays_in_denominator(self):
        tasks = [{'task_id': 'a', 'candidate_ids': [1, 2], 'target': 2, 'eligible': True, 'split': 'test', 'stratum': 'random'},
                 {'task_id': 'b', 'candidate_ids': [1, 2], 'target': 2, 'eligible': True, 'split': 'test', 'stratum': 'standard'}]
        predictions = {'a': {'status': 'submitted', 'ordered_item_ids': ['kuairand:1', 'kuairand:2']},
                       'b': {'status': 'failed', 'error': 'filter without hard constraints', 'ordered_item_ids': []}}
        group = scorer.independent(tasks, predictions)['groups']['all']
        self.assertEqual(group['n'], 2); self.assertEqual(group['invalid'], 1)
        self.assertEqual(group['Hit@10'], .5)
        self.assertEqual(group['NDCG@10'], (1 / math.log2(3)) / 2)

    def test_duplicate_and_incomplete_rankings_are_zero(self):
        task = {'task_id': 'a', 'candidate_ids': [1, 2], 'target': 2, 'eligible': True, 'split': 'test', 'stratum': 'random'}
        for ranking in [['kuairand:2'], ['kuairand:2', 'kuairand:2']]:
            group = scorer.independent([task], {'a': {'status': 'submitted', 'ordered_item_ids': ranking}})['groups']['all']
            self.assertEqual(group['Hit@10'], 0); self.assertEqual(group['invalid'], 1)

    def test_original_protocol_and_independent_cutoff_recomputation_match(self):
        spec = importlib.util.spec_from_file_location('recbot_test_protocol', scorer.PINNED / 'kuairand/scripts/protocol.py')
        protocol = importlib.util.module_from_spec(spec); spec.loader.exec_module(protocol)
        ids = list(range(1, 22))
        task = {'task_id': 'a', 'candidate_ids': ids, 'target': 11, 'eligible': True, 'split': 'test', 'stratum': 'random'}
        predictions = {'a': {'status': 'submitted', 'ordered_item_ids': [f'kuairand:{item}' for item in ids]}}
        original = protocol.evaluate([task], predictions)
        manual = scorer.independent([task], predictions)
        self.assertEqual(original['groups'], manual['groups'])
        self.assertEqual(manual['groups']['all']['Hit@10'], 0)
        self.assertEqual(manual['groups']['all']['Hit@20'], 1)


if __name__ == '__main__':
    unittest.main()
