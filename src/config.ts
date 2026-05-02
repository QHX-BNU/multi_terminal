import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionState, SessionsStore } from './types';

const STORE_DIR = path.join(os.homedir(), '.multi-claude');
const STORE_FILE = path.join(STORE_DIR, 'sessions.json');

function ensureStoreDir(): void {
  if (!fs.existsSync(STORE_DIR)) {
    fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadSessions(): SessionsStore {
  ensureStoreDir();
  if (!fs.existsSync(STORE_FILE)) {
    return { version: 1, sessions: {} };
  }
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf-8');
    return JSON.parse(raw) as SessionsStore;
  } catch {
    const bakFile = STORE_FILE + '.bak';
    try {
      fs.renameSync(STORE_FILE, bakFile);
      process.stderr.write(
        `Warning: ${STORE_FILE} is corrupted. Renamed to ${bakFile}. Starting with empty sessions.\n`,
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
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  fs.chmodSync(STORE_FILE, 0o600);
}

export function addSession(state: SessionState): void {
  const store = loadSessions();
  store.sessions[state.name] = state;
  saveSessions(store);
}

export function removeSession(name: string): boolean {
  const store = loadSessions();
  if (!store.sessions[name]) return false;
  delete store.sessions[name];
  saveSessions(store);
  return true;
}

export function renameSession(oldName: string, newName: string): boolean {
  const store = loadSessions();
  if (!store.sessions[oldName] || store.sessions[newName]) return false;
  store.sessions[newName] = {
    ...store.sessions[oldName],
    name: newName,
    config: { ...store.sessions[oldName].config, name: newName },
  };
  delete store.sessions[oldName];
  saveSessions(store);
  return true;
}

export function updateSessionStatus(name: string, status: 'running' | 'stopped'): void {
  const store = loadSessions();
  if (store.sessions[name]) {
    store.sessions[name].status = status;
    saveSessions(store);
  }
}

export function getSession(name: string): SessionState | undefined {
  const store = loadSessions();
  return store.sessions[name];
}

export function getAllSessions(): SessionState[] {
  const store = loadSessions();
  return Object.values(store.sessions);
}
