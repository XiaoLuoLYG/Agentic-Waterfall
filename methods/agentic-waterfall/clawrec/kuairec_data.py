"""Project public KuaiRec plays into ClawRec UnifiedEvent update packets."""
import argparse
import json
import math
import subprocess
from datetime import datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
PACKETS=Path(__file__).parent/'source-snapshot/clawrec-synthesizing-user-state/scripts/build_update_packets.py'


def convert_events(observation):
    events=[]
    for event in observation['behavior_events']:
        if event.get('type') != 'play':
            raise ValueError('unsupported KuaiRec event')
        timestamp=datetime.fromisoformat(event['occurred_at'].replace('Z','+00:00'))
        if timestamp.tzinfo is None: raise ValueError('timestamp must have timezone')
        milliseconds=int(timestamp.timestamp()*1000)
        payload=event['payload'];text=payload.get('item_text') or ''
        if not isinstance(text,str): raise ValueError('invalid item text')
        signals=['play']
        ratio=payload.get('watch_ratio')
        if ratio is not None:
            if isinstance(ratio,bool) or not isinstance(ratio,(float,int)) or not math.isfinite(ratio):raise ValueError('invalid watch ratio')
            signals.append(f'watch_ratio={ratio}')
        events.append({'record_id':str(event['id']),'kind':'content_interest','session_id':str(observation['session_id']),
                       'ts_start_ms':milliseconds,'ts_end_ms':milliseconds,'platform':'kuairec','page_type':'video',
                       'content_key':f"kuairec:video:{event['item_id']}",'title':text,'canonical_url':'',
                       'context':{'source_search_record_id':None,'behavior_signal_types':signals}})
    return events


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args()
    with Path(args.input).open() as f: sample=json.loads(next(line for line in f if line.strip()))
    events=convert_events(sample['observation'])
    if not events:raise ValueError('empty history')
    out=Path(args.output);out.mkdir(parents=True,exist_ok=False)
    path=out/'evidence.jsonl'
    with path.open('x') as f:
        for event in events:f.write(json.dumps(event,ensure_ascii=False)+'\n')
    result=subprocess.run(['python3',str(PACKETS),'--input',str(path)],capture_output=True,text=True,check=False)
    (out/'packet-stderr.log').write_text(result.stderr)
    if result.returncode:raise RuntimeError('author packet builder failed')
    (out/'update-packets.md').write_text(result.stdout)
    print(json.dumps({'events':len(events),'output':str(out),'status':'packet_prepared'}))

if __name__=='__main__':main()
