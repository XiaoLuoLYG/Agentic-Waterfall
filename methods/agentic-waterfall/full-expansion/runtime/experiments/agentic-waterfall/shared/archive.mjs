export function archiveAttempt(db, ledger, id, receipt, completedAt, durationMs) {
  const index = ledger.attempts.findIndex(x => x.id === id);
  if (index < 0 || ledger.attempts[index].status !== 'in_progress') throw new Error('reservation_missing');
  const entry = {...ledger.attempts[index], status: receipt?.status || 'failed', completed_at: completedAt,
    duration_ms: durationMs, usage: receipt?.usage || null,
    provider_response_model: receipt?.provider_response_model || null, request_gate_wait_ms:receipt?.request_gate_wait_ms??null,
    http_request_started_at:receipt?.http_request_started_at??null,
    ...(receipt?.error ? {error: receipt.error} : {}),...(receipt?.http_error?{http_error:receipt.http_error}:{})};
  db.exec('CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, record TEXT NOT NULL)');
  db.prepare('INSERT INTO attempts(id,record) VALUES(?,?)').run(id, JSON.stringify(entry));
  ledger.attempts.splice(index, 1);
}
