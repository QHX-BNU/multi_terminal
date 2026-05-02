# multi-claude — Handbook

Multi-terminal Claude Code session manager. Run multiple Claude Code instances simultaneously, each in its own tmux window, with independent LLM providers, models, working directories, MCP servers, and permission modes.

## Architecture

Every managed session is a tmux window inside a single shared tmux session named `multi-claude`. The tmux session is auto-created on the first `start` call.

```
tmux session "multi-claude"
├── window "claude-openai"   →  claude --model gpt-4.1 --settings ~/.multi-claude/settings/openai.json
├── window "claude-gemini"   →  claude --model gemini-2.5-flash --settings ~/.multi-claude/settings/gemini.json
├── window "claude-groq"     →  claude --model llama-4-maverick --settings ~/.multi-claude/settings/groq.json
└── window "myproject"       →  claude --model sonnet --name myproject
```

Session configuration is persisted as JSON at `~/.multi-claude/sessions.json`. The JSON file stores provider, model, working directory, MCP config, permission mode, and all other options — so you can `stop` a session and `start` it later without re-specifying flags.

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
# Start your first session (Anthropic — built-in, no settings needed)
multi-claude start myproject --model sonnet --dir ~/code/myproject

# Start a session with a different LLM provider
export OPENAI_API_KEY=sk-...
multi-claude start openai --provider openai --model gpt-4.1 --dir ~/code/myproject

# Or use init to auto-detect providers and start sessions for all of them
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
export GROQ_API_KEY=...
multi-claude init

# See what's running (now with provider column)
multi-claude list

# Browse available providers and models
multi-claude models
multi-claude models --provider openai

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
| `-m, --model <model>` | Model alias (sonnet, gpt-4.1, gemini-2.5-flash, etc.) |
| `--provider <id>` | Provider preset: `anthropic`, `openai`, `gemini`, `groq`, `deepseek`, `openrouter`, `ollama`, `together` |
| `-d, --dir <path>` | Working directory (defaults to `cwd`) |
| `-s, --system-prompt <prompt>` | Custom system prompt |
| `-p, --permission-mode <mode>` | Permission mode: `default`, `acceptEdits`, `plan`, `bypassPermissions` |
| `-e, --effort <level>` | Reasoning effort: `low`, `medium`, `high`, `xhigh`, `max` |
| `--settings <file>` | Path to a settings JSON file (custom API providers/endpoints) |
| `--mcp-config <configs...>` | One or more MCP server config files |
| `--extra-args <args...>` | Arbitrary extra flags forwarded to `claude` |
| `-f, --force` | Force-restart if the session is already running |

When `--provider` is used, the tool automatically:
- Generates a settings file at `~/.multi-claude/settings/<provider>.json` (if not already present)
- Sets the correct base URL for the provider's API endpoint
- Selects the provider's default model if `--model` is not specified

An explicit `--settings` flag overrides the auto-generated one.

**Examples:**

```bash
# Anthropic (built-in, no settings file needed)
multi-claude start frontend --model sonnet --dir ~/code/frontend

# OpenAI
multi-claude start gpt --provider openai --model gpt-4.1 --dir ~/code/backend

# Google Gemini with high effort
multi-claude start gemini --provider gemini --model gemini-2.5-pro --effort high

# Groq (fast inference)
multi-claude start groq --provider groq --model llama-4-maverick-17b-128e-instruct

# Local Ollama
multi-claude start local --provider ollama --model qwen2.5-coder

# Custom settings file (bypasses provider auto-config)
multi-claude start custom --settings ~/.claude/my-settings.json --model gpt-4o
```

### `init` — One-shot multi-provider setup

```bash
multi-claude init [options]
```

Detects available LLM providers from environment variables and creates sessions for them. For each detected provider, it generates the appropriate Claude Code settings file and optionally starts the session.

| Flag | Description |
|---|---|
| `--providers <ids...>` | Specific providers to set up (e.g. `openai gemini groq`) |
| `--list` | List all available provider presets and their env var names |
| `--no-start` | Create session configs without launching them |
| `--force` | Overwrite existing settings files and session configs |
| `--json` | Output results as JSON for scripting |

Without `--providers`, `init` scans the environment and sets up every provider whose API key is detected. Ollama is always detected since it runs locally without an API key.

**Examples:**

```bash
# See what's available
multi-claude init --list

# Auto-detect and start all configured providers
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
multi-claude init

# Set up specific providers only
multi-claude init --providers openai groq

# Create configs without starting (start manually later)
multi-claude init --providers openai gemini --no-start
multi-claude start claude-openai
multi-claude start claude-gemini
```

### `stop` — Stop a session

```bash
multi-claude stop <name> [--remove]
multi-claude stop --all
```

Kills the tmux window. By default, the session config is preserved so you can restart later with `start <name>`.

| Flag | Description |
|---|---|
| `--remove` | Permanently delete the session from the config store |
| `--all` | Stop all running sessions |

### `list` — Show all sessions

```bash
multi-claude list [--json] [--filter <running|stopped>]
```

