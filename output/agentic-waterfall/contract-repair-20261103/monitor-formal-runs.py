"""Read-only terminal overview of this batch's full experiments."""
import argparse
import hashlib
import importlib.util
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unicodedata

ROOT = Path(__file__).resolve().parent
BEIJING = timezone(timedelta(hours=8))
WINDOW_SECONDS = 15 * 60
QUOTA_SPEC = importlib.util.spec_from_file_location('batch_quota_state', ROOT / 'transport-retry/check-approved-quota.py')
QUOTA_STATE = importlib.util.module_from_spec(QUOTA_SPEC)
QUOTA_SPEC.loader.exec_module(QUOTA_STATE)


def read_json(path):
    try:
        return json.loads(Path(path).read_bytes())
    except (OSError, ValueError):
        return {}


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).timestamp()
    except (AttributeError, TypeError, ValueError):
        return None


def journal_times(path, method=None):
    try:
        lines = Path(path).read_bytes().splitlines()
    except OSError:
        return []
    result = []
    for line in lines:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if method and record.get('method') != method:
            continue
        if record.get('result_path', '').startswith(str(ROOT / 'kuairec-clawrec-targeted-repair-20261104' / 'cases') + '/'):
            continue  # Short repairs do not estimate the remaining complete episodes.
        value = timestamp(record.get('finished_at'))
        if value is not None and not record.get('retained_from_previous_run'):
            result.append(value)
    return result


def file_times(folder, pattern):
    values = []
    for path in Path(folder).glob(pattern):
        try:
            values.append(path.stat().st_mtime)
        except OSError:
            pass
    return values


def processes():
    result = {}
    try:
        output = subprocess.check_output(
            ['ps', '-axo', 'pid=,stat=,lstart='], text=True,
            env={**os.environ, 'LC_ALL': 'C'})
    except (OSError, subprocess.CalledProcessError):
        return None
    for line in output.splitlines():
        fields = line.split()
        if len(fields) != 7 or fields[1].startswith('Z'):
            continue
        try:
            started = datetime.strptime(' '.join(fields[2:]), '%a %b %d %H:%M:%S %Y').timestamp()
            result[int(fields[0])] = started
        except ValueError:
            continue
    return result


def clock(value):
    return datetime.fromtimestamp(value, BEIJING).strftime('%m-%d %H:%M') if value else '—'


def estimate(done, total, stamps, now, started=None):
    cutoff = max(now - WINDOW_SECONDS, started or 0)
    recent = [value for value in stamps if cutoff <= value <= now]
    elapsed = now - cutoff
    if len(recent) < 3 or elapsed < 60 or done >= total:
        return '估算中'
    return clock(now + (total - done) * elapsed / len(recent))


def row(name, done, total, state, stamps, now, live, stop=None):
    phase = state.get('status', state.get('phase'))
    pid = state.get('pid')
    progress = f'{done}/{total}'
    if phase == 'completed':
        end = timestamp(state.get('at') or state.get('updated_at') or state.get('finished_at'))
        return [name, progress, '已完成', clock(end or max(stamps, default=0))]
    if stop and Path(stop).exists():
        return [name, progress, '已暂停', '待恢复']
    if phase in ('needs_attention', 'pilot_needs_attention'):
        unresolved = state.get('unresolved')
        if state.get('execution_complete') and isinstance(unresolved, list) and unresolved:
            return [name, progress, f'验收未通过（{len(unresolved)}题）',
                    clock(timestamp(state.get('execution_finished_at')))]
        return [name, progress, '待处理', '待恢复']
    if phase in ('paused', 'bounded_pause'):
        return [name, progress, '已暂停', '待恢复']
    if live is None:
        return [name, progress, '状态读取中', '—']
    if pid not in live:
        return [name, progress, '进程已退出' if phase else '暂无记录', '待恢复' if phase else '—']
    eta = estimate(done, total, stamps, now, live[pid])
    return [name, progress, '评分中' if phase == 'scoring' else '运行中', eta]


def completed(name, done, total, stamps, status='已完成'):
    return [name, f'{done}/{total}', status, clock(max(stamps, default=0))]


def clawrec_deliveries(folder):
    try:
        records = [json.loads(line) for line in (folder / 'outcomes.jsonl').read_bytes().splitlines()]
    except (OSError, ValueError):
        return 0
    count = 0
    repairs = ROOT / 'kuairec-clawrec-additional-repairs-20261104'
    for record in records:
        if record.get('category') == 'terminal':
            count += 1
            continue
        for path in [repairs / record['id'] / 'recovery.json',
                     repairs / 'quota-resume-20261104/cases' / record['id'] / 'recovery.json']:
            proof = read_json(path)
            if proof.get('valid') and proof.get('original_result_sha256') == record.get('result_sha256'):
                try:
                    valid = hashlib.sha256(Path(proof['result_path']).read_bytes()).hexdigest() == proof['result_sha256']
                except (OSError, KeyError):
                    valid = False
                if valid:
                    count += 1
                    break
    return count


