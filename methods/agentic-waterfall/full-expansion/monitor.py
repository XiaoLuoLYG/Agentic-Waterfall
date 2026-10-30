#!/usr/bin/env python3
"""Read-only experiment receipts; Ctrl+C never signals experiment processes."""
import argparse
from collections import Counter, defaultdict
import curses
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
import unicodedata

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


def waterfall(table, run, warnings=None):
    plan = read(run / 'plan.json')
    validation = validator(run / 'code/experiments/agentic-waterfall/unified/formal_queue.py')
    dispositions = validation.load_validation_dispositions(run, plan)
    errors = Counter()
    failed_lineage = set()
    for task in jsonlines(run / 'tasks.jsonl'):
        if task['dataset'] == 'mind':
            continue
        row = table[group(task['dataset'], task.get('split', ''), task.get('domain', ''), 'Waterfall')]
        row['total'] += 1
        output = run / 'results' / (task['id'] + '.json')
        disposition = validation.checked_disposition(task, output, dispositions)
        if disposition in {'hold', 'failed'}:
            row['held' if disposition == 'hold' else 'failed'] += 1
            if disposition == 'failed':
                row['audited_failures'] += 1
                failed_lineage.add(task['id'])
            if output.exists():
                result = validation.read_committed(output, task)
                if disposition == 'hold' and isinstance(result.get('ordered_item_ids'),list) and result['ordered_item_ids']:row['held_with_slate'] += 1
                codes = validation.result_warnings(result)
                if codes:
                    row['warning_cases'] += 1
                    if warnings is not None:warnings.update(codes)
            continue
        if plan.get('method_outcome_policy') == 'first-complete-episode-v2' and task.get('previous') in failed_lineage:
            failed_lineage.add(task['id'])
            row['blocked'] += 1
            continue
        if not output.exists():
            row['uncommitted' if (run / 'started' / output.name).exists() else 'pending'] += 1
            continue
        def check(path):
            try:
                result = validation.read_committed(path, task)
                if not plan.get('core_sha256') or result.get('runtime_source_sha256') != plan['core_sha256']:
                    return 'failed', 'core_sha256_mismatch', []
                reason = validation.failure_reason(result)
                codes = validation.result_warnings(result)
                if reason:
                    return 'failed', reason, codes
                if not isinstance(result.get('ordered_item_ids'), list):
                    return 'failed', 'missing_ordered_item_ids', []
                return ('delivered' if result['ordered_item_ids'] else 'empty'), None, codes
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
                return 'failed', 'invalid_committed_result: ' + str(exc), []
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
        status, reason, warning_codes = CACHE[key][1]
        row[status] += 1
        if status == 'failed' and plan.get('method_outcome_policy') == 'first-complete-episode-v2':
            try:
                if validation.terminal_method_failure(validation.read_committed(output, task)):
                    failed_lineage.add(task['id'])
            except (OSError, ValueError, KeyError, TypeError, AttributeError):
                pass  # The invalid result is already failed; it cannot establish a terminal method outcome.
        if warning_codes:
            row['warning_cases'] += 1
            if warnings is not None:warnings.update(warning_codes)
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


def queue_line(title, state, pid, script, states=(), fatal=None, expected=(), short=False):
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
             'validation_holds_remaining': '可运行部分已收集，隔离项待审',
             'method_failures_remaining': '方法失败已保留，依赖后继阻断',
             'preflight_running': '复验中', 'complete': '队列已结束'}.get(status, status)
    if state.get('held_count'):detail += f"；隔离 {state['held_count']}题"
    if short:
        if status in ('running', 'preflight_running', 'waiting_for_service') and not running:
            label = '未运行，状态待检查'
        for code, meaning in [('model_http_429', '接口限流429'),
                              ('action_id_reuse_with_different_payload', '动作编号冲突'),
                              ('state_evidence_missing', '状态引用无效证据'),
                              ('acquisition_failed:unsupported_source_or_mode', '获取来源/方式不支持')]:
            detail = detail.replace(code, meaning)
        return f'  {title}: {label}' + detail + (f'；{current}' if current else '')
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
    return f'补充数据：已核验 {manifests} 组；尚未配对、未开跑，不计入预测总进度。'


def display_width(text):
    return sum(0 if unicodedata.combining(c) else 2 if unicodedata.east_asian_width(c) in 'WF' else 1 for c in str(text))


def cell(text, width, right=False):
    text = str(text)
    padding = ' ' * max(0, width - display_width(text))
    return padding + text if right else text + padding


def totals(table, method=None, split=None):
    result = Counter()
    for key, counts in table.items():
        if key[0] != 'mind' and (method is None or key[3] == method) and (split is None or key[1] == split):
            result.update(counts)
    return result


