import unittest
from simbench_catalog import make_catalog
class CatalogTests(unittest.TestCase):
 def test_sorted_and_only_public_fields(self):
  docs=[{'id':'b','title':'B','text':'two','private':'hidden'},{'id':'a','title':'A','text':'one'}]
  self.assertEqual(make_catalog(docs),[{'id':'a','text':'A\none'},{'id':'b','text':'B\ntwo'}])
if __name__=='__main__':unittest.main()
