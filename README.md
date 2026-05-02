# multi-claude — Handbook

Multi-terminal Claude Code session manager. Run multiple Claude Code instances simultaneously, each in its own tmux window, with independent models, working directories, MCP servers, and permission modes.

## Architecture

Every managed session is a tmux window inside a single shared tmux session named `multi-claude`. The tmux session is auto-created on the first `start` call.

```
tmux session "multi-claude"
├── window "frontend"   →  claude --model sonnet --name frontend
├── window "api"        →  claude --model opus --name api
└── window "devops"     →  claude --model haiku --name devops
```

Session configuration is persisted as JSON at `~/.multi-claude/sessions.json`. The JSON file stores model, working directory, MCP config, permission mode, and all other options — so you can `stop` a session and `start` it later without re-specifying flags.

Stopping a session kills its tmux window but preserves the config. Use `--remove` when stopping to permanently delete the stored config. `kill-all` stops everything but preserves all configs (all sessions become `stopped`).

## Prerequisites

- **tmux** 3.0+ — `sudo apt install tmux` / `brew install tmux`
- **Claude Code** CLI — `npm install -g @anthropic-ai/claude-code`

## Installation

```bash
git clone <repo-url> && cd multi_terminal
npm install
npm run build
npm link          # makes `multi-claude` available globally
```

Verify: `multi-claude --help`

## Quick Start

```bash
# Start your first session
multi-claude start myproject --model sonnet --dir ~/code/myproject

# Start a second session with different settings
multi-claude start api --model opus --dir ~/code/api --effort high

# See what's running
multi-claude list

# Connect to a session
multi-claude attach myproject
```

## Command Reference

### `start` — Launch a new session

```bash
multi-claude start <name> [options]
```

Creates a tmux window named `<name>` inside the `multi-claude` tmux session and launches `claude` with the given options. If a session with the same name already exists in the config store, its saved flags are reused for any options you omit — so `multi-claude start myproject` (no flags) restarts with the last-used settings.

**Idempotent:** if a tmux window with that name already exists, it is killed and recreated.

| Flag | Description |
|---|---|
| `-m, --model <model>` | Model alias (sonnet, opus, haiku) or full ID |
| `-d, --dir <path>` | Working directory (defaults to `cwd`) |
| `-s, --system-prompt <prompt>` | Custom system prompt |
| `-p, --permission-mode <mode>` | Permission mode (e.g. `default`, `acceptEdits`, `plan`) |
| `-e, --effort <level>` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `--settings <file>` | Path to a settings JSON file (custom API providers/endpoints) |
| `--mcp-config <configs...>` | One or more MCP server config files |
| `--extra-args <args...>` | Arbitrary extra flags forwarded to `claude` |
| `-f, --force` | Force-restart if the session is already running |

**Examples:**

```bash
# Basic session
multi-claude start frontend --model sonnet --dir ~/code/frontend

# With custom system prompt and high effort
multi-claude start api --model opus --system-prompt "You are a Go backend expert" --effort high

# Using an alternative API provider via settings file
multi-claude start custom --settings ~/.claude/settings.openai.json --mcp-config ~/.mcp/servers.json

# Passing extra flags directly to claude
multi-claude start debug --extra-args --verbose --extra-args --debug
```

### `stop` — Stop a session

```bash
multi-claude stop <name> [--remove]
```

Kills the tmux window. By default, the session config is preserved so you can restart later with `start <name>`.

| Flag | Description |
|---|---|
| `--remove` | Permanently delete the session from the config store |

### `list` — Show all sessions

```bash
multi-claude list
```

Displays a table of all managed sessions with name, status (▶ running / ■ stopped), model, and working directory. Cross-references the stored JSON state against live tmux windows, so the status is always accurate even if you manually killed a tmux window outside the tool.

### `attach` — Connect to a session

```bash
multi-claude attach [name]
```

Attaches your terminal to the `multi-claude` tmux session. Without a name, you land on the last active window. With a name, you jump directly to that session's window.

Inside tmux, use:
- `Ctrl-b n` / `Ctrl-b p` — next/previous window
- `Ctrl-b <number>` — jump to window by index
- `Ctrl-b d` — detach (leave the session running)

### `config-show` — Inspect session settings

