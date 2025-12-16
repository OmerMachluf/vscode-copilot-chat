# Skills Guide

Skills are domain-specific knowledge modules that agents can reference on-demand. Unlike instructions (which are always loaded), skills are only loaded when explicitly referenced, saving token usage and keeping prompts focused.

## Skills vs Instructions

| Aspect | Instructions | Skills |
|--------|-------------|--------|
| **Loading** | Always loaded | Explicitly referenced |
| **Purpose** | Behavioral rules | Domain knowledge |
| **Location** | `*.instructions.md` | `skills/*.skill.md` |
| **Example** | "Use tabs not spaces" | "Microservices patterns" |

## Creating Skills

### File Location

Skills can be placed in several locations:

```
.github/
├── skills/                          # Global skills (all agents)
│   └── coding-standards.skill.md
├── agents/
│   └── architect/
│       └── skills/                  # Agent-specific skills
│           ├── microservices.skill.md
│           └── design-patterns.skill.md
```

### Skill File Format

Skills use YAML frontmatter followed by markdown content:

```yaml
# .github/agents/architect/skills/microservices.skill.md
---
name: Microservices Patterns
description: Knowledge of microservices architecture patterns
keywords:
  - microservice
  - service mesh
  - API gateway
---
# Microservices Architecture Patterns

## Service Communication

### Synchronous Communication
- REST APIs with OpenAPI specs
- gRPC for internal services
- GraphQL for flexible queries

### Asynchronous Communication
- Message queues (RabbitMQ, SQS)
- Event streaming (Kafka)
- Pub/Sub patterns

## Service Discovery
...
```

### Required Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable skill name |
| `description` | Yes | Brief description of what the skill provides |
| `keywords` | No | Keywords for discovery/search |

## Referencing Skills

### In Prompts

Use the `#skill:name` syntax to reference skills in your prompts:

```
Please help me design a service using #skill:microservices patterns.
Also consider #skill:security-best-practices when implementing auth.
```

### In Agent Definitions

Agents can specify skills that should always be loaded via `useSkills`:

```yaml
# .github/agents/cloud-architect/cloud-architect.agent.md
---
name: CloudArchitect
description: Designs cloud-native applications
useSkills: [microservices, cloud-native, security-best-practices]
tools: ['search', 'read_file']
---
You design cloud-native applications...
```

## Best Practices

### When to Create a Skill

Create a skill when you have:
- **Reusable domain knowledge** that multiple agents or tasks might need
- **Specialized patterns** specific to your codebase or technology stack
- **Reference material** that would be helpful but not needed for every task

### When NOT to Create a Skill

Don't create a skill for:
- **Behavioral rules** → Use instructions instead
- **One-off information** → Include directly in the prompt
- **Large documents** → Consider breaking into smaller, focused skills

### Skill Design Guidelines

1. **Keep skills focused**: One skill = one domain area
2. **Use clear naming**: The skill ID should be descriptive
3. **Include examples**: Concrete examples help agents apply the knowledge
4. **Keep it concise**: Skills add to token usage; trim unnecessary content

## Example Skills

### REST API Patterns Skill

```yaml
---
name: REST API Patterns
description: RESTful API design patterns and best practices
keywords: [rest, api, http, endpoints]
---
# REST API Design Patterns

## Resource Naming
- Use nouns, not verbs: `/users` not `/getUsers`
- Use plural forms: `/users` not `/user`
- Use hyphens for readability: `/user-profiles`

## HTTP Methods
- GET: Retrieve resources
- POST: Create new resources
- PUT: Replace entire resource
- PATCH: Partial update
- DELETE: Remove resources

## Response Codes
- 200: Success
- 201: Created
- 400: Bad Request
- 404: Not Found
- 500: Server Error
```

### Error Handling Skill

```yaml
---
name: Error Handling
description: Error handling patterns for this codebase
keywords: [errors, exceptions, handling]
---
# Error Handling Patterns

## Custom Error Classes
Always use custom error classes that extend BaseError:

\`\`\`typescript
class ValidationError extends BaseError {
  constructor(message: string, field: string) {
    super(message, 'VALIDATION_ERROR', { field });
  }
}
\`\`\`

## Error Response Format
Return errors in this format:
\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": { "field": "email" }
  }
}
\`\`\`
```

## API Reference

### ISkillsService Methods

```typescript
interface ISkillsService {
  // Discover all available skills for an agent
  discoverSkills(agentId: string): Promise<ISkillDiscoveryResult>;

  // Get a specific skill by ID
  getSkill(agentId: string, skillId: string): Promise<ISkill | undefined>;

  // Get multiple skills by their references
  getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]>;

  // Parse skill references from a prompt string
  parseSkillReferences(prompt: string): ISkillReference[];

  // Load skills based on prompt references and agent definition
  loadSkillsForAgent(
    agentId: string,
    prompt: string,
    useSkills?: string[]
  ): Promise<ISkill[]>;
}
```

### ISkill Interface

```typescript
interface ISkill {
  id: string;           // Skill identifier (from filename)
  name: string;         // Human-readable name
  description: string;  // What this skill provides
  keywords: string[];   // Search keywords
  content: string;      // Markdown content
  source: 'builtin' | 'repo';
  path?: string;        // Path to skill file
  agentId?: string;     // Agent this skill belongs to
}
```

## Troubleshooting

### Skill Not Loading

1. **Check file extension**: Must be `.skill.md`
2. **Check location**: Must be in a `skills/` directory
3. **Check frontmatter**: Must have valid YAML with `name` and `description`
4. **Check reference syntax**: Use `#skill:name` exactly

### Skill Content Not Applied

1. **Verify the skill ID**: The ID is derived from the filename
2. **Check case sensitivity**: Skill IDs are case-insensitive but filenames matter
3. **Clear cache**: The service caches skills; workspace changes may need a reload
