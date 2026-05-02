import { SessionConfig } from './types';
/**
 * Build the claude CLI argument array from a session config.
 */
export declare function buildClaudeArgs(config: SessionConfig): string[];
/**
 * Start a new Claude Code session inside a tmux window.
 * Uses tmux send-keys to avoid shell injection through tmux new-window's shell command argument.
 */
export declare function startSession(config: SessionConfig): {
    pid: number;
    tmuxWindow: string;
};
/**
 * Stop a session by killing its tmux window.
 */
export declare function stopSession(name: string): boolean;
/**
 * Rename a tmux window within the multi-claude session.
 */
export declare function renameWindow(oldName: string, newName: string): boolean;
/**
 * Attach to the tmux session (default: attach to last active window).
 * If windowName is specified, select that window first.
 */
export declare function attachSession(windowName?: string): void;
/**
 * Check if a session's tmux window is still alive.
 */
export declare function isSessionAlive(name: string): boolean;
/**
 * List all running tmux windows for our session.
 */
export declare function listRunningWindows(): string[];
