export function sourceCoverage(allowed,manifest){
 if(!Array.isArray(allowed)||!manifest?.sources||typeof manifest.sources!=='object')throw Error('invalid sources');
 const active=allowed.filter(x=>Number.isInteger(manifest.sources[x])&&manifest.sources[x]>0),unavailable=allowed.filter(x=>!active.includes(x));
 if(!active.length)throw Error('no shared source');return {active,unavailable};
}
