import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readModelResponse } from '../shared/model-response.mjs';

const endpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const flashModel = 'deepseek-v4.1-flash-1017';
const hash = value => createHash('sha256').update(value).digest('hex');
const quota = { total_tokens: 120000, period_seconds: 6 };
const maxRate = quota.total_tokens / quota.period_seconds * 0.9;
const burst = maxRate * 3;

export function bailianComparisonApi(keyFile, root, stop) {
  const key = readFileSync(keyFile, 'utf8').trim();
  assert(/^sk-[\w.-]+$/.test(key), 'invalid Bailian credential file');
  const headers = { authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const counters = { endpoint, model: flashModel, quota, credential_set_sha256: hash(key), requests: 0, successes: 0,
    failed: 0, throttled: 0, retries: 0, peak_inflight: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let active = 0, waiting = 0, rate = maxRate, tokens = burst, updated = Date.now(), blockedUntil = 0, gate = Promise.resolve();
  const replenish = () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + (now - updated) * rate / 1000);
    updated = now;
  };
  const record = row => appendFileSync(join(root, 'api-receipts.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
  const stats = () => ({ ...counters, active, waiting, target_tokens_per_second: Math.round(rate) });
  function reserve(amount, signal) {
    const next = gate.then(async () => {
      for (;;) {
        signal?.throwIfAborted();
        replenish();
        const wait = Math.max(blockedUntil - updated, (amount - tokens) * 1000 / rate);
        if (wait <= 0) { tokens -= amount; return; }
        await sleep(Math.ceil(wait), undefined, { signal });
      }
    });
    gate = next.catch(() => {});
    return next;
  }

  async function complete(payload, { signal, ...meta } = {}) {
    const { thinking, extra_body, response_format, messages, ...options } = payload;
    const format = response_format?.type === 'json_schema' ? { type: 'json_object' } : response_format;
    const schema = response_format?.type === 'json_schema' && response_format.json_schema?.schema;
    const sent = schema ? [{ role: 'system', content: 'Return a JSON object satisfying this schema: ' + JSON.stringify(schema) }, ...messages] : messages;
    const body = JSON.stringify({ ...options, messages: sent, ...(format ? { response_format: format } : {}), model: flashModel,
      stream: true, stream_options: { include_usage: true } });
    const request_sha256 = hash(body);
    // shortcut: reserve estimated tokens and settle from receipts; slow down on 429 if account traffic changes.
    const estimate = Math.min(burst, Math.ceil(Buffer.byteLength(JSON.stringify(sent)) / 3) + (options.enable_thinking ? 1800 : 512));
    for (let retry = 0; ; retry++) {
      waiting++;
      try { await reserve(estimate, signal); }
      finally { waiting--; }
      counters.requests++;
      counters.peak_inflight = Math.max(counters.peak_inflight, ++active);
      if (retry) counters.retries++;
      const started_at = new Date().toISOString();
      let status, result, error, retryable = false, refund = 0, code;
      try {
        const timeout = AbortSignal.timeout(300000);
        const response = await fetch(endpoint, { method: 'POST', headers, body, redirect: 'error',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
        status = response.status;
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          const reported = detail.error?.code ?? detail.code;
          code = typeof reported === 'string' && /^[\w.-]{1,80}$/.test(reported) ? reported : null;
          error = Error('Bailian HTTP ' + status + (code ? ' (' + code + ')' : ''));
          retryable = status === 429 || status >= 500;
          if (status === 429) {
            counters.throttled++;
            replenish();
            rate = Math.max(maxRate * 0.2, rate * 0.8);
            const header = response.headers.get('retry-after');
            const delay = header && (Number.isFinite(Number(header)) ? Number(header) * 1000 : Date.parse(header) - Date.now());
            blockedUntil = Math.max(blockedUntil, Date.now() + Math.max(1000, delay || quota.period_seconds * 1000));
          }
          if (status < 500) refund = estimate;
          if ([401, 403].includes(status) || /balance|arrearage|insufficientquota|invalidapikey|accessdenied/i.test(code ?? '')) stop(error);
        } else {
          result = await readModelResponse(response);
          if (result.model?.toLowerCase() !== flashModel) {
            error = Error('Bailian response did not identify the pinned model');
            if (result.model) stop(error);
          } else if (typeof result.choices?.[0]?.message?.content !== 'string' || !result.choices[0].finish_reason
            || !Number.isFinite(result.usage?.total_tokens)) {
            error = Error('incomplete Bailian response');
            retryable = true;
          }
        }
      } catch (cause) {
        error = Error('Bailian response interrupted', { cause });
        retryable = !signal?.aborted;
      } finally {
        active--;
        replenish();
        if (Number.isFinite(result?.usage?.total_tokens)) {
          for (const field of ['prompt_tokens', 'completion_tokens', 'total_tokens']) counters[field] += result.usage[field] ?? 0;
          refund = estimate - result.usage.total_tokens;
        }
        tokens = Math.min(burst, tokens + refund);
        if (!error && Date.now() - blockedUntil > 30000) rate = Math.min(maxRate, rate + 20);
        counters[error ? 'failed' : 'successes']++;
        record({ ...meta, request_sha256, started_at, finished_at: new Date().toISOString(), status, retry,
          id: result?.id, model: result?.model, usage: result?.usage, finish_reason: result?.choices?.[0]?.finish_reason, error: error?.message, code });
      }
      if (!error) return result;
      signal?.throwIfAborted();
      if (!retryable || retry === 6) throw error;
      if (status !== 429) await sleep(Math.min(16000, 1000 * 2 ** retry), undefined, { signal });
    }
  }

  return { raw: {}, flashModel, stats, complete, generate(messages, { temperature, max_tokens, ...meta }) {
    return complete({ messages, temperature, max_tokens, enable_thinking: false, response_format: { type: 'json_object' } }, meta);
  } };
}
