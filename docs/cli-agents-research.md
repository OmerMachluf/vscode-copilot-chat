# CLI Agents Research Document

**Task ID:** task-10 (investigate-cli-agents)
**Status:** Complete
**Date:** December 3, 2025

## Executive Summary

This document provides comprehensive research on the execution models of four major CLI agents: GitHub Copilot CLI, OpenAI Codex CLI, Claude Code (Anthropic), and Gemini CLI (Google). This research informs the architecture design for CLI agent integration in the VS Code Copilot Chat extension's orchestrator system.

---

## 1. GitHub Copilot CLI

### Overview
GitHub Copilot CLI is a command-line interface that provides AI-powered assistance directly from the terminal. It's designed for developers who want to use Copilot without leaving their terminal environment, supporting code generation, debugging, Git operations, and interaction with GitHub.com.

### Installation

```bash
# NPM (recommended)
npm install -g @github/copilot

# Prerequisites
# - Node.js version 22 or later
# - npm version 10 or later
```

### Authentication Requirements

| Method | Description |
|--------|-------------|
| GitHub OAuth | Uses `/login` slash command, follows browser-based OAuth flow |
| GitHub Account | Requires active Copilot Pro, Pro+, Business, or Enterprise subscription |
| Session-based | Credentials cached in `~/.copilot` directory |

**Environment Variables:**
- `XDG_CONFIG_HOME` - Changes default config directory location (default: `~/.copilot`)

### Command Syntax

| Command | Description | Example |
|---------|-------------|---------|
| `copilot` | Start interactive REPL | `copilot` |
| `copilot "prompt"` | Start with initial prompt | `copilot "explain this codebase"` |
| `copilot -p "prompt"` | Programmatic mode (non-interactive) | `copilot -p "Show commits" --allow-tool 'shell(git)'` |
| `copilot --resume` | Resume previous session | `copilot --resume abc123` |
| `copilot --continue` | Continue most recent session | `copilot --continue` |
| `copilot help` | Show help | `copilot help` |

### Input/Output Format

**Input Methods:**
- Interactive REPL with prompt input
- Command-line argument with `-p` or `--prompt` flag
- Piped input: `echo ./script.sh | copilot`
- File references with `@path/to/file` syntax

**Output Formats:**
- Interactive: Streaming text output in terminal
- Programmatic: Text to stdout (final response only)
- No JSON output mode documented

### Streaming Capabilities
- Real-time streaming in interactive mode
- Streaming output in programmatic mode (default behavior)
- Can be cancelled with `Esc` key

### Multi-turn Conversation Support

| Feature | Support |
|---------|---------|
| Session persistence | ✅ Yes - stored in `~/.copilot/sessions/` |
| Resume by ID | ✅ Yes - `--resume <session-id>` |
| Continue last | ✅ Yes - `--continue` |
| Context preservation | ✅ Yes - full conversation history |

### Tool/Permission Model

```bash
# Auto-approve all tools
copilot -p "Revert the last commit" --allow-all-tools

# Allow specific tools
copilot --allow-tool 'shell(git)'

# Deny specific tools
copilot --deny-tool 'shell(rm)' --deny-tool 'shell(git push)'

# Combined approach
copilot --allow-all-tools --deny-tool 'shell(rm)'
```

### MCP Integration
- Built-in GitHub MCP server for GitHub.com operations
- Custom MCP servers configurable via `/mcp add` command
- Configuration stored in `~/.copilot/mcp-config.json`

### Key Configuration Files
- `~/.copilot/config.json` - Main configuration
- `~/.copilot/trusted_folders` - Trusted directory list
- `~/.copilot/mcp-config.json` - MCP server definitions

---

## 2. OpenAI Codex CLI

### Overview
OpenAI Codex CLI is a lightweight coding agent that runs in your terminal. It provides an interactive TUI (Terminal User Interface) and supports non-interactive automation mode. Built primarily in Rust for performance.

### Installation

