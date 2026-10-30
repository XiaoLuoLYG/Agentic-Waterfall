#!/usr/bin/env python3
"""Read-only experiment receipts; Ctrl+C never signals experiment processes."""
import argparse
from collections import Counter, defaultdict
import datetime
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import sys
import time

sys.dont_write_bytecode = True
CACHE = {}


def cached(path, loader):
    path = Path(path)
    stat = path.stat()
    stamp = (stat.st_mtime_ns, stat.st_size)
    if path not in CACHE or CACHE[path][0] != stamp:
        CACHE[path] = (stamp, loader(path))
    return CACHE[path][1]


def read(path):
    try:
        return cached(path, lambda p: json.loads(p.read_text()))
    except (OSError, ValueError):
        return {}


def jsonlines(path):
    def parse(p):
        rows = []
        for line in p.read_text().splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass  # A writer may not have finished its last line yet.
        return rows
    try:
        return cached(path, parse)
    except OSError:
        return []


def find_root():
    for start in (Path(__file__).resolve().parent, Path.cwd()):
        for parent in (start, *start.parents):
            for candidate in (parent, parent / 'output/agentic-waterfall'):
                if (candidate / 'waterfall-four-parallel-20261030/tasks.jsonl').is_file():
                    return candidate
    raise FileNotFoundError('找不到实验目录；请使用 --root /path/to/output/agentic-waterfall')


def live(pid, *expected):
    if type(pid) is not int or pid <= 0 or not expected:
        return False
    try:
        process = subprocess.run(['ps', '-p', str(pid), '-o', 'command='],
                                 capture_output=True, text=True, timeout=2)
        return process.returncode == 0 and all(part in process.stdout for part in expected)
    except (OSError, subprocess.TimeoutExpired):
        return False


def group(dataset, split='', domain='', method=''):
    if dataset in ('clawrec', 'simbench', 'simbench_sequence'):
        dataset, split = 'simbench', 'five_events'
    if dataset == 'agentrecbench':
        split = split or 'short_term'
    return dataset, split, domain, method


def event_states(rows):
    """Restarts and retries replace a case state; skipped_existing adds no receipt."""
    states = {}
    for row in rows:
        key = row.get('case') or (row.get('dataset'), row.get('method'), row.get('task_id'))
        if not row.get('case') and not row.get('task_id'):
            continue
        outcome = row.get('outcome')
        if outcome == 'superseded':
            states.pop(key, None)
        elif outcome != 'skipped_existing':
            states[key] = row
    return states


def add_state(counts, state):
    outcome = state.get('outcome', state.get('status', 'pending'))
    field = {'submitted': 'delivered', 'no_delivery': 'empty',
             'method_failure': 'failed', 'operational_failure': 'failed',
             'failed': 'failed', 'blocked_by_prior_failure': 'blocked',
             'running': 'uncommitted'}.get(outcome, 'pending')
    counts[field] += 1


def apply_events(table, mapping, states):
    for key, rowgroup in mapping.items():
        if rowgroup[0] == 'mind':
            continue
        table[rowgroup]['total'] += 1
        add_state(table[rowgroup], states.get(key, {}))


def validator(path):
    def load(p):
        spec = importlib.util.spec_from_file_location('monitor_frozen_queue', p)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    return cached(path, load)


def waterfall(table, run):
    plan = read(run / 'plan.json')
    validation = validator(run / 'code/experiments/agentic-waterfall/unified/formal_queue.py')
    errors = Counter()
    for task in jsonlines(run / 'tasks.jsonl'):
        if task['dataset'] == 'mind':
            continue
        row = table[group(task['dataset'], task.get('split', ''), task.get('domain', ''), 'Waterfall')]
        row['total'] += 1
        output = run / 'results' / (task['id'] + '.json')
        if not output.exists():
            row['uncommitted' if (run / 'started' / output.name).exists() else 'pending'] += 1
            continue
        def check(path):
            try:
                result = validation.read_committed(path, task)
                if not plan.get('core_sha256') or result.get('runtime_source_sha256') != plan['core_sha256']:
                    return 'failed', 'core_sha256_mismatch'
                reason = validation.failure_reason(result)
                if reason:
                    return 'failed', reason
                if not isinstance(result.get('ordered_item_ids'), list):
                    return 'failed', 'missing_ordered_item_ids'
                return ('delivered' if result['ordered_item_ids'] else 'empty'), None
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                return 'failed', 'invalid_committed_result: ' + str(exc)
        # Include validator/protocol versions so changing validation invalidates cached classifications.
        version = (plan.get('core_sha256'), CACHE[run / 'code/experiments/agentic-waterfall/unified/formal_queue.py'][0], task['dataset'])
        key = (output, version)
        try:
            stat = output.stat()
        except FileNotFoundError:
            row['uncommitted'] += 1
            continue
        stamp = (stat.st_mtime_ns, stat.st_size)
        if key not in CACHE or CACHE[key][0] != stamp:
            CACHE[key] = stamp, check(output)
        status, reason = CACHE[key][1]
        row[status] += 1
        if reason:
            errors[reason] += 1
    return errors


