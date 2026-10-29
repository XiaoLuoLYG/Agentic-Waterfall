"""Select predictions in frozen public cohort order without reading labels."""
import argparse,hashlib,json
from pathlib import Path

def select_predictions(inputs,rows):
    ids=[x['observation']['decision_id'] for x in inputs]
    if len(ids)!=len(set(ids)):raise ValueError('duplicate input decision')
    index={row['decision_id']:row for row in rows}
    if len(index)!=len(rows):raise ValueError('duplicate prediction')
    if not set(ids)<=set(index):raise ValueError('missing cohort predictions')
    return [index[x] for x in ids]

def main():
    p=argparse.ArgumentParser();p.add_argument('--inputs',required=True);p.add_argument('--predictions',required=True);p.add_argument('--output',required=True);p.add_argument('--tfidf-receipt',help='verify the original TF-IDF receipt to record zero model calls');a=p.parse_args()
    input_bytes=Path(a.inputs).read_bytes();prediction_bytes=Path(a.predictions).read_bytes()
    inputs=[json.loads(x) for x in input_bytes.splitlines() if x.strip()];rows=[json.loads(x) for x in prediction_bytes.splitlines() if x.strip()]
    selected=select_predictions(inputs,rows)
    if a.tfidf_receipt:
        receipt=json.loads(Path(a.tfidf_receipt).read_text())
        if receipt.get('method')!='tfidf' or receipt.get('exit_code')!=0 or receipt.get('sha256')!=hashlib.sha256(prediction_bytes).hexdigest():raise ValueError('TF-IDF receipt mismatch')
        selected=[dict(row,model_request_count=0,model_calls=[]) for row in selected]
    with Path(a.output).open('x') as f:
        for row in selected:f.write(json.dumps(row,ensure_ascii=False)+'\n')
    print(json.dumps({'cohort':len(inputs),'selected':len(selected),'input_sha256':hashlib.sha256(input_bytes).hexdigest(),'source_predictions_sha256':hashlib.sha256(prediction_bytes).hexdigest(),'model_calls':0,'labels_read':False}))
if __name__=='__main__':main()
