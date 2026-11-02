import unittest
from retrieval import CatalogRetriever

class SearchOnlyContract(unittest.TestCase):
    def setUp(self):
        self.catalog=[{'id':str(i+1),'text':word,'big_positive_count':10000-i} for i,word in enumerate(['popular','needle','garden','music','sport'])]
        self.search=CatalogRetriever(self.catalog)
        self.ids=[row['id'] for row in self.catalog]

    def test_hot_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            self.search.acquire('',self.ids,mode='hot')

    def test_empty_query_does_not_fetch_popular_items(self):
        result=self.search.acquire('',self.ids)
        self.assertEqual(result['items'],[])
        self.assertEqual(result['evidence']['backend'],'bm25')

    def test_no_match_does_not_return_id_order(self):
        self.assertEqual(self.search.acquire('unmatched',self.ids)['items'],[])

    def test_only_matching_eligible_unseen_items_are_returned(self):
        self.assertEqual([row['id'] for row in self.search.acquire('needle',self.ids)['items']],['2'])
        self.assertEqual(self.search.acquire('needle',self.ids,exclude=['2'])['items'],[])
        self.assertEqual(self.search.acquire('needle',['1'])['items'],[])

    def test_common_term_match_is_retained_even_with_nonpositive_bm25_score(self):
        search=CatalogRetriever([{'id':'1','text':'common'},{'id':'2','text':'common'}])
        self.assertEqual(len(search.acquire('common',['1','2'])['items']),2)

if __name__=='__main__':unittest.main()
