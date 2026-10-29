import hashlib,json,tempfile,unittest
from pathlib import Path
from build_evaluation import load_frozen
class FreezeTest(unittest.TestCase):
 def test_requires_untampered_case_and_pool(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);files={}
   for n in ('rankings.json','catalog.json'):
    data=b'{}';(p/n).write_bytes(data);files[n]=hashlib.sha256(data).hexdigest()
   (p/'freeze.json').write_text(json.dumps({'case_id':'case','hidden_labels_accessed':False,'files':files}))
   self.assertEqual(load_frozen(p,'case'),[{},{}])
   with self.assertRaises(ValueError):load_frozen(p,'other')
   (p/'catalog.json').write_text('{"changed":true}')
   with self.assertRaises(ValueError):load_frozen(p,'case')
if __name__=='__main__':unittest.main()
