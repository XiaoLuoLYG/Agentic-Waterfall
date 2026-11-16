import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { check, exact } from './core.mjs';

const derive = promisify(scrypt);
// OWASP's 32 MiB scrypt option keeps parallel logins within a local demo's memory budget.
const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const SETTINGS = ['interests', 'sources', 'contentTypes', 'layout', 'theme', 'density', 'language'];
const defaults = () => ({ interests: [], sources: [], contentTypes: ['text', 'video', 'image'], layout: 'cards', theme: 'light', density: 'comfortable', language: 'zh' });
const publicUser = user => structuredClone({ id: user.id, username: user.username, displayName: user.displayName, settings: user.settings, created_at: user.created_at, ...(user.type ? { type: user.type } : {}) });
const tokenHash = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash('sha256').update(token).digest('hex') : null;

function text(value, name, max) {
  check(typeof value === 'string' && [...value].length <= max, `${name}须为不超过 ${max} 字的文本`);
  const trimmed = value.trim(); check(trimmed.length > 0 && !/[\u0000-\u001f\u007f]/.test(trimmed), `${name}不能为空或包含控制字符`);
  return trimmed;
}
function username(value) {
  const normalized = text(value, '用户名', 40).toLowerCase();
  check(/^[a-z0-9_-]{3,32}$/.test(normalized), '用户名须为 3–32 位字母、数字、下划线或连字符'); return normalized;
}
function password(value) {
  check(typeof value === 'string' && [...value].length >= 8 && [...value].length <= 128 && value.trim().length > 0, '密码须为 8–128 个字符'); return value;
}
export function settingsPatch(patch) {
  exact(patch, SETTINGS); const result = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'interests' || key === 'sources') {
      const count = key === 'interests' ? 60 : 30; const length = key === 'interests' ? 40 : 80;
      check(Array.isArray(value) && value.length <= count, `${key}最多 ${count} 项`);
      result[key] = [...new Set(value.map(item => text(item, key, length)))];
    } else if (key === 'contentTypes') {
      check(Array.isArray(value) && value.length >= 1 && value.length <= 3 && value.every(item => ['text', 'video', 'image'].includes(item)), '请选择至少一种有效内容类型');
      result[key] = [...new Set(value)];
    } else {
      const choices = { layout: ['cards', 'list'], theme: ['light', 'dark', 'system'], density: ['comfortable', 'compact'], language: ['zh', 'all'] };
      check(choices[key].includes(value), `${key}取值无效`); result[key] = value;
    }
  }
  return result;
}

