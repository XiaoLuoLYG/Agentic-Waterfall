"""Read only the released SimBench event input folder."""
import json,sys
from pathlib import Path
from runtime_input import normalize_source,project_evidence

def load_case(folder):
    p=Path(folder).resolve()
    if p.name!='input':raise ValueError('expected public input folder')
    manifest=json.loads((p/'manifest.json').read_text());sources=json.loads((p/'allowed_sources.json').read_text());
    events=project_evidence([json.loads(x) for x in (p/'evidence.visible.jsonl').read_text().splitlines() if x.strip()])
    allowed=sorted({normalize_source(x) for x in sources.get('platforms',{}) if x})
    event=int(manifest['runtime_sequence']['current_event_position'])
    if any(not ((x.get('event')==event and x.get('step') in (1,2,3,4)) or (x.get('event')==event-1 and x.get('step')==5)) for x in events):raise ValueError('non-visible event row')
    if not allowed:raise ValueError('no allowed sources')
    times=[x['ts_end_ms'] for x in events if type(x.get('ts_end_ms')) is int and x['ts_end_ms']>0]
    if not times:raise ValueError('missing visible time cutoff')
    return {'as_of_ms':max(times),'case_id':manifest['case_id'],'user_id':str(manifest['user_id']),'event':int(manifest['runtime_sequence']['current_event_position']),'allowed_sources':allowed,'evidence':events}
if __name__=='__main__':print(json.dumps(load_case(sys.argv[1]),ensure_ascii=False))
