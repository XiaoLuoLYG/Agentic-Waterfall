import unittest

from mind import rank_mind


def news(number, abstract=""):
    return {"id": f"N{number}", "title": f"Title {number}", "abstract": abstract}


def sample(history, candidates):
    return {
        "observation": {
            "decision_id": "mind:test:1",
            "user_id": "U1",
            "dialogue": [],
            "behavior_events": [
                {"type": "click", "item_id": item["id"], "item": item} for item in history
            ],
            "environment": {"candidate_pool": candidates},
        }
    }


class MindRecAgentTests(unittest.TestCase):
    def test_author_flow_sees_full_candidate_pool_and_long_click_history(self):
        cards = [news(i) for i in range(1, 296)]
        history = [news(400, "weather " * 100)] * 135 + [news(401, "END OF CLICK HISTORY")]
        order = [item["id"] for item in reversed(cards)]
        requests = []

        def model(request):
            requests.append(request)
            return repr(list(range(295, 0, -1)))

        result = rank_mind(sample(history, cards), model)
        self.assertEqual(result["ordered_item_ids"], order)
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0]["max_tokens"], 8192)
        self.assertEqual(requests[0]["temperature"], 0.1)
        prompt = requests[0]["messages"][0]["content"]
        self.assertIn("clicked before", prompt)
        self.assertNotIn("review text and stars", prompt)
        self.assertIn("following 295 items", prompt)
        self.assertIn("above 295 candidate items", prompt)
        self.assertIn("END OF CLICK HISTORY", prompt)
        self.assertEqual(prompt.count("'item_id': 'N400'"), 135)
        self.assertIn("each integer from 1 to 295 exactly once", prompt)
        for index, item in enumerate(cards, 1):
            self.assertIn(repr({
                "candidate_index": index, "item_id": item["id"],
                "title": item["title"], "description": "",
            }), prompt)
        self.assertGreater(result["history_tokens"], 12000)
        self.assertFalse(result["history_truncated"])

    def test_indices_map_back_to_the_original_frozen_order(self):
        row = sample([], [news(22), news(5), news(17)])
        self.assertEqual(
            rank_mind(row, lambda _: "[3, 1, 2]")["ordered_item_ids"], ["N17", "N22", "N5"]
        )

    def test_recover_only_a_complete_prefix_with_trailing_repeats(self):
        row = sample([], [news(22), news(5)])
        result = rank_mind(row, lambda _: "[2, 1, 2]")
        self.assertEqual(result["ordered_item_ids"], ["N5", "N22"])
        self.assertEqual(result["trailing_repeats_removed"], 1)

    def test_partial_duplicate_and_noninteger_indices_are_rejected(self):
        row = sample([], [news(22), news(5)])
        for reply in ("[1]", "[1, 1]", "[3, 1]", "[1, 1, 2]", "[2, 1, 3]", "[True, 2]", '["1", "2"]'):
            with self.subTest(reply=reply), self.assertRaisesRegex(ValueError, "full candidate index permutation"):
                rank_mind(row, lambda _: reply)

    def test_invalid_public_candidates_are_rejected_before_model_call(self):
        with self.assertRaisesRegex(ValueError, "duplicate MIND candidate"):
            rank_mind(sample([], [news(1), news(1)]), lambda _: self.fail("model called"))
