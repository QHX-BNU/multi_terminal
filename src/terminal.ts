import { spawnSync, execSync } from 'child_process';
import { SessionConfig } from './types';

const TMUX_SESSION_PREFIX = 'multi-claude';

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
  try {
    execSync(`tmux has-session -t "${windowName}" 2>/dev/null`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a tmux command safely without shell interpolation.
 * All arguments are passed as an array to avoid /bin/sh involvement.
 */
function tmux(args: string[]): void {
  spawnSync('tmux', args, { stdio: 'ignore' });
}

/**
 * Start a new Claude Code session inside a tmux window.
 * Uses tmux send-keys to avoid shell injection through tmux new-window's shell command argument.
 */
export function startSession(config: SessionConfig): { pid: number; tmuxWindow: string } {
  const windowName = `${TMUX_SESSION_PREFIX}:${config.name}`;
  const workDir = config.workingDir || process.cwd();

  // Kill existing window with the same name if it exists
  if (tmuxHasWindow(windowName)) {
    tmux(['kill-window', '-t', windowName]);
  }

  // Ensure the tmux session exists, or create it
  const sessionExists = tmuxHasWindow(TMUX_SESSION_PREFIX);
  if (sessionExists) {
    tmux(['new-window', '-t', TMUX_SESSION_PREFIX, '-n', config.name]);
  } else {
    tmux(['new-session', '-d', '-s', TMUX_SESSION_PREFIX, '-n', config.name]);
  }

  // Build the command with proper shell quoting (for the target shell in the pane)
  const claudeArgs = buildClaudeArgs(config);
  const quotedArgs = claudeArgs.map(shellQuote);
  const cmdLine = `cd ${shellQuote(workDir)} && claude ${quotedArgs.join(' ')}\n`;

  // Send the command to the window as literal keystrokes (no shell interpretation in our process)
  spawnSync('tmux', ['send-keys', '-l', '-t', windowName, cmdLine], { stdio: 'ignore' });

  // Get the PID of the shell in the new window
  const result = spawnSync('tmux', ['display-message', '-t', windowName, '-p', '#{pane_pid}'], {
    encoding: 'utf-8',
  });

  const pidStr = (result.stdout || '').trim();
  const pid = parseInt(pidStr, 10);

  return { pid: isNaN(pid) ? 0 : pid, tmuxWindow: windowName };
}

/**
 * Stop a session by killing its tmux window.
 */
export function stopSession(name: string): boolean {
  const windowName = `${TMUX_SESSION_PREFIX}:${name}`;
  if (!tmuxHasWindow(windowName)) return false;

  tmux(['kill-window', '-t', windowName]);

  // If no more windows in the session, kill the session too
  try {
    const windows = execSync(
      `tmux list-windows -t "${TMUX_SESSION_PREFIX}" -F '#{window_name}' 2>/dev/null`,
      { encoding: 'utf-8' },
    ).trim();
    if (!windows || windows.split('\n').filter(Boolean).length === 0) {
      tmux(['kill-session', '-t', TMUX_SESSION_PREFIX]);
    }
  } catch {
    // Session already gone
  }

  return true;
}

/**
 * Attach to the tmux session (default: attach to last active window).
 * If windowName is specified, select that window first.
 */
export function attachSession(windowName?: string): void {
  try {
    if (windowName) {
      execSync(`tmux select-window -t "${windowName}" 2>/dev/null`, { stdio: 'ignore' });
    }
    execSync(`tmux attach-session -t "${TMUX_SESSION_PREFIX}"`, { stdio: 'inherit' });
  } catch {
    console.error('Failed to attach to tmux session. Is tmux running?');
    process.exit(1);
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
  try {
    const output = execSync(
      `tmux list-windows -t "${TMUX_SESSION_PREFIX}" -F '#{window_name}' 2>/dev/null`,
      { encoding: 'utf-8' },
    ).trim();
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}
