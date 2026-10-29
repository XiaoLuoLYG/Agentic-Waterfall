import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan} from './plan.mjs';

test('parses only KuaiRec searches without changing queries',()=>{
 const plan='## Search Instructions\n### [search-001]\n- Platform: KuaiRec\n- Query: 拍摄 技巧\n- Task-Goal: 找教程\n### [search-002]\n- Platform: KuaiRec\n- Query: 剪辑\n- Task-Goal: 查资料\n## Display Plan\n';
 assert.deepEqual(parsePlan(plan),[{id:'search-001',query:'拍摄 技巧'},{id:'search-002',query:'剪辑'}]);
});
test('rejects unknown platforms, missing queries and duplicate ids',()=>{
 assert.throws(()=>parsePlan('## Search Instructions\n### [search-1]\n- Platform: Bilibili\n- Query: x\n'),/platform/);
 assert.throws(()=>parsePlan('## Search Instructions\n### [search-1]\n- Platform: KuaiRec\n'),/query/);
 assert.throws(()=>parsePlan('## Search Instructions\n### [search-1]\n- Platform: KuaiRec\n- Query: a\n### [search-1]\n- Platform: KuaiRec\n- Query: b\n'),/duplicate/);
});
