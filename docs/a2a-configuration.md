# Agent-to-Agent (A2A) Configuration Guide

This guide details how to customize the behavior of Copilot's Agent-to-Agent (A2A) architecture, including agent capabilities, orchestrator permissions, and model preferences.

## Configuration Levels

Configuration is applied in the following order of precedence (highest to lowest):
1. **User Settings** (VS Code `settings.json`)
2. **Workspace Configuration** (`.github/agents/` files)
3. **Extension Defaults**

## 1. VS Code Settings

These settings can be configured in your user or workspace `settings.json`.

### `copilot.agents.capabilities`
Override specific capabilities for agents.

```json
"copilot.agents.capabilities": {
    "architect": {
        "skills": ["design-patterns", "system-architecture"],
        "allowedTools": ["search_workspace", "read_file"]
    }
}
```

### `copilot.orchestrator.permissions`
Control what actions the orchestrator can perform without explicit user approval.

```json
"copilot.orchestrator.permissions": {
    "fileSystem": {
        "read": "auto_approve",
        "write": "ask_user"
    },
    "terminal": {
        "execute": "ask_user"
    }
}
```

### `copilot.orchestrator.limits`
Set operational limits for the orchestrator.

```json
"copilot.orchestrator.limits": {
    "maxSubtaskDepth": 3,
    "maxSubtasksPerWorker": 15
}
```

### `copilot.orchestrator.modelPreferences`
Specify which AI models to use for different tasks or agents.

```json
"copilot.orchestrator.modelPreferences": {
    "default": "gpt-4o",
    "byTaskType": {
        "architecture": "o1-preview",
        "implementation": "claude-3-5-sonnet",
        "review": "gpt-4o"
    },
    "byAgent": {
        "architect": "o1-preview"
    }
}
```

## 2. Workspace Configuration Files

You can commit these files to your repository to share configuration with your team.

### Agent Definitions
**Path:** `.github/agents/{agentId}/{agentId}.agent.md`

Define custom agents or override existing ones using Markdown frontmatter and content.

```markdown
---
name: "Security Auditor"
description: "Reviews code for security vulnerabilities"
capabilities:
  - code-analysis
  - vulnerability-scanning
---

# System Prompt
You are a security expert...
```

### Registry Overrides
**Path:** `.github/agents/registry-overrides.md`

Override capabilities of registered agents.

```markdown
# Registry Overrides

## architect
- add_skill: "cloud-native-design"
- remove_tool: "delete_file"

## reviewer
- set_model: "gpt-4o"
```

### Permission Overrides
**Path:** `.github/agents/orchestrator/permissions.md`

Define project-specific permissions.

```markdown
# Orchestrator Permissions

## File System
- **Read**: auto_approve
- **Write**: ask_user (protected branches only)

## Terminal
- **Execute**: ask_user
```

## 3. Configuration Templates

We provide templates for common scenarios:

- **Enterprise**: Restrictive, security-focused (requires approval for most actions).
- **Open Source**: Permissive for contributors, strict for maintainers.
- **Solo**: Optimized for speed (auto-approve most actions).
- **Team**: Balanced for collaboration (PR workflows).

## Troubleshooting

### Configuration Not Loading
- Ensure files are in `.github/agents/`.
- Check VS Code Output channel for "Copilot Orchestrator" for parsing errors.
- Verify JSON syntax in `settings.json`.

### Conflicts
- User settings always override workspace settings.
- If an agent behaves unexpectedly, check `copilot.agents.capabilities` for overrides.
