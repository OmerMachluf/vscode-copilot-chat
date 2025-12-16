# Onboarding Agent Implementation Plan

## Overview

This plan outlines the implementation of a comprehensive onboarding agent for Claude Code that:
1. Investigates repository structure and patterns using the repository investigator agent
2. Generates a detailed `architecture.md` file documenting the codebase
3. Analyzes the business domain and technology stack
4. Provides personalized agent configuration recommendations
5. Suggests custom instructions tailored to the repository and domain

## Architecture Analysis

### Current Agent Framework Structure

Based on code analysis, the current system has:

- **ClaudeAgentManager**: Main agent orchestration service
- **ClaudeCodeSession**: Individual agent sessions with worktree isolation
- **ClaudeCommandService**: Handles `.claude/commands/` directory for custom commands
- **A2A Orchestration**: Agent-to-agent communication and task delegation
- **WorktreeSession**: Isolated agent contexts for parallel work

### Key Integration Points

1. **IClaudeCommandService**: For managing custom commands in `.claude/commands/`
2. **A2A MCP Server**: For spawning and coordinating sub-agents
3. **Orchestrator Service**: For complex multi-agent workflows
4. **Agent Discovery Service**: For finding and launching specialized agents

## Implementation Strategy

### Phase 1: Repository Investigation Engine

#### 1.1 Repository Analyzer Service

```typescript
export interface IRepositoryAnalyzer {
    analyzeStructure(): Promise<RepositoryStructure>;
    identifyTechnologies(): Promise<TechnologyStack>;
    analyzeDomain(): Promise<BusinessDomain>;
    findPatterns(): Promise<CodePatterns>;
}

interface RepositoryStructure {
    directories: DirectoryInfo[];
    fileTypes: FileTypeAnalysis;
    dependencies: DependencyAnalysis;
    testStructure: TestStructure;
    buildSystem: BuildSystemInfo;
}

interface TechnologyStack {
    primaryLanguages: string[];
    frameworks: Framework[];
    databases: string[];
    deployment: DeploymentInfo;
    cicd: CICDInfo;
}

interface BusinessDomain {
    domain: string; // e.g., "fintech", "e-commerce", "healthcare"
    keywords: string[];
    compliance: ComplianceRequirements;
    scale: "startup" | "enterprise" | "medium";
}
```

#### 1.2 Repository Investigation Agent

Create a new agent that uses the repository-researcher to:
- Analyze file structure and naming conventions
- Identify architectural patterns (MVC, microservices, etc.)
- Detect technology stack and frameworks
- Find configuration files and documentation
- Identify business domain through code analysis and README content

**File**: `src/extension/agents/repository/repositoryInvestigationAgent.ts`

### Phase 2: Architecture Documentation Generator

#### 2.1 Architecture Document Builder

```typescript
export interface IArchitectureDocumentBuilder {
    generateArchitectureDoc(analysis: RepositoryAnalysis): Promise<string>;
    generateSystemOverview(structure: RepositoryStructure): string;
    generateComponentDiagrams(components: Component[]): string;
    generateDataFlowDiagrams(flows: DataFlow[]): string;
}
```

#### 2.2 Template System

Create templates for different types of projects:
- Web applications
- APIs/Services
- Libraries/SDKs
- Desktop applications
- Microservices

**File**: `src/extension/agents/repository/architectureTemplates.ts`

### Phase 3: Agent Recommendation Engine

#### 3.1 Agent Configuration Recommender

```typescript
export interface IAgentRecommendationEngine {
    recommendAgents(analysis: RepositoryAnalysis): Promise<AgentRecommendation[]>;
    generateCustomInstructions(domain: BusinessDomain, stack: TechnologyStack): Promise<CustomInstructions>;
    suggestWorkflows(patterns: CodePatterns): Promise<WorkflowSuggestion[]>;
}

interface AgentRecommendation {
    agentType: string;
    purpose: string;
    configuration: AgentConfig;
    customInstructions: string[];
    suggestedSkills: string[];
}
```

