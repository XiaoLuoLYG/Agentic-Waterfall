import io,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import download_captions as m
class Response(io.BytesIO):
 def __init__(self,data,content_range):super().__init__(data);self.status=206;self.headers={'Content-Range':content_range}
class DownloadTests(unittest.TestCase):
 def test_resumes_exact_range_and_refuses_wrong_header(self):
  with tempfile.TemporaryDirectory() as tmp:
   old=(m.DIR,m.TOTAL,m.COUNT);m.DIR,m.TOTAL,m.COUNT=Path(tmp),8,2;(m.DIR/'00.part').write_bytes(b'ab')
   try:
    def get(req,timeout):
     self.assertEqual(req.get_header('Range'),'bytes=2-3');return Response(b'cd','bytes 2-3/8')
    with patch.object(m.urllib.request,'urlopen',get):self.assertEqual(m.part(0),0)
    self.assertEqual((m.DIR/'00.part').read_bytes(),b'abcd')
    (m.DIR/'01.part').write_bytes(b'')
    with patch.object(m.urllib.request,'urlopen',lambda *a,**k:Response(b'fake','bytes 0-3/8')),patch.object(m.time,'sleep',lambda x:None):
     with self.assertRaises(ValueError):m.part(1)
   finally:m.DIR,m.TOTAL,m.COUNT=old
if __name__=='__main__':unittest.main()
