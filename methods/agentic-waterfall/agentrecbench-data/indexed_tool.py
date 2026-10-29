"""Low-memory AgentRecBench tool with pinned-file offsets and official masking."""
import hashlib,json,os,sqlite3
from pathlib import Path

KINDS=('item','user','review')
def build_index(data,output):
    data=Path(data);output=Path(output);part=output.with_suffix(output.suffix+'.part')
    if output.exists() or part.exists():raise FileExistsError('preserve existing index or unfinished part')
    output.parent.mkdir(parents=True,exist_ok=True);fd=os.open(part,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
    db=sqlite3.connect(part)
    try:
        db.executescript('CREATE TABLE meta (kind TEXT PRIMARY KEY, bytes INTEGER, mtime_ns INTEGER, sha256 TEXT); CREATE TABLE item (id TEXT PRIMARY KEY, off INTEGER, len INTEGER); CREATE TABLE user (id TEXT PRIMARY KEY, off INTEGER, len INTEGER); CREATE TABLE review (seq INTEGER PRIMARY KEY, id TEXT, user_id TEXT, item_id TEXT, off INTEGER, len INTEGER);')
        for kind in KINDS:
            path=data/(kind+'.json');sha=hashlib.sha256();offset=0;pending=[];count=0;st=path.stat()
            with path.open('rb') as f:
                while True:
                    raw=f.readline()
                    if not raw:break
                    row=json.loads(raw);length=len(raw);sha.update(raw)
                    if kind=='review':pending.append((count,str(row['review_id']),str(row['user_id']),str(row['item_id']),offset,length))
                    else:pending.append((str(row[kind+'_id']),offset,length))
                    offset+=length;count+=1
                    if len(pending)>=2000:
                        db.executemany('INSERT INTO review VALUES (?,?,?,?,?,?)' if kind=='review' else f'INSERT OR REPLACE INTO {kind} VALUES (?,?,?)',pending);pending=[]
                if pending:db.executemany('INSERT INTO review VALUES (?,?,?,?,?,?)' if kind=='review' else f'INSERT OR REPLACE INTO {kind} VALUES (?,?,?)',pending)
            if path.stat().st_size!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:raise ValueError('input changed during indexing')
            receipt=path.with_name(path.name+'.receipt.json')
            if receipt.exists():
                meta=json.loads(receipt.read_text())
                if meta['bytes']!=offset or meta['sha256']!=sha.hexdigest():raise ValueError('input does not match download receipt')
            db.execute('INSERT INTO meta VALUES (?,?,?,?)',(kind,offset,st.st_mtime_ns,sha.hexdigest()));db.commit();print(json.dumps({'indexed':kind,'rows':count,'bytes':offset}),flush=True)
        db.executescript('CREATE INDEX review_user ON review(user_id,seq); CREATE INDEX review_item ON review(item_id,seq); CREATE INDEX review_id ON review(id,seq);');db.commit()
    finally:db.close()
    os.link(part,output);part.unlink();return output

class IndexedTool:
    def __init__(self,data,index,block_set_dir):
        self.data=Path(data);self.db=sqlite3.connect(f'file:{Path(index).resolve()}?mode=ro',uri=True);self.files={};self.blocked=set()
        for kind,size,mtime,_ in self.db.execute('SELECT kind,bytes,mtime_ns,sha256 FROM meta'):
            p=self.data/(kind+'.json');st=p.stat()
            if st.st_size!=size or st.st_mtime_ns!=mtime:raise ValueError('indexed source has changed')
            self.files[kind]=p.open('rb')
        if set(self.files)!=set(KINDS):raise ValueError('incomplete index')
        folder=Path(block_set_dir)
        for taskfile in (folder/'tasks').glob('task_*.json'):
            task=json.loads(taskfile.read_text())
            if task['type']=='user_behavior_simulation':item=task['item_id']
            else:
                gt=folder/'groundtruth'/taskfile.name.replace('task_','groundtruth_');item=json.loads(gt.read_text())['ground truth']
                if item not in task['candidate_list']:raise ValueError('ground truth not in candidates')
            self.blocked.add((task['user_id'],item))
        if not self.blocked:raise ValueError('empty mask')
    def _read(self,kind,off,length):
        f=self.files[kind];f.seek(off);raw=f.read(length)
        if len(raw)!=length:raise ValueError('truncated indexed file')
        return json.loads(raw)
    def _item(self,kind,id):
        row=self.db.execute(f'SELECT off,len FROM {kind} WHERE id=?',(str(id),)).fetchone()
        return self._read(kind,*row) if row else None
    def get_user(self,user_id):return self._item('user',user_id)
    def get_item(self,item_id=None):return self._item('item',item_id) if item_id else None
    def get_reviews(self,item_id=None,user_id=None,review_id=None):
        if review_id:field,value,order='id',review_id,'DESC'
        elif item_id:field,value,order='item_id',item_id,'ASC'
        elif user_id:field,value,order='user_id',user_id,'ASC'
        else:return []
        rows=self.db.execute(f'SELECT off,len,user_id,item_id FROM review WHERE {field}=? ORDER BY seq {order}',(str(value),));out=[]
        for off,length,user,item in rows:
            if (user,item) in self.blocked:continue
            out.append(self._read('review',off,length))
            if review_id:break
        return out
    def close(self):
        for f in self.files.values():f.close()
        self.db.close()

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--data',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    build_index(args.data,args.output)
