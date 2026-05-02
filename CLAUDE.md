# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm run build          # TypeScript → dist/ (tsc)
npm start              # Run the built CLI
npm run dev            # Build + run
node dist/index.js --help
```

## Architecture

`multi-claude` is a CLI that manages multiple Claude Code instances running in separate tmux windows, each potentially using different LLM backends (models, API providers, MCP servers).

- **`src/index.ts`** — CLI entry point using Commander.js. Defines all subcommands: `start`, `stop`, `list`, `attach`, `config-show`, `config-set`, `restart`, `kill-all`, `models`. Each command handler orchestrates between config persistence and terminal operations.
- **`src/terminal.ts`** — All tmux interaction. Groups sessions under a single tmux session named `multi-claude`, with each managed Claude instance in its own tmux window. `startSession` uses `spawnSync` + `tmux send-keys -l` to safely pass user-supplied arguments without shell interpolation. Key functions: `startSession`, `stopSession`, `attachSession`, `isSessionAlive`, `listRunningWindows`, `buildClaudeArgs`. Helper: `shellQuote` (single-quote escaping), `tmux` (spawnSync wrapper).
- **`src/config.ts`** — Persistence layer. Sessions are stored as JSON at `~/.multi-claude/sessions.json`. Provides CRUD operations: `loadSessions`, `saveSessions`, `addSession`, `removeSession`, `getSession`, `getAllSessions`, `updateSessionStatus`.
- **`src/types.ts`** — Shared interfaces: `SessionConfig` (all CLI flags for a session), `SessionState` (runtime status + config), `SessionsStore` (the root JSON schema).

## Key design decisions

- Each session maps to a single tmux window within the `multi-claude` tmux session. The tmux session is auto-created on first `start`.
- Sessions survive terminal closures — state is read from `~/.multi-claude/sessions.json` and cross-referenced with live tmux windows via `list`.
- `stop` kills the tmux window and marks the session as `'stopped'` (preserves config for restart). Use `--remove` to permanently delete the stored config. `kill-all` preserves all sessions as `'stopped'`.
- `start` merges CLI options with existing saved config using `??` fallback — calling `start <name>` without flags reuses previously saved settings.
- `startSession` builds the command, single-quote-escapes every argument via `shellQuote`, then uses `spawnSync` + `tmux send-keys -l` to type it into the pane. No shell interpolation happens in the orchestrator process.
- `config-set` mutates the stored config but does not restart the session — the user must run `restart` manually.
- Session store files are created with restrictive permissions: directory `0o700`, file `0o600`. Corrupted JSON is renamed to `.bak` instead of silently discarded.
