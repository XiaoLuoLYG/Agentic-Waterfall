import {SYSTEM_PROMPT} from '../../../demos/agentic-feed/waterfall-core.mjs';

const INITIAL = 60, BYTE_LIMIT = 85000, INITIAL_BYTE_TARGET = 45000;
const compactFields = ['id', 'candidate_index', 'title', 'category', 'source_id', 'content_type', 'duration_ms', 'retrieval_score', 'retrieval_backend', 'retrieval_query'];
const messageBytes = (observation, context, extra) => Buffer.byteLength(JSON.stringify([
  {role: 'system', content: SYSTEM_PROMPT + extra},
  {role: 'user', content: JSON.stringify({observation, context})},
]));

function fitsHistory(observation, byteLimit = BYTE_LIMIT) {
  const candidates = observation.environment.candidate_pool || [];
  const context = {variant: 'full', call_index: 19, remaining_model_calls: 1};
  const compact = candidates.map(item => Object.fromEntries(compactFields.filter(key => item[key] !== undefined).map(key => [key, item[key]])));
  const merge = {...observation, environment: {...observation.environment, candidate_pool: compact}};
  const mergeBytes = messageBytes(merge, {...context, batch_stage: 'merge', batch_rankings: [candidates.map(item => item.id)]},
    ' Merge the batch rankings into the recommendation order using the visible candidate metadata.');
  const largest = candidates.reduce((best, item) => Buffer.byteLength(JSON.stringify(item)) > Buffer.byteLength(JSON.stringify(best)) ? item : best, {});
  const single = {...observation, environment: {...observation.environment, candidate_pool: candidates.length ? [largest] : [],
    recommendation_constraints: {...observation.environment.recommendation_constraints, mode: 'fixed_candidates', require_full_ranking: true, top_k: 1, acquire_enabled: false}}};
  const singleBytes = messageBytes(single, {...context, batch_stage: 'rank', batch_index: 9999},
    ' Rank every candidate in this batch exactly once and return one recommend action.');
  return Math.max(mergeBytes, singleBytes) <= byteLimit;
}

export function prepareHistory(source) {
  const input = structuredClone(source), observation = input.observation;
  const history = observation.behavior_events || [], owner = observation.user_id, cutoff = observation.observed_at;
  const visible = row => (row.user_id === undefined || row.user_id === owner) &&
    (!row.visible_to_policy_id || row.visible_to_policy_id === (input.protocol?.policy_id || 'full')) &&
    (!cutoff || ['feedback_available_at', 'available_at', 'received_at', 'ended_at', 'occurred_at', 'timestamp']
      .map(key => row[key]).filter(value => value !== undefined && value !== null && value !== '')
      .every(value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(cutoff)));
  const available = history.filter(visible);
  observation.behavior_events = available.slice(-INITIAL);
  observation.environment = {...observation.environment, sources: [...(observation.environment?.sources || []), {
    id: 'waterfall-history-archive', modes: [], tool: 'lookup_history', total_count: history.length,
    visible_count: available.length, initial_count: observation.behavior_events.length,
    description: 'The full original behavior history is retained. The initial input includes the latest 60 visible events. Use lookup_history to consult earlier records. An empty query paginates from newest to oldest; a nonempty query matches event JSON case-insensitively. Empty returned IDs with an unchanged next_offset mean the current context is full; the archive is still retained and current evidence remains available for recommendation.',
  }]};
  // Added history access must not displace the dataset's original source-tool allowance.
  input.protocol = {...input.protocol, max_tool_calls: (input.protocol?.max_tool_calls || 0) + 20};
  input.run_meta = {...input.run_meta, history_protocol: {version: 'recent60-with-original-history-lookup-v1',
    original_events: history.length, initial_events: observation.behavior_events.length, lookup_message_byte_limit: BYTE_LIMIT,
    original_history_retained: true, state_unchanged: true}};

  if (!fitsHistory(observation)) {
    const archive = observation.environment.sources.at(-1);
    archive.description = archive.description.replace('The initial input includes the latest 60 visible events.',
      'The initial input includes as many of the latest 60 visible events as fit the context; see initial_count, which can be zero.');
    const empty = {...observation, behavior_events: []};
    if (!fitsHistory(empty)) throw Error('history_context_byte_budget_exceeded');
    for (const row of available) {
      if (!fitsHistory({...empty, behavior_events: [row]})) throw Error('history_event_byte_budget_exceeded');
    }
    while (observation.behavior_events.length && !fitsHistory(observation, INITIAL_BYTE_TARGET)) observation.behavior_events.shift();
    archive.initial_count = observation.behavior_events.length;
    Object.assign(input.run_meta.history_protocol, {version: 'recent60-byte-bounded-with-original-history-lookup-v2',
      initial_events: observation.behavior_events.length, initial_message_byte_target: INITIAL_BYTE_TARGET});
  }
  const initialCount = observation.behavior_events.length;

  const lookupHistory = (args, {observation: current}) => {
    if (current.user_id !== owner) throw Error('history_owner_mismatch');
    const {query = '', offset = 0, limit = 30} = args;
    if (typeof query !== 'string' || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid_history_lookup');
    const matches = history.filter(visible).slice(0, available.length - initialCount).reverse()
      .filter(row => !query || JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));
    const seen = new Set((current.behavior_events || []).map(row => row.id)), additions = [];
    let cursor = offset;
    while (cursor < matches.length && additions.length < limit) {
      const row = matches[cursor];
      if (seen.has(row.id)) {cursor++; continue;}
      const proposed = {...current, behavior_events: [...(current.behavior_events || []), ...additions, row]};
      if (!fitsHistory(proposed)) return {dialogue: [], behavior_events: structuredClone(additions),
        next_offset: additions.length ? cursor : offset, budget_full: true};
      additions.push(row); seen.add(row.id); cursor++;
    }
    return {dialogue: [], behavior_events: structuredClone(additions), next_offset: cursor < matches.length ? cursor : null};
  };
  return {input, lookupHistory};
}