Displays a table of all managed sessions with name, status (▶ running / ■ stopped), provider, model, description, and working directory. Cross-references the stored JSON state against live tmux windows, so the status is always accurate even if you manually killed a tmux window outside the tool.

With `--json`, outputs machine-readable JSON. With `--filter`, shows only running or stopped sessions.

### `attach` — Connect to a session

```bash
multi-claude attach [name]
```

Attaches your terminal to the `multi-claude` tmux session. Without a name, you land on the last active window. With a name, you jump directly to that session's window.

Inside tmux, use:
- `Ctrl-b n` / `Ctrl-b p` — next/previous window
- `Ctrl-b <number>` — jump to window by index
- `Ctrl-b d` — detach (leave the session running)

### `config` — Inspect or update session settings

```bash
multi-claude config <name>             # Show stored configuration
multi-claude config <name> [options]   # Update stored configuration
```

Without options, prints every stored setting for the session: provider, model, working directory, permission mode, effort level, settings file, MCP configs, system prompt, extra args, and timestamps.

With options, mutates the stored config. **Does not affect a running session** — you must `restart` for changes to take effect.

| Flag | Description |
|---|---|
| `-m, --model <model>` | Change LLM model |
| `--provider <id>` | Change LLM provider (auto-resolves settings file) |
| `-d, --dir <path>` | Change working directory |
| `--desc <description>` | Change session description |
| `-s, --system-prompt <prompt>` | Change system prompt |
| `-p, --permission-mode <mode>` | Change permission mode |
| `-e, --effort <level>` | Change effort level |
| `--settings <file>` | Change settings JSON file |
| `--mcp-config <configs...>` | Change MCP server config files |
| `--extra-args <args...>` | Change extra claude arguments |
| `--unset <fields...>` | Clear specific fields (model, provider, workingDir, description, systemPrompt, permissionMode, effort, settingsFile, mcpConfig, extraArgs) |
| `--json` | Output configuration as JSON |

```bash
multi-claude config myproject --provider openai --model gpt-4.1
multi-claude config myproject --unset systemPrompt extraArgs
multi-claude restart myproject
```

### `restart` — Stop and restart with current config

```bash
multi-claude restart <name>
multi-claude restart --all
```

Shorthand for `stop` + `start` using the saved configuration. Use `--all` to restart every saved session.

### `rename` — Rename a session

```bash
multi-claude rename <oldName> <newName>
```

Renames the session in the config store and renames the tmux window if it's currently running.

### `duplicate` — Clone a session

```bash
multi-claude duplicate <source> <target>
```

Copies a session's configuration under a new name (stopped state).

### `models` — List available providers and models

```bash
multi-claude models [--provider <id>] [--json]
```

Without flags, shows all 8 provider presets with API key detection status (✓ detected / ✗ not set). With `--provider <id>`, drills into a specific provider's full model list, including reasoning model tags.

```bash
# Overview of all providers
multi-claude models

# OpenAI model catalog
multi-claude models --provider openai

# Machine-readable output
multi-claude models --json
```

### `logs` — Show session output

```bash
multi-claude logs <name> [-n <lines>] [-a]
```

Prints the tmux pane scrollback buffer for a running session.

| Flag | Description |
|---|---|
| `-n, --lines <number>` | Show only the last N lines (default: 200) |
| `-a, --all` | Capture the entire scrollback buffer |

### `kill-all` — Stop everything

```bash
multi-claude kill-all
```

Stops every running tmux window and kills the entire `multi-claude` tmux session. All session configs are preserved (status is set to `stopped`).

### `completion` — Generate shell completion

```bash
multi-claude completion [bash|zsh]
```

Generates a shell completion script. Detects your shell from `$SHELL` if not specified.

```bash
# Bash (add to ~/.bashrc)
source <(multi-claude completion bash)

# Zsh (add to ~/.zshrc)
source <(multi-claude completion zsh)
```

Tab-completes subcommands, session names, and provider IDs. After setup, `multi-claude start --provider <TAB>` will suggest available providers.

## Provider Configuration

### Supported providers

| Provider | ID | Env Variable | Base URL |
|---|---|---|---|
| Anthropic (built-in) | `anthropic` | `ANTHROPIC_API_KEY` | `https://api.anthropic.com/v1` |
| OpenAI | `openai` | `OPENAI_API_KEY` | `https://api.openai.com/v1` |
| Google Gemini | `gemini` | `GEMINI_API_KEY` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| Groq | `groq` | `GROQ_API_KEY` | `https://api.groq.com/openai/v1` |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | `https://api.deepseek.com/v1` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | `https://openrouter.ai/api/v1` |
| Ollama (local) | `ollama` | *(none)* | `http://localhost:11434/v1` |
| Together AI | `together` | `TOGETHER_API_KEY` | `https://api.together.xyz/v1` |

### How it works

Claude Code's `--settings` flag accepts a JSON file that overrides environment variables for the underlying API client. For third-party providers, `multi-claude` generates these files automatically at `~/.multi-claude/settings/<provider-id>.json`.

