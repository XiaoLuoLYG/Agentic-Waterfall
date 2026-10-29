import test from 'node:test';import assert from 'node:assert/strict';import {validatePrior} from './sequence.mjs';
test('enforces independent per-user and per-method consecutive state',()=>{
 const current={user_id:'u',event:2};const prior={user_id:'u',method:'clawrec',event:1,state:'one'};
 assert.equal(validatePrior(current,'clawrec',prior),'one');
 assert.throws(()=>validatePrior(current,'generic-agent',prior),/prior/);
 assert.throws(()=>validatePrior({user_id:'v',event:2},'clawrec',prior),/prior/);
 assert.throws(()=>validatePrior({user_id:'u',event:3},'clawrec',prior),/prior/);
 assert.equal(validatePrior({user_id:'u',event:1},'clawrec',null),null);
});
