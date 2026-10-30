import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from prepare_agentrecbench_long import split_reviews


class SplitTests(unittest.TestCase):
    def test_splits_without_reordering_and_validates_hash(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'input.jsonl';rows=[{'source':'amazon','review_id':'a'}, {'source':'yelp','review_id':'b'}, {'source':'amazon','review_id':'c'}]
            raw=''.join(json.dumps(x)+'\n' for x in rows).encode();p.write_bytes(raw)
            result=split_reviews(p,root/'out',hashlib.sha256(raw).hexdigest())
            self.assertEqual(result['counts'],{'amazon':2,'yelp':1,'goodreads':0})
            self.assertEqual([json.loads(x)['review_id'] for x in (root/'out/amazon/review.json').read_text().splitlines()],['a','c'])

    def test_unexpected_source_does_not_publish_outputs(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);p=root/'input';raw=b'{"source":"unknown"}\n';p.write_bytes(raw)
            with self.assertRaisesRegex(ValueError,'unexpected source'):
                split_reviews(p,root/'out',hashlib.sha256(raw).hexdigest())
            self.assertFalse((root/'out/amazon/review.json').exists())
