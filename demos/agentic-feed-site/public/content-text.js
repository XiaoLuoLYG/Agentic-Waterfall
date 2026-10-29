export function plainSummary(value, source = '') {
  let text=String(value ?? '');
  const entities={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',hellip:'…',mdash:'—',ndash:'–'};
  for(let i=0;i<3;i++)text=text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,(match,key)=>{
    if(key[0]==='#'){const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):match;}
    return entities[key.toLowerCase()] ?? match;
  });
  text=text.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,' ').replace(/<\/?[a-z][\w:-]*(?:\s[^>]*?)?\s*\/?>/gi,' ');
  if(source==='steam')text=text.replace(/\[\/?(?:list|p|h[1-6]|b|i|u|url|img|quote|code|table|tr|td|spoiler|\*)(?:=[^\]]*)?\]/gi,' ').replace(/\\\[/g,'[');
  return text.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim();
}
