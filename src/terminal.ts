import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SessionConfig } from './types';

export const TMUX_SESSION_PREFIX = 'multi-claude';
export const SETTINGS_DIR = path.join(os.homedir(), '.multi-claude', 'settings');

const VALID_SESSION_NAME = /^[a-zA-Z0-9][-a-zA-Z0-9_]*$/;

const PANE_READY_TIMEOUT_MS = 5000;
const PANE_POLL_INTERVAL_MS = 100;

export function checkTmux(): boolean {
  const result = spawnSync('tmux', ['-V'], { stdio: 'ignore' });
  return result.status === 0;
}

export function validateSessionName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'Session name must not be empty.';
  if (name.length > 64) return 'Session name must be 64 characters or fewer.';
  if (name.includes(':')) return 'Session name must not contain colons (:).';
  if (name.includes('.')) return 'Session name must not contain dots (.).';
  if (/\s/.test(name)) return 'Session name must not contain whitespace.';
  if (!VALID_SESSION_NAME.test(name))
    return 'Session name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.';
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
  const result = spawnSync('tmux', ['has-session', '-t', windowName], {
    stdio: 'ignore',
    timeout: 5000,
  });
  return result.status === 0;
}

/**
 * Run a tmux command. Returns the spawn result so callers can check success.
 */
function tmux(args: string[]): SpawnSyncReturns<Buffer> {
  return spawnSync('tmux', args, { stdio: 'ignore', timeout: 10000 });
}

/**
 * Poll until a tmux pane is ready (shell initialized).
 * After creating a new window, the shell inside needs a moment to start.
 * Sending keys too early causes them to be lost.
 * Returns true if pane became ready, false on timeout.
 */
function waitForPane(windowName: string, timeoutMs = PANE_READY_TIMEOUT_MS): boolean {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = spawnSync('tmux', ['list-panes', '-t', windowName], {
      encoding: 'utf-8',
      timeout: 2000,
    });
    if (result.status === 0 && (result.stdout || '').trim()) {
      spawnSync('sleep', ['0.2']);
      return true;
    }
    spawnSync('sleep', [(PANE_POLL_INTERVAL_MS / 1000).toString()]);
  }
  return false;
}

/**
 * Check whether the `claude` binary is available in PATH.
 */
export function checkClaudeCli(): boolean {
  const result = spawnSync('which', ['claude'], { stdio: 'ignore', timeout: 5000 });
  return result.status === 0;
}

/**
 * Validate that a working directory exists and is accessible.
 */
export function validateWorkingDir(dir: string): string | null {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return `"${dir}" exists but is not a directory.`;
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.X_OK);
    } catch {
      return `Directory "${dir}" is not readable/executable.`;
    }
    return null;
  } catch {
    return `Directory "${dir}" does not exist.`;
  }
}

/**
 * Start a new Claude Code session inside a tmux window.
 * Uses tmux send-keys -l to avoid shell injection through tmux new-window's shell command argument.
 * Throws on failure.
 */
export function startSession(config: SessionConfig): { tmuxWindow: string } {
  const windowName = `${TMUX_SESSION_PREFIX}:${config.name}`;
  const workDir = config.workingDir || process.cwd();

  const dirErr = validateWorkingDir(workDir);
  if (dirErr) throw new Error(dirErr);

  if (tmuxHasWindow(windowName)) {
    const killResult = tmux(['kill-window', '-t', windowName]);
    if (killResult.status !== 0 && killResult.status !== 1) {
      throw new Error(`Failed to kill existing tmux window "${windowName}".`);
    }
  }

  const sessionExists = tmuxHasWindow(TMUX_SESSION_PREFIX);
  let createResult: SpawnSyncReturns<Buffer>;
  if (sessionExists) {
    createResult = tmux(['new-window', '-t', TMUX_SESSION_PREFIX, '-n', config.name]);
  } else {
    createResult = tmux([
      'new-session', '-d', '-s', TMUX_SESSION_PREFIX, '-n', config.name,
    ]);
  }
  if (createResult.status !== 0) {
    throw new Error(
      `Failed to create tmux window for session "${config.name}" (exit code ${createResult.status}).`,
    );
  }

  const paneReady = waitForPane(windowName);
  if (!paneReady) {
    tmux(['kill-window', '-t', windowName]);
    throw new Error(
      `Tmux pane for session "${config.name}" did not become ready within ${PANE_READY_TIMEOUT_MS}ms.`,
    );
  }

  const claudeArgs = buildClaudeArgs(config);
  const quotedArgs = claudeArgs.map(shellQuote);
  const cmdLine = `cd ${shellQuote(workDir)} && claude ${quotedArgs.join(' ')}\n`;

  const sendResult = spawnSync('tmux', ['send-keys', '-l', '-t', windowName, cmdLine], {
    stdio: 'ignore',
    timeout: 5000,
  });
  if (sendResult.status !== 0) {
    tmux(['kill-window', '-t', windowName]);
    throw new Error(`Failed to send command to tmux pane for session "${config.name}".`);
  }

  return { tmuxWindow: windowName };
}

