import csv
import datetime
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('full',pathlib.Path(__file__).with_name('prepare_kuairand_full.py'))
full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)


class FullKuaiRandTest(unittest.TestCase):
    def test_full_export_matches_frozen_protocol_without_target_leakage(self):
        with tempfile.TemporaryDirectory() as directory:
            data=pathlib.Path(directory)/'data';raw=data/'raw';raw.mkdir(parents=True)
            prepared=data/'prepared-v2';prepared.mkdir()
            def event(video,date,offset=0,random=0,play=100):
                time=int(datetime.datetime.strptime(str(date),'%Y%m%d').replace(tzinfo=datetime.timezone.utc).timestamp()*1000)+offset
                row={key:0 for key in full.FIELDS};row.update(user_id=7,video_id=video,date=date,time_ms=time,long_view=1,is_rand=random,play_time_ms=play,duration_ms=1000)
                return row
            groups=[[event(i,20220408,i*1000) for i in range(70)],
                [event(170,20220422),event(201,20220429,0,play=100000),event(180,20220429,1000)],
                [event(181,20220429,2000,random=1)]]
            groups[1][1]['long_view']=0
            all_events=[];files=[]
            for name,rows in zip(full.LOGS,groups):
                path=raw/name
                with path.open('w',newline='') as f:
                    writer=csv.DictWriter(f,fieldnames=full.FIELDS+full.OPTIONAL_FIELDS);writer.writeheader();writer.writerows({**r,'hourmin':900,'profile_stay_time':12,'comment_stay_time':13,'is_profile_enter':1,'tab':2} for r in rows)
                all_events.extend({**row,'event_id':f'{name}:{i}'} for i,row in enumerate(rows,1))
                files.append(dict(file=name,rows=len(rows),sha256=full.sha(path)))
            (raw/'user_features_1k.csv').write_text('user_id\n7\n')
            catalog=list(range(1,250));(prepared/'catalog-ids.json').write_text(json.dumps(catalog))
            db=sqlite3.connect(prepared/'catalog.sqlite');db.execute('CREATE TABLE items(video_id INTEGER PRIMARY KEY,payload TEXT)')
            for video in catalog:db.execute('INSERT INTO items VALUES (?,?)',(video,json.dumps(dict(id=f'kuairand:{video}',source_id='kuairand-1k',title=f'KuaiRand video {video}',text='video_duration=1000'))))
            db.commit();db.close()
            (raw/'video_features_basic_1k.csv').write_text('video_id,video_duration\n'+''.join(f'{i},1000\n' for i in range(250)))
            caption=data/'kuairand-video-captions-20261029.csv'
            with caption.open('w',newline='') as f:
                writer=csv.writer(f);writer.writerow(['final_video_id','caption','show_cover_text','duration'])
                for video in range(250):writer.writerow([video,'完整文案'*40,'完整封面'*30,'unknown' if video==180 else 1000])
            (data/'captions-full-20261029-manifest.json').write_text(json.dumps(dict(bytes=caption.stat().st_size,sha256=full.sha(caption),official_md5_verified=True)))
            (prepared/'preparation-manifest.json').write_text(json.dumps(dict(protocol_version='v2-global-completed-event-cutoff',training_cutoff_ms=1,files=files,catalog_sha256=full.sha(prepared/'catalog-ids.json'))))
            output=pathlib.Path(directory)/'output';report=full.prepare(data,output)
            expected={t['task_id']:t for t in full.user_tasks(7,all_events,catalog) if t['split']=='test'}
            assignments=[json.loads(line) for line in (output/'assignment.jsonl').read_text().splitlines()]
            self.assertEqual(len({a['input_path'] for a in assignments}),2)
            public=[json.loads(pathlib.Path(a['input_path']).read_bytes()) for a in assignments]
            self.assertFalse((output/'public-inputs.jsonl').exists())
            for a in assignments:
                self.assertEqual(a['input_offset'],0)
                self.assertEqual(a['input_bytes'],pathlib.Path(a['input_path']).stat().st_size)
                self.assertEqual(a['sha256'],full.sha(pathlib.Path(a['input_path'])))
            hidden=[json.loads(line) for line in (output/'evaluator-only/private-tasks.jsonl').read_text().splitlines()]
            self.assertEqual(report['n'],2);self.assertEqual(len(hidden),2)
            self.assertTrue(all('history' not in task for task in hidden))
            for row in public:
                obs=row['observation'];task=expected[obs['decision_id']]
                self.assertNotIn('target',obs);self.assertNotIn('target',row['run_meta'])
                self.assertEqual([i['id'] for i in obs['environment']['candidate_pool']],[f'kuairand:{i}' for i in task['candidate_ids']])
                self.assertEqual([e['id'] for e in obs['behavior_events']],[e['event_id'] for e in task['history']])
                self.assertTrue(all(e['available_at']<=obs['observed_at'] for e in obs['behavior_events']))
                self.assertEqual(row['protocol']['top_k'],101)
                self.assertGreater(len(obs['behavior_events']),64)
                self.assertEqual(obs['behavior_events'][0]['payload']['tab'],2)
                self.assertEqual(obs['behavior_events'][0]['payload']['profile_stay_time'],12)
                self.assertEqual(obs['environment']['data_contract'],full.FEEDBACK_CONTRACT)
                self.assertNotIn(task['target_event_id'],[e['id'] for e in obs['behavior_events']])
                self.assertTrue(all(e['payload'].get('caption_excerpt')=='完整文案'*40 for e in obs['behavior_events'] if e['payload']['caption_status']=='matched'))
                self.assertTrue(all(e['payload'].get('cover_excerpt')=='完整封面'*30 for e in obs['behavior_events'] if e['payload']['caption_status']=='matched'))
                for item in obs['environment']['candidate_pool']:
                    if item['caption_status']=='matched':
                        self.assertEqual(item['title'],'完整文案'*40)
                        self.assertTrue(item['text'].endswith('; cover_text='+'完整封面'*30))
            outside=public[0]['observation']['behavior_events'][0]
            self.assertEqual(outside['item_id'],'kuairand:0')
            self.assertEqual({k:outside['payload'][k] for k in ('play_time_ms','duration_ms','long_view')},{'play_time_ms':100,'duration_ms':1000,'long_view':1})
            self.assertTrue(outside['payload']['content_metadata'].startswith('video_duration=1000'))
            item=next(i for i in public[0]['observation']['environment']['candidate_pool'] if i['id']=='kuairand:180')
            self.assertEqual(item['caption_status'],'unverifiable');self.assertEqual(item['title'],'KuaiRand video 180')

    def test_unsorted_user_source_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/full.LOGS[0]
            with path.open('w',newline='') as f:
                writer=csv.DictWriter(f,fieldnames=full.FIELDS);writer.writeheader()
                for user in [8,7]:
                    event={key:0 for key in full.FIELDS};event.update(user_id=user,date=20220408)
                    writer.writerow(event)
            with self.assertRaisesRegex(ValueError,'not ordered'):list(full.events(path,{7,8},full.collections.Counter()))


if __name__=='__main__':unittest.main()
