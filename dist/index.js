#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const config_1 = require("./config");
const terminal_1 = require("./terminal");
const program = new commander_1.Command();
program
    .name('multi-claude')
    .description('Multi-terminal Claude Code session manager — run multiple Claude Code instances simultaneously with different LLM backends')
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
    .action((name, options) => {
    const existing = (0, config_1.getSession)(name);
    if (existing && (0, terminal_1.isSessionAlive)(name)) {
        console.log(`Session "${name}" is already running. Use "multi-claude attach ${name}" to connect.`);
        return;
    }
    const prev = existing?.config;
    const config = {
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
    const { pid, tmuxWindow } = (0, terminal_1.startSession)(config);
    (0, config_1.addSession)({ name, status: 'running', tmuxWindow, pid, config });
    console.log(`Session "${name}" started successfully.`);
    console.log(`  Tmux window : ${tmuxWindow}`);
    console.log(`  PID         : ${pid}`);
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
    .action((name, options) => {
    const session = (0, config_1.getSession)(name);
    if (!session) {
        console.log(`No session named "${name}" found.`);
        return;
    }
    if (!(0, terminal_1.isSessionAlive)(name) && session.status === 'stopped') {
        console.log(`Session "${name}" is already stopped.`);
        return;
    }
    (0, terminal_1.stopSession)(name);
    if (options.remove) {
        (0, config_1.removeSession)(name);
        console.log(`Session "${name}" stopped and removed.`);
    }
    else {
        (0, config_1.updateSessionStatus)(name, 'stopped');
        console.log(`Session "${name}" stopped. Use "multi-claude start ${name}" to restart.`);
    }
});
// ─── list ────────────────────────────────────────────────────────────────────
program
    .command('list')
    .description('List all managed Claude Code sessions')
    .action(() => {
    const sessions = (0, config_1.getAllSessions)();
    const runningWindows = (0, terminal_1.listRunningWindows)();
    // Sync status of all sessions in a single read-modify-write cycle
    const store = (0, config_1.loadSessions)();
    let changed = false;
    for (const s of sessions) {
        const alive = runningWindows.includes(s.name);
        if (alive && s.status !== 'running') {
            const entry = store.sessions[s.name];
            if (entry) {
                entry.status = 'running';
                s.status = 'running';
                changed = true;
            }
        }
        else if (!alive && s.status !== 'stopped') {
            const entry = store.sessions[s.name];
            if (entry) {
                entry.status = 'stopped';
                s.status = 'stopped';
                changed = true;
            }
        }
    }
    if (changed)
        (0, config_1.saveSessions)(store);
    if (sessions.length === 0) {
        console.log('No managed sessions found. Use "multi-claude start <name>" to create one.');
        return;
    }
    console.log('Managed Claude Code sessions:\n');
    const nameWidth = Math.max(20, ...sessions.map(s => s.name.length));
    console.log(`${'NAME'.padEnd(nameWidth)}  ${'STATUS'.padEnd(10)}  ${'MODEL'.padEnd(20)}  ${'WORK DIR'}`);
    console.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(10)}  ${'-'.repeat(20)}  ${'-'.repeat(40)}`);
    for (const s of sessions) {
        const alive = runningWindows.includes(s.name);
        const status = alive ? '▶ running' : '■ stopped';
        const model = s.config.model || '(default)';
        const workDir = s.config.workingDir || '(unknown)';
        console.log(`${s.name.padEnd(nameWidth)}  ${status.padEnd(10)}  ${model.padEnd(20)}  ${workDir}`);
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
    .action((name) => {
    if (name) {
        const session = (0, config_1.getSession)(name);
        if (!session && !(0, terminal_1.isSessionAlive)(name)) {
            console.log(`No session named "${name}" found.`);
            console.log('Available sessions:');
            const sessions = (0, config_1.getAllSessions)();
            if (sessions.length === 0) {
                console.log('  (none)');
            }
            else {
                sessions.forEach(s => console.log(`  ${s.name}`));
            }
            return;
        }
        (0, terminal_1.attachSession)(session?.tmuxWindow || `multi-claude:${name}`);
    }
    else {
        (0, terminal_1.attachSession)();
    }
});
// ─── config-show ─────────────────────────────────────────────────────────────
program
    .command('config-show <name>')
    .description('Show session configuration')
    .action((name) => {
    const session = (0, config_1.getSession)(name);
    if (!session) {
        console.log(`No session named "${name}" found.`);
        return;
    }
    const cfg = session.config;
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
});
// ─── config-set ──────────────────────────────────────────────────────────────
program
    .command('config-set <name>')
    .description('Update session configuration (requires restart to take effect)')
    .option('-m, --model <model>', 'Change LLM model')
    .option('-d, --dir <path>', 'Change working directory')
    .option('-s, --system-prompt <prompt>', 'Change system prompt')
    .option('-p, --permission-mode <mode>', 'Change permission mode')
    .option('-e, --effort <level>', 'Change effort level')
    .option('--settings <file>', 'Change settings JSON file for custom API providers')
    .option('--mcp-config <configs...>', 'Change MCP server config files')
    .option('--extra-args <args...>', 'Change extra arguments passed to claude')
    .action((name, options) => {
    const session = (0, config_1.getSession)(name);
    if (!session) {
        console.log(`No session named "${name}" found.`);
        return;
    }
    const cfg = session.config;
    if (options.model)
        cfg.model = options.model;
    if (options.dir)
        cfg.workingDir = path.resolve(options.dir);
    if (options.systemPrompt)
        cfg.systemPrompt = options.systemPrompt;
    if (options.permissionMode)
        cfg.permissionMode = options.permissionMode;
    if (options.effort)
        cfg.effort = options.effort;
    if (options.settings)
        cfg.settingsFile = options.settings;
    if (options.mcpConfig)
        cfg.mcpConfig = options.mcpConfig;
    if (options.extraArgs)
        cfg.extraArgs = options.extraArgs;
    (0, config_1.addSession)({ ...session, config: cfg });
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
    .action((name) => {
    const session = (0, config_1.getSession)(name);
    if (!session) {
        console.log(`No session named "${name}" found.`);
        return;
    }
    console.log(`Restarting session "${name}"...`);
    if ((0, terminal_1.isSessionAlive)(name)) {
        (0, terminal_1.stopSession)(name);
    }
    const { pid, tmuxWindow } = (0, terminal_1.startSession)(session.config);
    (0, config_1.addSession)({
        name,
        status: 'running',
        tmuxWindow,
        pid,
        config: { ...session.config, lastStartedAt: new Date().toISOString() },
    });
    console.log(`Session "${name}" restarted.`);
    console.log(`  Tmux window : ${tmuxWindow}`);
    console.log(`  Model       : ${session.config.model || '(default)'}`);
});
// ─── kill-all ────────────────────────────────────────────────────────────────
program
    .command('kill-all')
    .description('Stop all running sessions and kill the multi-claude tmux session')
    .action(() => {
    const store = (0, config_1.loadSessions)();
    const runningWindows = (0, terminal_1.listRunningWindows)();
    let count = 0;
    for (const name of runningWindows) {
        (0, terminal_1.stopSession)(name);
        count++;
    }
    try {
        (0, child_process_1.execSync)(`tmux kill-session -t "multi-claude" 2>/dev/null`, { stdio: 'ignore' });
    }
    catch {
        // Already gone
    }
    for (const key of Object.keys(store.sessions)) {
        store.sessions[key].status = 'stopped';
    }
    (0, config_1.saveSessions)(store);
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
