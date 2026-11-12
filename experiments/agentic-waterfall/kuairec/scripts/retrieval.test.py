import unittest
from retrieval import CatalogRetriever
from rank_bm25 import BM25Okapi
from retrieval import tokenize

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

class ChineseAdmission(unittest.TestCase):
    def setUp(self):
        self.rows=[{'id':str(i+1),'text':text} for i,text in enumerate(['小编今天教你编舞','编程教程','程序设计','程式舞步','美食教学','花开了'])]
        self.search=CatalogRetriever(self.rows)
        self.ids=[r['id'] for r in self.rows]

    def ids_for(self,query):
        return {r['id'] for r in self.search.acquire(query,self.ids)['items']}

    def test_chinese_word_cannot_match_only_a_shared_character(self):
        self.assertEqual(self.ids_for('编程'),{'2'})
        self.assertEqual(self.search.acquire('编程',['1','3','4','5','6'])['items'],[])

    def test_single_character_query_is_still_supported(self):
        self.assertEqual(self.ids_for('编'),{'1','2'})

    def test_long_chinese_phrase_and_space_separated_terms_use_bigram_or(self):
        self.assertEqual(self.ids_for('编程设计'),{'2','3'})
        self.assertEqual(self.ids_for('编程 美食'),{'2','5'})

    def test_single_characters_in_a_longer_query_cannot_bypass_bigram_admission(self):
        self.assertEqual(self.ids_for('编 程'),set())
        self.assertEqual(self.ids_for('编程 花'),{'2'})

    def test_gate_preserves_the_existing_bm25_scores(self):
        original=BM25Okapi([tokenize(r['text']) for r in self.rows],k1=1.5,b=0.75,epsilon=0.25)
        self.assertEqual(self.search.acquire('编程',self.ids)['scores']['2'],float(original.get_scores(tokenize('编程'))[1]))

if __name__=='__main__':unittest.main()
