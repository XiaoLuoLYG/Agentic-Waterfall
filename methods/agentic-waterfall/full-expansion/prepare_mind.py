"""Index label-free full MIND inputs and exclude the existing baseline queue."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import sqlite3
import sys

HERE = Path(__file__).resolve().parent
WORK = HERE.parents[2]
SOURCE = WORK/'output/agentic-waterfall/waterfall-full-20261029/input-preparation/mind-full.jsonl'
LEGACY = WORK/'methods/agentic-waterfall/protocols/mind-common-i2agent-967-20261029/inputs-eligible.jsonl'
DIAGNOSTIC = WORK/'datasets/agentic-waterfall/mind-small/prepared/test/inputs.jsonl'
METHODS = ('clawrec', 'generic-agent', 'i2agent', 'recbot', 'mars')


def public_content(obj):
    obs = obj['observation']
    return [e['item'] for e in obs['behavior_events']], obs['environment']['candidate_pool']


def build_index(source, old, output, expected_total=None, expected_old=None, diagnostics=(), expected_hash=None):
    if output.exists():
        raise FileExistsError(output)
    legacy = {}
    if old is not None:
        with old.open() as f:
            legacy = {x['observation']['decision_id']: public_content(x) for x in map(json.loads, f)}
    if expected_old is not None and len(legacy) != expected_old:
        raise ValueError('legacy count mismatch')
    temp = output.with_name(output.name+'.building')
    if temp.exists():
        raise FileExistsError(temp)
    db = sqlite3.connect(temp)
    counts = {'total': 0, 'eligible': 0, 'legacy': 0, 'jobs': 0, 'diagnostic': 0}
    digest = hashlib.sha256()
    try:
        db.executescript('CREATE TABLE tasks (id INTEGER PRIMARY KEY, decision_id TEXT UNIQUE NOT NULL, offset INTEGER NOT NULL, bytes INTEGER NOT NULL, eligible INTEGER NOT NULL, legacy INTEGER NOT NULL, diagnostic INTEGER NOT NULL); CREATE TABLE jobs (task INTEGER NOT NULL, decision_id TEXT NOT NULL, method TEXT NOT NULL, status TEXT NOT NULL DEFAULT "pending", attempt INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(task,method));')
        with source.open('rb') as f:
            while True:
                offset = f.tell()
                line = f.readline()
                if not line:
                    break
                digest.update(line)
                obj = json.loads(line)
                obs = obj['observation']
                decision = obs['decision_id']
                history, candidates = public_content(obj)
                if not candidates or len({v['id'] for v in candidates}) != len(candidates):
                    raise ValueError('invalid public candidates: '+decision)
                eligible = len(history) >= 2
                was_legacy = decision in legacy
                if was_legacy and (history, candidates) != legacy[decision]:
                    raise ValueError('legacy input mismatch: '+decision)
                index = counts['total']
                diag = decision in diagnostics
                db.execute('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)', (index, decision, offset, len(line), eligible, was_legacy, diag))
                if not was_legacy:
                    rows = [(index, decision, m) for m in METHODS if m != 'i2agent' or eligible]
                    db.executemany('INSERT INTO jobs(task,decision_id,method) VALUES(?,?,?)', rows)
                    counts['jobs'] += len(rows)
                counts['total'] += 1
                counts['eligible'] += eligible
                counts['legacy'] += was_legacy
                counts['diagnostic'] += diag
        if (expected_total is not None and counts['total'] != expected_total) or (expected_old is not None and counts['legacy'] != expected_old):
            raise ValueError('full or legacy count mismatch')
        if expected_hash and digest.hexdigest() != expected_hash:
            raise ValueError('full input hash mismatch')
        db.execute('CREATE INDEX job_status ON jobs(status,task,method)')
        db.commit()
        counts['source_sha256'] = digest.hexdigest()
    finally:
        db.close()
    os.rename(temp, output)
    return counts


if __name__ == '__main__':
    if len(sys.argv) == 1:
        with DIAGNOSTIC.open() as f:
            diagnostics = {x['decision_id'] for x in map(json.loads, f)}
        source_manifest = json.loads(SOURCE.with_name('mind-full.manifest.json').read_text())
        source, legacy, output = SOURCE, LEGACY, HERE/'mind-index.sqlite'
        result = build_index(source, legacy, output, 73152, 967, diagnostics, source_manifest['input_sha256'])
        manifest_path = HERE/'mind-index-manifest.json'
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument('--source', type=Path, required=True)
        parser.add_argument('--output', type=Path, required=True)
        parser.add_argument('--legacy', type=Path)
        parser.add_argument('--expected-total', type=int)
        args = parser.parse_args()
        source, legacy, output = args.source.resolve(), args.legacy, args.output.resolve()
        result = build_index(source, legacy, output, expected_total=args.expected_total)
        manifest_path = output.with_suffix('.manifest.json')
    manifest_path.write_text(json.dumps({**result, 'source': str(source), 'legacy_source': str(legacy) if legacy else None,
        'labels_read': False, 'training': False, 'diagnostics_are_not_independent': True}, indent=2)+'\n')
    print(json.dumps(result))
