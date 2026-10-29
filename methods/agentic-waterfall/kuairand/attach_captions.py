"""Join the verified official caption file to frozen public tasks without reading targets."""
import csv,hashlib,json,math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3];DATA=ROOT/'datasets/agentic-waterfall/kuairand-1k';SOURCE=DATA/'model-36-public-v2';OUTPUT=DATA/'model-36-caption-verified-v2'
def clip(text,limit):return text.encode('utf-8')[:limit].decode('utf-8',errors='ignore')
def checked_caption(basic,row):
    try:
        a=float(basic['video_duration']);b=float(row['duration'])
        if not math.isfinite(a) or not math.isfinite(b):return 'unverifiable'
        return 'matched' if abs(a-b)<=1 else 'mismatch'
    except (ValueError,TypeError,KeyError):return 'unverifiable'
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
    return h.hexdigest()
def main():
    full=DATA/'kuairand-video-captions-20261029.csv';manifest=json.loads((DATA/'captions-full-20261029-manifest.json').read_text())
    if not manifest.get('official_md5_verified') or full.stat().st_size!=manifest['bytes'] or sha(full)!=manifest['sha256']:raise ValueError('full caption file not verified')
    raw=(SOURCE/'public-inputs.jsonl').read_bytes();source=json.loads((SOURCE/'manifest.json').read_text())
    if hashlib.sha256(raw).hexdigest()!=source['public_sha256']:raise ValueError('public input changed')
    rows=[json.loads(x) for x in raw.splitlines()];ids={int(i['id'].split(':')[1]) for x in rows for i in x['observation']['environment']['candidate_pool']};ids.update(int(e['item_id'].split(':')[1]) for x in rows for e in x['observation']['behavior_events'])
    basic={}
    with (DATA/'raw/video_features_basic_1k.csv').open(newline='',encoding='utf-8') as f:
        for r in csv.DictReader(f):
            v=int(r['video_id'])
            if v in ids:basic[v]=r
    selected={};previous=-1;unverified=[];mismatch=[];empty=[]
    with full.open(newline='',encoding='utf-8') as f:
        reader=csv.DictReader(f,strict=True)
        if reader.fieldnames!=['final_video_id','caption','show_cover_text','duration']:raise ValueError('unexpected CSV columns')
        for r in reader:
            v=int(r['final_video_id'])
            if v!=previous+1:raise ValueError('unexpected video ID order')
            previous=v
            if v not in ids:continue
            if any(x is None for x in r.values()):raise ValueError('incomplete caption row')
            check=checked_caption(basic.get(v,{}),r)
            if check=='unverifiable':unverified.append(v)
            elif check=='mismatch':mismatch.append(v)
            else:selected[v]=r
            if not r['caption'] and not r['show_cover_text']:empty.append(v)
            if len(selected)+len(unverified)+len(mismatch)==len(ids):break
    missing=ids-set(selected)-set(unverified)-set(mismatch)
    if mismatch or missing:raise ValueError(f'caption ID join failed: {len(mismatch)} mismatches, {len(missing)} missing')
    for row in rows:
        obs=row['observation']
        for item in obs['environment']['candidate_pool']:
            v=int(item['id'].split(':')[1]);r=selected.get(v)
            if r:item['title']=clip(r['caption'],64) or item['title'];item['text']+='; cover_text='+clip(r['show_cover_text'],32);item['content_hash']=hashlib.sha256(json.dumps(r,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        for event in obs['behavior_events']:
            v=int(event['item_id'].split(':')[1]);r=selected.get(v)
            if r:event['payload']['caption_excerpt']=clip(r['caption'],64);event['payload']['cover_excerpt']=clip(r['show_cover_text'],32)
        row['run_meta'].update(content_scope='official 2026 supplementary captions, validated against basic duration',caption_missing_policy='use basic metadata only for unverifiable durations',caption_temporal_scope='retrospective content; not proven available in 2022')
    result=(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows)).encode();OUTPUT.mkdir(exist_ok=False);(OUTPUT/'public-inputs.jsonl').write_bytes(result)
    (OUTPUT/'manifest.json').write_text(json.dumps({'tasks':len(rows),'task_ids':source['task_ids'],'input_sha256':hashlib.sha256(result).hexdigest(),'full_caption_sha256':manifest['sha256'],'source_public_sha256':source['public_sha256'],'matched_ids':len(selected),'unverifiable_ids':unverified,'empty_text_ids':empty,'missing_ids':[],'duration_mismatches':[],'labels_read':False,'history_limit':64,'content_time':'2026 supplement, not established as available in 2022'},indent=2)+'\n')
    print(json.dumps({'tasks':len(rows),'matched':len(selected),'unverifiable':len(unverified),'empty_text':len(empty)}))
if __name__=='__main__':main()