def baselines(table, base):
    states = {name: event_states(jsonlines(base / f'{name}-events.jsonl'))
              for name in ('fixed', 'additional', 'local')}
    fixed = {}
    for job in read(base.parent / 'experiment-plan.json').get('jobs', []):
        if job['dataset'] != 'kuairand':
            continue
        folder = base / 'fixed-candidates/kuairand' / job['method']
        for task in read(folder / 'task-input-hashes.json').get('tasks', []):
            decision = task['task_id']
            fixed[('kuairand', job['method'], decision)] = group('kuairand', decision.split(':')[2], '', job['method'])
    apply_events(table, fixed, states['fixed'])
    additional = {}
    for entry in read(base / 'additional-plan.json').get('groups', []):
        for item in entry['items']:
            kind, method = item['kind'], item['method']
            rowgroup = group(kind, item.get('split', ''), item.get('domain', ''), method)
            if kind == 'simbench_sequence':
                for event in item['events']:
                    additional[f"formal/simbench/{method}/{event['case_id']}"] = rowgroup
            else:
                index = item.get('task_id', item['entry'].get('line'))
                additional[f"formal/{entry['name']}/task-{index:06d}"] = rowgroup
    apply_events(table, additional, states['additional'])
    local = read(base / 'local-plan.json')
    mapping = {}
    for kind, key in [('simbench', 'simbench_cases'), ('kuairec/dev', 'kuairec_dev'), ('kuairec/test', 'kuairec_test')]:
        parts = kind.split('/')
        rowgroup = group(parts[0], parts[1] if len(parts) > 1 else '', '', 'fixed')
        mapping.update({f'formal/{kind}/fixed/task-{n:06d}': rowgroup for n in range(local.get(key, 0))})
    apply_events(table, mapping, states['local'])
    for domain in ('amazon', 'yelp', 'goodreads'):
        manifest = read(base / 'agentrecbench' / domain / 'i2agent/manifest.json')
        table[group('agentrecbench', '', domain, 'i2agent')]['inapplicable'] = sum(
            record.get('status') == 'not_applicable' for record in manifest.get('records', []))
    states['fixed'] = {key: value for key, value in states['fixed'].items() if key in fixed}
    states['additional'] = {key: value for key, value in states['additional'].items() if key in additional}
    states['local'] = {key: value for key, value in states['local'].items() if key in mapping}
    return states


def kuairand(table, expansion):
    path = expansion / 'kuairand/mind-index.sqlite'
    if not path.exists():
        return
    # mode=ro forbids writes and does not create a missing database.
    with sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True, timeout=1) as db:
        db.execute('PRAGMA query_only=ON')
        total = db.execute("SELECT count(*) FROM tasks WHERE decision_id LIKE 'kuairand:%:test:%'").fetchone()[0]
        jobs = db.execute("SELECT method,status,count(*) FROM jobs WHERE decision_id LIKE 'kuairand:%:test:%' GROUP BY method,status").fetchall()
    methods = set()
    for method, status, count in jobs:
        methods.add(method)
        row = table[group('kuairand', 'test', '', method)]
        row['total'] += count
        field = {'submitted': 'delivered', 'failed': 'failed', 'running': 'uncommitted'}.get(status, 'pending')
        row[field] += count
    for method in methods:
        row = table[group('kuairand', 'test', '', method)]
        row['inapplicable'] = max(0, total - row['total'])


def queue_line(title, state, pid, script, states=(), fatal=None, expected=()):
    running = live(pid, script, *expected)
    status = state.get('status') or ('running' if state.get('running') else 'stopped' if state.get('stopped') else 'not_running')
    completed = sum(state.get(key, 0) for key in ('submitted', 'no_delivery', 'skipped_existing'))
    if not running and not state.get('stopped') and state.get('total_planned') == completed and completed:
        status = 'predictions_complete'
    current = state.get('current') or state.get('task') or state.get('last', {}).get('case')
    reasons = []
    if state.get('reason'):
        reasons.append(str(state['reason']))
    if fatal and fatal.get('error') and state.get('stopped') and not running:
        reasons.append(str(fatal['error']))
    for row in states:
        if row.get('outcome') in ('method_failure', 'operational_failure', 'blocked_by_prior_failure'):
            reasons.append(str(row.get('error') or row.get('reason') or row['outcome']))
    detail = '；原因: ' + ', '.join(dict.fromkeys(reasons)) if reasons else ''
    label = {'running': '运行中', 'waiting_for_service': '等待重试', 'needs_attention': '已暂停，需检查',
             'predictions_complete': '预测已交付，待评分', 'stopped': '已停止', 'not_running': '未运行',
             'preflight_running': '复验中', 'complete': '队列已结束'}.get(status, status)
    return f"  {title}: {label} ({status})；进程{'存活' if running else '未匹配/未运行'}" + (f'；当前: {current}' if current else '') + detail


