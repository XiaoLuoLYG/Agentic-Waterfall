export function validatePlan(value){
 if(!value||!Array.isArray(value.queries)||value.queries.length>10||value.queries.some(q=>typeof q!=='string'||!q.trim())||new Set(value.queries).size!==value.queries.length)throw Error('invalid queries');
 if(typeof value.memory!=='string')throw Error('invalid memory');
 return {queries:value.queries,memory:value.memory};
}
export function validateRanking(ranking,acquired){
 if(!Array.isArray(ranking)||ranking.length>10||new Set(ranking).size!==ranking.length||ranking.some(id=>typeof id!=='string'||!acquired.includes(id)))throw Error('invalid ranking');
 return ranking;
}
