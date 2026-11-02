import test from 'node:test';
import assert from 'node:assert/strict';
import {researchPublicInput} from '../lib/waterfall/research-input.mjs';

test('confirmed common input retains natural evidence at its cutoff and excludes evaluator and other-user data',()=>{
 const snapshot={id:'cutoff',captured_at:'2026-10-31T01:00:00Z',command:'多看点足球',state:{profile:'Explicit profile',interests:['足球','摄影'],memory:'PRIVATE_INFERENCE',entries:[{origin:'model',value:'PRIVATE_ENTRY'},{origin:'user_edit',target:'memory',value:'explicit fact'}]},behavior:[{id:'like',type:'feedback',value:'like',title:'football',simulated:true}]};
 const history=[{id:'like',kind:'feedback',value:'like',title:'football',user_id:'owner',track:'feed'},{id:'wrong',kind:'feedback',value:'like',text:'OTHER_USER',user_id:'other',track:'feed'},{id:'evaluation',kind:'evaluation',text:'RATING_LABEL',track:'evaluation'},{id:'evaluation-open',kind:'open',text:'EVALUATION_OPEN',track:'evaluation'},{id:'future',kind:'command',text:'FUTURE',track:'feed',available_at:'2026-10-31T02:00:00Z'}];
 const result=researchPublicInput(snapshot,history,'owner'),serialized=JSON.stringify(result);
 assert.deepEqual(result.evidence.map(row=>row.id),['like','cutoff']);assert.deepEqual(result.provided_profile.interests,['足球','摄影']);
 for(const secret of ['PRIVATE_INFERENCE','PRIVATE_ENTRY','OTHER_USER','RATING_LABEL','EVALUATION_OPEN','FUTURE','simulated'])assert(!serialized.includes(secret),secret);
 assert.equal(result.provided_profile.entries[0].value,'explicit fact');assert.equal(snapshot.behavior[0].simulated,true);
});
