import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const now = () => new Date().toISOString();
export const read = path => JSON.parse(readFileSync(path, 'utf8'));
export const errorText = error => String(error?.message || error).replace(/sk-[A-Za-z0-9_-]+/g, '[REDACTED]');
export function save(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = path + '.tmp';
  writeFileSync(temp, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}