```bash
multi-claude config-show <name>
```

Prints every stored option for the session: model, working directory, permission mode, effort level, settings file, MCP configs, system prompt, extra args, and timestamps.

### `config-set` — Update session settings

```bash
multi-claude config-set <name> [options]
```

Mutates the stored config. **Does not affect a running session** — you must `restart` for changes to take effect.

Accepts the same flags as `start`: `--model`, `--dir`, `--system-prompt`, `--permission-mode`, `--effort`, `--settings`, `--mcp-config`, `--extra-args`.

```bash
multi-claude config-set myproject --model haiku --effort low
multi-claude restart myproject
```

### `restart` — Stop and restart with current config

```bash
multi-claude restart <name>
```

Shorthand for `stop` + `start` using the saved configuration. Reads the latest config from the store, kills the running tmux window (if any), and creates a fresh one.

### `rename` — Rename a session

```bash
multi-claude rename <oldName> <newName>
```

Renames the session in the config store and renames the tmux window if it's currently running.

### `kill-all` — Stop everything

```bash
multi-claude kill-all
```

Stops every running tmux window and kills the entire `multi-claude` tmux session. All session configs are preserved (status is set to `stopped`). Use `start <name>` to resume any session later.

### `models` — List model aliases

```bash
multi-claude models
```

Prints common model aliases for reference. Use these with the `--model` flag.

## Configuration File

Sessions are stored in `~/.multi-claude/sessions.json`:

```json
{
  "version": 1,
  "sessions": {
    "myproject": {
      "name": "myproject",
      "status": "running",
      "tmuxWindow": "multi-claude:myproject",
      "pid": 12345,
      "config": {
        "name": "myproject",
        "model": "sonnet",
        "workingDir": "/home/user/code/myproject",
        "permissionMode": "acceptEdits",
        "effort": "high",
        "settingsFile": "/home/user/.claude/settings.json",
        "mcpConfig": ["/home/user/.claude/mcp.json"],
        "extraArgs": [],
        "createdAt": "2025-01-01T00:00:00.000Z",
        "lastStartedAt": "2025-01-02T12:00:00.000Z"
      }
    }
  }
}
```

The file and its parent directory are created with restrictive permissions (`0o700` directory, `0o600` file). Corrupted JSON is renamed to `.bak` instead of being silently discarded.

## Common Workflows

### Parallel development in multiple repos

```bash
multi-claude start frontend --model sonnet --dir ~/code/frontend
multi-claude start backend  --model sonnet --dir ~/code/backend
multi-claude start infra    --model opus   --dir ~/code/infra --effort high
```

### Switching models mid-task

```bash
# Start with a fast model for exploration
multi-claude start explore --model haiku --dir ~/code/myproject

# Later, switch to a deeper model
multi-claude config-set explore --model opus --effort max
multi-claude restart explore
```

### Using different API providers

```bash
# Create a settings file for an alternative provider
cat > ~/.claude/settings.openai.json << 'EOF'
{
  "apiKeyHelper": "cat ~/.openai-key"
}
EOF

multi-claude start openai-session --settings ~/.claude/settings.openai.json --model gpt-4o
```

### Attaching to a tmux window outside the tool

```bash
# List all windows in the multi-claude session
tmux list-windows -t multi-claude

# Attach directly
tmux attach -t multi-claude

# Jump to a specific window
tmux select-window -t multi-claude:myproject && tmux attach -t multi-claude
```

## Troubleshooting

### "Failed to attach to tmux session"

You're not inside a tmux session. `multi-claude attach` opens tmux from your current terminal — this works from a plain terminal, but not from inside an existing tmux session (nested tmux). Exit your current tmux session first, or use `tmux attach -t multi-claude` directly.

### Session shows as running but claude isn't responding

The stored PID is the tmux pane's shell PID, not the Claude process PID. Attach to the session to see what's happening: `multi-claude attach <name>`.

### Config changes not taking effect

`config-set` only writes to the JSON file. Running sessions are unaffected. Run `multi-claude restart <name>` to apply changes.

### Corrupted sessions.json

On startup, if `sessions.json` is unparseable, it's renamed to `sessions.json.bak` and the tool starts with an empty session list. Check the `.bak` file to recover your config.
