"""Export one complete domain/window to a local API bridge; evaluator labels stay separate.
Requires complete source-validated JSONL files and official target-pair masking.
"""
import argparse,json
from pathlib import Path
from adapter import load_task
from official_components import load_components

def main():
    a=argparse.ArgumentParser(); a.add_argument('--data-dir',required=True); a.add_argument('--task-dir',required=True)
    a.add_argument('--output',required=True); a.add_argument('--domain',required=True)
    v=a.parse_args(); d=Path(v.data_dir); tasks=Path(v.task_dir)
    for name in ['user.json','item.json','review.json']:
        if not (d/name).is_file(): raise ValueError(f'Missing complete corpus file {name}')
        with (d/name).open() as f:
            for line in f:
                if json.loads(line)['source']!=v.domain: raise ValueError('Cross-domain/synthetic record in corpus')
    official=load_components(); tools=official.InteractionTool(str(d),str(tasks))
    bundle={'domain':v.domain,'users':tools.user_data,'items':tools.item_data,'reviews':tools.review_data,
            'user_reviews':tools.user_reviews,'item_reviews':tools.item_reviews,
            'provenance':{'source':'official InteractionTool after target pair masking','synthetic':False}}
    dest=Path(v.output)
    with dest.open('x') as f: json.dump(bundle,f)
    print(json.dumps({'users':len(tools.user_data),'items':len(tools.item_data),'reviews':len(tools.review_data),'output':str(dest)}))
if __name__=='__main__':main()
