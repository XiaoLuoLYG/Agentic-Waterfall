import hashlib,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import fetch_author
class FetchTests(unittest.TestCase):
 def test_hash_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as d,patch.object(fetch_author,'SOURCE_SHA256',hashlib.sha256(b'original').hexdigest()):
   p=Path(d)/'model.py';self.assertEqual(fetch_author.install(b'original',p),'installed');self.assertEqual(fetch_author.install(b'original',p),'already_present')
   with self.assertRaises(ValueError):fetch_author.install(b'bad',p)
   p.write_bytes(b'user file')
   with self.assertRaises(FileExistsError):fetch_author.install(b'original',p)
if __name__=='__main__':unittest.main()
