import {createHash} from 'node:crypto';
import {check} from './core.mjs';
import {publicStudy,researchStopped} from './research.mjs';
const keys={contents:'content_version_id',participants:'participant_id',profiles:'profile_id',sessions:'session_id',events:'event_id',contexts:'context_id',runs:'run_id',slates:'slate_id',studies:'study_id',questions:'question_id',presentations:'presentation_id',ratings:'rating_id',blind_choices:'blind_choice_id',model_calls:'model_call_id',tool_calls:'tool_call_id'};
export function exportableAccountRows(store){
 const studies=store.rows.filter(row=>row.kind==='research_study'||row.kind==='comparison');
 const finished=studies.filter(row=>{if(row.kind==='comparison')return researchStopped(store,row.id)||store.rows.some(answer=>answer.kind==='evaluation'&&answer.comparison_id===row.id);const view=publicStudy(store,row);return view.stopped||view.completed===view.total;});
 const ids=new Set(finished.map(row=>row.id)),preps=new Set(finished.map(row=>row.preparation_id));
 const rows=store.rows.filter(row=>{
  if(['research_study','comparison'].includes(row.kind))return ids.has(row.id);
  if(row.kind==='research_preparation')return preps.has(row.id);
  if(['research_job','research_job_status'].includes(row.kind))return preps.has(row.preparation_id);
  if(row.study_id||row.comparison_id)return ids.has(row.study_id||row.comparison_id);
  return row.track!=='evaluation';
 });
 return {rows,unfinished:studies.length-finished.length};
}
export function mergeAccountDatasets(datasets,unfinished){
 check(datasets.length,'还没有可导出的数据',409);
 const tables=Object.fromEntries(Object.keys(keys).map(name=>[name,new Map()]));
 for(const dataset of datasets)for(const [name,key]of Object.entries(keys))for(const row of dataset.tables[name]){
  const previous=tables[name].get(row[key]);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(row)){
   if(name==='participants'){tables[name].set(row[key],{...previous,data_origin:'unknown'});continue;}
   check(false,'数据版本冲突，请稍后重试',409);
  }
  tables[name].set(row[key],row);
 }
 const rows=Object.fromEntries(Object.entries(tables).map(([name,items])=>[name,[...items.values()]])),origins=new Set(datasets.map(data=>data.manifest.data_origin));
 return {schema_version:datasets[0].schema_version,manifest:{...datasets[0].manifest,dataset_id:'account:'+createHash('sha256').update(datasets.map(data=>data.manifest.dataset_id).sort().join('\n')).digest('hex'),exported_at:new Date().toISOString(),data_origin:origins.size===1?[...origins][0]:'mixed',eligible_for_analysis:false,analysis_eligibility_reason:'private_account_export_requires_review',selection:{kind:'saved_account_records',unfinished_studies:unfinished},source_datasets:datasets.map(data=>data.manifest),source_record_counts:datasets.reduce((counts,data)=>{for(const [kind,count]of Object.entries(data.manifest.source_record_counts||{}))counts[kind]=(counts[kind]||0)+count;return counts;},{}),collection_archive:{archive_ready:datasets.every(data=>data.manifest.collection_archive?.archive_ready===true),scope:'per_session',sessions:datasets.map(data=>({session_dataset:data.manifest.dataset_id,...data.manifest.collection_archive}))},table_counts:Object.fromEntries(Object.entries(rows).map(([name,items])=>[name,items.length]))},tables:rows,artifact_refs:datasets.flatMap(data=>data.artifact_refs||[])};
}
