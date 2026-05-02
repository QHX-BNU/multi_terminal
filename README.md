# multi-claude

Multi-terminal Claude Code session manager — run multiple Claude Code instances simultaneously with different LLM backends, each in its own tmux window.

## Prerequisites

- [tmux](https://github.com/tmux/tmux) (3.0+)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI (`claude`)

## Install

```bash
npm install
npm run build
npm link          # optional: install globally as `multi-claude`
```

## Usage

### Start a session

```bash
multi-claude start myproject --model sonnet --dir ~/code/myproject
multi-claude start api --model opus --system-prompt "You are a Go backend expert"
multi-claude start custom --settings ~/.claude/settings.openai.json --mcp-config ~/.claude/mcp.json
```

### List sessions

```bash
multi-claude list
```

Shows all managed sessions with their status (running/stopped), model, and working directory.

### Attach to a session

```bash
multi-claude attach myproject     # attach to a specific session
multi-claude attach               # attach to the tmux session (last active window)
# or directly:
tmux attach -t multi-claude
```

### View / update session config

```bash
multi-claude config-show myproject
multi-claude config-set myproject --model haiku --effort high
```

### Stop / restart

```bash
multi-claude stop myproject           # stop and preserve config for later restart
multi-claude stop myproject --remove  # stop and delete the session permanently
multi-claude restart myproject        # restart with saved config
multi-claude kill-all                 # stop all sessions
```

### Reference

```bash
multi-claude models   # list model aliases
multi-claude --help   # full help
```

## How it works

Each session is a tmux window inside a shared `multi-claude` tmux session. Session config (model, working directory, MCP servers, etc.) is persisted to `~/.multi-claude/sessions.json`. Stopping a session kills its tmux window but preserves the config — use `start` to resume or `--remove` to delete permanently.

## Session options

| Option | Description |
|---|---|
| `-m, --model <model>` | LLM model alias (sonnet, opus, haiku) or full ID |
| `-d, --dir <path>` | Working directory |
| `-s, --system-prompt <prompt>` | Custom system prompt |
| `-p, --permission-mode <mode>` | Permission mode |
| `-e, --effort <level>` | Effort level (low, medium, high, xhigh, max) |
| `--settings <file>` | Custom settings JSON for API providers |
| `--mcp-config <configs...>` | MCP server config files |
| `--extra-args <args...>` | Extra arguments passed to `claude` |
