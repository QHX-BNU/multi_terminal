import { SessionState, SessionsStore } from './types';
export declare function loadSessions(): SessionsStore;
export declare function saveSessions(store: SessionsStore): void;
export declare function addSession(state: SessionState): void;
export declare function removeSession(name: string): boolean;
export declare function updateSessionStatus(name: string, status: 'running' | 'stopped'): void;
export declare function getSession(name: string): SessionState | undefined;
export declare function getAllSessions(): SessionState[];