def api_summary(live, now):
    shared = ROOT / 'full-agentrecbench-20261103'
    ledger = read_json(shared / 'frozen/code/experiments/agentic-waterfall/shared/model-ledger.json')
    if not ledger or live is None:
        return 'API 状态读取中'
    attempts = ledger.get('attempts', [])
    active = [a for a in attempts if a.get('status') == 'in_progress'
              and a.get('pid') in live and a.get('http_request_started_at')]
    per_key = ledger.get('max_concurrent_per_credential')
    overrides = ledger.get('credential_concurrency_overrides', {})
    policy = ledger.get('credential_policy') or {}
    quota = QUOTA_STATE.status(ledger)
    cap = sum(policy.get('max_concurrent',{}).get(slot,overrides.get(slot,per_key))
              for slot in quota['available_credentials']) if per_key else ledger.get('max_concurrent',0)
    exhausted = quota['exhausted_credentials']
    success = sum(a.get('status') == 'success' and (timestamp(a.get('completed_at')) or 0) >= now - 60 for a in attempts)
    started = sum((timestamp(a.get('http_request_started_at')) or 0) >= now - 60 for a in attempts)
    cooldown = max((read_json(p).get('cooldown_until', 0) / 1000 - now
                    for p in (shared / 'request-gates').glob('*.json')), default=0)
    text = f'API 在途 {len(active)}/{cap}  |  近 1 分钟发出 {started} / 成功 {success}'
    if exhausted:
        text += f'  |  {len(exhausted)} 把凭证额度耗尽'
    if quota['invalid_credentials']:
        text += f"  |  {len(quota['invalid_credentials'])} 把凭证认证失败"
    if cooldown > 0:
        text += f'  |  限流退避 {max(1, round(cooldown))} 秒'
    return text


def window_deliveries(window, method):
    accepted, pending, stamps = 0, 0, []
    for path in (window / 'cases' / method).glob('*/outcome.json'):
        original = read_json(path)
        selected, source = original, path
        if not original.get('valid'):
            repairs = ([window / 'targeted-repair' / path.parent.name / 'outcome.json'] if method == 'generic-agent' else [])
            repairs.append(window / 'service-repair' / method / path.parent.name / 'outcome.json')
            for repair in repairs:
                candidate = read_json(repair)
                if candidate.get('valid') and candidate.get('previous_result_sha256') == original.get('result_sha256'):
                    selected, source = candidate, repair
                    break
        if selected.get('valid'):
            accepted += 1
            stamps.append(source.stat().st_mtime)
        else:
            pending += 1
    return accepted, pending, stamps


