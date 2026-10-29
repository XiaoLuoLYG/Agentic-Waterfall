import unittest
from retrieval import reciprocal_rank_fusion, validate_catalog, select_catalog, build_index, frozen_hot_fallback

class RetrievalTest(unittest.TestCase):
    def test_shared_candidates_are_promoted_and_results_are_unique(self):
        ranked=reciprocal_rank_fusion(['a','b','c'],['c','b','d'],limit=4)
        self.assertEqual(ranked,['c','b','a','d'])
        self.assertEqual(len(set(ranked)),4)
    def test_eligibility_and_exclusions_keep_vector_positions(self):
        catalog=[{'id':'a','text':'a'}, {'id':'b','text':'b'}, {'id':'c','text':'c'}]
        self.assertEqual(select_catalog(catalog,['a','b'],['a']),[1])
        with self.assertRaisesRegex(ValueError,'unknown'):
            select_catalog(catalog,['missing'],[])
        with self.assertRaisesRegex(ValueError,'empty'):
            select_catalog(catalog,[],[])
    def test_empty_query_uses_only_frozen_train_popularity_and_exclusions(self):
        self.assertEqual(frozen_hot_fallback(['a','b','c'],['b','a','c'],['a','c']),['a','c'])
        with self.assertRaisesRegex(ValueError,'hot'):
            frozen_hot_fallback(['a','b','c'],['a','b'],['a'])
    def test_rejects_duplicate_ids_before_indexing(self):
        with self.assertRaisesRegex(ValueError,'duplicate'):
            validate_catalog([{'id':'a','text':'one'},{'id':'a','text':'two'}])
    def test_ties_are_deterministic(self):
        self.assertEqual(reciprocal_rank_fusion(['b'],['a'],limit=2),['a','b'])
    def test_rejects_duplicate_ranking(self):
        with self.assertRaisesRegex(ValueError,'duplicate'):
            reciprocal_rank_fusion(['a','a'],[],limit=2)

class IndexTest(unittest.TestCase):
    def test_catalog_order_and_vector_alignment_are_frozen(self):
        import json,tempfile
        from pathlib import Path
        from unittest.mock import patch
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); source=root/'catalog.json'; dest=root/'index'
            source.write_text(json.dumps([{'id':'b','text':'second'},{'id':'a','text':'first'}]))
            def fake(texts):
                self.assertEqual(texts,['first','second'])
                return np.array([[1.,0.],[0.,1.]],dtype=np.float32)
            with patch('retrieval.embeddings',side_effect=fake):
                build_index(source,dest)
                with self.assertRaises(FileExistsError):build_index(source,dest)
            meta=json.loads((dest/'index.json').read_text())
            self.assertEqual([x['id'] for x in meta['catalog']],['a','b'])
            self.assertEqual(np.load(dest/'vectors.npy',allow_pickle=False).tolist(),[[1.,0.],[0.,1.]])

if __name__=='__main__': unittest.main()
