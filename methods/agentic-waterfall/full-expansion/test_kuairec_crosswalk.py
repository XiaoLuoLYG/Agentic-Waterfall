import unittest
from kuairec_crosswalk import crosswalk


def row(user, decision, value='same'):
    return {'observation':{'user_id':user,'decision_id':decision,'behavior_events':[value],'environment':{}}}


class CrosswalkTests(unittest.TestCase):
    def test_matches_user_with_different_decision_ids(self):
        out=crosswalk([row('1','test-1')],[row('1','dev-1')])
        self.assertEqual(out,[{'user_id':'1','waterfall_decision_id':'test-1','baseline_decision_id':'dev-1'}])

    def test_rejects_non_identical_or_duplicate_inputs(self):
        with self.assertRaisesRegex(ValueError,'observation mismatch'):
            crosswalk([row('1','test-1')],[row('1','dev-1','different')])
        with self.assertRaisesRegex(ValueError,'duplicate user'):
            crosswalk([row('1','a'),row('1','b')],[row('1','c')])