def overview(now, live):
    rows = []
    arb = ROOT / 'full-agentrecbench-20261103'
    water = ROOT / 'agentrecbench-waterfall-full-20261103'
    state = read_json(water / 'run/progress.json')
    rows.append(row('AgentRecBench Waterfall', state.get('completed', 0), 300, state,
                    journal_times(water / 'run/outcomes.jsonl'), now, live))
    metrics = read_json(arb / 'evaluation/current-metrics.json').get('methods', {})
    for method, label in (('recagent', 'RecAgent'), ('i2agent', 'i²Agent')):
        count = metrics.get(method, {}).get('all', {}).get('n', 0)
        rows.append(completed('AgentRecBench ' + label, count, 300,
                              journal_times(arb / 'run/outcomes.jsonl', method),
                              '已评分' if count == 300 else '待验收'))

    controls = ROOT / 'agentrecbench-fixed-controls-20261103'
    if (controls / 'resume-20261105/launch.json').is_file():
        state = read_json(controls / 'progress.json')
        for method, label in (('clawrec', 'ClawRec'), ('generic-agent', '通用 Agent')):
            stamps = []
            for receipt in (controls / 'cases' / method).glob('*/outcome.json'):
                outcome = read_json(receipt)
                result = receipt.parent / 'attempt/result.json'
                rank = outcome.get('ordered_item_ids', [])
                if (outcome.get('status') == 'submitted' and outcome.get('method') == method
                        and len(rank) == len(set(rank)) == 20 and result.is_file()
                        and hashlib.sha256(result.read_bytes()).hexdigest() == outcome.get('result_sha256')):
                    stamps.append(result.stat().st_mtime)
            entry = row('AgentRecBench ' + label + ' 固定候选', len(stamps), 300, state, stamps, now, live,
                        controls / 'STOP')
            if state.get('status') == 'completed' and read_json(controls / 'resume-20261105/full-acceptance.json').get('passed'):
                entry[2] = '已评分'
            if state.get('status') == 'needs_user':
                entry[2:] = ['异常待确认', '已停止派发']
            rows.append(entry)

    window = ROOT / 'kuairand-window512-20261103'
    state = read_json(window / 'progress.json')
    for method, label in (('waterfall', 'Waterfall'), ('generic-agent', '通用 Agent'), ('mars', 'MARS')):
        count, pending, stamps = window_deliveries(window, method)
        scored = window / method
        accepted = read_json(scored / 'acceptance.json')
        if (not pending and accepted.get('passed') and accepted.get('assigned') == accepted.get('valid') == count == 617
                and (scored / 'metrics.json').is_file()
                and hashlib.sha256((scored / 'metrics.json').read_bytes()).hexdigest() == accepted.get('metrics_sha256')):
            rows.append(completed('KuaiRand ' + label, count, 617,
                                  [(scored / 'acceptance.json').stat().st_mtime], '已评分'))
            continue
        current = state
        recovery = read_json(window / 'service-repair/active-recovery.json')
        if state.get('status') == 'needs_attention' and pending and live is not None and recovery.get('pid') in live:
            current = {**state, 'status': 'running', 'pid': recovery['pid']}
        rows.append(row('KuaiRand ' + label, count, 617, current, stamps, now, live, window / 'STOP'))
    claw = window / 'clawrec'
    state = read_json(claw / 'progress.json')
    accepted_claw = len(list((claw / 'cases').glob('*/outcome.json')))
    rows.append(row('KuaiRand ClawRec', accepted_claw, state.get('planned', 617), state,
                    file_times(claw / 'cases', '*/outcome.json'), now, live, claw / 'STOP'))
    i2 = ROOT / 'full-kuairand-i2agent-20261103/run'
    state = read_json(i2 / 'progress.json')
    rows.append(row('KuaiRand i²Agent', state.get('completed', 0), 617, state,
                    journal_times(i2 / 'outcomes.jsonl'), now, live))

    krec = ROOT / 'full-kuairec-api-continuation-20261103'
    for method, label in (('waterfall', 'Waterfall'), ('clawrec', 'ClawRec')):
        folder = krec / f'run-{method}-network'
        state = read_json(folder / 'progress.json')
        quota_repair = read_json(ROOT / 'kuairec-clawrec-additional-repairs-20261104/quota-resume-20261104/active-recovery.json') if method == 'clawrec' else {}
        recovering = False
        if live is not None and quota_repair.get('pid') in live and quota_repair.get('status') == 'recovering_failed_steps':
            command = subprocess.run(['ps', '-p', str(quota_repair['pid']), '-o', 'command='], capture_output=True, text=True).stdout
            recovering = 'quota-resume-20261104/recover.py' in command
            if recovering:
                state = {**state, 'status': 'running', 'pid': quota_repair['pid']}
        count = clawrec_deliveries(folder) if method == 'clawrec' else state.get('completed', 0)
        entry = row('KuaiRec ' + label, count, 1129, state,
                    journal_times(folder / 'outcomes.jsonl'), now, live, krec / 'STOP')
        if recovering:
            entry[2] = '续接 ' + str(sum(r.get('valid', False) for r in quota_repair.get('results', []))) + '/10'
            entry[3] = '失败步骤恢复中'
        if entry[2] == '已完成':
            score_folder = ROOT / 'scoring' / ('scored-kuairec-waterfall-full-20261104' if method == 'waterfall'
                                               else 'scored-kuairec-clawrec-full-20261105')
            accepted = read_json(score_folder / 'acceptance.json')
            metric_file = score_folder / 'metrics.json'
            if (accepted.get('passed') and accepted.get('manifest_sha256') == state.get('manifest_sha256')
                    and metric_file.is_file() and hashlib.sha256(metric_file.read_bytes()).hexdigest() == accepted.get('metrics_sha256')):
                entry[2] = '已评分'
        if method == 'clawrec' and entry[2] == '运行中':
            repair = read_json(ROOT / 'kuairec-clawrec-targeted-repair-20261104/launch.json')
            targets = set(repair.get('targets', []))
            if targets:
                repaired = set()
                try:
                    for line in (folder / 'outcomes.jsonl').read_bytes().splitlines():
                        try:
                            record = json.loads(line)
                        except ValueError:
                            continue
                        if record.get('id') in targets and record.get('category') == 'terminal':
                            repaired.add(record['id'])
                except OSError:
                    pass
                if repaired != targets:
                    entry[2] = f'补跑 {len(repaired)}/{len(targets)}'
        rows.append(entry)
    generic_metrics = read_json(ROOT / 'scoring/scored-kuairec-full-completed/metrics.json')
    rows.append(completed('KuaiRec 通用 Agent', 1129 if generic_metrics else 0, 1129,
                          journal_times(krec / 'run/outcomes.jsonl', 'generic-agent'),
                          '已评分' if generic_metrics else '待验收'))
    fixed = ROOT / 'full-kuairec-fixed-v3'
    state = read_json(fixed / 'progress.json')
    rows.append(row('KuaiRec fixed BM25+BGE', state.get('completed', 0), 1129, state,
                    [], now, live))

    sim = ROOT / 'simbench-targeted-repair-20261104'
    prediction = read_json(sim / 'progress.json')
    selected = read_json(sim / 'selected-predictions.json')
    score = read_json(sim / 'scoring-progress.json')
    scoring_times = file_times(sim / 'evaluation', '*/metrics.json')
    wf = ROOT / 'simbench-waterfall-20261103'
    wf_state = read_json(wf / 'progress.json')
    done_by_method = {
        'waterfall': wf_state.get('statuses', {}).get('submitted', 0) + wf_state.get('statuses', {}).get('no_delivery', 0),
        'clawrec': sum(v.get('valid', False) for v in selected.get('clawrec', {}).values()),
        'generic-agent': sum(v.get('valid', False) for v in selected.get('generic-agent', {}).values()),
        'fixed-bm25-bge-reranker': 210 if (ROOT / 'simbench-three-methods-20261103/predictions-frozen.json').exists() else 0,
    }
    for method, label in (('waterfall', 'Waterfall'), ('clawrec', 'ClawRec'),
                          ('generic-agent', '通用 Agent'), ('fixed-bm25-bge-reranker', 'fixed BM25+BGE')):
        done = done_by_method[method]
        if prediction.get('phase') == 'predictions_validated' and done == 210:
            entry = row('SimBench ' + label, score.get('scored', 0), 210, score, scoring_times, now, live)
            if score.get('phase') == 'scoring' and live is not None and score.get('pid') in live:
                entry[2] = '评分中'
            elif score.get('phase') == 'completed':
                entry[2] = '已评分'
            rows.append(entry)
        elif done == 210:
            rows.append(['SimBench ' + label, '210/210', '等待共同评分', '待条件满足'])
        else:
            state = wf_state if method == 'waterfall' else prediction
            stamps = file_times(wf / 'predictions-matched', '*/result.json') if method == 'waterfall' else [
                Path(v['path']).joinpath('result.json').stat().st_mtime
                for v in selected.get(method, {}).values() if v.get('valid') and Path(v['path']).joinpath('result.json').exists()]
            rows.append(row('SimBench ' + label, done, 210, state, stamps, now, live, sim / 'STOP'))
    return rows


