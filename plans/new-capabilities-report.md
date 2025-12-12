# New Capabilities Report: Background Tasks & CLI Agents

## Executive Summary
This report details the investigation into "background tasks", "CLI agents", and "terminal agents" within the codebase. It identifies the technical mechanisms behind these features and outlines opportunities for the Orchestrator to leverage them for enhanced automation and workflow management.

## 1. Background Tasks

### Technical Discovery
The core logic for task management is located in `src/platform/tasks/vscode/tasksService.ts`. This service wraps the VS Code Tasks API and provides a unified interface for executing and monitoring tasks.

### Mechanism
- **Definition**: Tasks are defined with a `TaskDefinition` that includes an `isBackground` boolean property.
- **Execution**: The `executeTask` method handles the actual spawning of the task.
- **Lifecycle**: The service exposes events such as `onDidStartTask`, `onDidEndTask`, and `onDidEndTaskProcess` to track the lifecycle of tasks.
- **Problem Matchers**: Background tasks often use "problem matchers" to signal when they are "ready" (e.g., a server listening on a port) versus when they have "finished" (which background tasks technically don't do until killed).

### Orchestrator Opportunities
- **Non-Blocking Execution**: The Orchestrator can now confidently spawn long-running processes (like development servers, file watchers, or build-in-watch-mode) without blocking its own execution flow.
- **Tooling**: The `create_and_run_task` tool should be used with `{ isBackground: true }`.
- **Use Cases**:
  - Starting a local development server (`npm start`) and then running integration tests against it in a separate step.
  - Running `npm run watch` to keep build artifacts up-to-date while the Orchestrator performs other code edits.

## 2. CLI Agents & Terminal Integration

### Technical Discovery
The "CLI Agent" functionality is primarily implemented in `src/extension/chatSessions/vscode-node/copilotCLITerminalIntegration.ts`. This file manages the integration of Copilot into the integrated terminal.

### Mechanism
- **Shim Injection**: The system generates a "shim" script (`copilotCLIShim.js` for Node/Unix, `copilotCLIShim.ps1` for PowerShell) in the global storage directory.
- **Terminal Wrapping**: When `openTerminal` is called, it launches a new terminal instance that executes this shim. The shim effectively wraps the user's shell, intercepting commands or providing a "Copilot" command interface.
- **Authentication Injection**: Crucially, the `getCommonTerminalOptions` function injects authentication tokens into the terminal's environment variables:
  - `GH_TOKEN`: The GitHub access token.
  - `COPILOT_GITHUB_TOKEN`: A specific token for Copilot services.
- **Shell Support**: The integration supports `zsh`, `bash`, `powershell`, `pwsh`, and `cmd`.

### Orchestrator Opportunities
- **Authenticated Operations**: The Orchestrator can leverage the fact that terminals can be spawned with valid GitHub tokens. This is critical for git operations (push/pull) or accessing private packages without requiring manual user authentication.
- **Specialized Shell Sessions**: The Orchestrator could potentially request a "Copilot Terminal" to run complex CLI workflows that benefit from the shim's capabilities (likely context awareness or command suggestion/correction).
- **Terminal Agents**: The "Terminal Agent" concept likely refers to this shimmed shell experience. The Orchestrator can treat this as a specialized "worker" that operates via CLI commands rather than file edits.

## 3. Specialized Agent Sessions

### Overview
The extension supports a multi-agent architecture with three distinct session types, each offering unique capabilities and execution environments. These are managed via the `ChatSessionsContrib` contribution point.

### Session Types

#### 1. Claude Code (`claude-code`)
- **Description**: "Claude Code CLI Agent" - Runs local background tasks.
- **Backend**: Powered by the local Claude CLI SDK (`@anthropic-ai/claude-agent-sdk`).
- **Storage**: Sessions are persisted locally in `~/.claude/projects`.
- **Capabilities**: Can perform complex local tasks, file edits, and analysis. It has its own set of commands (e.g., `init`, `compact`, `review`).

#### 2. Background Agent (`copilotcli`)
- **Description**: "Background Agent" - Runs tasks in the background.
- **Backend**: Powered by the local Copilot CLI SDK (`@github/copilot`).
- **Storage**: Sessions are persisted locally in `~/.copilot/session-state`.
- **Isolation**: Uses **Git Worktrees** (`CopilotCLIWorktreeManager`) to isolate agent changes from the user's working copy. This allows the agent to work on a separate branch (`copilot-cli-session/<id>`) without interfering with the user's current state.
- **Capabilities**: Supports file attachments, problem fixing, and symbol search.

#### 3. Cloud Agent (`copilot-cloud-agent`)
- **Description**: "Cloud Agent" - Delegates tasks to the cloud.
- **Backend**: Powered by the GitHub Cloud API (remote execution).
- **Workflow**:
    1.  User delegates a task.
    2.  Extension creates a remote job via GitHub API.
    3.  Cloud agent creates a Pull Request.
    4.  Extension streams logs and progress back to the chat UI.
- **Integration**: Deeply integrated with GitHub Pull Requests, allowing for "follow-up" comments to refine the PR.

#### 4. OpenAI Codex (`openai-codex`)
- **Status**: Identified as a placeholder view (`codex-placeholder`) in `package.json`.
- **Function**: Likely a legacy or feature-flagged view, not a fully active session type in the current architecture.

### Orchestrator Opportunities
- **Worktree Isolation**: The Orchestrator should adopt the `CopilotCLIWorktreeManager` pattern. By performing complex multi-file edits in a temporary worktree, the Orchestrator can ensure safety and atomicity, allowing the user to "accept" the entire set of changes by merging the worktree branch.
- **Cloud Delegation**: For massive refactoring or tasks requiring significant compute/context, the Orchestrator could potentially delegate to the `copilot-cloud-agent` if the API allows programmatic invocation (currently driven by UI interactions).
- **Agent Specialization**: The Orchestrator can route tasks to the most appropriate agent:
    - **Claude Code** for deep analysis and complex local logic.
    - **Background Agent** for safe, isolated file modifications.
    - **Cloud Agent** for PR-based workflows and asynchronous long-running tasks.

## 4. Strategic Recommendations

1.  **Update Task Planning**: Modify the Orchestrator's planning logic to identify tasks that should be run in the background (e.g., "start server", "watch files").
2.  **Secure Git Automation**: When the Orchestrator needs to perform git operations, it should ensure it's running in a context where `GH_TOKEN` is available, mirroring the logic in `copilotCLITerminalIntegration.ts`.
3.  **Adopt Worktree Isolation**: Implement a mechanism similar to `CopilotCLIWorktreeManager` for the Orchestrator's own complex tasks. This prevents "half-baked" states in the user's active workspace.
4.  **Leverage Specialized Agents**: Instead of reinventing the wheel, the Orchestrator should be able to spawn sub-tasks that utilize the existing `claude-code` or `copilotcli` agents when their specific strengths are required.