```bash
# NPM
npm install -g @openai/codex

# Homebrew (macOS)
brew install --cask codex

# Direct download
# Available from GitHub Releases page
```

### Authentication Requirements

| Method | Description |
|--------|-------------|
| ChatGPT Login | OAuth login via browser (recommended) |
| API Key | Set `OPENAI_API_KEY` environment variable |
| Codex API Key | Set `CODEX_API_KEY` for `codex exec` mode only |

**Environment Variables:**
```bash
# For API key authentication
export OPENAI_API_KEY="your-api-key"

# For codex exec specifically
export CODEX_API_KEY="your-api-key"
```

### Command Syntax

| Command | Description | Example |
|---------|-------------|---------|
| `codex` | Interactive TUI | `codex` |
| `codex "prompt"` | TUI with initial prompt | `codex "fix lint errors"` |
| `codex exec "prompt"` | Non-interactive automation | `codex exec "explain utils.ts"` |
| `codex resume` | Resume session picker | `codex resume` |
| `codex resume --last` | Resume most recent | `codex resume --last` |
| `codex completion <shell>` | Generate shell completions | `codex completion bash` |

### Input/Output Format

**Input Methods:**
- Interactive TUI input
- Command-line prompt argument
- File input with `-i/--image` flag for images
- `@` symbol for fuzzy file search

**Output Formats:**
```bash
# Default: streams to stderr, final message to stdout
codex exec "query"

# JSON Lines (JSONL) streaming
codex exec --json "query"

# Structured JSON output with schema
codex exec --output-schema ~/schema.json "query"

# Save output to file
codex exec -o output.txt "query"
```

**JSON Event Types:**
- `thread.started` - Thread initialization
- `turn.started` / `turn.completed` / `turn.failed` - Turn lifecycle
- `item.started` / `item.updated` / `item.completed` - Item updates
- `error` - Unrecoverable errors

**Item Types:**
- `agent_message` - Assistant responses
- `reasoning` - Thinking summaries
- `command_execution` - Shell command execution
- `file_change` - File modifications
- `mcp_tool_call` - MCP tool invocations
- `web_search` - Web search operations
- `todo_list` - Agent planning

### Streaming Capabilities

```bash
# Stream JSON events
codex exec --json "query"

# Real-time item updates
# Events include partial progress for long operations
```

### Multi-turn Conversation Support

| Feature | Support |
|---------|---------|
| Session persistence | ✅ Yes - stored in `~/.codex/sessions/` |
| Resume by ID | ✅ Yes - `codex resume <SESSION_ID>` |
| Resume last | ✅ Yes - `codex resume --last` |
| Non-interactive resume | ✅ Yes - `codex exec resume --last "follow-up"` |

### Execution Modes

```bash
# Read-only mode (default for exec)
codex exec "count lines of code"

# Full automation with file edits
codex exec --full-auto "fix the bug"

# Full access including network
codex exec --sandbox danger-full-access "deploy the app"

# Skip git repo check
codex exec --skip-git-repo-check "query"
```

### Key Flags

| Flag | Description |
|------|-------------|
| `--model/-m` | Select model |
| `--ask-for-approval/-a` | Approval settings |
| `--cd/-C` | Change working directory |
| `--add-dir` | Add additional directories |
| `--max-turns` | Limit agentic turns |
| `--json` | JSONL output mode |
| `--output-schema` | Structured output schema |

### Configuration
- Config file: `~/.codex/config.toml`
- Memory file: `AGENTS.md` in working directory or `~/.codex/AGENTS.md`

---

## 3. Claude Code (Anthropic)

### Overview
Claude Code is an agentic coding tool from Anthropic that lives in your terminal. It understands codebases, executes tasks, handles git workflows, and supports extensive customization through MCP servers.

### Installation

```bash
# macOS/Linux
curl -fsSL https://claude.ai/install.sh | bash

# Homebrew (macOS)
brew install --cask claude-code

# Windows PowerShell
irm https://claude.ai/install.ps1 | iex

# NPM (requires Node.js 18+)
npm install -g @anthropic-ai/claude-code
```