#### 3.2 Domain-Specific Knowledge Base

Build knowledge base for different domains:
- **FinTech**: Security requirements, compliance patterns, audit trails
- **Healthcare**: HIPAA compliance, data privacy, regulatory requirements
- **E-commerce**: Payment processing, inventory management, user analytics
- **Enterprise**: SSO integration, role-based access, scalability patterns

**File**: `src/extension/agents/repository/domainKnowledge.ts`

### Phase 4: Onboarding Orchestrator

#### 4.1 Main Onboarding Agent

```typescript
export class OnboardingAgent {
    async orchestrateOnboarding(options: OnboardingOptions): Promise<OnboardingResult> {
        // Phase 1: Repository Investigation
        const investigation = await this.delegateToRepositoryInvestigator();

        // Phase 2: Architecture Documentation
        const architectureDoc = await this.generateArchitectureDoc(investigation);

        // Phase 3: Agent Recommendations
        const recommendations = await this.generateRecommendations(investigation);

        // Phase 4: Configuration Generation
        const configurations = await this.generateConfigurations(recommendations);

        return {
            architectureDocument: architectureDoc,
            agentRecommendations: recommendations,
            customConfigurations: configurations,
            setupInstructions: this.generateSetupInstructions(configurations)
        };
    }

    private async delegateToRepositoryInvestigator(): Promise<RepositoryAnalysis> {
        // Use A2A orchestration to spawn repository-researcher agent
        return this.subTaskManager.spawn({
            agentType: '@repository-researcher',
            prompt: this.buildInvestigationPrompt(),
            expectedOutput: 'Complete repository analysis with structure, patterns, and technologies'
        });
    }
}
```

#### 4.2 Onboarding Command

Create a new slash command: `/onboard`

**File**: `.claude/commands/onboard.md`

```markdown
---
name: onboard
description: Complete repository onboarding and setup with architecture documentation and agent recommendations
argument-hint: "[optional: focus area like 'security', 'performance', 'testing']"
---

Perform comprehensive repository onboarding that includes:

1. **Repository Investigation**: Analyze codebase structure, technologies, and patterns
2. **Architecture Documentation**: Generate detailed architecture.md with system overview
3. **Agent Configuration**: Recommend and configure specialized agents
4. **Custom Instructions**: Provide domain-specific guidance and best practices
5. **Workflow Setup**: Suggest development workflows and automation

The onboarding process will:
- Spawn repository investigator to analyze the codebase thoroughly
- Generate architecture.md with system diagrams and component documentation
- Recommend specific agent configurations based on technology stack and domain
- Provide custom instructions tailored to the business domain
- Set up suggested workflows for common development tasks

Use the @onboarding agent to handle this request.
```

## Implementation Details

### File Structure

```
src/extension/agents/onboarding/
├── node/
│   ├── onboardingAgent.ts              # Main orchestrator agent
│   ├── repositoryAnalyzer.ts           # Repository structure analysis
│   ├── architectureDocumentBuilder.ts # Architecture.md generation
│   ├── agentRecommendationEngine.ts   # Agent configuration recommendations
│   ├── domainKnowledge.ts             # Business domain expertise
│   └── test/
│       └── onboardingAgent.spec.ts
├── common/
│   ├── onboardingTypes.ts             # Type definitions
│   └── architectureTemplates.ts      # Document templates
└── onboardingAgentContrib.ts         # VS Code contribution
```

### Key Components

#### 1. Repository Analysis Pipeline

```typescript
class RepositoryAnalysisPipeline {
    async analyze(): Promise<RepositoryAnalysis> {
        const [structure, technologies, domain, patterns] = await Promise.all([
            this.analyzeStructure(),
            this.analyzeTechnologies(),
            this.analyzeDomain(),
            this.analyzePatterns()
        ]);

        return {
            structure,
            technologies,
            domain,
            patterns,
            recommendations: this.generateRecommendations(structure, technologies, domain)
        };
    }
}
```

#### 2. Architecture Document Templates