export class AccountStore {
  #dir;
  #file;
  constructor(dataDir) {
    this.#dir = resolve(dataDir); mkdirSync(this.#dir, { recursive: true, mode: 0o700 });
    this.#file = join(this.#dir, 'accounts.json'); this.#read();
    try { chmodSync(this.#file, 0o600); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  #read() {
    let raw;
    try { raw = readFileSync(this.#file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return { version: 1, users: [], sessions: [] }; throw error;
    }
    try {
      const data = JSON.parse(raw);
      if (data.version !== 1 || !Array.isArray(data.users) || !Array.isArray(data.sessions)) throw new Error();
      const ids = new Set(); const names = new Set(); const tokens = new Set();
      for (const user of data.users) {
        if (typeof user.id !== 'string' || !user.id || ids.has(user.id) || names.has(user.username) || (user.type ? text(user.username, '用户名', 32).toLowerCase() !== user.username || !['human', 'agent'].includes(user.type) : username(user.username) !== user.username) || !Number.isFinite(Date.parse(user.created_at)) || !/^[a-f0-9]{32}$/.test(user.password_salt) || !/^[a-f0-9]{128}$/.test(user.password_hash)) throw new Error();
        text(user.displayName, '显示名', 40); settingsPatch(user.settings);
        if (Object.keys(user.settings).length !== SETTINGS.length) throw new Error();
        ids.add(user.id); names.add(user.username);
      }
      for (const session of data.sessions) {
        if (!ids.has(session.user_id) || !/^[a-f0-9]{64}$/.test(session.token_hash) || tokens.has(session.token_hash) || !Number.isSafeInteger(session.created_at) || !Number.isSafeInteger(session.expires_at) || session.expires_at <= session.created_at) throw new Error();
        tokens.add(session.token_hash);
      }
      return data;
    } catch { throw new Error('账户文件损坏或格式不受支持；原文件未被改写'); }
  }

  #write(data) {
    const temporary = join(this.#dir, `.accounts-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try { writeFileSync(fd, `${JSON.stringify(data)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.#file);
      const directory = openSync(this.#dir, 'r');
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { rmSync(temporary, { force: true }); }
  }

  #change(change) {
    // shortcut: one Node writer process per data directory; use transactional storage before multi-process deployment.
    const data = this.#read();
    data.sessions = data.sessions.filter(session => session.expires_at > Date.now());
    const result = change(data); this.#write(data); return result;
  }

  #issue(data, user) {
    const token = randomBytes(32).toString('base64url'); const now = Date.now();
    data.sessions.push({ token_hash: tokenHash(token), user_id: user.id, created_at: now, expires_at: now + SESSION_TTL });
    return { user: publicUser(user), token };
  }

  selectIdentity(input) {
    exact(input, ['username', 'type']);
    const name = text(input.username, '用户名', 32).toLowerCase();
    check(['human', 'agent'].includes(input.type), '请选择人或 Agent');
    return this.#change(data => {
      let user = data.users.find(value => value.username === name);
      if (user) {
        check((user.type || 'human') === input.type, '这个用户名已有不同的账号类型', 409);
      } else {
        user = { id: randomUUID(), username: name, displayName: name, type: input.type, settings: defaults(), created_at: new Date().toISOString(), password_salt: randomBytes(16).toString('hex'), password_hash: randomBytes(64).toString('hex') };
        data.users.push(user);
      }
      return this.#issue(data, user);
    });
  }

  async register(input) {
    exact(input, ['username', 'password', 'displayName']);
    const name = username(input.username); const secret = password(input.password); const displayName = text(input.displayName, '显示名', 40);
    check(!this.#read().users.some(user => user.username === name), '用户名已被使用', 409);
    const salt = randomBytes(16); const key = await derive(secret, salt, 64, SCRYPT);
    return this.#change(data => {
      check(!data.users.some(user => user.username === name), '用户名已被使用', 409);
      const user = { id: randomUUID(), username: name, displayName, settings: defaults(), created_at: new Date(Date.now()).toISOString(), password_salt: salt.toString('hex'), password_hash: key.toString('hex') };
      data.users.push(user); return this.#issue(data, user);
    });
  }

  async login(input) {
    exact(input, ['username', 'password']); const name = username(input.username); const secret = password(input.password);
    const user = this.#read().users.find(value => value.username === name);
    const key = await derive(secret, user ? Buffer.from(user.password_salt, 'hex') : Buffer.alloc(16), 64, SCRYPT);
    const matches = timingSafeEqual(key, user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64));
    check(user && matches, '用户名或密码不正确', 401);
    return this.#change(data => {
      const current = data.users.find(value => value.id === user.id);
      check(current && current.password_hash === user.password_hash, '用户名或密码不正确', 401);
      return this.#issue(data, current);
    });
  }

  getUser(token) {
    const hash = tokenHash(token); if (!hash) return null;
    const data = this.#read(); const session = data.sessions.find(value => value.token_hash === hash && value.expires_at > Date.now());
    return session ? publicUser(data.users.find(user => user.id === session.user_id)) : null;
  }

  logout(token) {
    const hash = tokenHash(token); if (!hash) return;
    this.#change(data => { data.sessions = data.sessions.filter(session => session.token_hash !== hash); });
  }

  updateSettings(userId, patch) {
    const changes = settingsPatch(patch);
    return this.#change(data => {
      const user = data.users.find(value => value.id === userId); check(user, '账户不存在', 404);
      Object.assign(user.settings, changes); return publicUser(user);
    });
  }

  updateProfile(userId, patch) {
    exact(patch, ['displayName']); const displayName = text(patch.displayName, '显示名', 40);
    return this.#change(data => {
      const user = data.users.find(value => value.id === userId); check(user, '账户不存在', 404);
      user.displayName = displayName; return publicUser(user);
    });
  }
}
