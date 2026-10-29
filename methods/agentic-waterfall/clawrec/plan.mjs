export function parsePlan(markdown) {
  if(typeof markdown!=='string')throw Error('invalid plan');
  const section=markdown.match(/^## Search Instructions\s*$([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
  if(!section)throw Error('missing search instructions');
  const matches=[...section.matchAll(/^### \[(search-[^\]]+)\]\s*$([\s\S]*?)(?=^### |$(?![\s\S]))/gm)];
  if(!matches.length || matches.length>10)throw Error('invalid search count');
  const seen=new Set();
  return matches.map(match=>{
    const id=match[1];if(seen.has(id))throw Error('duplicate search id');seen.add(id);
    const platform=match[2].match(/^- Platform:\s*(.*?)\s*$/m)?.[1];
    const query=match[2].match(/^- Query:\s*(.*?)\s*$/m)?.[1];
    if(platform!=='KuaiRec')throw Error('unsupported platform');
    if(!query)throw Error('missing query');
    return {id,query};
  });
}
