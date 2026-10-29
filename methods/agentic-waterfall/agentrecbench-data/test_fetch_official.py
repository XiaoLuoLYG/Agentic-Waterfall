import io,hashlib,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import fetch_official as m
class FetchTests(unittest.TestCase):
 def archive(self,name):
  out=io.BytesIO()
  with tarfile.open(fileobj=out,mode='w:gz') as t:
   b=b'code';info=tarfile.TarInfo(name);info.size=len(b);t.addfile(info,io.BytesIO(b))
  return out.getvalue()
 def test_checksum_and_safe_paths(self):
  raw=self.archive(m.NAME+'/file.py')
  with tempfile.TemporaryDirectory() as d,patch.object(m,'SHA',hashlib.sha256(raw).hexdigest()):
   self.assertTrue(Path(m.install(raw,d),'file.py').is_file())
   with self.assertRaises(FileExistsError):m.install(raw,d)
   with self.assertRaises(ValueError):m.install(b'bad',d)
  bad=self.archive(m.NAME+'/../escape')
  with tempfile.TemporaryDirectory() as d,patch.object(m,'SHA',hashlib.sha256(bad).hexdigest()):
   with self.assertRaises(ValueError):m.install(bad,d)
if __name__=='__main__':unittest.main()