### Authentication Requirements

| Method | Description |
|--------|-------------|
| Claude Console | OAuth via console.anthropic.com (requires billing) |
| Claude App | Login with Pro/Max subscription via claude.ai |
| Amazon Bedrock | Enterprise - AWS credentials |
| Google Vertex AI | Enterprise - GCP credentials |
| Microsoft Foundry | Enterprise - Azure/Entra ID |

**Environment Variables:**
```bash
# Bedrock
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1

# Vertex AI
export CLAUDE_CODE_USE_VERTEX=1
export CLOUD_ML_REGION=us-east5
export ANTHROPIC_VERTEX_PROJECT_ID=your-project-id

# Microsoft Foundry
export CLAUDE_CODE_USE_FOUNDRY=1
export ANTHROPIC_FOUNDRY_RESOURCE=your-resource
export ANTHROPIC_FOUNDRY_API_KEY=your-api-key

# Proxy configuration
export HTTPS_PROXY='https://proxy.example.com:8080'

# Disable auto-updates
export DISABLE_AUTOUPDATER=1

# Custom Git Bash path (Windows)
export CLAUDE_CODE_GIT_BASH_PATH="C:\Program Files\Git\bin\bash.exe"
```

### Command Syntax

| Command | Description | Example |
|---------|-------------|---------|
| `claude` | Start interactive REPL | `claude` |
| `claude "query"` | REPL with initial prompt | `claude "explain this project"` |
| `claude -p "query"` | Print mode (non-interactive) | `claude -p "explain this function"` |
| `cat file \| claude -p "query"` | Process piped content | `cat logs.txt \| claude -p "explain"` |
| `claude -c` | Continue most recent | `claude -c` |
| `claude -r "id" "query"` | Resume by session ID | `claude -r "abc123" "finish PR"` |
| `claude update` | Update to latest version | `claude update` |
| `claude mcp` | Configure MCP servers | `claude mcp` |

### Input/Output Format

**Input Methods:**
- Interactive REPL
- Command-line prompt with `-p` flag
- Piped stdin: `cat file | claude -p "query"`
- Streaming JSON input: `--input-format stream-json`

**Output Formats:**
```bash
# Plain text (default)
claude -p "query"

# JSON output
claude -p "query" --output-format json

# Streaming JSON (newline-delimited)
claude -p "query" --output-format stream-json

# Structured output with schema
claude -p --json-schema '{"type":"object",...}' "query"

# Include partial streaming events
claude -p --output-format stream-json --include-partial-messages "query"

# Verbose logging
claude --verbose "query"
```

### Streaming Capabilities

```bash
# Stream JSON events
claude -p --output-format stream-json "query"

# Include partial message updates
claude -p --output-format stream-json --include-partial-messages "query"
```

### Multi-turn Conversation Support

| Feature | Support |
|---------|---------|
| Session persistence | ✅ Yes |
| Continue last | ✅ Yes - `-c` flag |
| Resume by ID | ✅ Yes - `-r <session-id>` |
| SDK continuation | ✅ Yes - `-c -p "query"` |

### Key Flags

| Flag | Description |
|------|-------------|
| `--print, -p` | Non-interactive print mode |
| `--output-format` | Output format: text, json, stream-json |
| `--input-format` | Input format: text, stream-json |
| `--json-schema` | Structured output schema |
| `--model` | Model selection: sonnet, opus, haiku |
| `--max-turns` | Limit agentic turns |
| `--verbose` | Enable verbose logging |
| `--system-prompt` | Replace system prompt |
| `--append-system-prompt` | Append to system prompt |
| `--system-prompt-file` | Load prompt from file |
| `--permission-mode` | Set permission mode: plan, etc. |
| `--dangerously-skip-permissions` | Skip all permission prompts |
| `--allowedTools` | Whitelist specific tools |
| `--disallowedTools` | Blacklist specific tools |
| `--agents` | Define custom subagents (JSON) |
| `--add-dir` | Add additional directories |