def resources(root):
    key = ('resources', root)
    if key in CACHE and time.monotonic() - CACHE[key][0] < 30:
        return CACHE[key][1]
    try:
        free = shutil.disk_usage(root).free / 1024**3
        checked = subprocess.run(['memory_pressure', '-Q'], capture_output=True, text=True, timeout=2)
        memory = re.search(r'memory free percentage:\s*(\d+)%', checked.stdout)
        value = f"资源：可用内存 {memory[1] + '%' if memory else '未知'}；剩余磁盘 {free:.1f} GiB"
        CACHE[key] = time.monotonic(), value
        return value
    except (OSError, subprocess.TimeoutExpired):
        return '资源：无法读取系统资源'


def preparation(expansion):
    arb = expansion / 'agentrecbench'
    manifests = len(list(arb.glob('*.manifest.json')))
    receipts = list((arb / 'prepared').rglob('*manifest*.json'))
    return f'AgentRecBench 补充场景：下载回执 {manifests}；准备索引回执 {len(receipts)}；未配对 Waterfall 任务，不计入完成。'


def table_lines(table, dev=False):
    lines = ['  方法           有效/计划      进度       空 失败 在途 待跑 阻断 不适用']
    previous = None
    names = {'generic-agent': '通用Agent', 'fixed': '固定检索', 'i2agent': 'i²Agent',
             'clawrec': 'ClawRec', 'recbot': 'RecBot语义版', 'mars': 'MARS复现'}
    for key, counts in sorted(table.items()):
        if (key[1] == 'dev') != dev or key[0] == 'mind':
            continue
        dataset, split, domain, method = key
        name = '/'.join(x for x in (dataset, split, domain) if x)
        if name != previous:
            lines.append(name)
            previous = name
        delivered = f"{counts['delivered']:,}/{counts['total']:,}"
        filled = min(8, counts['delivered'] * 8 // counts['total']) if counts['total'] else 0
        bar = '[' + '█' * filled + '░' * (8 - filled) + ']'
        lines.append(f"  {names.get(method, method):<12} {delivered:>11} {bar} {counts['empty']:>3} {counts['failed']:>4} {counts['uncommitted']:>4} {counts['pending']:>4} {counts['blocked']:>4} {counts['inapplicable']:>6}")
    return lines


def snapshot(root):
    root = Path(root)
    base = root / 'formal-20261029-224252/formal'
    expansion = root / 'full-expansion-20261030'
    run = root / 'waterfall-four-parallel-20261030'
    table = defaultdict(Counter)
    errors = waterfall(table, run)
    states = baselines(table, base)
    database_error = None
    try:
        kuairand(table, expansion)
    except sqlite3.Error as exc:
        database_error = str(exc)
    lines = [f'统一实验进度  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}',
             resources(root), '有效 = 非空交付；空推荐、失败、在途分别列出，保留完整分母。MIND 已排除。', '',
             *table_lines(table), '', '开发集（单独列示，不并入测试进度）：', *table_lines(table, dev=True), '', '队列状态：']
    for shard in ('kuairec', 'other'):
        folder = run / 'shards' / shard
        state = read(folder / 'progress.json')
        supervisor = read(folder / 'supervisor.json')
        lines.append(queue_line('Waterfall/' + shard, state, state.get('pid'), 'formal_queue.py', expected=(str(folder),)))
        if supervisor.get('reason') and supervisor['reason'] != state.get('reason'):
            lines.append('    supervisor: ' + str(supervisor['reason']))
    pids = read(base / 'processes.json')
    for name, script in [('fixed', 'run_fixed.py'), ('additional', 'run_agents.py'), ('local', 'run_local.py')]:
        lines.append(queue_line(name, read(base / f'{name}-progress.json'), pids.get(name), script,
                                states[name].values(), read(base / f'{name}-fatal.json')))
    k = read(expansion / 'kuairand/progress.json')
    lines.append(queue_line('KuaiRand 扩展', k, k.get('pid'), 'run_kuairand.py'))
    if errors:
        lines.append('Waterfall 当前失败：' + '；'.join(f'{reason} ×{count}' for reason, count in errors.items()))
    if database_error:
        lines.append('KuaiRand SQLite 无法读取（显示仅含旧队列）：' + database_error)
    lines += ['', preparation(expansion), '', '每 30 秒只读刷新；Ctrl+C 只关闭本显示，不停止实验。']
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='output/agentic-waterfall 路径')
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    root = args.root.resolve() if args.root else find_root()
    try:
        while True:
            print(('\033[H\033[2J' if sys.stdout.isatty() else '') + snapshot(root), flush=True)
            if args.once:
                break
            time.sleep(30)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