def progress_text(counts, width=12):
    done, total = counts['delivered'] + counts['empty'], counts['total']
    filled = min(width, done * width // total) if total else 0
    percent = f'{done / total * 100:.1f}%' if total else '—'
    return f"[{'█' * filled}{'░' * (width - filled)}] {done:,}/{total:,} {percent}"


def compact_rows(table):
    rows = [cell('数据 / 划分', 20) + cell('Waterfall', 13, True) + cell('其他方法合计', 15, True) + '  失败/隔离/在途']
    groups = [('kuairec', 'test', 'KuaiRec 测试'), ('kuairec', 'dev', 'KuaiRec 开发'),
              ('kuairand', 'test', 'KuaiRand 测试'), ('kuairand', 'dev', 'KuaiRand 旧开发'),
              ('agentrecbench', 'short_term', 'AgentRecBench 短历史'), ('simbench', 'five_events', 'SimBench 五轮')]
    for dataset, split, title in groups:
        selected = {key: value for key, value in table.items() if key[:2] == (dataset, split)}
        all_counts = totals(selected)
        own = totals(selected, method='Waterfall')
        other = all_counts.copy()
        other.subtract(own)
        def fraction(counts):
            return f"{counts['delivered'] + counts['empty']:,}/{counts['total']:,}" if counts['total'] else '—'
        rows.append(cell(title, 20) + cell(fraction(own), 13, True) + cell(fraction(other), 15, True) +
                    f"  {all_counts['failed']}/{all_counts['held']}/{all_counts['uncommitted']}")
    return rows


def screen_lines(lines, height, width):
    if height <= 0 or width <= 1:
        return []
    if len(lines) > height:
        lines = lines[:max(0, height - 2)] + ['…余下状态已省略；完整明细加 --details'] + lines[-1:]
    result = []
    for line in lines[:height]:
        text = ''
        for c in line:
            if display_width(text + c) > width - 1:
                break
            text += c
        result.append(text)
    return result


def table_lines(table, dev=False):
    lines = ['  方法           非空通过/计划   进度       空 失败 隔离 在途 待跑 阻断 不适用']
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
        lines.append(f"  {cell(names.get(method, method), 12)} {delivered:>11} {bar} {counts['empty']:>3} {counts['failed']:>4} {counts['held']:>4} {counts['uncommitted']:>4} {counts['pending']:>4} {counts['blocked']:>4} {counts['inapplicable']:>6}")
    return lines


def snapshot(root, details=False):
    root = Path(root)
    base = root / 'formal-20261029-224252/formal'
    expansion = root / 'full-expansion-20261030'
    run = root / 'waterfall-four-parallel-20261030'
    table = defaultdict(Counter)
    warnings = Counter()
    errors = waterfall(table, run, warnings)
    states = baselines(table, base)
    database_error = None
    try:
        kuairand(table, expansion)
    except sqlite3.Error as exc:
        database_error = str(exc)
    all_counts = totals(table)
    own = totals(table, method='Waterfall')
    other = all_counts.copy()
    other.subtract(own)
    dev = totals(table, split='dev')
    test = all_counts.copy()
    test.subtract(dev)
    lines = [f'统一实验进度  {datetime.datetime.now():%m-%d %H:%M:%S}  MIND 暂停', resources(root),
             '流程验收  ' + progress_text(all_counts), 'Waterfall ' + progress_text(own),
             '对照方法  ' + progress_text(other),
             f"其中测试 {test['delivered'] + test['empty']:,}/{test['total']:,}；开发 {dev['delivered'] + dev['empty']:,}/{dev['total']:,}；不适用 {all_counts['inapplicable']} 另列",
             f"合法空交付 {all_counts['empty']}；失败 {all_counts['failed']}；隔离待审 {all_counts['held']}；在途 {all_counts['uncommitted']}；采集进度不是可比成绩。",
             '', *(table_lines(table) if details else compact_rows(table))]
    if details:
        lines += ['', '开发集（单独列示，不并入测试进度）：', *table_lines(table, dev=True), '', '队列状态：']
    repair = read(root / 'minimal-rerun-control-20261030/bounded-prefix-execution.json')
    if repair:
        lines.append(f"版本补齐：{repair.get('finished_jobs', 0)}/{repair.get('total_jobs', 0)}；新增请求 {repair.get('new_api_calls', 0)}/{repair.get('maximum_new_api_calls', 0)}；{repair.get('status')}；不增加原计划题数。")
    shard_names={'kuairec','other'}|{p.parent.name for p in (run/'shards').glob('*/plan.json')}
    for shard in sorted(shard_names):
        folder = run / 'shards' / shard
        state = dict(read(folder / 'progress.json'))
        if state.get('status') == 'needs_attention' and state.get('task'):
            result = read(run / 'results' / (state['task'] + '.json')).get('result', {})
            codes = [call['error'] for call in result.get('model_calls', []) if call.get('error')]
            state['reason'] = ', '.join(dict.fromkeys([str(state.get('reason') or 'unknown'), *codes]))
        supervisor = read(folder / 'supervisor.json')
        lines.append(queue_line('WF/' + shard, state, state.get('pid'), 'formal_queue.py', expected=(str(folder),), short=not details))
        if details and supervisor.get('reason') and supervisor['reason'] != state.get('reason'):
            lines.append('    supervisor: ' + str(supervisor['reason']))
    pids = read(base / 'processes.json')
    for name, script in [('fixed', 'run_fixed.py'), ('additional', 'run_agents.py'), ('local', 'run_local.py')]:
        title = {'fixed': '旧候选', 'additional': 'Agent对照', 'local': '本地检索'}[name]
        lines.append(queue_line(title, read(base / f'{name}-progress.json'), pids.get(name), script,
                                states[name].values(), read(base / f'{name}-fatal.json'), short=not details))
    k = read(expansion / 'kuairand/progress.json')
    lines.append(queue_line('KuaiRand对照', k, k.get('pid'), 'run_kuairand.py', short=not details))
    if errors and details:
        lines.append('Waterfall 当前失败：' + '；'.join(f'{reason} ×{count}' for reason, count in errors.items()))
    if warnings and details:
        labels={'state_evidence_missing':'曾有状态更新被拒','input_byte_budget_exceeded':'交付后输入超限',
                'candidate_or_history_too_large':'交付后上下文超限','batch_model_budget_insufficient':'交付后批处理额度用尽',
                'dependency_failed':'曾有依赖动作取消'}
        lines.append('Waterfall 动作异常（含已纠正；不代表无影响）：'+'；'.join(f'{labels.get(reason,reason)} {count}题' for reason,count in warnings.items()))
    if own['held']:
        lines.append(f"Waterfall 隔离待审 {own['held']}题（已有排名 {own['held_with_slate']}题）；不计主表成功，完整分母保留，正式评分受阻。")
    if own['audited_failures']:
        lines.append(f"Waterfall 已审定方法失败 {own['audited_failures']}题：保留失败和完整分母，效果计0，不追加重试。")
    if database_error:
        lines.append('KuaiRand SQLite 无法读取（显示仅含旧队列）：' + database_error)
    lines += [preparation(expansion), '30秒原位刷新；q / Ctrl+C 仅关闭显示。完整明细：加 --details']
    return '\n'.join(lines)


def details_viewport(lines, height, width, offset):
    """Keep the seven summary lines and footer fixed while scrolling the detail body."""
    if height <= 0 or width <= 1:
        return [], 0, 0, 0
    header = lines[:min(7, max(0, height - 2))]
    body = lines[7:-1]
    page = max(0, height - len(header) - 1)
    maximum = max(0, len(body) - page) if page else 0
    offset = max(0, min(offset, maximum))
    end = min(offset + page, len(body))
    footer = f'↑↓/PgUp/PgDn/Home/End 滚动；30秒刷新；q/Ctrl+C退出  {offset + 1 if end else 0}-{end}/{len(body)}'
    frame = header + body[offset:end] + [footer]
    return screen_lines(frame, height, width), offset, page, maximum


def dashboard(screen, root, details=False):
    try:
        curses.curs_set(0)
    except curses.error:
        pass
    screen.timeout(1000)
    deadline, lines, size, offset = 0, [], None, 0
    while True:
        if time.monotonic() >= deadline:
            lines = snapshot(root, details).splitlines()
            deadline = time.monotonic() + 30
            size = None
        current = screen.getmaxyx()
        if current != size:
            if details:
                frame, offset, page, maximum = details_viewport(lines, *current, offset)
            else:
                frame = screen_lines(lines, *current)
            screen.erase()
            for row, line in enumerate(frame):
                try:
                    screen.addstr(row, 0, line)
                except curses.error:
                    break  # The terminal may shrink between getmaxyx and drawing.
            screen.refresh()
            size = current
        key = screen.getch()
        if key in (ord('q'), ord('Q')):
            return
        if key == curses.KEY_RESIZE:
            size = None
        elif details:
            target = {curses.KEY_UP: offset - 1, curses.KEY_DOWN: offset + 1,
                      curses.KEY_PPAGE: offset - page, curses.KEY_NPAGE: offset + page,
                      curses.KEY_HOME: 0, curses.KEY_END: maximum}.get(key, offset)
            target = max(0, min(target, maximum))
            if target != offset:
                offset, size = target, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='output/agentic-waterfall 路径')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--details', action='store_true', help='持续刷新完整明细，方向键/PageUp/PageDown/Home/End 滚动')
    args = parser.parse_args()
    root = args.root.resolve() if args.root else find_root()
    try:
        if args.once or not sys.stdout.isatty():
            print(snapshot(root, args.details), flush=True)
        else:
            curses.wrapper(dashboard, root, args.details)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
