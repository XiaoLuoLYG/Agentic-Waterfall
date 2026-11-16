const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {validResearchMethods} from './research-methods.mjs';
const statuses=new Set(['queued','running','succeeded','failed','interrupted']);

// This client runs on the authenticated application server, never in browser code.
export function createRemoteResearchBackend({url,token}){
 let endpoint;try{endpoint=new URL(url);}catch{throw Error('research backend endpoint invalid');}
 if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('research backend endpoint invalid');
 if(endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)))throw Error('research backend requires HTTPS or localhost');
 if(typeof token!=='string'||token.length<32||/[\r\n]/.test(token))throw Error('research backend token required');
 const base=endpoint.href.replace(/\/+$/,''),identities=new Map();
 const jobId=id=>{if(!uuid.test(id))throw Error('research job identity invalid');return id;};
 async function request(path,body){
  let response;try{response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000),redirect:'manual'});}catch{throw Object.assign(Error('research backend unavailable'),{status:503});}
  if(!response.ok)throw Object.assign(Error(`research_backend_http_${response.status}`),{status:response.status});return response;
 }
 function validate(value,id,expected){
  if(!value||value.job_id!==id||!uuid.test(value.user_id)||!uuid.test(value.session_id)||!statuses.has(value.status)||expected&&(expected.user_id!==value.user_id||expected.session_id!==value.session_id))throw Error('research backend identity or status mismatch');
  identities.set(id,{user_id:value.user_id,session_id:value.session_id,artifact:value.artifact});return value;
 }
 return {
  async info(){const value=await (await request('/v1/info')).json();if(typeof value?.ready!=='boolean'||!validResearchMethods(value.methods)||!Array.isArray(value.sources))throw Error('research backend capabilities invalid');return value;},
  async start(input){const id=jobId(input.job_id);return validate(await (await request('/v1/jobs',input)).json(),id,input);},
  async poll(id){jobId(id);return validate(await (await request(`/v1/jobs/${id}`)).json(),id,identities.get(id));},
  async artifact(id){
   jobId(id);const response=await request(`/v1/jobs/${id}/artifact`),expected=identities.get(id);
   if(response.headers.get('x-job-id')!==id||expected&&(response.headers.get('x-user-id')!==expected.user_id||response.headers.get('x-session-id')!==expected.session_id))throw Error('research artifact identity mismatch');
   const data=await response.arrayBuffer(),digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
   const size=Number(response.headers.get('x-artifact-size')),sha=response.headers.get('x-artifact-sha256');
   if(new Uint8Array(data)[0]!==0x1f||new Uint8Array(data)[1]!==0x8b||data.byteLength!==size||digest!==sha||expected?.artifact&&(expected.artifact.sha256!==sha||expected.artifact.size!==size))throw Error('research artifact checksum mismatch');
   return new Response(data,{status:response.status,headers:response.headers});
  }
 };
}