def display_width(value):
    return sum(2 if unicodedata.east_asian_width(c) in ('W', 'F') else 1 for c in value)


def progress_bar(progress):
    done, total = map(int, progress.split('/'))
    ratio = max(0, min(done / total, 1)) if total > 0 else 0
    filled = int(ratio * 12)
    return f'[{"#" * filled}{"-" * (12 - filled)}] {ratio:5.1%} {progress}'


def render():
    now = time.time()
    live = processes()
    rows = overview(now, live)
    for entry in rows:
        entry[1] = progress_bar(entry[1])
    headers = ['实验', '进度', '当前状态', '预计 / 完成时间']
    widths = [max(display_width(values[i]) for values in [headers, *rows]) for i in range(4)]
    print(datetime.fromtimestamp(now, BEIJING).strftime('%m-%d %H:%M:%S 北京时间'))
    print(api_summary(live, now))
    print()
    for values in [headers, *rows]:
        print('  '.join(value + ' ' * max(0, widths[i] - display_width(value))
                        for i, value in enumerate(values)).rstrip())
    print('\n进度为已有结果数。运行项按近 15 分钟速度估算，完成项取最后交付或评分记录。')
    print('每 5 秒刷新，Ctrl+C 退出监控。', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true')
    args = parser.parse_args()
    try:
        while True:
            if not args.once and sys.stdout.isatty():
                print('\033[2J\033[H', end='')
            render()
            if args.once:
                break
            time.sleep(5)
    except KeyboardInterrupt:
        print()


if __name__ == '__main__':
    main()
