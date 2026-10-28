const HEADERS = { memory: '【长期记忆】', context: '【当前关注】' };

export function formatProfile(state) {
  const parts = [state.profile || ''];
  for (const [key, marker] of Object.entries(HEADERS)) if (state[key]) parts.push(`${marker}\n${state[key]}`);
  return parts.join('\n\n').trim();
}

export function parseProfile(text, state) {
  const value = String(text), regex = /(?:^|\n\n)(【长期记忆】|【当前关注】)\n/g;
  const matches = [...value.matchAll(regex)];
  const result = { profile: value.slice(0, matches[0]?.index ?? value.length).trim(), memory: state.memory || '', context: state.context || '' };
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i], key = Object.keys(HEADERS).find(name => HEADERS[name] === match[1]);
    result[key] = value.slice(match.index + match[0].length, matches[i + 1]?.index ?? value.length).trim();
  }
  return result;
}