/**
 * Stop a session by killing its tmux window.
 * Returns true if a window was killed.
 */
export function stopSession(name: string): boolean {
  const windowName = `${TMUX_SESSION_PREFIX}:${name}`;
  if (!tmuxHasWindow(windowName)) return false;

  const result = tmux(['kill-window', '-t', windowName]);
  if (result.status !== 0) return false;

  const listResult = spawnSync(
    'tmux',
    ['list-windows', '-t', TMUX_SESSION_PREFIX, '-F', '#{window_name}'],
    { encoding: 'utf-8', timeout: 5000 },
  );
  const windows = (listResult.stdout || '').trim();
  if (listResult.status !== 0 || !windows || windows.split('\n').filter(Boolean).length === 0) {
    spawnSync('tmux', ['kill-session', '-t', TMUX_SESSION_PREFIX], { stdio: 'ignore', timeout: 5000 });
  }

  return true;
}

/**
 * Rename a tmux window within the multi-claude session.
 */
export function renameWindow(oldName: string, newName: string): boolean {
  const oldWindow = `${TMUX_SESSION_PREFIX}:${oldName}`;
  if (!tmuxHasWindow(oldWindow)) return false;
  const result = spawnSync('tmux', ['rename-window', '-t', oldWindow, newName], {
    stdio: 'ignore',
    timeout: 5000,
  });
  return result.status === 0;
}

/**
 * Attach to the tmux session (default: attach to last active window).
 * If windowName is specified, select that window first.
 */
export function attachSession(windowName?: string): void {
  if (windowName) {
    const selResult = spawnSync('tmux', ['select-window', '-t', windowName], {
      stdio: 'ignore',
      timeout: 5000,
    });
    if (selResult.status !== 0) {
      throw new Error(`Failed to select tmux window "${windowName}". Is the session running?`);
    }
  }
  const result = spawnSync('tmux', ['attach-session', '-t', TMUX_SESSION_PREFIX], {
    stdio: 'inherit',
    timeout: 0,
  });
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
  const result = spawnSync(
    'tmux',
    ['list-windows', '-t', TMUX_SESSION_PREFIX, '-F', '#{window_name}'],
    { encoding: 'utf-8', timeout: 5000 },
  );
  if (result.status !== 0) return [];
  const output = (result.stdout || '').trim();
  return output ? output.split('\n').filter(Boolean) : [];
}

/**
 * Resolve the settings file path for a given provider ID.
 * Returns undefined for Anthropic (no settings needed) or if the file doesn't exist.
 */
export function resolveProviderSettings(providerId: string): string | undefined {
  if (providerId === 'anthropic') return undefined;
  const filePath = path.join(SETTINGS_DIR, `${providerId}.json`);
  return fs.existsSync(filePath) ? filePath : undefined;
}

/**
 * Capture the visible content (or scrollback buffer) of a tmux pane.
 * Limited to prevent memory issues.
 */
export function capturePane(name: string, lines?: number): string {
  const windowName = `${TMUX_SESSION_PREFIX}:${name}`;
  const args = ['capture-pane', '-t', windowName, '-p'];
  if (lines !== undefined && lines > 0) {
    args.push('-S', `-${Math.min(lines, 1_000_000)}`);
  } else {
    args.push('-S', '-10000');
  }
  const result = spawnSync('tmux', args, {
    encoding: 'utf-8',
    timeout: 10000,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) return '';
  return (result.stdout || '');
}