For example, the OpenAI settings file looks like:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.openai.com/v1"
  },
  "apiKeyHelper": "echo $OPENAI_API_KEY"
}
```

This tells Claude Code to route requests through OpenAI's API endpoint using your `OPENAI_API_KEY` environment variable. Claude Code uses the Anthropic-compatible API format, so any provider that exposes an OpenAI/Anthropic-compatible endpoint works.

### Manual provider configuration

You can also create settings files manually and reference them directly:

```bash
cat > ~/.claude/settings.custom.json << 'EOF'
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-custom-endpoint.com/v1"
  },
  "apiKeyHelper": "echo $CUSTOM_API_KEY"
}
EOF

multi-claude start custom --settings ~/.claude/settings.custom.json --model your-model-id
```

## Configuration File

Sessions are stored in `~/.multi-claude/sessions.json`:

```json
{
  "version": 1,
  "sessions": {
    "claude-openai": {
      "status": "running",
      "tmuxWindow": "multi-claude:claude-openai",
      "config": {
        "name": "claude-openai",
        "model": "gpt-4.1",
        "provider": "openai",
        "workingDir": "/home/user/code/myproject",
        "description": "Claude Code with OpenAI",
        "permissionMode": "default",
        "settingsFile": "/home/user/.multi-claude/settings/openai.json",
        "mcpConfig": [],
        "extraArgs": [],
        "createdAt": "2026-05-02T00:00:00.000Z",
        "lastStartedAt": "2026-05-02T12:00:00.000Z"
      }
    }
  }
}
```

The file and its parent directory are created with restrictive permissions (`0o700` directory, `0o600` file). Corrupted JSON is renamed to `.bak` instead of being silently discarded.

Provider settings files are stored separately at `~/.multi-claude/settings/<provider-id>.json`.

## Common Workflows

### Multi-provider parallel development

```bash
# Set up API keys
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
export ANTHROPIC_API_KEY=sk-ant-...

# One-shot init for all three
multi-claude init --providers anthropic openai gemini

# Now you have three Claude Code instances running in parallel:
#   claude-anthropic  → Claude Sonnet
#   claude-openai     → GPT-4.1
#   claude-gemini     → Gemini 2.5 Flash
```

### Comparing models on the same task

```bash
multi-claude start task-sonnet  --model sonnet  --dir ~/code/myproject
multi-claude start task-gpt     --provider openai --model gpt-4.1 --dir ~/code/myproject
multi-claude start task-gemini  --provider gemini --model gemini-2.5-flash --dir ~/code/myproject

# Give each the same prompt and compare results
multi-claude attach task-sonnet
# (Ctrl-b n to switch to task-gpt, etc.)
```

### Switching providers mid-task

```bash
# Start with a fast model for exploration
multi-claude start explore --provider groq --model llama-4-scout-17b-16e-instruct

# Later, switch to a deeper model
multi-claude config explore --provider openai --model gpt-4.1
multi-claude restart explore
```

### Local-only development with Ollama

```bash
# No API keys needed
multi-claude start local-dev --provider ollama --model qwen2.5-coder --dir ~/code/myproject
```

### CI / scripting with JSON output

```bash
# List sessions as JSON for scripting
multi-claude list --json | jq '.[] | select(.status == "running") | .name'

# Get provider model catalog
multi-claude models --provider openai --json | jq '.models[].id'

# Init programmatically
multi-claude init --providers openai gemini --no-start --json
```

### Attaching to a tmux window outside the tool

```bash
# List all windows in the multi-claude session
tmux list-windows -t multi-claude

# Attach directly
tmux attach -t multi-claude

# Jump to a specific window
tmux select-window -t multi-claude:myproject \; attach -t multi-claude
```

## Troubleshooting

### "Failed to attach to tmux session"

You're already inside a tmux session. `multi-claude attach` opens tmux from your current terminal — this works from a plain terminal, but not from inside an existing tmux session (nested tmux). Exit your current tmux session first, or use `tmux switch-client -t multi-claude` directly.

### Session shows as running but claude isn't responding

Attach to the session to see what's happening: `multi-claude attach <name>`. The tool starts the shell in the tmux pane and sends the `claude` command as keystrokes — if something went wrong during initialization, you'll see the error in the pane.

### Config changes not taking effect

`config` only writes to the JSON file. Running sessions are unaffected. Run `multi-claude restart <name>` to apply changes.

### Provider session fails to connect

1. Verify the API key is set: `echo $OPENAI_API_KEY`
2. Check the generated settings file: `cat ~/.multi-claude/settings/openai.json`
3. Verify the provider's base URL is correct and accessible
4. Restart the session after fixing: `multi-claude restart <name>`

### "No LLM providers detected" from init

`init` scans for API keys in your environment. Set at least one provider's API key:

```bash
export OPENAI_API_KEY=sk-...
export GEMINI_API_KEY=...
```

Or specify providers manually even without keys (the sessions will warn about missing keys):

```bash
multi-claude init --providers openai gemini
```

### Corrupted sessions.json

On load, if `sessions.json` is unparseable, it's renamed to `sessions.json.bak` and the tool starts with an empty session list. Check the `.bak` file to recover your config.
