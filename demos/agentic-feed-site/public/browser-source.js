export async function fetchApplePodcasts(query, fetcher=fetch){
  const url=new URL('https://itunes.apple.com/search');url.search=new URLSearchParams({term:query,country:/[\u3400-\u9fff]/.test(query)?'CN':'US',media:'podcast',entity:'podcast',limit:'200'});
  const response=await fetcher(url,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw new Error('来源请求失败');
  const data=await response.json();if(!Array.isArray(data.results))throw new Error('来源结果无效');
  return data.results.slice(0,200).map(row=>({collectionId:row.collectionId,collectionName:String(row.collectionName||'').slice(0,300),collectionViewUrl:row.collectionViewUrl,artworkUrl600:row.artworkUrl600||row.artworkUrl100,artistName:String(row.artistName||'').slice(0,160),genres:Array.isArray(row.genres)?row.genres.slice(0,8):[],trackCount:row.trackCount,releaseDate:row.releaseDate}));
}

export function createBrowserSourceWorker(api,context){
  let polling=false;const active=new Set();
  async function run(job,sid,owner){
    if(active.has(job.id)||job.source!=='applepodcasts')return;active.add(job.id);
    let rows=[],failed=false;try{rows=await fetchApplePodcasts(job.query)}catch{failed=true}
    try{const current=context();if(current.sessionId===sid&&current.userId===owner)await api('/api/source-jobs',{sessionId:sid,id:job.id,rows,failed})}catch{}finally{active.delete(job.id)}
  }
  return async()=>{const current=context();if(!current.active||!current.sessionId||polling)return;polling=true;
    try{const {jobs}=await api(`/api/source-jobs?sessionId=${encodeURIComponent(current.sessionId)}`);for(const job of jobs||[])run(job,current.sessionId,current.userId)}catch{}finally{polling=false}
  };
}
