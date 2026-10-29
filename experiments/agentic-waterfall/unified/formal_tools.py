"""Public observations and existing masked disk tools for the Waterfall batch."""
import json, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
request = json.load(sys.stdin)
if request['operation'] == 'agentrecbench':
    sys.path.insert(0, str(root/'methods/agentic-waterfall/agentrecbench-data'))
    from indexed_tool import IndexedTool
    if request['tool'] not in ('get_user', 'get_item', 'get_reviews'):
        raise ValueError('unsupported benchmark tool')
    # The existing tool reads targets only to mask their reviews, never to return labels.
    tool = IndexedTool(request['data_dir'], request['index_file'], request['task_dir'])
    try:
        result = getattr(tool, request['tool'])(**request['arguments'])
    finally:
        tool.close()
elif request['operation'] == 'clawrec':
    sys.path.insert(0, str(root/'methods/agentic-waterfall/simbench'))
    sys.path.insert(0, str(root/'experiments/agentic-waterfall/clawrec/adapters'))
    from case_input import load_case
    from simbench import observation
    folder = Path(request['case_input']).resolve()
    case = load_case(folder)
    workspace = folder.parent.parent.name
    event = case['event']
    previous = request.get('previous')
    state = None
    if event == 1:
        if previous is not None:
            raise ValueError('first event must not have prior state')
    else:
        if not isinstance(previous, dict):
            raise ValueError('prior state required')
        prior_observation = previous.get('input', {}).get('observation', {})
        state = previous.get('result', {}).get('state_after')
        if (prior_observation.get('user_id') != workspace or
            prior_observation.get('decision_id') != f'{workspace}__event_{event-1:02d}' or
            not isinstance(state, dict) or type(state.get('version')) is not int or
            not isinstance(state.get('records'), list)):
            raise ValueError('prior state mismatch')
    public = {'workspace_id': workspace, 'event_id': event, 'evidence': case['evidence']}
    result = {'case': case, 'observation': observation(public, state)}
else:
    raise ValueError('unsupported operation')
print(json.dumps(result, ensure_ascii=False))
