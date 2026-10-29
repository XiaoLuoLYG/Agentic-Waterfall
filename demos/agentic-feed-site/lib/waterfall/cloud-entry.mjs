import { createCloudHandler } from './server.mjs';

function modelConfig(raw, signal) {
  if (!raw || !raw.apiKey || !raw.apiBase || !(raw.recommendationModelName || raw.modelName)) return null;
  const endpoint=new URL(raw.apiBase);if(endpoint.protocol!=='https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)throw new Error('model endpoint invalid');
  endpoint.pathname=endpoint.pathname.replace(/\/+$/,'');if(!endpoint.pathname.endsWith('/chat/completions'))endpoint.pathname+='/chat/completions';
  return {key:raw.apiKey,endpoint:endpoint.href,model:raw.recommendationModelName || raw.modelName,timeoutMs:60000,signal,...(raw.recommendationModelName?{requestParameters:{max_tokens:4096,temperature:.3,enable_thinking:false,thinking:{type:'disabled'},extra_body:{thinking:{type:'disabled'}}}}:{})};
}

export async function handleApi(request, env) {
  if(!env.DB)return Response.json({error:'云端数据库未配置'}, {status:503});
  let raw={},composio;try{raw=env.WATERFALL_CONFIG?JSON.parse(env.WATERFALL_CONFIG):{};composio=env.COMPOSIO_CONFIG?JSON.parse(env.COMPOSIO_CONFIG):raw.composio||{};}catch{return Response.json({error:'服务配置无效'}, {status:503});}
  const config=modelConfig(raw,request.signal), sourceConfig={providers:raw.providers||{},composio,allowed:raw.runtime?.waterfall?.sources||{},rssFeeds:raw.runtime?.waterfall?.rssFeeds||[],signal:request.signal,bilibiliRelay:!!env.BILIBILI_RELAY_TOKEN};
  const path=new URL(request.url),headers=Object.fromEntries(request.headers.entries());headers.host=path.host;
  const body=request.body?new Uint8Array(await request.arrayBuffer()):null;
  const nodeRequest={method:request.method,url:path.pathname+path.search,headers,socket:{remoteAddress:'cloud'},async *[Symbol.asyncIterator](){if(body)yield body;}};
  let status=200,content='',responseHeaders=new Headers();
  const nodeResponse={setHeader(key,value){responseHeaders.set(key,value);},writeHead(code,headers){status=code;for(const [key,value] of Object.entries(headers))responseHeaders.set(key,value);},end(value){content=value ?? '';}};
  const {handler}=createCloudHandler({db:env.DB,config,sourceConfig,relayToken:env.BILIBILI_RELAY_TOKEN});await handler(nodeRequest,nodeResponse);
  return new Response(content,{status,headers:responseHeaders});
}
