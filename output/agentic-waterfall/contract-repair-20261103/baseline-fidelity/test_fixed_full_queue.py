import importlib.util,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch

P=Path(__file__).with_name('run_fixed_full.py')
spec=importlib.util.spec_from_file_location('queue',P);q=importlib.util.module_from_spec(spec);spec.loader.exec_module(q)

class QueueTest(unittest.TestCase):
 def setup_case(self,root,exitcode=0):
  script=root/'fixture.py';script.write_text("from pathlib import Path\nimport sys,json\np=Path(sys.argv[1]);p.mkdir();(p/'predictions.jsonl').write_text(json.dumps({'user_id':'u','status':'submitted','ordered_item_ids':['item']})+'\\n');Path(str(p)+'.runtime.json').write_text(json.dumps({'exit_code':"+str(exitcode)+"}));(p.parent/'calls').open('a').write('one\\n');sys.exit("+str(exitcode)+")\n")
  inp=root/'input';inp.write_text('public');job={'index':0,'user_id':'u','input':str(inp),'input_sha256':q.sha(inp),'argv':['python3',str(script),'{OUTPUT}']};plan={'files_sha256':{str(script):q.sha(script)},'asset_stats':{}}
  return job,plan
 def audit(self,path,job,plan):return {'user_id':job['user_id'],'status':'submitted','ordered_item_ids':['item']},{str(path/'predictions.jsonl'):q.sha(path/'predictions.jsonl')}
 def test_resume_never_reexecutes_completed(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root)
   with patch.object(q,'audit_case',self.audit):
    a=q.run_job(job,plan,root,{});b=q.run_job(job,plan,root,{})
   self.assertEqual(a,b);self.assertEqual((root/'cases/0000/calls').read_text(),'one\n')
 def test_successful_orphan_is_recovered_without_episode(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root)
   with patch.object(q,'audit_case',self.audit):
    q.run_job(job,plan,root,{});(root/'cases/0000/result.json').unlink();q.run_job(job,plan,root,{})
   self.assertEqual((root/'cases/0000/calls').read_text(),'one\n')
 def test_failed_episode_retained_and_never_retried(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root,1)
   with patch.object(q,'audit_case',self.audit):
    a=q.run_job(job,plan,root,{});b=q.run_job(job,plan,root,{})
   self.assertEqual(a['status'],'failed');self.assertEqual(a,b);self.assertEqual((root/'cases/0000/calls').read_text(),'one\n')
 def test_input_drift_blocks_before_process(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root);Path(job['input']).write_text('changed')
   with self.assertRaises(AssertionError):q.run_job(job,plan,root,{})
   self.assertFalse((root/'cases').exists())
 def test_unresolved_started_case_is_not_launched(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root);case=root/'cases/0000';case.mkdir(parents=True);(case/'started.json').write_text('{}')
   with self.assertRaises(RuntimeError):q.run_job(job,plan,root,{})
   self.assertFalse((case/'calls').exists())
 def test_resume_rejects_altered_result(self):
  with tempfile.TemporaryDirectory() as t:
   root=Path(t);job,plan=self.setup_case(root)
   with patch.object(q,'audit_case',self.audit):
    q.run_job(job,plan,root,{});p=root/'cases/0000/result.json';r=json.loads(p.read_text());r['prediction']['ordered_item_ids']=['changed'];p.write_text(json.dumps(r))
    with self.assertRaises(AssertionError):q.run_job(job,plan,root,{})
 def test_real_legacy_relative_input(self):
  plan=json.loads((P.parent/'fixed-full-plan.json').read_text());old=q.OLD/'pilot/kuairec/fixed-retrieval/case-0007/inference-resource-v2';row,_=q.audit_case(old,plan['cases'][88],plan);self.assertEqual(row['user_id'],'6858')

if __name__=='__main__':unittest.main()
