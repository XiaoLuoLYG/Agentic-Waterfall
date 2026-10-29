"""Project released SimBench visible records; never open evaluator-only files."""
import json,sys
from pathlib import Path

FIELDS=('kind','record_id','session_id','event','step','title','ts_start_ms','ts_end_ms','url','canonical_url','content_key','page_type','engine','normalized_query')
CONTEXT=('referrer_domain','source_query','source_search_record_id','next_content_keys','previous_query')
def normalize_source(source):
    if not isinstance(source,str):raise ValueError('invalid source')
    source=source.lower().strip()
    aliases={'www.xiaohongshu.com':'xiaohongshu','www.bilibili.com':'bilibili','search.bilibili.com':'bilibili','www.zhihu.com':'zhihu'}
    return aliases.get(source,source)
def project_evidence(rows):
    out=[];visible_keys={r.get('content_key') for r in rows if r.get('content_key')}
    for r in rows:
        if r.get('kind') not in ('content_interest','search_intent'):raise ValueError('unexpected visible event')
        row={k:r[k] for k in FIELDS if k in r};row['platform']=normalize_source(r.get('platform',''))
        c=r.get('context') or {}
        if not isinstance(c,dict):raise ValueError('invalid context')
        row['context']={k:c[k] for k in CONTEXT if k in c}
        if 'next_content_keys' in row['context']:
            keys=row['context']['next_content_keys']
            if not isinstance(keys,list):raise ValueError('invalid forward references')
            row['context']['next_content_keys']=[key for key in keys if key in visible_keys]
        out.append(row)
    return out
if __name__=='__main__':
    path=Path(sys.argv[1]).resolve()
    if path.name!='evidence.visible.jsonl' or path.parent.name!='input':raise ValueError('expected released visible input path')
    rows=[json.loads(x) for x in path.read_text().splitlines() if x.strip()]
    print(json.dumps(project_evidence(rows),ensure_ascii=False))
