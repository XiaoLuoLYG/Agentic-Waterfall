import json, pathlib, subprocess, sys, tempfile, unittest
from unittest.mock import patch
import pandas as pd
from export_full_history import build_histories


class FullHistoryChecks(unittest.TestCase):
    def test_every_source_row_survives_export_and_input_build(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            records=[{'user_id':7,'video_id':1+i%2,'watch_ratio':0.1 if i<85 else 3.0,'timestamp':1000+(99-i)//2} for i in range(100)]
            records[99]['watch_ratio']=0.01
            records.extend([dict(records[0]),{'user_id':8,'video_id':1,'watch_ratio':1,'timestamp':1}])
            pd.DataFrame(records).to_csv(root/'big.csv',index=False)
            (root/'small.csv').write_text('user_id,video_id,watch_ratio\n7,3,PRIVATE_LABEL_NOT_READ\n')
            (root/'captions.csv').write_text('video_id,caption,topic_tag,first_level_category_name\n1,early,[],one\n2,late,UNKNOWN,two\n')
            read_csv=pd.read_csv
            with patch('export_full_history.pd.read_csv',wraps=read_csv) as reads:
                rows,audit=build_histories(root/'big.csv',root/'small.csv',root/'captions.csv',[7],chunksize=7)
            small_reads=[call for call in reads.call_args_list if call.args[0]==root/'small.csv']
            self.assertEqual(small_reads[0].kwargs['usecols'],['user_id','video_id'])
            history=rows[0]
            expected=sorted([{k:v for k,v in row.items() if k!='user_id'}|{'source_row':i+1} for i,row in enumerate(records) if row['user_id']==7],key=lambda e:(e['timestamp'],e['video_id'],e['source_row']))
            self.assertEqual([{k:e[k] for k in expected[0]} for e in history['events']],expected)
            self.assertEqual(len(history['events']),101)
            self.assertEqual(audit['big_rows'],102)
            self.assertEqual(audit['big_small_pair_overlap'],0)
            self.assertTrue(any(e['timestamp']==1000 and e['watch_ratio']==0.01 for e in history['events']))
            self.assertTrue(any(e['source_row']==1 and e['watch_ratio']==0.1 for e in history['events']))
            self.assertEqual(rows,build_histories(root/'big.csv',root/'small.csv',root/'captions.csv',[7],chunksize=29)[0])
            history_path=root/'full.jsonl'
            history_path.write_text(json.dumps(history)+'\n')
            (root/'splits.json').write_text(json.dumps({'dev':[7]}))
            (root/'public-content-metadata.json').write_text(json.dumps({'items':{'1':{'duration_ms':1000},'2':{'duration_ms':2000}}}))
            output=root/'input.jsonl'
            command=[sys.executable,str(pathlib.Path(__file__).with_name('build_waterfall_inputs.py')),'--data-dir',str(root),'--split','dev','--histories',str(history_path),'--output',str(output)]
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            row=json.loads(output.read_text())
            events=row['observation']['behavior_events']
            self.assertEqual(len(events),101)
            self.assertEqual([e['payload']['source_row'] for e in events],[e['source_row'] for e in expected])
            self.assertEqual([e['payload']['source_timestamp'] for e in events],[e['timestamp'] for e in expected])
            self.assertEqual([e['payload']['watch_ratio'] for e in events],[e['watch_ratio'] for e in expected])
            self.assertEqual(len({e['id'] for e in events}),101)
            self.assertEqual(row['run_meta']['history_protocol']['version'],'kuairec-full-big-history-v1')
            self.assertEqual(events[0]['payload']['duration_ms'],1000 if events[0]['item_id']=='1' else 2000)
            original=output.read_bytes()
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(output.read_bytes(),original)

    def test_overlap_is_rejected_without_reading_small_relevance(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            (root/'big.csv').write_text('user_id,video_id,watch_ratio,timestamp\n7,1,0.1,1000\n')
            (root/'small.csv').write_text('user_id,video_id\n7,1\n')
            (root/'captions.csv').write_text('video_id,caption\n1,one\n')
            with self.assertRaisesRegex(ValueError,'big_small_pair_overlap'):
                build_histories(root/'big.csv',root/'small.csv',root/'captions.csv',[7])


if __name__=='__main__':unittest.main()
