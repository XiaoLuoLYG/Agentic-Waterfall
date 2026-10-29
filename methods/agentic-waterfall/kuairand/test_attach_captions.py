import unittest
from attach_captions import checked_caption,clip
class CaptionTests(unittest.TestCase):
 def test_only_matching_durations_unlock_caption(self):
  basic={'video_duration':'100'};row={'duration':'100.5','caption':'caption','show_cover_text':'cover'}
  self.assertEqual(checked_caption(basic,row),'matched')
  self.assertEqual(checked_caption(basic,{**row,'duration':'wrong'}),'unverifiable')
  self.assertEqual(checked_caption(basic,{**row,'duration':'130'}),'mismatch')
 def test_clip_respects_utf8_bytes(self):self.assertEqual(clip('你好abc',5),'你')
if __name__=='__main__':unittest.main()

class SyntheticJoinTest(unittest.TestCase):
 def test_full_join_uses_only_duration_verified_text(self):
  import tempfile,json,hashlib
  from pathlib import Path
  import attach_captions as m
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);(d/'raw').mkdir();src=d/'source';src.mkdir();out=d/'output'
   (d/'raw/video_features_basic_1k.csv').write_text('video_id,video_duration\n0,100\n1,200\n')
   csv=b'final_video_id,caption,show_cover_text,duration\n0,alpha,cover,100\n1,beta,cover,unknown\n';(d/'kuairand-video-captions-20261029.csv').write_bytes(csv)
   (d/'captions-full-20261029-manifest.json').write_text(json.dumps({'bytes':len(csv),'sha256':hashlib.sha256(csv).hexdigest(),'official_md5_verified':True}))
   row={'observation':{'decision_id':'sample','behavior_events':[{'item_id':'kuairand:0','payload':{}}],'environment':{'candidate_pool':[{'id':'kuairand:1','title':'fallback','text':'basic'}]}},'run_meta':{}}
   raw=(json.dumps(row)+'\n').encode();(src/'public-inputs.jsonl').write_bytes(raw);(src/'manifest.json').write_text(json.dumps({'task_ids':['sample'],'public_sha256':hashlib.sha256(raw).hexdigest()}))
   old=(m.DATA,m.SOURCE,m.OUTPUT);m.DATA,m.SOURCE,m.OUTPUT=d,src,out
   try:m.main()
   finally:m.DATA,m.SOURCE,m.OUTPUT=old
   result=json.loads((out/'public-inputs.jsonl').read_text());self.assertEqual(result['observation']['behavior_events'][0]['payload']['caption_excerpt'],'alpha');self.assertEqual(result['observation']['environment']['candidate_pool'][0]['title'],'fallback');self.assertEqual(json.loads((out/'manifest.json').read_text())['unverifiable_ids'],[1])
