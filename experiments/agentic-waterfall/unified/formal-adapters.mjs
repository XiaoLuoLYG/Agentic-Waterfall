import {readFileSync} from 'node:fs';
import {resolve, dirname, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {makeInput, makeAcquire, preloadCandidateDetails} from '../agentrecbench/scripts/waterfall_bridge.mjs';
import {sourceCoverage} from '../../../methods/agentic-waterfall/simbench/coverage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
function python(script, args, input) {
  const result = spawnSync('python3', [script, ...args], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'},
  });
  if (result.error || result.status !== 0) throw Error(`formal_tool_failed: ${result.error?.message || result.stderr.trim()}`);
  return JSON.parse(result.stdout);
}

// Paths are absolute or relative to the frozen code root; previous is the prior {input,result}.
export async function buildFormalAdapter(task, previous = null) {
  if (!task || typeof task.root !== 'string') throw Error('formal_code_root_required');
  const root = resolve(task.root), path = key => {
    if (typeof task[key] !== 'string' || !task[key]) throw Error(`missing_${key}`);
    return resolve(root, task[key]);
  };
  const toolCalls = [];
  const query = request => python(resolve(here, 'formal_tools.py'), [root], request);
  if (task.dataset === 'agentrecbench') {
    if (previous !== null) throw Error('independent_benchmark_task_has_prior_state');
    if (!['amazon', 'goodreads', 'yelp'].includes(task.domain)) throw Error('invalid_domain');
    const taskFile = path('task_file'), raw = JSON.parse(readFileSync(taskFile, 'utf8'));
    const taskId = String(task.task_id ?? basename(taskFile).match(/^task_(\d+)\.json$/)?.[1]);
    if (!/^\d+$/.test(taskId) || !Array.isArray(raw.candidate_list) || raw.candidate_list.length !== 20 || new Set(raw.candidate_list).size !== 20) throw Error('invalid_benchmark_task');
    const locations = Object.fromEntries(['data_dir', 'index_file', 'task_dir'].map(key => [key, path(key)]));
    const input = makeInput(raw, 'short_term', taskId);
    input.observation.decision_id = input.observation.session_id = `agentrecbench:short_term:${task.domain}:${taskId}`;
    input.run_meta.domain = task.domain;
    input.run_meta.tool_backend = 'existing_target_masked_sqlite_index';
    const bundle = {users: {}, items: {}, reviews: {}, item_reviews: {}, user_reviews: {}};
    const acquire = makeAcquire(bundle, raw, toolCalls, async (tool, arguments_) => query({operation: 'agentrecbench', ...locations, tool, arguments: arguments_}));
    await preloadCandidateDetails(input,acquire);
    return {input, acquire, toolCalls};
  }
  if (task.dataset !== 'clawrec') throw Error('unsupported_formal_dataset');
  const data = query({operation: 'clawrec', case_input: path('case_input'), previous});
  const snapshot = path('snapshot_dir'), raw = readFileSync(resolve(snapshot, 'catalog.jsonl'));
  const manifest = JSON.parse(readFileSync(resolve(snapshot, 'manifest.json'), 'utf8'));
  if (createHash('sha256').update(raw).digest('hex') !== manifest.catalog_sha256) throw Error('snapshot_hash_mismatch');
  const coverage = sourceCoverage(data.case.allowed_sources, manifest);
  const input = {observation: {...data.observation, environment: {...data.observation.environment,
    sources: coverage.active.map(id => ({id, modes: ['search'], description: 'Frozen BM25 catalog; each source query returns up to 10 items published before the observation cutoff.'})),
    content_version: manifest.catalog_sha256,
  }}, protocol: {mode: 'acquire', top_k: 20, max_model_calls: 4, max_tool_calls: 10, max_acquired_items: 100, max_output_tokens: 8192},
  run_meta: {case_id: data.case.case_id, event: data.case.event, as_of_ms: data.case.as_of_ms,
    snapshot_sha256: manifest.catalog_sha256, content_environment: 'frozen_public_snapshot',
    unavailable_sources: coverage.unavailable, official_effect_evaluation: false, synthetic: false}};
  const acquire = async (args, context) => {
    if (args.mode !== 'search' || !Array.isArray(args.source_ids) || !args.source_ids.length ||
        args.source_ids.some(source => !coverage.active.includes(source)) ||
        !Number.isInteger(args.limit) || args.limit < 1 ||
        args.source_ids.length > context.remaining_tool_calls) throw Error('invalid_frozen_search');
    const items = [], evidence = [];
    for (const source of args.source_ids) {
      const request = {source, query: args.query, limit: Math.min(args.limit, 10), as_of_ms: data.case.as_of_ms};
      const found = python(resolve(root, 'methods/agentic-waterfall/simbench/search_cli.py'), [snapshot], request);
      toolCalls.push({tool: 'frozen_search', arguments: request, result: found});
      items.push(...found.map(item => ({...item, source_id: item.source, content_type: 'benchmark_content'})));
      evidence.push({source, query: args.query, returned: found.length, snapshot_sha256: manifest.catalog_sha256});
    }
    return {items: items.slice(0, args.limit), evidence, actual_requests: args.source_ids.length};
  };
  return {input, acquire, toolCalls};
}
