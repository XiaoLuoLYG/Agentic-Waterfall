"""One small readiness request per 45 minutes on the batch's approved routes."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import fcntl
import json
import os
import subprocess
import sys

HERE=Path(__file__).resolve().parent
ROOT=HERE.parent
SHARED=ROOT/'full-agentrecbench-20261103'
CODE=SHARED/'frozen/code/experiments/agentic-waterfall/shared'
LEDGER=CODE/'model-ledger.json'
MODEL='DeepSeek-V4.1-Flash-1017'
CHECKS=HERE/'quota-checks'

def read(path):
    return json.loads(path.read_bytes())

def status(ledger=None):
    data=read(LEDGER) if ledger is None else ledger
    attempts=data['attempts']
    policy=data.get('credential_policy') or {}
    slots=policy.get('slots') or ['primary','secondary']
    exhausted, invalid, unverified, successes, rejections=[], [], [], [], []
    validated=policy.get('validated_slots',slots)
    for slot in slots:
        fingerprint=policy.get('fingerprints',{}).get(slot)
        legacy=policy.get('legacy_allowed',{}).get(slot,True)
        rows=[r for r in attempts if r.get('credential_slot','primary')==slot
              and (not fingerprint or (r.get('credential_fingerprint')==fingerprint if r.get('credential_fingerprint') else legacy))]
        budget=max((r.get('completed_at') or '' for r in rows
                    if (r.get('http_error') or {}).get('type')=='budget_exceeded'
                    and r['http_error'].get('retryable') is False),default='')
        auth=max((r.get('completed_at') or '' for r in rows
                  if (r.get('http_error') or {}).get('status') in (401,403)),default='')
        rejected=max(budget,auth)
        valid=[r for r in rows if r['status']=='success' and r.get('provider_response_model')==MODEL
               and (r.get('http_request_started_at') or '')>rejected]
        successes.extend(valid)
        if budget:rejections.append(budget)
        if rejected and not valid:
            (invalid if auth>=budget else exhausted).append(slot)
        elif slot not in validated:unverified.append(slot)
    available=[slot for slot in slots if slot not in exhausted+invalid+unverified]
    return {'ready':bool(available),'available_credentials':available,
            'exhausted_credentials':exhausted,'invalid_credentials':invalid,'unverified_credentials':unverified,
            'latest_quota_rejection':max(rejections,default=''),
            'confirmed_success':max((r.get('completed_at') or '' for r in successes),default=None)}

def main(probe):
    state=status()
    if not probe or not state['exhausted_credentials']:
        print(json.dumps(state))
        return
    CHECKS.mkdir(exist_ok=True)
    with (CHECKS/'check.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        state=status()
        if not state['exhausted_credentials']:
            print(json.dumps(state))
            return
        now=datetime.now(timezone.utc)
        previous=sorted(CHECKS.glob('*/request.json'))
        if previous and datetime.fromtimestamp(previous[-1].stat().st_mtime,timezone.utc)>now-timedelta(minutes=45):
            print(json.dumps({**state,'probe':'cooldown'}))
            return
        folder=CHECKS/now.strftime('%Y%m%dT%H%M%SZ')
        folder.mkdir()
        request=folder/'request.json'
        receipt=folder/'receipt.json'
        request.write_text(json.dumps({'messages':[{'role':'user','content':'Reply OK.'}],
                                       'temperature':0,'max_tokens':8})+'\n')
        env={**os.environ,'WATERFALL_FORMAL_ROUTE':'1','WATERFALL_MODEL_TIMEOUT_MS':'30000',
             'WATERFALL_REQUEST_GATE_DIR':str(SHARED/'request-gates'),
             'MODEL_CONFIG_FILE':str(ROOT.parents[2]/'HyperAgent/.worktrees/xuanji-device-latest-20261021/entry/src/main/resources/rawfile/hyperagent_config.local.json'),
             'WATERFALL_APPROVED_QUOTA_PROBE':'1'}
        env.pop('NODE_OPTIONS',None)
        try:
            with (folder/'process.log').open('xb') as log:
                # Outlast the existing 30s HTTP + 210s logical scheduling deadline.
                subprocess.run(['node','--import='+str(HERE/'register.mjs'),str(CODE/'model-call.mjs'),
                                '--experiment','method-deployment','--request',str(request),'--output',str(receipt)],
                               cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=270)
        except subprocess.TimeoutExpired:
            print(json.dumps({**status(),'probe':'process_timeout'}))
            return
        result=read(receipt)
        print(json.dumps({**status(),'probe':'success' if result.get('status')=='success' else result.get('error')}))

if __name__=='__main__':
    main('--probe' in sys.argv)