### Subagent Support

```bash
claude --agents '{
  "code-reviewer": {
    "description": "Expert code reviewer",
    "prompt": "You are a senior code reviewer...",
    "tools": ["Read", "Grep", "Glob", "Bash"],
    "model": "sonnet"
  }
}'
```

### MCP Integration
- Full MCP server support
- Configured via `claude mcp` command
- Supports third-party MCP servers for extended functionality

### Configuration Files
- Settings in standard config directories
- Memory via `CLAUDE.md` files at repository, organization, or system level

---

## 4. Gemini CLI (Google)

### Overview
Gemini CLI is an open-source AI agent (Apache 2.0) from Google that brings Gemini directly into the terminal. It features a generous free tier, 1M token context window, built-in tools, and MCP support.

### Installation

```bash
# NPX (no installation required)
npx https://github.com/google-gemini/gemini-cli

# NPM global install
npm install -g @google/gemini-cli

# Homebrew (macOS/Linux)
brew install gemini-cli

# Version tags
npm install -g @google/gemini-cli@latest   # stable
npm install -g @google/gemini-cli@preview  # weekly preview
npm install -g @google/gemini-cli@nightly  # nightly builds

# Prerequisites: Node.js 20+
```

### Authentication Requirements

| Method | Description | Best For |
|--------|-------------|----------|
| Google OAuth | Login with Google account | Individual developers |
| Gemini API Key | From aistudio.google.com/apikey | Specific model control |
| Vertex AI | Google Cloud credentials | Enterprise/production |

**Environment Variables:**
```bash
# Google OAuth (with Code Assist License)
export GOOGLE_CLOUD_PROJECT="YOUR_PROJECT_ID"

# Gemini API Key
export GEMINI_API_KEY="YOUR_API_KEY"

# Vertex AI
export GOOGLE_API_KEY="YOUR_API_KEY"
export GOOGLE_GENAI_USE_VERTEXAI=true
```

### Command Syntax

| Command | Description | Example |
|---------|-------------|---------|
| `gemini` | Start interactive mode | `gemini` |
| `gemini -p "query"` | Non-interactive mode | `gemini -p "explain architecture"` |
| `gemini -m <model>` | Specify model | `gemini -m gemini-2.5-flash` |
| `gemini --include-directories` | Add directories | `gemini --include-directories ../lib,../docs` |

### Input/Output Format

**Input Methods:**
- Interactive terminal input
- Command-line prompt with `-p` flag
- Multi-directory context with `--include-directories`

**Output Formats:**
```bash
# Plain text (default)
gemini -p "explain the architecture"

# JSON output
gemini -p "query" --output-format json

# Streaming JSON (newline-delimited events)
gemini -p "run tests and deploy" --output-format stream-json
```

### Streaming Capabilities

```bash
# Real-time streaming for monitoring
gemini -p "long running operation" --output-format stream-json
```

### Multi-turn Conversation Support

| Feature | Support |
|---------|---------|
| Conversation checkpointing | ✅ Yes |
| Save/resume sessions | ✅ Yes |
| Context preservation | ✅ Yes - 1M token context window |

### Key Features

