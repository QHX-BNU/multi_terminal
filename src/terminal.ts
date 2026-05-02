import { spawnSync } from 'child_process';
import { SessionConfig } from './types';

export const TMUX_SESSION_PREFIX = 'multi-claude';

const VALID_SESSION_NAME = /^[a-zA-Z0-9][-a-zA-Z0-9_]*$/;

export function checkTmux(): boolean {
  const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return result.status === 0;
}

export function validateSessionName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'Session name must not be empty.';
  if (name.includes(':')) return 'Session name must not contain colons (:).';
  if (name.includes('.')) return 'Session name must not contain dots (.).';
  if (/\s/.test(name)) return 'Session name must not contain whitespace.';
  if (!VALID_SESSION_NAME.test(name)) return 'Session name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.';
  return null;
}

function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the claude CLI argument array from a session config.
 */
export function buildClaudeArgs(config: SessionConfig): string[] {
  const args: string[] = ['--name', config.name];

  if (config.model) {
    args.push('--model', config.model);
  }
  if (config.permissionMode) {
    args.push('--permission-mode', config.permissionMode);
  }
  if (config.effort) {
    args.push('--effort', config.effort);
  }
  if (config.systemPrompt) {
    args.push('--system-prompt', config.systemPrompt);
  }
  if (config.settingsFile) {
    args.push('--settings', config.settingsFile);
  }
  if (config.mcpConfig && config.mcpConfig.length > 0) {
    for (const mcp of config.mcpConfig) {
      args.push('--mcp-config', mcp);
    }
  }
  if (config.extraArgs && config.extraArgs.length > 0) {
    args.push(...config.extraArgs);
  }

  return args;
}

/**
 * Check whether a tmux session/window exists.
 */
function tmuxHasWindow(windowName: string): boolean {
  const result = spawnSync('tmux', ['has-session', '-t', windowName], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Run a tmux command safely without shell interpolation.
 * All arguments are passed as an array to avoid /bin/sh involvement.
 */
function tmux(args: string[]): void {
  spawnSync('tmux', args, { stdio: 'ignore' });
}

/**
 * Poll until a tmux pane is ready (shell initialized).
 * After creating a new window, the shell inside needs a moment to start.
 * Sending keys too early causes them to be lost.
 */
function waitForPane(windowName: string, timeoutMs = 3000): void {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = spawnSync('tmux', ['list-panes', '-t', windowName], { encoding: 'utf-8' });
    if (result.status === 0 && (result.stdout || '').trim()) {
      spawnSync('sleep', ['0.15']);
      return;
    }
    spawnSync('sleep', ['0.1']);
  }
}

/**
 * Check whether the `claude` binary is available in PATH.
 */
export function checkClaudeCli(): boolean {
  const result = spawnSync('which', ['claude'], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Start a new Claude Code session inside a tmux window.
 * Uses tmux send-keys to avoid shell injection through tmux new-window's shell command argument.
 */
export function startSession(config: SessionConfig): { tmuxWindow: string } {
  const windowName = `${TMUX_SESSION_PREFIX}:${config.name}`;
  const workDir = config.workingDir || process.cwd();

  if (tmuxHasWindow(windowName)) {
    tmux(['kill-window', '-t', windowName]);
  }

  const sessionExists = tmuxHasWindow(TMUX_SESSION_PREFIX);
  if (sessionExists) {
    tmux(['new-window', '-t', TMUX_SESSION_PREFIX, '-n', config.name]);
  } else {
    tmux(['new-session', '-d', '-s', TMUX_SESSION_PREFIX, '-n', config.name]);
  }

  waitForPane(windowName);

  const claudeArgs = buildClaudeArgs(config);
  const quotedArgs = claudeArgs.map(shellQuote);
  const cmdLine = `cd ${shellQuote(workDir)} && claude ${quotedArgs.join(' ')}\n`;

  spawnSync('tmux', ['send-keys', '-l', '-t', windowName, cmdLine], { stdio: 'ignore' });

  return { tmuxWindow: windowName };
}

/**
 * Stop a session by killing its tmux window.
 */
export function stopSession(name: string): boolean {
  const windowName = `${TMUX_SESSION_PREFIX}:${name}`;
  if (!tmuxHasWindow(windowName)) return false;

  tmux(['kill-window', '-t', windowName]);

  // If no more windows in the session, kill the session too
  const listResult = spawnSync('tmux', ['list-windows', '-t', TMUX_SESSION_PREFIX, '-F', '#{window_name}'], { encoding: 'utf-8' });
  const windows = (listResult.stdout || '').trim();
  if (listResult.status !== 0 || !windows || windows.split('\n').filter(Boolean).length === 0) {
    tmux(['kill-session', '-t', TMUX_SESSION_PREFIX]);
  }

  return true;
}

/**
 * Rename a tmux window within the multi-claude session.
 */
export function renameWindow(oldName: string, newName: string): boolean {
  const oldWindow = `${TMUX_SESSION_PREFIX}:${oldName}`;
  if (!tmuxHasWindow(oldWindow)) return false;
  const result = spawnSync('tmux', ['rename-window', '-t', oldWindow, newName], { stdio: 'ignore' });
  return result.status === 0;
}

/**
 * Attach to the tmux session (default: attach to last active window).
 * If windowName is specified, select that window first.
 */
export function attachSession(windowName?: string): void {
  if (windowName) {
    spawnSync('tmux', ['select-window', '-t', windowName], { stdio: 'ignore' });
  }
  const result = spawnSync('tmux', ['attach-session', '-t', TMUX_SESSION_PREFIX], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Failed to attach to tmux session. Is tmux running?');
  }
}

/**
 * Check if a session's tmux window is still alive.
 */
export function isSessionAlive(name: string): boolean {
  return tmuxHasWindow(`${TMUX_SESSION_PREFIX}:${name}`);
}

/**
 * List all running tmux windows for our session.
 */
export function listRunningWindows(): string[] {
  const result = spawnSync('tmux', ['list-windows', '-t', TMUX_SESSION_PREFIX, '-F', '#{window_name}'], { encoding: 'utf-8' });
  if (result.status !== 0) return [];
  const output = (result.stdout || '').trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Capture the visible content (or scrollback buffer) of a tmux pane.
 * Returns the text content.
 */
export function capturePane(name: string, lines?: number): string {
  const windowName = `${TMUX_SESSION_PREFIX}:${name}`;
  const args = ['capture-pane', '-t', windowName, '-p'];
  if (lines !== undefined && lines > 0) {
    args.push('-S', `-${lines}`);
  } else {
    args.push('-S', '-');
  }
  const result = spawnSync('tmux', args, { encoding: 'utf-8' });
  if (result.status !== 0) return '';
  return (result.stdout || '');
}
