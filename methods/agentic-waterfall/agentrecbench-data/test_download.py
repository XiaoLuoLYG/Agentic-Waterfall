import unittest
from download import resume_interval, validate_content_range
class RangeTests(unittest.TestCase):
 def test_resume_preserves_original_range_and_bytes(self):
  self.assertEqual(resume_interval(100,200,20),(120,199));self.assertEqual(resume_interval(0,5,5),None)
  with self.assertRaises(ValueError):resume_interval(0,5,6)
 def test_rejects_wrong_server_range(self):
  validate_content_range(206,'bytes 120-199/500',120,199,500)
  with self.assertRaises(ValueError):validate_content_range(200,'bytes 120-199/500',120,199,500)
  with self.assertRaises(ValueError):validate_content_range(206,'bytes 0-199/500',120,199,500)
if __name__=='__main__':unittest.main()
