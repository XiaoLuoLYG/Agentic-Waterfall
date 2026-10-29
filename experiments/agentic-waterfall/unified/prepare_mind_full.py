"""Stream every MIND-small dev impression into public Waterfall inputs without decoding labels."""
from pathlib import Path
import argparse
import collections
import hashlib
import json
import random
import tempfile


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def public_input(line, line_number, news, seen):
    fields = line.rstrip('\n').split('\t')
    impression_id = fields[0]
    decision_id = f'mind:test:{impression_id}'
    metadata = {'dataset': 'MIND-small/original-dev', 'split': 'test', 'stage': 'full',
                'synthetic': False, 'seed': 20261029, 'source_line': line_number}
    try:
        if len(fields) != 5 or not impression_id or not fields[1]:
            raise ValueError('invalid_impression_structure')
        if impression_id in seen:
            raise ValueError('duplicate_impression_id')
        seen.add(impression_id)
        _, user_id, timestamp, history_text, raw_candidates = fields
        encoded = raw_candidates.split()
        if not encoded or any('-' not in token for token in encoded):
            raise ValueError('invalid_candidate_structure')
        candidates = [token.rpartition('-')[0] for token in encoded]
        if len(candidates) != len(set(candidates)):
            raise ValueError('duplicate_candidate_id')
        history = history_text.split()
        if any(item_id not in news for item_id in candidates + history):
            raise ValueError('unknown_news_id')
        candidate_seed = int(hashlib.sha256(f'20261029:candidates:{impression_id}'.encode()).hexdigest(), 16)
        random.Random(candidate_seed).shuffle(candidates)
        events = [{'id': f'{decision_id}:history:{index}', 'type': 'click', 'item_id': item_id,
                   'item': news[item_id], 'history_position': index,
                   'time_precision': 'before_impression_no_exact_timestamp', 'source_channels': ['behavior']}
                  for index, item_id in enumerate(history)]
        observation = {'schema_version': '1.0', 'decision_id': decision_id, 'user_id': user_id,
                       'session_id': f'mind:{user_id}',
                       'trigger': {'kind': 'recommendation_request', 'dataset_time': timestamp},
                       'dialogue': [], 'behavior_events': events, 'user_state': {'version': 0, 'records': []},
                       'environment': {'candidate_pool': [news[item_id] for item_id in candidates],
                                       'sources': [], 'pending_queue': [], 'visible_item_ids': history,
                                       'content_version': 'MINDsmall-2115068f-local-v1'}}
        return {'observation': observation, 'protocol': {'mode': 'fixed_candidates', 'top_k': len(candidates),
                'require_full_ranking': True, 'max_model_calls': 20, 'max_tool_calls': 0,
                'max_acquired_items': 0, 'max_output_tokens': 8192}, 'run_meta': metadata}
    except ValueError as error:
        return {'observation': {'decision_id': f'{decision_id}:blocked-line-{line_number}',
                               'user_id': fields[1] if len(fields) > 1 else None},
                'preparation_status': 'blocked', 'preparation_error': str(error), 'run_meta': metadata}


def prepare(data_dir, output):
    data_dir, output = data_dir.resolve(), output.resolve()
    manifest_path = output.with_suffix('.manifest.json')
    if output.exists() or manifest_path.exists():
        raise FileExistsError('public input or manifest already exists')
    news_path = data_dir / 'prepared/news.json'
    behaviors_path = data_dir / 'MINDsmall_dev/behaviors.tsv'
    news = json.loads(news_path.read_text())
    forbidden = {'label', 'labels', 'groundtruth', 'target', 'relevance', 'rating', 'impressions_raw'}

    def check_keys(value):
        if isinstance(value, dict):
            if forbidden.intersection(value):
                raise ValueError('forbidden_field_in_public_news')
            for child in value.values():
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)

    check_keys(news)
    output.parent.mkdir(parents=True, exist_ok=True)
    count, users, seen, blocked = 0, set(), set(), collections.Counter()
    digest = hashlib.sha256()
    with behaviors_path.open() as source, output.open('xb') as destination:
        for count, line in enumerate(source, 1):
            row = public_input(line, count, news, seen)
            if row.get('preparation_status') == 'blocked':
                blocked[row['preparation_error']] += 1
            else:
                users.add(row['observation']['user_id'])
            encoded = (json.dumps(row, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
            destination.write(encoded)
            digest.update(encoded)
    manifest = {'dataset': 'MIND-small/original-dev', 'stage': 'full', 'synthetic': False,
                'source_rows': count, 'output_rows': count, 'ready_rows': count - sum(blocked.values()),
                'blocked_rows': sum(blocked.values()), 'blocked_reasons': dict(blocked), 'unique_users': len(users),
                'input_sha256': digest.hexdigest(), 'input_bytes': output.stat().st_size,
                'source_behaviors_sha256': sha(behaviors_path), 'source_news_sha256': sha(news_path),
                'labels_decoded': False, 'selection_rule': 'every original dev row; no label, size or outcome filtering',
                'candidate_shuffle_seed': 'SHA256(20261029:candidates:impression_id)',
                'history_policy': 'all supplied historical clicks, unchanged order; no truncation',
                'protocol': {'max_model_calls': 20, 'max_output_tokens': 8192},
                'overlap_note': 'Includes previously inspected and previously evaluated impressions; not an untouched heldout set.',
                'model_calls': 0}
    with manifest_path.open('x') as destination:
        json.dump(manifest, destination, ensure_ascii=False, indent=2)
        destination.write('\n')
    print(json.dumps({'output': str(output), 'manifest': str(manifest_path), 'rows': count,
                      'blocked_rows': manifest['blocked_rows'], 'bytes': manifest['input_bytes']}))


def self_check():
    news = {'A': {'id': 'A', 'title': 'alpha'}, 'B': {'id': 'B', 'title': 'beta'}}
    first = public_input('1\tu\tt\tA A B\tA-0 B-1\n', 1, news, set())
    changed = public_input('1\tu\tt\tA A B\tA-1 B-0\n', 1, news, set())
    assert first == changed
    assert len(first['observation']['behavior_events']) == 3
    assert first['observation']['environment']['visible_item_ids'] == ['A', 'A', 'B']
    assert public_input('2\tu\tt\t\tA-0 MISSING-1\n', 2, news, set())['preparation_status'] == 'blocked'
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        (root / 'prepared').mkdir(); (root / 'MINDsmall_dev').mkdir()
        (root / 'prepared/news.json').write_text(json.dumps(news))
        (root / 'MINDsmall_dev/behaviors.tsv').write_text('1\tu\tt\tA B\tA-0 B-1\nbad\n')
        prepare(root, root / 'public.jsonl')
        manifest = json.loads((root / 'public.manifest.json').read_text())
        assert manifest['source_rows'] == manifest['output_rows'] == 2
        assert manifest['ready_rows'] == 1 and manifest['blocked_rows'] == 1
    print('synthetic full-input preparation checks passed; no real labels or model calls')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--self-check', action='store_true')
    args = parser.parse_args()
    if args.self_check:
        self_check()
    elif args.data_dir and args.output:
        prepare(args.data_dir, args.output)
    else:
        parser.error('--data-dir and --output, or --self-check, required')
