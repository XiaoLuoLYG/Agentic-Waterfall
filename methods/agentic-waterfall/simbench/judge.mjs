export function labelsFromJudgment(cards,judgment){
 if(!Array.isArray(judgment?.card_relevance)||judgment.card_relevance.length!==cards.length)throw Error('incomplete judgments');
 const labels={};for(const row of judgment.card_relevance){
  if(!Number.isInteger(row.rank)||row.rank<1||row.rank>cards.length||row.card_id!==cards[row.rank-1].card_id||!Number.isInteger(row.rel)||row.rel<1||row.rel>5||Object.hasOwn(labels,row.card_id))throw Error('invalid card judgment');
  labels[row.card_id]=row.rel;
 }return labels;
}
