# Onboarding Agent - Phase 1 Implementation

## Overview

The Onboarding Agent provides comprehensive repository analysis and onboarding capabilities for Claude Code. This Phase 1 implementation focuses on the Repository Investigation Engine, which analyzes codebases to understand their structure, technology stack, business domain, and architectural patterns.

## Phase 1 Components

### 1. Core Type Definitions (`common/onboardingTypes.ts`)

Comprehensive TypeScript interfaces and types for:

- **Repository Analysis Types**: Structure analysis, technology identification, domain classification
- **Architecture Documentation Types**: Component modeling, data flow analysis
- **Agent Recommendation Types**: Custom agent configurations and workflow suggestions
- **Service Integration Types**: VS Code service integration patterns

### 2. Repository Analyzer Service (`node/repositoryAnalyzer.ts`)

The main analysis service that:

- **Delegates to Repository-Researcher**: Uses A2A orchestration to spawn the repository-researcher agent for deep analysis
- **Analyzes Repository Structure**: Categorizes directories, analyzes file types, identifies organizational patterns
- **Identifies Technology Stack**: Detects languages, frameworks, databases, and deployment technologies
- **Analyzes Business Domain**: Determines industry domain, compliance requirements, and project scale
- **Finds Code Patterns**: Identifies architectural patterns, design patterns, and coding conventions

### 3. A2A Integration

The service integrates with the existing A2A (Agent-to-Agent) orchestration system to:

- Spawn repository-researcher agents for comprehensive analysis
- Execute analysis tasks in isolated worktree contexts
- Handle task lifecycle and error management
- Support both blocking and non-blocking execution patterns

## Key Features

### Repository Structure Analysis

- Directory categorization (source, test, config, build, docs, assets)
- File type distribution analysis
- Build system and testing framework detection
- Dependency analysis and package manager identification

### Technology Stack Identification

- Programming language detection and distribution
- Framework and library identification
- Database and storage technology detection
- CI/CD and deployment platform analysis

### Business Domain Classification

- Industry domain identification (fintech, healthcare, e-commerce, etc.)
- Compliance requirement analysis (GDPR, HIPAA, SOX, etc.)
- Project scale assessment (startup, enterprise, medium)
- Security and audit requirement detection

### Code Pattern Recognition

- Architectural pattern identification (MVC, microservices, clean architecture)
- Design pattern detection
- Naming convention analysis
- Code style and formatting assessment

## Integration with VS Code Extension System

The onboarding agent follows VS Code extension patterns:

- **Service-based architecture**: Uses dependency injection with `IInstantiationService`
- **Disposable pattern**: Proper resource cleanup and lifecycle management
- **Event-driven communication**: Integration with VS Code's event system
- **Workspace integration**: Full access to workspace files and configuration

## Usage Example

```typescript
import { IRepositoryAnalyzerService } from './common/onboardingTypes';

// Analyze repository structure
const structure = await repositoryAnalyzer.analyzeStructure();

// Identify technology stack
const technologies = await repositoryAnalyzer.identifyTechnologies();

// Analyze business domain
const domain = await repositoryAnalyzer.analyzeDomain();

// Find code patterns
const patterns = await repositoryAnalyzer.findPatterns();
```

## Testing

Basic unit tests are provided in `node/test/repositoryAnalyzer.spec.ts` that:

- Verify service instantiation and interface compliance
- Test method availability and basic functionality
- Handle mock workspace scenarios
- Validate error handling for missing dependencies

## Future Phases

### Phase 2: Architecture Documentation Generator
- Generate comprehensive `architecture.md` files
- Create system diagrams and component documentation
- Build template system for different project types

### Phase 3: Agent Recommendation Engine
- Recommend specialized agents based on analysis
- Generate custom instructions for different domains
- Suggest workflows and automation opportunities

### Phase 4: Onboarding Orchestrator
- Main onboarding agent that coordinates all phases
- `/onboard` slash command implementation
- Interactive onboarding workflows

## Dependencies

- **A2A Orchestration System**: For delegating analysis to repository-researcher
- **VS Code Extension API**: For workspace access and service integration
- **Logging Service**: For diagnostic information and error tracking
- **Sub-Task Manager**: For managing agent spawning and lifecycle

## Architecture Decisions

1. **A2A Delegation**: Uses existing repository-researcher agent rather than implementing analysis from scratch
2. **Service-based Design**: Follows VS Code extension patterns for maintainability
3. **Type-first Approach**: Comprehensive TypeScript interfaces for all data structures
4. **Phased Implementation**: Incremental delivery with clear boundaries between phases
5. **Extensible Design**: Architecture supports future enhancements and customizations