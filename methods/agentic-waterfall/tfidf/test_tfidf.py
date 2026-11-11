import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import tfidf_predict


class TfidfTest(unittest.TestCase):
    def test_cosine_ranking_and_stable_ties(self):
        catalog = {"first": "forest trail", "match": "city rail", "last": ""}
        index = tfidf_predict.fit_catalog(catalog)
        ranked, nonzero = tfidf_predict.rank_candidates(index, ["city rail"], list(catalog))
        self.assertEqual((ranked, nonzero), (["match", "first", "last"], 1))
        self.assertEqual(tfidf_predict.rank_candidates(index, [], list(catalog)), (list(catalog), 0))
        empty = tfidf_predict.fit_catalog({"first": "", "last": "?"})
        self.assertEqual(tfidf_predict.rank_candidates(empty, ["city"], ["last", "first"]),
                         (["last", "first"], 0))

    def test_mind_output_is_never_overwritten_or_published_on_error(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            train, dev, inputs, output = (root / name for name in ("train", "dev", "inputs", "predictions"))
            train.write_text("n1\tc\ts\tforest trail\n")
            dev.write_text("n2\tc\ts\tcity rail\n")
            observation = {
                "decision_id": "mind:1",
                "behavior_events": [{"item": {"id": "n2", "title": "city rail"}}],
                "environment": {"candidate_pool": [{"id": "n1"}, {"id": "n2"}]},
            }
            inputs.write_text(json.dumps({"observation": observation}) + "\n")
            tfidf_predict.predict(inputs, output, 1, train, dev)
            original = output.read_bytes()
            self.assertEqual(json.loads(original)["ordered_item_ids"], ["n2", "n1"])
            with self.assertRaises(FileExistsError):
                tfidf_predict.predict(inputs, output, 1, train, dev)
            self.assertEqual(output.read_bytes(), original)
            inputs.write_text(json.dumps({"observation": {"decision_id": "mind:2"},
                                          "preparation_status": "blocked"}) + "\n")
            with self.assertRaisesRegex(ValueError, "blocked MIND input.*mind:2"):
                tfidf_predict.predict(inputs, root / "blocked", None, train, dev)
            self.assertFalse((root / "blocked").exists())
            self.assertEqual(list(root.glob(".tfidf-*")), [])


if __name__ == "__main__":
    unittest.main()
