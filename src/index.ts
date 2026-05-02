#!/usr/bin/env node

import { Command } from 'commander';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  loadSessions,
  saveSessions,
  addSession,
  removeSession,
  getSession,
  getAllSessions,
  updateSessionStatus,
  renameSession,
} from './config';
import {
  startSession,
  stopSession,
  attachSession,
  isSessionAlive,
  listRunningWindows,
  renameWindow,
  checkTmux,
  validateSessionName,
  capturePane,
} from './terminal';
import { SessionConfig } from './types';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

const program = new Command();

program
  .name('multi-claude')
  .description(
    'Multi-terminal Claude Code session manager — run multiple Claude Code instances simultaneously with different LLM backends',
  )
  .version('1.0.0');

if (!checkTmux()) {
  console.error('Error: tmux is not installed or not available in PATH.');
  console.error('tmux 3.0+ is required. Install it with:');
  console.error('  sudo apt install tmux    # Debian/Ubuntu');
  console.error('  brew install tmux        # macOS');
  process.exit(1);
}

// ─── start ───────────────────────────────────────────────────────────────────

program
  .command('start <name>')
  .description('Start a new Claude Code session in a tmux window')
  .option('-m, --model <model>', 'LLM model alias or full name (e.g. sonnet, opus, claude-sonnet-4-6)')
  .option('-d, --dir <path>', 'Working directory for the session')
  .option('-s, --system-prompt <prompt>', 'Custom system prompt')
  .option('-p, --permission-mode <mode>', 'Permission mode')
  .option('-e, --effort <level>', 'Effort level (low, medium, high, xhigh, max)')
  .option('--settings <file>', 'Path to settings JSON file for custom API providers/endpoints')
  .option('--mcp-config <configs...>', 'MCP server config files (space-separated)')
  .option('--extra-args <args...>', 'Extra arguments to pass to claude')
  .option('-f, --force', 'Force restart if session is already running')
  .action((name: string, options: Record<string, any>) => {
    const nameErr = validateSessionName(name);
    if (nameErr) { console.error(`Invalid session name: ${nameErr}`); process.exit(1); }

    const existing = getSession(name);
    if (existing && isSessionAlive(name)) {
      if (options.force) {
        console.log(`Session "${name}" is already running. Force-restarting...`);
        stopSession(name);
      } else {
        console.log(`Session "${name}" is already running. Use "multi-claude attach ${name}" to connect, or --force to restart.`);
        return;
      }
    }

    const prev = existing?.config;
    const config: SessionConfig = {
      name,
      model: options.model ?? prev?.model,
      workingDir: options.dir ? path.resolve(options.dir) : (prev?.workingDir ?? process.cwd()),
      systemPrompt: options.systemPrompt ?? prev?.systemPrompt,
      permissionMode: options.permissionMode ?? prev?.permissionMode,
      effort: options.effort ?? prev?.effort,
      settingsFile: options.settings ?? prev?.settingsFile,
      mcpConfig: options.mcpConfig ?? prev?.mcpConfig,
      extraArgs: options.extraArgs ?? prev?.extraArgs,
      createdAt: prev?.createdAt || new Date().toISOString(),
      lastStartedAt: new Date().toISOString(),
    };

    console.log(`Starting session "${name}"${config.model ? ` with model "${config.model}"` : ''}...`);

    const { tmuxWindow } = startSession(config);

    addSession({ status: 'running', tmuxWindow, config });

    console.log(`Session "${name}" started successfully.`);
    console.log(`  Tmux window : ${tmuxWindow}`);
    console.log(`  Model       : ${config.model || '(default)'}`);
    console.log(`  Work dir    : ${config.workingDir}`);
    console.log();
    console.log(`Use "multi-claude attach ${name}" to connect, or "tmux attach -t multi-claude" to see all sessions.`);
  });

// ─── stop ────────────────────────────────────────────────────────────────────

program
  .command('stop [name]')
  .description('Stop a running Claude Code session (or all sessions with --all)')
  .option('--remove', 'Also remove the session from the managed list')
  .option('--all', 'Stop all running sessions')
  .action((name: string | undefined, options: Record<string, any>) => {
    if (options.all) {
      const store = loadSessions();
      const runningWindows = listRunningWindows();
      let count = 0;
      for (const w of runningWindows) {
        stopSession(w);
        const entry = store.sessions[w];
        if (entry) { entry.status = 'stopped'; }
        count++;
      }
      saveSessions(store);
      console.log(`Stopped ${count} session(s).`);
      return;
    }

    if (!name) {
      console.error('Error: specify a session name or use --all.');
      process.exit(1);
    }

    const session = getSession(name);
    if (!session) {
      console.log(`No session named "${name}" found.`);
      return;
    }

    if (!isSessionAlive(name) && session.status === 'stopped') {
      console.log(`Session "${name}" is already stopped.`);
      return;
    }

    stopSession(name);

    if (options.remove) {
      removeSession(name);
      console.log(`Session "${name}" stopped and removed.`);
    } else {
      updateSessionStatus(name, 'stopped');
      console.log(`Session "${name}" stopped. Use "multi-claude start ${name}" to restart.`);
    }
  });

