import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionState, SessionsStore } from './types';

const STORE_DIR = path.join(os.homedir(), '.multi-claude');
const STORE_FILE = path.join(STORE_DIR, 'sessions.json');
const LOCK_FILE = path.join(STORE_DIR, 'sessions.lock');

function ensureStoreDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

function isStoreShape(parsed: unknown): parsed is SessionsStore {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (!obj.sessions || typeof obj.sessions !== 'object') return false;
  for (const [name, entry] of Object.entries(obj.sessions as Record<string, unknown>)) {
    if (typeof name !== 'string' || !name) return false;
    if (!entry || typeof entry !== 'object') return false;
    const s = entry as Record<string, unknown>;
    if (s.status !== 'running' && s.status !== 'stopped') return false;
    if (typeof s.tmuxWindow !== 'string') return false;
    if (!s.config || typeof s.config !== 'object') return false;
    const c = s.config as Record<string, unknown>;
    if (typeof c.name !== 'string' || !c.name) return false;
    if (typeof c.createdAt !== 'string') return false;
  }
  return true;
}

function acquireLock(): number | null {
  ensureStoreDir();
  try {
    const fd = fs.openSync(LOCK_FILE, 'wx');
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch {
    try {
      const stat = fs.statSync(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > 30_000) {
        fs.unlinkSync(LOCK_FILE);
        const fd = fs.openSync(LOCK_FILE, 'wx');
        fs.writeSync(fd, String(process.pid));
        return fd;
      }
    } catch {
      // can't recover
    }
    return null;
  }
}

function releaseLock(fd: number | null): void {
  if (fd === null) return;
  try {
    fs.closeSync(fd);
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // best effort
  }
}

export function loadSessions(): SessionsStore {
  ensureStoreDir();
  if (!fs.existsSync(STORE_FILE)) {
    return { version: 1, sessions: {} };
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!isStoreShape(parsed)) {
      throw new Error('Invalid store schema');
    }
    return parsed;
  } catch {
    const bakFile = STORE_FILE + '.bak';
    try {
      fs.renameSync(STORE_FILE, bakFile);
      process.stderr.write(
        `Warning: ${STORE_FILE} is corrupted or invalid. Renamed to ${bakFile}. Starting with empty sessions.\n`,
      );
    } catch {
      process.stderr.write(
        `Warning: ${STORE_FILE} is corrupted and could not be backed up. Starting with empty sessions.\n`,
      );
    }
    return { version: 1, sessions: {} };
  }
}

export function saveSessions(store: SessionsStore): void {
  ensureStoreDir();
  const tmpFile = STORE_FILE + '.tmp';
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpFile, STORE_FILE);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
    throw err;
  }
}

export function addSession(state: SessionState): void {
  const lockFd = acquireLock();
  try {
    const store = loadSessions();
    store.sessions[state.config.name] = state;
    saveSessions(store);
  } finally {
    releaseLock(lockFd);
  }
}

export function removeSession(name: string): boolean {
  const lockFd = acquireLock();
  try {
    const store = loadSessions();
    if (!store.sessions[name]) return false;
    delete store.sessions[name];
    saveSessions(store);
    return true;
  } finally {
    releaseLock(lockFd);
  }
}

export function renameSession(oldName: string, newName: string): boolean {
  const lockFd = acquireLock();
  try {
    const store = loadSessions();
    if (!store.sessions[oldName] || store.sessions[newName]) return false;
    store.sessions[newName] = {
      ...store.sessions[oldName],
      config: { ...store.sessions[oldName].config, name: newName },
    };
    delete store.sessions[oldName];
    saveSessions(store);
    return true;
  } finally {
    releaseLock(lockFd);
  }
}

export function updateSessionStatus(name: string, status: 'running' | 'stopped'): void {
  const lockFd = acquireLock();
  try {
    const store = loadSessions();
    if (store.sessions[name]) {
      store.sessions[name].status = status;
      saveSessions(store);
    }
  } finally {
    releaseLock(lockFd);
  }
}

export function updateSessionsStatus(updates: Array<{ name: string; status: 'running' | 'stopped' }>): void {
  const lockFd = acquireLock();
  try {
    const store = loadSessions();
    for (const u of updates) {
      if (store.sessions[u.name]) {
        store.sessions[u.name].status = u.status;
      }
    }
    saveSessions(store);
  } finally {
    releaseLock(lockFd);
  }
}

export function getSession(name: string): SessionState | undefined {
  const store = loadSessions();
  return store.sessions[name];
}

export function getAllSessions(): (SessionState & { name: string })[] {
  const store = loadSessions();
  return Object.entries(store.sessions).map(([name, state]) => ({
    ...state,
    name,
  }));
}
