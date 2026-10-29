"""Frozen, source-scoped local search for SimBench adaptations; no labels or network."""
import math,re
from datetime import datetime
from collections import Counter
from urllib.parse import urlsplit

FIELDS={'id','source','title','text','url'}
OPTIONAL={'published_at','captured_at'}
def tokens(text):
    a=re.findall(r'[a-z0-9]+',text.lower())
    for part in re.findall(r'[\u3400-\u9fff]+',text):a.extend(part);a.extend(part[i:i+2] for i in range(len(part)-1))
    return a
def published_ms(value):
    if not isinstance(value,str) or not value:return None
    try:
        if value.isdecimal():
            n=int(value)
            if n<1_000_000_000:return None
            return n if n>=100_000_000_000 else n*1000
        d=datetime.fromisoformat(value.replace('Z','+00:00'))
        return int(d.timestamp()*1000) if d.tzinfo is not None else None
    except (ValueError,OverflowError,OSError):return None

class FrozenCatalog:
    def __init__(self,records):
        if not isinstance(records,list) or not records:raise ValueError('empty catalog')
        self.records=[]
        for r in records:
            if not isinstance(r,dict) or not FIELDS<=set(r) or not set(r)<=FIELDS|OPTIONAL or any(not isinstance(r[k],str) for k in r):raise ValueError('invalid fields')
            if not r['id'] or not r['source'] or not r['title'] or urlsplit(r['url']).scheme not in ('http','https') or not urlsplit(r['url']).hostname:raise ValueError('invalid catalog record')
            self.records.append(dict(r))
        if len({r['id'] for r in self.records})!=len(self.records):raise ValueError('duplicate catalog id')
        self.terms=[Counter(tokens(r['title']+' '+r['text'])) for r in self.records]
    def search(self,source,query,limit,as_of_ms=None):
        if as_of_ms is not None and (type(as_of_ms) is not int or as_of_ms<=0):raise ValueError("invalid observation time")
        if not isinstance(query,str) or not query.strip() or type(limit) is not int or not 1<=limit<=10:raise ValueError('invalid query')
        subset=[i for i,r in enumerate(self.records) if r['source']==source and (as_of_ms is None or (published_ms(r.get('published_at','')) is not None and published_ms(r.get('published_at',''))<=as_of_ms))]
        if not subset:return []
        q=set(tokens(query));N=len(subset);average=sum(sum(self.terms[i].values()) for i in subset)/N or 1
        df={t:sum(t in self.terms[i] for i in subset) for t in q};scores=[]
        for i in subset:
            doc=self.terms[i];length=sum(doc.values());score=0.0
            for t in q:
                f=doc[t]
                if f:score+=math.log(1+(N-df[t]+0.5)/(df[t]+0.5))*(f*2.2)/(f+1.2*(0.25+0.75*length/average))
            if score>0:scores.append((score,i))
        scores.sort(key=lambda x:(-x[0],self.records[x[1]]['id']))
        return [dict(self.records[i]) for _,i in scores[:limit]]
class SearchSession:
    def __init__(self,catalog,allowed_sources):
        if not isinstance(allowed_sources,list) or not all(isinstance(x,str) and x for x in allowed_sources):raise ValueError('invalid sources')
        self.catalog=catalog;self.allowed=set(allowed_sources);self.searches=0;self.acquired={}
    def search(self,source,query,limit):
        if self.searches>=10:raise ValueError('search budget exhausted')
        self.searches+=1
        if source not in self.allowed:raise ValueError('source not permitted')
        found=self.catalog.search(source,query,limit)
        for item in found:self.acquired[item['id']]=item
        return found
