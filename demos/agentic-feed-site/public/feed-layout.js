export function chooseColumn(columns) {
  const visible=columns.every(column=>column.getClientRects().length>0);
  const sizes=columns.map(column=>visible?column.offsetHeight:column.querySelectorAll('.feed-item').length);
  return sizes[0]<=sizes[1]?0:1;
}
