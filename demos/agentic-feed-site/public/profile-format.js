export function formatProfile(state, interests = state.interests) {
  return JSON.stringify({ ...state, interests }, null, 2);
}

export function parseProfile(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('JSON 格式不正确，请检查引号、逗号和括号。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('画像须为 JSON 对象。');
  return value;
}
