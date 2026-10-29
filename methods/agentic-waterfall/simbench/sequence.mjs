export function validatePrior(current,method,prior){
 if(!current||typeof current.user_id!=='string'||!Number.isInteger(current.event)||current.event<1)throw Error('invalid case');
 if(current.event===1){if(prior!==null)throw Error('first event must not have prior state');return null;}
 if(!prior||prior.user_id!==current.user_id||prior.method!==method||prior.event!==current.event-1||typeof prior.state!=='string')throw Error('invalid prior state');
 return prior.state;
}
