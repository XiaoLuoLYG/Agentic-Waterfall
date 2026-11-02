import unittest
from kuairec_data import convert_events

class KuaiRecAdapterTest(unittest.TestCase):
    def test_public_play_is_preserved_without_fabricating_a_url(self):
        obs={'session_id':'s','behavior_events':[{'id':'e','type':'play','item_id':'42',
            'occurred_at':'2020-07-08T01:29:40.453000+00:00',
            'payload':{'watch_ratio':1.75,'duration_ms':12000,'item_text':'公开视频内容','label':'SECRET'}}]}
        result=convert_events(obs)
        self.assertEqual(result[0]['ts_start_ms'],1594171780453)
        self.assertEqual(result[0]['canonical_url'],'')
        self.assertEqual(result[0]['content_key'],'kuairec:video:42')
        self.assertIn('watch_ratio=1.75',result[0]['context']['behavior_signal_types'])
        self.assertIn('duration_ms=12000',result[0]['context']['behavior_signal_types'])
        self.assertNotIn('SECRET',str(result))
    def test_invalid_time_is_rejected(self):
        with self.assertRaises(ValueError):
            convert_events({'session_id':'s','behavior_events':[{'id':'x','type':'play','item_id':'1','occurred_at':'not-a-time','payload':{}}]})

if __name__=='__main__':unittest.main()
