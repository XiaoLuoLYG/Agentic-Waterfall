"""Read a verified frozen corpus and return source-scoped deterministic results."""
import hashlib,json,sys
from pathlib import Path
from catalog import FrozenCatalog
p=Path(sys.argv[1]).resolve();raw=(p/'catalog.jsonl').read_bytes();meta=json.loads((p/'manifest.json').read_text())
if hashlib.sha256(raw).hexdigest()!=meta['catalog_sha256']:raise ValueError('frozen catalog hash mismatch')
catalog=FrozenCatalog([json.loads(x) for x in raw.splitlines() if x.strip()]);request=json.load(sys.stdin)
print(json.dumps(catalog.search(request['source'],request['query'],request['limit'],request.get('as_of_ms')),ensure_ascii=False))
