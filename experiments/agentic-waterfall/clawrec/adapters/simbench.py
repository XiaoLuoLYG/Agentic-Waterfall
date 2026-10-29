"""Public-only SimBench loader. This module never opens private/ or review_md/."""
from __future__ import annotations
import datetime, json, pathlib, re


def read_public_event(cases_root, workspace_id, event_id, sanitize=True):
    if not re.fullmatch(r'group_\d+__user_\d+', workspace_id) or event_id not in range(1, 6):
        raise ValueError('invalid workspace/event')
    input_dir = pathlib.Path(cases_root) / workspace_id / f'event_{event_id:02d}' / 'input'
    rows = [json.loads(line) for line in (input_dir/'evidence.visible.jsonl').read_text().splitlines() if line.strip()]
    for row in rows:
        permitted = (row['event'] == event_id and row['step'] in (1,2,3,4)) or (row['event'] == event_id-1 and row['step'] == 5)
        if not permitted: raise ValueError('non-visible row')
    # Public-only fix: extractor-generated forward links may name hidden/future content.
    # Retain only links backed by content rows in this already-visible input; no private lookup.
    known_keys = {r.get('content_key') for r in rows if r.get('content_key')}
    removed = 0
    if sanitize:
        for row in rows:
            context = row.get('context', {})
            if 'next_content_keys' in context:
                original = context['next_content_keys']
                context['next_content_keys'] = [key for key in original if key in known_keys]
                removed += len(original) - len(context['next_content_keys'])
    # These files contain descriptive statistics, not executable quotas or a source permission list.
    return {'workspace_id': workspace_id, 'event_id': event_id, 'evidence': rows,
            'adaptation': {'name': 'visible-references-only-v1' if sanitize else 'upstream-raw', 'removed_forward_references': removed},
            'source_statistics': json.loads((input_dir/'allowed_sources.json').read_text()),
            'budget_statistics': json.loads((input_dir/'budget.json').read_text())}


def observation(public, state=None):
    rows = public['evidence']; wid = public['workspace_id']; eid = public['event_id']
    if state is None and eid > 1: raise ValueError('prior method state required after event 1')
    timestamp = max([r['ts_end_ms'] for r in rows], default=0)
    return {'schema_version':'1.0', 'decision_id':f'{wid}__event_{eid:02d}',
            'user_id':wid, 'session_id':wid, 'observed_at':datetime.datetime.fromtimestamp(timestamp/1000,datetime.timezone.utc).isoformat(),
            'trigger':'benchmark_event', 'dialogue':[],
            'behavior_events':[{'id':f"e{r['event']}:s{r['step']}:{r['record_id']}", 'type':r['kind'], 'timestamp_ms':r['ts_end_ms'], 'origin':'simulated_gui_grounded', 'payload':r} for r in rows],
            'user_state':state if state is not None else {'version':0,'records':[]},
            'environment':{'candidate_pool':[], 'sources':[], 'pending_queue':[], 'visible_item_ids':[], 'content_version':'unconfigured'}}


def stage_input(public, destination):
    """Create only this event's evidence; do not mount all future event directories."""
    path = pathlib.Path(destination); path.mkdir(parents=True,exist_ok=False)
    (path/'evidence.visible.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in public['evidence']))
    (path/'source-statistics.json').write_text(json.dumps(public['source_statistics'],ensure_ascii=False,indent=2))
    (path/'budget-statistics.json').write_text(json.dumps(public['budget_statistics'],ensure_ascii=False,indent=2))
    return path
