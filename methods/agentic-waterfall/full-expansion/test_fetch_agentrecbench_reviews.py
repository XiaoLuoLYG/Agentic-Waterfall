import hashlib
import tempfile
import unittest
from pathlib import Path
from fetch_agentrecbench_reviews import verified


class DownloadTests(unittest.TestCase):
    def test_checks_both_size_and_hash(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'review';p.write_bytes(b'example')
            self.assertTrue(verified(p,7,hashlib.sha256(b'example').hexdigest()))
            self.assertFalse(verified(p,6,hashlib.sha256(b'example').hexdigest()))
            self.assertFalse(verified(p,7,'0'*64))
