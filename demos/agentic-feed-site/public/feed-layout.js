export function chooseColumn(columns, prioritize = false) {
  const anchors=columns.map(column=>column.querySelector('.feed-item[data-seen="false"]'));
  if(prioritize && Boolean(anchors[0]) !== Boolean(anchors[1]))return anchors[0]?0:1;
  const visible=columns.every(column=>column.getClientRects().length>0);
  const sizes=columns.map(column=>visible?column.offsetHeight:column.querySelectorAll('.feed-item').length);
  return sizes[0]<=sizes[1]?0:1;
}
