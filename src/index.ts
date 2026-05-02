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
  .command('stop <name>')
  .description('Stop a running Claude Code session')
  .option('--remove', 'Also remove the session from the managed list')
  .action((name: string, options: Record<string, any>) => {
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
  .action(() => {
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
    console.log('  tmux attach -t multi-claude  — View all sessions in tmux');
  });

// ─── attach ──────────────────────────────────────────────────────────────────

program
  .command('attach [name]')
  .description('Attach to the multi-claude tmux session (or a specific window)')
  .action((name?: string) => {
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
  .command('restart <name>')
  .description('Restart a session (keeps the same configuration)')
  .action((name: string) => {
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

program.parse(process.argv);
