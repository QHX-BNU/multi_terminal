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
  updateSessionsStatus,
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
  checkClaudeCli,
  validateSessionName,
  capturePane,
  resolveProviderSettings,
  TMUX_SESSION_PREFIX,
} from './terminal';
import {
  SessionConfig,
  InitResult,
  validateSessionConfig,
  VALID_PERMISSION_MODES,
  VALID_EFFORT_LEVELS,
} from './types';
import { generateZshCompletion, generateBashCompletion } from './completion';
import {
  PROVIDER_PRESETS,
  getProvider,
  detectProviders,
  generateSettingsFile,
  ensureSettingsFiles,
  sessionNameForProvider,
} from './providers';

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stderr.write(`\nReceived ${signal}. Shutting down...\n`);
  process.exit(0);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ─── Pre-flight checks ───────────────────────────────────────────────────────

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

if (!checkClaudeCli()) {
  console.error('Error: claude CLI is not installed or not available in PATH.');
  console.error('Install Claude Code with:');
  console.error('  npm install -g @anthropic-ai/claude-code');
  console.error('  See: https://docs.anthropic.com/en/docs/claude-code');
  process.exit(1);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printConfigSummary(cfg: SessionConfig): void {
  console.log(`  Description    : ${cfg.description || '(none)'}`);
  console.log(`  Provider       : ${cfg.provider || '(none)'}`);
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
}

// ─── start ────────────────────────────────────────────────────────────────────

program
  .command('start [name]')
  .description('Start a new Claude Code session in a tmux window')
  .option('-m, --model <model>', 'LLM model alias or full name (e.g. sonnet, opus, gpt-4.1)')
  .option('--provider <id>', 'LLM provider preset (anthropic, openai, gemini, groq, deepseek, openrouter, ollama, together)')
  .option('-d, --dir <path>', 'Working directory for the session')
  .option('--desc <description>', 'Description or notes for the session')
  .option('-s, --system-prompt <prompt>', 'Custom system prompt')
  .option('-p, --permission-mode <mode>', `Permission mode: ${VALID_PERMISSION_MODES.join(', ')}`)
  .option('-e, --effort <level>', `Effort level: ${VALID_EFFORT_LEVELS.join(', ')}`)
  .option('--settings <file>', 'Path to settings JSON file for custom API providers/endpoints')
  .option('--mcp-config <configs...>', 'MCP server config files (space-separated)')
  .option('--extra-args <args...>', 'Extra arguments to pass to claude')
  .option('-f, --force', 'Force restart if session is already running')
  .option('--all', 'Start all stopped sessions')
  .action((name: string | undefined, options: Record<string, any>) => {
    try {
      if (options.all) {
        const store = loadSessions();
        let count = 0;
        for (const [n, state] of Object.entries(store.sessions)) {
          if (state.status === 'stopped' || !isSessionAlive(n)) {
            if (isSessionAlive(n)) stopSession(n);
            try {
              const { tmuxWindow } = startSession(state.config);
              state.status = 'running';
              state.tmuxWindow = tmuxWindow;
              state.config.lastStartedAt = new Date().toISOString();
              count++;
            } catch (err: unknown) {
              console.error(`Failed to start "${n}": ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
        saveSessions(store);
        console.log(`Started ${count} session(s).`);
        return;
      }

      if (!name) {
        console.error('Error: specify a session name or use --all.');
        process.exit(1);
      }

      const nameErr = validateSessionName(name);
      if (nameErr) { console.error(`Invalid session name: ${nameErr}`); process.exit(1); }

      const existing = getSession(name);
      if (existing && isSessionAlive(name)) {
        if (options.force) {
          stopSession(name);
        } else {
          console.log(`Session "${name}" is already running. Use "multi-claude attach ${name}" to connect, or --force to restart.`);
          return;
        }
      }

      const prev = existing?.config;

      const providerId = options.provider ?? prev?.provider;
      if (providerId && !getProvider(providerId)) {
        console.error(`Unknown provider "${providerId}". Available: ${PROVIDER_PRESETS.map(p => p.id).join(', ')}`);
        process.exit(1);
      }

      let settingsFile = options.settings ?? prev?.settingsFile;
      if (!settingsFile && providerId) {
        if (providerId !== 'anthropic') {
          ensureSettingsFiles([providerId]);
          settingsFile = resolveProviderSettings(providerId);
        }
      }

      let model = options.model ?? prev?.model;
      if (!model && providerId) {
        const prov = getProvider(providerId);
        if (prov) model = prov.defaultModel;
      }

      const config: SessionConfig = {
        name,
        model,
        workingDir: options.dir ? path.resolve(options.dir) : (prev?.workingDir ?? process.cwd()),
        description: options.desc ?? prev?.description,
        systemPrompt: options.systemPrompt ?? prev?.systemPrompt,
        permissionMode: options.permissionMode ?? prev?.permissionMode,
        effort: options.effort ?? prev?.effort,
        settingsFile,
        mcpConfig: options.mcpConfig ?? prev?.mcpConfig,
        extraArgs: options.extraArgs ?? prev?.extraArgs,
        provider: providerId ?? prev?.provider,
        createdAt: prev?.createdAt || new Date().toISOString(),
        lastStartedAt: new Date().toISOString(),
      };

      // Validate config
      const configErrors = validateSessionConfig(config);
      if (configErrors.length > 0) {
        for (const err of configErrors) console.error(`Config error: ${err}`);
        process.exit(1);
      }

      const { tmuxWindow } = startSession(config);
      addSession({ status: 'running', tmuxWindow, config });

      const providerLabel = config.provider ? ` [${config.provider}]` : '';
      console.log(`Session "${name}" started successfully${providerLabel}.`);
      console.log(`  Tmux window : ${tmuxWindow}`);
      console.log(`  Model       : ${config.model || '(default)'}`);
      console.log(`  Work dir    : ${config.workingDir}`);
      if (config.description) console.log(`  Description : ${config.description}`);
      console.log();
      console.log(`Use "multi-claude attach ${name}" to connect, or "tmux attach -t multi-claude" to see all sessions.`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize sessions for detected LLM providers')
  .option('--providers <ids...>', 'Specific providers to set up (e.g. openai gemini groq)')
  .option('--list', 'List available provider presets')
  .option('--no-start', 'Create session configs without starting them')
  .option('--force', 'Overwrite existing settings files and session configs')
  .option('--json', 'Output results as JSON')
  .action((options: Record<string, any>) => {
    try {
      if (options.list) {
        console.log('Available LLM provider presets:\n');
        const nameWidth = 12;
        const envWidth = 24;
        console.log(`${'PROVIDER'.padEnd(nameWidth)}  ${'ENV VAR'.padEnd(envWidth)}  ${'DEFAULT MODEL'}`);
        console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(envWidth)}  ${'-'.repeat(30)}`);
        for (const p of PROVIDER_PRESETS) {
          const envVar = p.envVar || '(none — local)';
          const builtin = p.builtin ? ' (built-in)' : '';
          console.log(`${p.id.padEnd(nameWidth)}  ${envVar.padEnd(envWidth)}  ${p.defaultModel}${builtin}`);
        }
        console.log();
        console.log('Set the corresponding API key environment variable before running init.');
        console.log('Example: export OPENAI_API_KEY=sk-...');
        return;
      }

      const providerIds = options.providers
        ? options.providers
        : detectProviders().map(p => p.id);

      if (providerIds.length === 0) {
        console.log('No LLM providers detected.');
        console.log();
        console.log('Set at least one API key environment variable:');
        for (const p of PROVIDER_PRESETS) {
          if (p.envVar) console.log(`  export ${p.envVar}=<your-api-key>`);
        }
        console.log();
        console.log('Or specify providers manually:');
        console.log('  multi-claude init --providers openai gemini');
        console.log();
        console.log('See available providers:');
        console.log('  multi-claude init --list');
        return;
      }

      const results: InitResult[] = [];
      const store = loadSessions();

      for (const id of providerIds) {
        const provider = getProvider(id);
        if (!provider) {
          console.error(`Unknown provider "${id}". Skipping.`);
          continue;
        }

        const apiKeySet = provider.envVar ? !!process.env[provider.envVar] : true;
        if (!apiKeySet && !provider.builtin) {
          console.log(`Warning: ${provider.envVar} is not set. Provider "${id}" may not work.`);
        }

        let settingsFile: string | undefined;
        if (!provider.builtin) {
          try {
            settingsFile = generateSettingsFile(provider);
            console.log(`Generated settings file: ${settingsFile}`);
          } catch (err: unknown) {
            console.error(`Failed to generate settings for "${id}": ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
        }

        const sessionName = sessionNameForProvider(id);
        const existing = store.sessions[sessionName];

        if (existing && !options.force) {
          console.log(`Session "${sessionName}" already exists. Use --force to overwrite.`);
          continue;
        }

        const config: SessionConfig = {
          name: sessionName,
          model: provider.defaultModel,
          workingDir: process.cwd(),
          description: `Claude Code with ${provider.name}`,
          settingsFile,
          provider: id,
          createdAt: new Date().toISOString(),
          lastStartedAt: undefined,
        };

        if (!options.noStart) {
          if (isSessionAlive(sessionName)) stopSession(sessionName);
          try {
            const { tmuxWindow } = startSession(config);
            addSession({ status: 'running', tmuxWindow, config });
            console.log(`Started session "${sessionName}" [${provider.name}] with model "${provider.defaultModel}"`);
          } catch (err: unknown) {
            console.error(`Failed to start "${sessionName}": ${err instanceof Error ? err.message : String(err)}`);
            addSession({ status: 'stopped', tmuxWindow: `multi-claude:${sessionName}`, config });
          }
        } else {
          addSession({ status: 'stopped', tmuxWindow: `multi-claude:${sessionName}`, config });
          console.log(`Created session "${sessionName}" [${provider.name}] (stopped — use "multi-claude start ${sessionName}" to run)`);
        }

        results.push({ provider: id, sessionName, settingsFile, apiKeySet });
      }

      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      console.log();
      console.log(`Initialized ${results.length} session(s).`);
      console.log('Use "multi-claude list" to see all sessions.');
      console.log('Use "multi-claude attach <name>" to connect to a session.');

      const missing = results.filter(r => !r.apiKeySet);
      if (missing.length > 0) {
        console.log();
        console.log('Warning: The following sessions have no API key set:');
        for (const r of missing) {
          const prov = getProvider(r.provider);
          const envVar = prov?.envVar || '';
          console.log(`  ${r.sessionName} — set ${envVar} before starting`);
        }
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── stop ─────────────────────────────────────────────────────────────────────

program
  .command('stop [name]')
  .description('Stop a running Claude Code session (or all sessions with --all)')
  .option('--remove', 'Also remove the session from the managed list')
  .option('--all', 'Stop all running sessions')
  .action((name: string | undefined, options: Record<string, any>) => {
    try {
      if (options.all) {
        const runningWindows = listRunningWindows();
        let count = 0;
        const statusUpdates: Array<{ name: string; status: 'running' | 'stopped' }> = [];
        for (const w of runningWindows) {
          if (stopSession(w)) {
            statusUpdates.push({ name: w, status: 'stopped' });
            count++;
          }
        }
        updateSessionsStatus(statusUpdates);
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
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── list ─────────────────────────────────────────────────────────────────────

program
  .command('list')
  .description('List all managed Claude Code sessions')
  .option('--json', 'Output as JSON')
  .option('--filter <status>', 'Filter by status: running, stopped')
  .action((options: Record<string, any>) => {
    try {
      const store = loadSessions();
      const sessions = Object.entries(store.sessions).map(([name, state]) => ({
        ...state,
        name,
      }));
      const runningWindows = listRunningWindows();

      const statusUpdates: Array<{ name: string; status: 'running' | 'stopped' }> = [];
      for (const s of sessions) {
        const alive = runningWindows.includes(s.name);
        if (alive && s.status !== 'running') {
          statusUpdates.push({ name: s.name, status: 'running' });
          s.status = 'running';
        } else if (!alive && s.status !== 'stopped') {
          statusUpdates.push({ name: s.name, status: 'stopped' });
          s.status = 'stopped';
        }
      }
      if (statusUpdates.length > 0) updateSessionsStatus(statusUpdates);

      const filtered = options.filter
        ? sessions.filter(s => (options.filter === 'running') === runningWindows.includes(s.name))
        : sessions;

      if (options.json) {
        const output = filtered.map(s => ({
          name: s.name,
          status: runningWindows.includes(s.name) ? 'running' : 'stopped',
          tmuxWindow: s.tmuxWindow,
          config: s.config,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      if (filtered.length === 0) {
        const msg = options.filter
          ? `No ${options.filter} sessions found.`
          : 'No managed sessions found. Use "multi-claude start <name>" to create one.';
        console.log(msg);
        return;
      }

      console.log(`Managed Claude Code sessions${options.filter ? ` (${options.filter})` : ''}:\n`);

      const nameWidth = Math.max(20, ...filtered.map(s => s.name.length));
      const provWidth = 12;
      const descWidth = 24;
      console.log(
        `${'NAME'.padEnd(nameWidth)}  ${'STATUS'.padEnd(10)}  ${'PROVIDER'.padEnd(provWidth)}  ${'MODEL'.padEnd(20)}  ${'DESCRIPTION'.padEnd(descWidth)}  ${'WORK DIR'}`,
      );
      console.log(
        `${'-'.repeat(nameWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(provWidth)}  ${'-'.repeat(20)}  ${'-'.repeat(descWidth)}  ${'-'.repeat(40)}`,
      );

      for (const s of filtered) {
        const alive = runningWindows.includes(s.name);
        const color = alive ? GREEN : RED;
        const plainStatus = alive ? '▶ running' : '■ stopped';
        const status = `${color}${plainStatus.padEnd(10)}${RESET}`;
        const provider = (s.config.provider || 'anthropic').slice(0, provWidth);
        const model = (s.config.model || '(default)').slice(0, 20);
        const desc = (s.config.description || '').slice(0, descWidth);
        const workDir = s.config.workingDir || '(unknown)';

        console.log(
          `${s.name.padEnd(nameWidth)}  ${status}  ${provider.padEnd(provWidth)}  ${model.padEnd(20)}  ${desc.padEnd(descWidth)}  ${workDir}`,
        );
      }

      console.log();
      console.log('Commands:');
      console.log('  multi-claude attach <name>   — Attach to a session');
      console.log('  multi-claude stop <name>     — Stop a session');
      console.log('  multi-claude stop --all      — Stop all sessions');
      console.log('  multi-claude start --all     — Start all stopped sessions');
      console.log('  multi-claude init            — Initialize sessions for detected providers');
      console.log('  tmux attach -t multi-claude  — View all sessions in tmux');
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── attach ───────────────────────────────────────────────────────────────────

program
  .command('attach [name]')
  .description('Attach to the multi-claude tmux session (or a specific window)')
  .action((name?: string) => {
    try {
      if (process.env.TMUX) {
        console.error('Already inside a tmux session. Detach first (Ctrl-b d) or use:');
        console.error(`  tmux select-window -t multi-claude${name ? `:${name}` : ''} \\&\\& tmux switch-client -t multi-claude`);
        process.exit(1);
      }
      if (!process.stdin.isTTY) {
        console.error('Cannot attach: stdin is not a terminal. Are you running from a script?');
        process.exit(1);
      }
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
    } catch (err: unknown) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── config ───────────────────────────────────────────────────────────────────

program
  .command('config <name>')
  .description('Show or update session configuration')
  .option('-m, --model <model>', 'Change LLM model')
  .option('--provider <id>', 'Change LLM provider preset')
  .option('-d, --dir <path>', 'Change working directory')
  .option('--desc <description>', 'Change session description')
  .option('-s, --system-prompt <prompt>', 'Change system prompt')
  .option('-p, --permission-mode <mode>', `Change permission mode: ${VALID_PERMISSION_MODES.join(', ')}`)
  .option('-e, --effort <level>', `Change effort level: ${VALID_EFFORT_LEVELS.join(', ')}`)
  .option('--settings <file>', 'Change settings JSON file for custom API providers')
  .option('--mcp-config <configs...>', 'Change MCP server config files')
  .option('--extra-args <args...>', 'Change extra arguments passed to claude')
  .option('--json', 'Output configuration as JSON')
  .option('--unset <fields...>', 'Unset configuration fields (model, workingDir, description, systemPrompt, permissionMode, effort, settingsFile, mcpConfig, extraArgs, provider)')
  .action((name: string, options: Record<string, any>) => {
    try {
      const session = getSession(name);
      if (!session) {
        console.log(`No session named "${name}" found.`);
        return;
      }

      const isModifying =
        options.model !== undefined ||
        options.provider !== undefined ||
        options.dir !== undefined ||
        options.desc !== undefined ||
        options.systemPrompt !== undefined ||
        options.permissionMode !== undefined ||
        options.effort !== undefined ||
        options.settings !== undefined ||
        options.mcpConfig !== undefined ||
        options.extraArgs !== undefined ||
        options.unset !== undefined;

      const cfg = session.config;

      if (!isModifying) {
        if (options.json) {
          console.log(JSON.stringify(cfg, null, 2));
          return;
        }
        console.log(`Configuration for "${name}":`);
        printConfigSummary(cfg);
        return;
      }

      if (options.model !== undefined) cfg.model = options.model || undefined;
      if (options.provider !== undefined) {
        const prov = options.provider ? getProvider(options.provider) : null;
        if (options.provider && !prov) {
          console.log(`Warning: Unknown provider "${options.provider}".`);
        } else {
          cfg.provider = options.provider || undefined;
          if (options.provider && options.provider !== 'anthropic') {
            ensureSettingsFiles([options.provider]);
            cfg.settingsFile = resolveProviderSettings(options.provider);
          } else if (!options.provider) {
            cfg.settingsFile = undefined;
          }
        }
      }
      if (options.dir !== undefined) cfg.workingDir = options.dir ? path.resolve(options.dir) : undefined;
      if (options.desc !== undefined) cfg.description = options.desc || undefined;
      if (options.systemPrompt !== undefined) cfg.systemPrompt = options.systemPrompt || undefined;
      if (options.permissionMode !== undefined) cfg.permissionMode = options.permissionMode || undefined;
      if (options.effort !== undefined) cfg.effort = options.effort || undefined;
      if (options.settings !== undefined) cfg.settingsFile = options.settings || undefined;
      if (options.mcpConfig !== undefined) cfg.mcpConfig = options.mcpConfig.length > 0 ? options.mcpConfig : undefined;
      if (options.extraArgs !== undefined) cfg.extraArgs = options.extraArgs.length > 0 ? options.extraArgs : undefined;

      if (options.unset) {
        const unsetMap: Record<string, keyof SessionConfig> = {
          model: 'model',
          provider: 'provider',
          workingDir: 'workingDir',
          description: 'description',
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
            delete cfg[key];
          } else {
            console.log(`Unknown config field "${field}". Valid fields: ${Object.keys(unsetMap).join(', ')}`);
          }
        }
      }

      const errors = validateSessionConfig(cfg);
      if (errors.length > 0) {
        for (const err of errors) console.error(`Config error: ${err}`);
        process.exit(1);
      }

      addSession({ status: session.status, tmuxWindow: session.tmuxWindow, config: cfg });

      console.log(`Configuration for "${name}" updated:`);
      printConfigSummary(cfg);
      console.log();
      console.log('Restart the session for changes to take effect:');
      console.log(`  multi-claude restart ${name}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── restart ──────────────────────────────────────────────────────────────────

program
  .command('restart [name]')
  .description('Restart a session (keeps the same configuration)')
  .option('--all', 'Restart all saved sessions')
  .action((name: string | undefined, options: Record<string, any>) => {
    try {
      if (options.all) {
        const store = loadSessions();
        let count = 0;
        for (const [n, state] of Object.entries(store.sessions)) {
          if (isSessionAlive(n)) stopSession(n);
          try {
            const { tmuxWindow } = startSession(state.config);
            state.status = 'running';
            state.tmuxWindow = tmuxWindow;
            state.config.lastStartedAt = new Date().toISOString();
            count++;
          } catch (err: unknown) {
            console.error(`Failed to restart "${n}": ${err instanceof Error ? err.message : String(err)}`);
          }
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

      if (isSessionAlive(name)) stopSession(name);

      const { tmuxWindow } = startSession(session.config);
      addSession({
        status: 'running',
        tmuxWindow,
        config: { ...session.config, lastStartedAt: new Date().toISOString() },
      });

      console.log(`Session "${name}" restarted.`);
      console.log(`  Tmux window : ${tmuxWindow}`);
      console.log(`  Model       : ${session.config.model || '(default)'}`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── rename ───────────────────────────────────────────────────────────────────

program
  .command('rename <oldName> <newName>')
  .description('Rename a session (and its tmux window if running)')
  .action((oldName: string, newName: string) => {
    try {
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
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── duplicate ────────────────────────────────────────────────────────────────

program
  .command('duplicate <source> <target>')
  .description('Clone a session configuration under a new name')
  .action((source: string, target: string) => {
    try {
      const nameErr = validateSessionName(target);
      if (nameErr) { console.error(`Invalid session name "${target}": ${nameErr}`); process.exit(1); }

      const sourceSession = getSession(source);
      if (!sourceSession) {
        console.log(`No session named "${source}" found.`);
        return;
      }
      if (getSession(target)) {
        console.log(`Session "${target}" already exists.`);
        return;
      }

      const newConfig: SessionConfig = {
        ...sourceSession.config,
        name: target,
        createdAt: new Date().toISOString(),
        lastStartedAt: undefined,
      };

      addSession({ status: 'stopped', tmuxWindow: `${TMUX_SESSION_PREFIX}:${target}`, config: newConfig });

      console.log(`Session "${source}" duplicated as "${target}".`);
      console.log(`Use "multi-claude start ${target}" to start it.`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── kill-all ─────────────────────────────────────────────────────────────────

program
  .command('kill-all')
  .description('Stop all running sessions and kill the multi-claude tmux session')
  .action(() => {
    try {
      const runningWindows = listRunningWindows();
      let count = 0;

      for (const name of runningWindows) {
        if (stopSession(name)) count++;
      }

      spawnSync('tmux', ['kill-session', '-t', 'multi-claude'], { stdio: 'ignore', timeout: 5000 });

      const store = loadSessions();
      const statusUpdates: Array<{ name: string; status: 'running' | 'stopped' }> = [];
      for (const key of Object.keys(store.sessions)) {
        statusUpdates.push({ name: key, status: 'stopped' });
      }
      updateSessionsStatus(statusUpdates);

      console.log(`Stopped ${count} session(s). All sessions killed.`);
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── models ───────────────────────────────────────────────────────────────────

program
  .command('models')
  .description('List available models by provider')
  .option('--provider <id>', 'Show models for a specific provider')
  .option('--json', 'Output as JSON')
  .action((options: Record<string, any>) => {
    try {
      if (options.provider) {
        const provider = getProvider(options.provider);
        if (!provider) {
          console.error(`Unknown provider "${options.provider}".`);
          console.error(`Available: ${PROVIDER_PRESETS.map(p => p.id).join(', ')}`);
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify({ provider: provider.id, name: provider.name, models: provider.models }, null, 2));
          return;
        }

        console.log(`${provider.name} models (use with --model and --provider ${provider.id}):\n`);
        for (const m of provider.models) {
          const tag = m.reasoning ? ' [reasoning]' : '';
          console.log(`  ${m.id.padEnd(45)} ${m.name}${tag}`);
        }
        if (provider.envVar) {
          console.log(`\nRequires: ${provider.envVar} to be set`);
        }
        console.log(`\nStart: multi-claude start <name> --provider ${provider.id} --model ${provider.defaultModel}`);
        return;
      }

      if (options.json) {
        const output = PROVIDER_PRESETS.map(p => ({
          id: p.id,
          name: p.name,
          envVar: p.envVar || null,
          baseUrl: p.baseUrl,
          defaultModel: p.defaultModel,
          models: p.models,
        }));
        console.log(JSON.stringify(output, null, 2));
        return;
      }

      console.log('Available LLM provider presets:\n');
      for (const p of PROVIDER_PRESETS) {
        const count = p.models.length;
        const builtin = p.builtin ? ' (built-in)' : '';
        const available = p.builtin || (p.envVar && process.env[p.envVar]) || !p.envVar
          ? `${GREEN}✓${RESET}`
          : `${RED}✗${RESET}`;
        console.log(`  ${available} ${p.id.padEnd(14)} ${p.name.padEnd(20)} ${count} models${builtin}`);
      }
      console.log();
      console.log(`  ${GREEN}✓${RESET} = API key detected   ${RED}✗${RESET} = API key not set`);
      console.log();
      console.log('Use --provider <id> to see models for a specific provider:');
      console.log('  multi-claude models --provider openai');
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── logs ─────────────────────────────────────────────────────────────────────

program
  .command('logs <name>')
  .description('Show recent output from a session (tmux pane scrollback)')
  .option('-n, --lines <number>', 'Number of lines to show (default: 200)', parseInt)
  .option('-a, --all', 'Capture the entire scrollback buffer')
  .action((name: string, options: Record<string, any>) => {
    try {
      if (!isSessionAlive(name)) {
        console.error(`Session "${name}" is not running.`);
        process.exit(1);
      }
      const lines = options.all ? undefined : (options.lines || 200);
      const output = capturePane(name, lines);
      if (!output) {
        console.log(`(no output captured from session "${name}")`);
      } else {
        process.stdout.write(output);
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ─── completion ──────────────────────────────────────────────────────────────

program
  .command('completion [shell]')
  .description('Generate shell completion script')
  .action((shell?: string) => {
    try {
      const target = shell || (process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash');
      if (target === 'zsh') {
        console.log(generateZshCompletion());
      } else {
        console.log(generateBashCompletion());
      }
    } catch (err: unknown) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
