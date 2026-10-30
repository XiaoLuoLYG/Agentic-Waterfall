#!/usr/bin/env python3
"""Read-only view; closing this display never signals experiment processes."""
import datetime
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / 'formal-20261029-224252/formal'
WATERFALL = ROOT / 'waterfall-full-20261030-actionfix'
EXPANSION = Path(__file__).resolve().parent


def read(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return {}


def live(pid):
    if not isinstance(pid, int):
        return False
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


def events(name):
    submitted, empty = set(), set()
    try:
        with (BASE / f'{name}-events.jsonl').open() as f:
            for line in f:
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if name == 'fixed' and row.get('dataset') != 'kuairand':
                    continue
                key = (row.get('dataset'), row.get('method'), row.get('task_id')) if name == 'fixed' else row.get('case')
                if key and row.get('outcome') in ('submitted', 'no_delivery'):
                    submitted.add(key)
                    if row['outcome'] == 'no_delivery':
                        empty.add(key)
                elif key and row.get('outcome') == 'superseded':
                    submitted.discard(key)
                    empty.discard(key)
    except OSError:
        pass
    return len(submitted), len(empty)


def bar(done, total):
    filled = min(30, int(30 * done / total)) if total else 0
    return f"[{'█' * filled}{'░' * (30 - filled)}] {done:,}/{total:,} ({done / total * 100:.2f}%)" if total else f'{done:,} / 待确定'


def snapshot():
    w = read(WATERFALL / 'progress.json')
    done = sum(v for k, v in w.get('counts', {}).items() if k.endswith(':submitted') and not k.startswith('mind:'))
    plan = read(WATERFALL / 'plan.json')
    total = sum(v for k, v in plan.get('datasets', {}).items() if k != 'mind')
    pids = read(BASE / 'processes.json')
    lines = [f"实验进度  {datetime.datetime.now():%Y-%m-%d %H:%M:%S}", '',
             'Waterfall 非 MIND：' + bar(done, total),
             f"  状态: {w.get('status', '未知')}，进程{'存活' if live(w.get('pid')) else '未运行'}，当前: {w.get('current', '—')}", '',
             '既有对照队列（已提交包含空推荐；不是效果得分）：']
    for name, title, total in [('fixed', 'KuaiRand 原队列', 175), ('additional', '其余 Agent 对照', 3762), ('local', '本地固定检索', 1621)]:
        count, empty = events(name)
        state = read(BASE / f'{name}-progress.json')
        running = state.get('running') and live(pids.get(name))
        state_label = '运行中' if running else ('预测已提交，待验证' if count >= total else '已停止/待检查')
        lines.append(f"  {title}: {bar(count, total)}  {state_label}" + (f'，空推荐 {empty}' if empty else ''))
    e = read(EXPANSION / 'progress.json')
    k = read(EXPANSION / 'kuairand/progress.json')
    estate = e.get('status', '准备与核验中')
    kstate = k.get('status', '准备与核验中')
    download = read(EXPANSION / 'agentrecbench/download-process.json')
    directory = EXPANSION / 'agentrecbench/task'
    files = sum(1 for _ in directory.rglob('*.json')) if directory.exists() else 0
    verified = len(list((EXPANSION / 'agentrecbench').glob('*.manifest.json')))
    reviews = EXPANSION / 'agentrecbench/reviews'
    review_process = read(reviews/'process.json')
    review_bytes = sum(p.stat().st_size for p in reviews.glob('*-review.json*') if p.is_file()) if reviews.exists() else 0
    if estate == 'running' and not live(e.get('pid')): estate = '进程未运行，待检查'
    if kstate == 'running' and not live(k.get('pid')): kstate = '进程未运行，待检查'
    lines += ['', 'KuaiRand 测试扩展：' + (bar(k.get('submitted', 0), k.get('total', 0)) if k else '准备中，尚未启动'),
              f"  状态: {kstate}；当前: {k.get('current', '—')}",
              f"AgentRecBench 补充数据：{files} 个文件，已验证 {verified}/12 个领域场景；" + ('下载中/等待限流' if live(download.get('pid')) else '下载进程未运行'), '',
              f"AgentRecBench 历史资料：{review_bytes/1e9:.2f}/4.47 GB；" + ('下载中/等待限流' if live(review_process.get('pid')) else '进程未运行或下载结束'), '',
              f'MIND：{estate}（已按要求暂停）', '',
              '每 30 秒刷新。Ctrl+C 只关闭本显示，不停止实验。']
    return '\n'.join(lines)


if __name__ == '__main__':
    while True:
        print(('\033[H\033[2J' if sys.stdout.isatty() else '') + snapshot(), flush=True)
        if '--once' in sys.argv:
            break
        try:
            time.sleep(30)
        except KeyboardInterrupt:
            break