```typescript
class ArchitectureTemplates {
    generateWebAppTemplate(analysis: RepositoryAnalysis): string;
    generateMicroserviceTemplate(analysis: RepositoryAnalysis): string;
    generateLibraryTemplate(analysis: RepositoryAnalysis): string;
    generateAPITemplate(analysis: RepositoryAnalysis): string;
}
```

#### 3. Agent Configuration Generator

```typescript
class AgentConfigurationGenerator {
    generateClaudeConfig(recommendations: AgentRecommendation[]): ClaudeConfiguration;
    generateCustomCommands(workflows: WorkflowSuggestion[]): CommandDefinition[];
    generateAgentInstructions(domain: BusinessDomain): CustomInstructions;
}
```

### Integration with Existing Systems

#### A2A Orchestration Integration

The onboarding agent will use the existing A2A orchestration to:
- Spawn repository-researcher for deep code analysis
- Delegate architecture document generation to specialized agents
- Coordinate multiple analysis phases in parallel

#### Claude Command Service Integration

The agent will integrate with ClaudeCommandService to:
- Create custom commands in `.claude/commands/`
- Generate agent configuration files in `.claude/agents/`
- Set up project-specific instructions

#### Worktree Session Management

Use ClaudeWorktreeSession for:
- Isolated analysis environments
- Parallel investigation of different code areas
- Safe document generation without conflicts

## Expected Outputs

### 1. Generated Files

- `architecture.md` - Complete system documentation
- `.claude/agents/custom/` - Domain-specific agent configurations
- `.claude/commands/` - Project-specific commands
- `.claude/instructions/` - Custom development guidelines

### 2. Architecture Document Structure

```markdown
# Project Architecture

## System Overview
- Purpose and scope
- Key stakeholders
- High-level architecture

## Technology Stack
- Languages and frameworks
- Databases and storage
- Infrastructure and deployment
- External dependencies

## System Components
- Core modules and their responsibilities
- Data flow between components
- API definitions and contracts

## Development Guidelines
- Coding standards and patterns
- Testing strategies
- Deployment procedures
- Security considerations

## Agent Recommendations
- Suggested agent configurations
- Custom workflow commands
- Domain-specific instructions
```

### 3. Agent Recommendations

Based on analysis, suggest agents like:
- **Security Agent**: For fintech/healthcare projects
- **Performance Agent**: For high-scale applications
- **Testing Agent**: For projects with complex test requirements
- **Documentation Agent**: For open-source or enterprise projects
- **Compliance Agent**: For regulated industries

## Success Metrics

1. **Onboarding Speed**: Reduce new developer onboarding from days to hours
2. **Documentation Quality**: Generate comprehensive, accurate architecture docs
3. **Agent Relevance**: 90%+ of recommended agents prove useful
4. **Custom Instructions**: Domain-specific guidance leads to better code quality
5. **User Adoption**: High usage of generated commands and configurations

## Implementation Timeline

### Phase 1: Foundation (Week 1-2)
- Repository analysis service
- Basic architecture document generation
- Integration with existing agent framework

### Phase 2: Intelligence (Week 3-4)
- Domain knowledge base
- Agent recommendation engine
- Custom instruction generation

### Phase 3: Orchestration (Week 5-6)
- Main onboarding agent
- A2A integration for complex workflows
- Testing and refinement

### Phase 4: Polish (Week 7-8)
- Template refinement based on feedback
- Performance optimization
- Comprehensive testing and documentation

## Risk Mitigation

1. **Analysis Accuracy**: Use multiple analysis methods and validation
2. **Template Quality**: Iterate based on user feedback and usage patterns
3. **Performance**: Implement caching and incremental analysis
4. **Integration Complexity**: Start with simple integrations and expand gradually

## Future Enhancements

1. **Learning System**: Improve recommendations based on user feedback
2. **Team Collaboration**: Multi-developer onboarding workflows
3. **CI/CD Integration**: Automated architecture validation
4. **Visual Diagrams**: Generate system architecture diagrams
5. **Migration Support**: Help migrate from other documentation systems