// ─── list ────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all managed Claude Code sessions')
  .option('--json', 'Output as JSON')
  .action((options: Record<string, any>) => {
    const store = loadSessions();
    const sessions = Object.entries(store.sessions).map(([name, state]) => ({
      ...state,
      name,
    }));
    const runningWindows = listRunningWindows();

    // Sync status of all sessions in a single read-modify-write cycle
    let changed = false;
    for (const s of sessions) {
      const alive = runningWindows.includes(s.name);
      if (alive && s.status !== 'running') {
        const entry = store.sessions[s.name];
        if (entry) { entry.status = 'running'; s.status = 'running'; changed = true; }
      } else if (!alive && s.status !== 'stopped') {
        const entry = store.sessions[s.name];
        if (entry) { entry.status = 'stopped'; s.status = 'stopped'; changed = true; }
      }
    }
    if (changed) saveSessions(store);

    if (options.json) {
      const output = sessions.map(s => ({
        name: s.name,
        status: runningWindows.includes(s.name) ? 'running' : 'stopped',
        tmuxWindow: s.tmuxWindow,
        config: s.config,
      }));
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    if (sessions.length === 0) {
      console.log('No managed sessions found. Use "multi-claude start <name>" to create one.');
      return;
    }

    console.log('Managed Claude Code sessions:\n');

    const nameWidth = Math.max(20, ...sessions.map(s => s.name.length));
    console.log(
      `${'NAME'.padEnd(nameWidth)}  ${'STATUS'.padEnd(10)}  ${'MODEL'.padEnd(20)}  ${'WORK DIR'}`,
    );
    console.log(
      `${'-'.repeat(nameWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(20)}  ${'-'.repeat(40)}`,
    );

    for (const s of sessions) {
      const alive = runningWindows.includes(s.name);
      const color = alive ? GREEN : RED;
      const plainStatus = alive ? '▶ running' : '■ stopped';
      const status = `${color}${plainStatus.padEnd(10)}${RESET}`;
      const model = s.config.model || '(default)';
      const workDir = s.config.workingDir || '(unknown)';

      console.log(
        `${s.name.padEnd(nameWidth)}  ${status}  ${model.padEnd(20)}  ${workDir}`,
      );
    }

    console.log();
    console.log('Commands:');
    console.log('  multi-claude attach <name>   — Attach to a session');
    console.log('  multi-claude stop <name>     — Stop a session');
    console.log('  multi-claude stop --all      — Stop all sessions');
    console.log('  tmux attach -t multi-claude  — View all sessions in tmux');
  });

// ─── attach ──────────────────────────────────────────────────────────────────

program
  .command('attach [name]')
  .description('Attach to the multi-claude tmux session (or a specific window)')
  .action((name?: string) => {
    if (process.env.TMUX) {
      console.error('Already inside a tmux session. Detach first (Ctrl-b d) or use:');
      console.error(`  tmux select-window -t multi-claude${name ? `:${name}` : ''} \\&\\& tmux switch-client -t multi-claude`);
      process.exit(1);
    }
    if (!process.stdin.isTTY) {
      console.error('Cannot attach: stdin is not a terminal. Are you running from a script?');
      process.exit(1);
    }
    try {
      if (name) {
        const session = getSession(name);
        if (!session && !isSessionAlive(name)) {
          console.log(`No session named "${name}" found.`);
          console.log('Available sessions:');
          const sessions = getAllSessions();
          if (sessions.length === 0) {
            console.log('  (none)');
          } else {
            sessions.forEach(s => console.log(`  ${s.name}`));
          }
          return;
        }
        attachSession(session?.tmuxWindow || `multi-claude:${name}`);
      } else {
        attachSession();
      }
    } catch (err: any) {
      console.error(err.message);
      process.exit(1);
    }
  });

// ─── config ───────────────────────────────────────────────────────────────────

program
  .command('config <name>')
  .description('Show or update session configuration')
  .option('-m, --model <model>', 'Change LLM model')
  .option('-d, --dir <path>', 'Change working directory')
  .option('-s, --system-prompt <prompt>', 'Change system prompt')
  .option('-p, --permission-mode <mode>', 'Change permission mode')
  .option('-e, --effort <level>', 'Change effort level')
  .option('--settings <file>', 'Change settings JSON file for custom API providers')
  .option('--mcp-config <configs...>', 'Change MCP server config files')
  .option('--extra-args <args...>', 'Change extra arguments passed to claude')
  .option('--unset <fields...>', 'Unset configuration fields (model, workingDir, systemPrompt, permissionMode, effort, settingsFile, mcpConfig, extraArgs)')
  .action((name: string, options: Record<string, any>) => {
    const session = getSession(name);
    if (!session) {
      console.log(`No session named "${name}" found.`);
      return;
    }

    const isModifying =
      options.model !== undefined ||
      options.dir !== undefined ||
      options.systemPrompt !== undefined ||
      options.permissionMode !== undefined ||
      options.effort !== undefined ||
      options.settings !== undefined ||
      options.mcpConfig !== undefined ||
      options.extraArgs !== undefined ||
      options.unset !== undefined;

    const cfg = session.config;

    if (!isModifying) {
      console.log(`Configuration for "${name}":`);
      console.log(`  Model          : ${cfg.model || '(default)'}`);
      console.log(`  Working Dir    : ${cfg.workingDir || '(not set)'}`);
      console.log(`  Permission Mode: ${cfg.permissionMode || '(default)'}`);
      console.log(`  Effort         : ${cfg.effort || '(default)'}`);
      console.log(`  Settings File  : ${cfg.settingsFile || '(none)'}`);
      console.log(`  MCP Configs    : ${cfg.mcpConfig?.join(', ') || '(none)'}`);
      console.log(`  System Prompt  : ${cfg.systemPrompt ? '(set)' : '(none)'}`);
      console.log(`  Extra Args     : ${cfg.extraArgs?.join(' ') || '(none)'}`);
      console.log(`  Created At     : ${cfg.createdAt}`);
      console.log(`  Last Started   : ${cfg.lastStartedAt || '(never)'}`);
      return;
    }

    if (options.model !== undefined) cfg.model = options.model || undefined;
    if (options.dir !== undefined) cfg.workingDir = options.dir ? path.resolve(options.dir) : undefined;
    if (options.systemPrompt !== undefined) cfg.systemPrompt = options.systemPrompt || undefined;
    if (options.permissionMode !== undefined) cfg.permissionMode = options.permissionMode || undefined;
    if (options.effort !== undefined) cfg.effort = options.effort || undefined;
    if (options.settings !== undefined) cfg.settingsFile = options.settings || undefined;
    if (options.mcpConfig !== undefined) cfg.mcpConfig = options.mcpConfig.length > 0 ? options.mcpConfig : undefined;
    if (options.extraArgs !== undefined) cfg.extraArgs = options.extraArgs.length > 0 ? options.extraArgs : undefined;

    if (options.unset) {
      const unsetMap: Record<string, string> = {
        model: 'model',
        workingDir: 'workingDir',
        systemPrompt: 'systemPrompt',
        permissionMode: 'permissionMode',
        effort: 'effort',
        settingsFile: 'settingsFile',
        mcpConfig: 'mcpConfig',
        extraArgs: 'extraArgs',
      };
      for (const field of options.unset) {
        const key = unsetMap[field];
        if (key) {
          (cfg as any)[key] = undefined;
        } else {
          console.log(`Unknown config field "${field}". Valid fields: ${Object.keys(unsetMap).join(', ')}`);
        }
      }
    }

    addSession({ status: session.status, tmuxWindow: session.tmuxWindow, config: cfg });

    console.log(`Configuration for "${name}" updated:`);
    console.log(`  Model          : ${cfg.model || '(default)'}`);
    console.log(`  Working Dir    : ${cfg.workingDir || '(not set)'}`);
    console.log(`  Permission Mode: ${cfg.permissionMode || '(default)'}`);
    console.log(`  Effort         : ${cfg.effort || '(default)'}`);
    console.log(`  Settings File  : ${cfg.settingsFile || '(none)'}`);
    console.log(`  MCP Configs    : ${cfg.mcpConfig?.join(', ') || '(none)'}`);
    console.log(`  System Prompt  : ${cfg.systemPrompt ? '(set)' : '(none)'}`);
    console.log(`  Extra Args     : ${cfg.extraArgs?.join(' ') || '(none)'}`);
    console.log();
    console.log('Restart the session for changes to take effect:');
    console.log(`  multi-claude restart ${name}`);
  });

// ─── restart ─────────────────────────────────────────────────────────────────

program
  .command('restart [name]')
  .description('Restart a session (keeps the same configuration)')
  .option('--all', 'Restart all saved sessions')
  .action((name: string | undefined, options: Record<string, any>) => {
    if (options.all) {
      const store = loadSessions();
      let count = 0;
      for (const [n, state] of Object.entries(store.sessions)) {
        console.log(`Restarting session "${n}"...`);
        if (isSessionAlive(n)) stopSession(n);
        const { tmuxWindow } = startSession(state.config);
        state.status = 'running';
        state.tmuxWindow = tmuxWindow;
        state.config.lastStartedAt = new Date().toISOString();
        count++;
      }
      saveSessions(store);
      console.log(`Restarted ${count} session(s).`);
      return;
    }

    if (!name) {
      console.error('Error: specify a session name or use --all.');
      process.exit(1);
    }

    const session = getSession(name);
    if (!session) {
      console.log(`No session named "${name}" found.`);
      return;
    }

    console.log(`Restarting session "${name}"...`);

    if (isSessionAlive(name)) {
      stopSession(name);
    }

    const { tmuxWindow } = startSession(session.config);

    addSession({
      status: 'running',
      tmuxWindow,
      config: { ...session.config, lastStartedAt: new Date().toISOString() },
    });

    console.log(`Session "${name}" restarted.`);
    console.log(`  Tmux window : ${tmuxWindow}`);
    console.log(`  Model       : ${session.config.model || '(default)'}`);
  });

// ─── rename ──────────────────────────────────────────────────────────────────

program
  .command('rename <oldName> <newName>')
  .description('Rename a session (and its tmux window if running)')
  .action((oldName: string, newName: string) => {
    const nameErr = validateSessionName(newName);
    if (nameErr) { console.error(`Invalid session name "${newName}": ${nameErr}`); process.exit(1); }

    const session = getSession(oldName);
    if (!session) {
      console.log(`No session named "${oldName}" found.`);
      return;
    }
    if (getSession(newName)) {
      console.log(`Session "${newName}" already exists.`);
      return;
    }

    const wasRunning = isSessionAlive(oldName);
    if (wasRunning) {
      renameWindow(oldName, newName);
    }

    renameSession(oldName, newName);
    console.log(`Session renamed: "${oldName}" → "${newName}"${wasRunning ? ` ${GREEN}(running)${RESET}` : ''}`);
  });

// ─── kill-all ────────────────────────────────────────────────────────────────

program
  .command('kill-all')
  .description('Stop all running sessions and kill the multi-claude tmux session')
  .action(() => {
    const store = loadSessions();
    const runningWindows = listRunningWindows();
    let count = 0;

    for (const name of runningWindows) {
      stopSession(name);
      count++;
    }

    spawnSync('tmux', ['kill-session', '-t', 'multi-claude'], { stdio: 'ignore' });

    for (const key of Object.keys(store.sessions)) {
      store.sessions[key].status = 'stopped';
    }
    saveSessions(store);

    console.log(`Stopped ${count} session(s). All sessions killed.`);
  });

// ─── models ──────────────────────────────────────────────────────────────────

program
  .command('models')
  .description('List common LLM model aliases for reference')
  .action(() => {
    console.log('Common model aliases (use with --model):\n');
    console.log('Anthropic Claude models:');
    console.log('  sonnet           — Latest Claude Sonnet');
    console.log('  opus             — Latest Claude Opus');
    console.log('  haiku            — Latest Claude Haiku');
    console.log('  claude-sonnet-4-6');
    console.log('  claude-opus-4-7');
    console.log();
    console.log('Third-party providers (if configured):');
    console.log('  Use the full model ID from your provider.');
    console.log('  See: https://docs.anthropic.com/en/docs/claude-code/settings');
  });

// ─── logs ───────────────────────────────────────────────────────────────────

program
  .command('logs <name>')
  .description('Show recent output from a session (tmux pane scrollback)')
  .option('-n, --lines <number>', 'Number of lines to show (default: entire buffer)', parseInt)
  .action((name: string, options: Record<string, any>) => {
    if (!isSessionAlive(name)) {
      console.error(`Session "${name}" is not running.`);
      process.exit(1);
    }
    const output = capturePane(name, options.lines);
    if (!output) {
      console.log(`(no output captured from session "${name}")`);
    } else {
      process.stdout.write(output);
    }
  });

// ─── completion ─────────────────────────────────────────────────────────────

program
  .command('completion [shell]')
  .description('Generate shell completion script')
  .action((shell?: string) => {
    const target = shell || (process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash');

    if (target === 'zsh') {
      console.log(`#compdef multi-claude
# shellcheck shell=zsh
# Generated by: multi-claude completion zsh
# Add to fpath: cp this file to /usr/local/share/zsh/site-functions/_multi-claude
#   or append to ~/.zshrc: source <(multi-claude completion zsh)

_multi_claude() {
  local curcontext=\$curcontext state state_descr line
  typeset -A opt_args

  local -a commands
  commands=(
    'start:Start a new Claude Code session in a tmux window'
    'stop:Stop a running session'
    'list:List all managed sessions'
    'attach:Attach to the tmux session'
    'config:Show or update session configuration'
    'restart:Restart a session'
    'rename:Rename a session'
    'kill-all:Stop all sessions and kill the tmux session'
    'models:List common model aliases'
    'completion:Generate shell completion script'
  )

  local -a session_names
  session_names=(\\\${(f)\\"\\$(node -e "try{const s=require(\\'os\\').homedir()+\\'/.multi-claude/sessions.json\\';const d=require(\\'fs\\').readFileSync(s,\\'utf8\\');const j=JSON.parse(d);console.log(Object.keys(j.sessions||{}).join(\\'\\\\n\\'));}catch(e){}" 2>/dev/null)\\"})

  _arguments -C \\
    '1: :->command' \\
    '*:: :->args'

  case \\\$state in
    command)
      _describe 'command' commands
      ;;
    args)
      case \\\$words[1] in
        start)
          _arguments \\
            '-m[LLM model]:model:()' \\
            '--model[LLM model]:model:()' \\
            '-d[Working directory]:dir:_directories' \\
            '--dir[Working directory]:dir:_directories' \\
            '-s[Custom system prompt]' \\
            '--system-prompt[Custom system prompt]' \\
            '-p[Permission mode]:mode:(default acceptEdits plan bypassPermissions)' \\
            '--permission-mode[Permission mode]:mode:(default acceptEdits plan bypassPermissions)' \\
            '-e[Effort level]:level:(low medium high xhigh max)' \\
            '--effort[Effort level]:level:(low medium high xhigh max)' \\
            '--settings[Settings file]:file:_files' \\
            '--mcp-config[MCP config files]:file:_files' \\
            '--extra-args[Extra arguments]' \\
            '-f[Force restart]' \\
            '--force[Force restart]' \\
            '1: :->session_names'
          ;;
        stop)
          _arguments \\
            '--remove[Also remove from managed list]' \\
            '--all[Stop all sessions]' \\
            '1:session:->session_names'
          ;;
        attach|config|restart|rename)
          _arguments '1:session:->session_names'
          ;;
      esac
      ;;
    session_names)
      if [[ -n \\\${session_names} ]]; then
        _describe 'session' session_names
      fi
      ;;
  esac
}

_multi_claude "\$@"
`);
    } else {
      console.log(`# shellcheck shell=bash
# Generated by: multi-claude completion bash
# Source in ~/.bashrc: source <(multi-claude completion bash)

_multi_claude_completion() {
  local cur prev words cword
  _init_completion || return

  local opts="start stop list attach config restart rename kill-all models completion"
  local sessions
  sessions=\\$(node -e "try{const s=require('os').homedir()+'/.multi-claude/sessions.json';const d=require('fs').readFileSync(s,'utf8');const j=JSON.parse(d);console.log(Object.keys(j.sessions||{}).join(' '));}catch(e){}" 2>/dev/null)

  case \\\${prev} in
    start)
      if [[ \\\${cur} == -* ]]; then
        COMPREPLY=( \\$(compgen -W "-m --model -d --dir -s --system-prompt -p --permission-mode -e --effort --settings --mcp-config --extra-args -f --force" -- "\\\${cur}") )
      else
        COMPREPLY=( \\$(compgen -W "\\\${sessions}" -- "\\\${cur}") )
      fi
      return 0
      ;;
    stop|attach|config|restart|rename)
      COMPREPLY=( \\$(compgen -W "\\\${sessions}" -- "\\\${cur}") )
      return 0
      ;;
    stop)
      if [[ \\\${cur} == -* ]]; then
        COMPREPLY=( \\$(compgen -W "--remove --all" -- "\\\${cur}") )
      else
        COMPREPLY=( \\$(compgen -W "\\\${sessions}" -- "\\\${cur}") )
      fi
      return 0
      ;;
    -m|--model|-d|--dir|-p|--permission-mode|-e|--effort|--settings|--mcp-config)
      return 0
      ;;
  esac

  COMPREPLY=( \\$(compgen -W "\\\${opts}" -- "\\\${cur}") )
  return 0
}

complete -F _multi_claude_completion multi-claude
`);
    }
  });

program.parse(process.argv);