- **Free Tier:** 60 requests/min, 1,000 requests/day
- **Models:** Gemini 2.5 Pro with 1M token context
- **Built-in Tools:** Google Search grounding, file operations, shell commands, web fetching
- **MCP Support:** Full Model Context Protocol integration
- **Custom Context:** GEMINI.md files for project-specific instructions

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/chat` | Chat operations |
| `/bug` | Report issues |

### MCP Configuration

Configure in `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "github": { ... },
    "slack": { ... }
  }
}
```

Usage:
```
> @github List my open pull requests
> @slack Send summary to #dev channel
```

### GitHub Integration
- GitHub Action available: `google-github-actions/run-gemini-cli`
- PR reviews, issue triage, on-demand assistance
- Mention `@gemini-cli` in issues/PRs

---

## Comparison Matrix

| Feature | GitHub Copilot CLI | Codex CLI | Claude Code | Gemini CLI |
|---------|-------------------|-----------|-------------|------------|
| **Installation** | npm | npm/brew/binary | curl/brew/npm | npm/brew/npx |
| **Primary Language** | Node.js | Rust | Node.js | TypeScript |
| **Auth Methods** | GitHub OAuth | ChatGPT OAuth, API Key | OAuth, API Key, Cloud | Google OAuth, API Key, Vertex |
| **Interactive Mode** | ✅ | ✅ TUI | ✅ REPL | ✅ |
| **Non-Interactive** | ✅ `-p` flag | ✅ `exec` command | ✅ `-p` flag | ✅ `-p` flag |
| **JSON Output** | ❌ | ✅ `--json` | ✅ `--output-format json` | ✅ `--output-format json` |
| **Streaming JSON** | ❌ | ✅ JSONL | ✅ `stream-json` | ✅ `stream-json` |
| **Structured Output** | ❌ | ✅ `--output-schema` | ✅ `--json-schema` | ❓ |
| **Session Resume** | ✅ | ✅ | ✅ | ✅ |
| **MCP Support** | ✅ Built-in GitHub | ✅ | ✅ | ✅ |
| **Piped Input** | ✅ | ✅ | ✅ | ❓ |
| **Tool Permissions** | ✅ Fine-grained | ✅ Sandbox modes | ✅ Allow/Disallow lists | ❓ |
| **Custom Agents** | ✅ Agent files | ✅ AGENTS.md | ✅ `--agents` JSON | ❓ |
| **Free Tier** | ❌ Subscription | Included with ChatGPT | Subscription/API | ✅ Generous |

---

## Architecture Recommendations

Based on this research, the CLI agent integration architecture should support:

### 1. Unified Execution Interface
```typescript
interface CLIAgentExecutor {
  execute(prompt: string, options: ExecutionOptions): AsyncIterable<AgentEvent>;
  resume(sessionId: string, prompt?: string): AsyncIterable<AgentEvent>;
  cancel(): Promise<void>;
}

interface ExecutionOptions {
  mode: 'interactive' | 'non-interactive';
  outputFormat: 'text' | 'json' | 'stream-json';
  workingDirectory: string;
  additionalDirectories?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  maxTurns?: number;
  timeout?: number;
}
```

### 2. Event Streaming Model
All agents support some form of streaming. Normalize to a common event model:
```typescript
interface AgentEvent {
  type: 'started' | 'message' | 'tool_call' | 'file_change' | 'error' | 'completed';
  timestamp: number;
  data: unknown;
}
```

### 3. Authentication Abstraction
```typescript
interface AuthProvider {
  type: 'oauth' | 'api_key' | 'cloud_credentials';
  authenticate(): Promise<Credentials>;
  refresh(): Promise<Credentials>;
}
```

### 4. Session Management
All agents support session persistence and resume. Implement:
- Session storage abstraction
- Resume by ID or "last" session
- Context preservation across sessions

### 5. Tool Permission Model
Unified permission configuration:
```typescript
interface ToolPermissions {
  allowAll?: boolean;
  allowed?: string[];
  denied?: string[];
  sandboxMode?: 'read-only' | 'full-auto' | 'full-access';
}
```

---

## Next Steps

1. **task-11:** Design the CLIAgentAdapter interface based on these findings
2. **task-12:** Implement process spawning and I/O handling layer
3. **task-13:** Create event normalization layer for streaming outputs
4. **task-14:** Build authentication management system
5. **task-15:** Implement session management abstraction

---

## References

- [GitHub Copilot CLI Docs](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- [OpenAI Codex CLI Repository](https://github.com/openai/codex)
- [Claude Code Docs](https://code.claude.com/docs/en/overview)
- [Gemini CLI Repository](https://github.com/google-gemini/gemini-cli)
