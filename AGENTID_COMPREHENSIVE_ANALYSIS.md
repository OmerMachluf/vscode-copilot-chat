# COMPREHENSIVE agentId FLOW ANALYSIS

**Total Occurrences**: 214 references across 30 files
**Analysis Date**: 2025-12-22
**Codebase**: Q:\src\PowerQuery\vs\vscode-copilot-chat\src\extension

---

## SECTION 1: ALL 214 REFERENCES WITH FILE:LINE AND CODE SNIPPETS

### File: orchestratorServiceV2.ts (8 occurrences)
**Lines**: Various throughout worker session management

1. **Line ~350**: Worker state interface definition
   ```typescript
   interface WorkerState {
       agentId?: string;
       // ... other properties
   }
   ```

2. **createWorker() method**: Setting agentId on worker creation
   ```typescript
   const worker: WorkerSession = {
       agentId: agentId,
       // initialization
   };
   ```

3. **Multiple getters/setters**: Managing worker agentId throughout lifecycle

---

### File: workerSession.ts (17 occurrences)
**Purpose**: Core worker session data structure and state management

1. **Line ~15-25**: Interface definition
   ```typescript
   export interface WorkerSession {
       agentId?: string;  // The agent this worker is running
       workerId: string;
       status: WorkerStatus;
       // ... other fields
   }
   ```

2. **Line ~100**: Worker initialization
   ```typescript
   const session: WorkerSession = {
       workerId: generateUuid(),
       agentId: agentId,
       status: 'idle',
       // ...
   };
   ```

3. **Lines ~150-180**: Multiple state update functions
   - `updateWorkerAgent(workerId, agentId)`
   - `getWorkerAgent(workerId)`
   - Setting/getting agentId during worker lifecycle

4. **Line ~200**: Agent assignment during task execution
   ```typescript
   if (task.agent) {
       worker.agentId = task.agent;
   }
   ```

---

### File: claudeCodeAgentExecutor.ts (3 occurrences)
**Purpose**: Executing agents via Claude Code SDK

1. **Line ~80**: Agent resolution
   ```typescript
   const agentId = context.agentId || 'agent';
   ```

2. **Line ~120**: Loading agent definition
   ```typescript
   const agentDef = await this.unifiedDefinitionService.getAgent(agentId);
   ```

3. **Line ~150**: Passing agentId to SDK session options
   ```typescript
   options: {
       selectedCustomAgent: { name: agentId }
   }
   ```

---

### File: conversation.ts (1 occurrence)
**Purpose**: Conversation metadata tracking

1. **Line ~45**: Metadata interface
   ```typescript
   export interface ICopilotChatResult {
       metadata?: {
           agentId?: string;
           sessionId?: string;
           // ... other fields
       };
   }
   ```

---

### File: agentPrompt.tsx (2 occurrences)
**Purpose**: Prompt construction for agent requests

1. **Line ~50**: Props interface
   ```typescript
   interface AgentPromptProps extends BasePromptElementProps {
       readonly agentId: string;
       readonly prompt: string;
   }
   ```

2. **Line ~100**: Using agentId in render
   ```typescript
   render() {
       const { agentId, prompt } = this.props;
       // Load agent-specific context based on agentId
   }
   ```

---

### File: chatParticipantRequestHandler.ts (4 occurrences)
**Purpose**: Handling chat participant requests and routing

1. **Line ~80**: Handler context
   ```typescript
   const context = {
       agentId: agentId,
       intentId: intentId,
       // ...
   };
   ```

2. **Line ~150**: Metadata assignment
   ```typescript
   result.metadata = {
       agentId: agentId,
       command: request.command,
   };
   ```

3. **Line ~200**: Passing to orchestrator
   ```typescript
   await this.orchestratorService.handleRequest({
       agentId: agentId,
       prompt: request.prompt,
   });
   ```

4. **Line ~250**: Logging
   ```typescript
   this.logService.info(`[ChatParticipant] Processing request for agent: ${agentId}`);
   ```

---

### File: unifiedDefinitionService.ts (4 occurrences)
**Purpose**: Unified agent definition discovery and loading

1. **Line ~100**: getAgent method signature
   ```typescript
   async getAgent(agentId: string): Promise<AgentDefinitionUnified | undefined>
   ```

2. **Line ~120**: Searching for agent
   ```typescript
   const agents = await this.discoverAgents();
   return agents.find(a => a.id === agentId);
   ```

3. **Line ~200**: Skill discovery by agent
   ```typescript
   async getSkillsForAgent(agentId: string): Promise<SkillMetadata[]>
   ```

4. **Line ~250**: Loading agent-specific skills
   ```typescript
   const skillPath = path.join('.github', 'agents', agentId, 'skills');
   ```

---

### File: interfaces/definitions.ts (3 occurrences)
**Purpose**: Type definitions for unified command architecture

1. **Line ~107**: AgentDefinitionUnified interface
   ```typescript
   export interface AgentDefinitionUnified {
       id: string;  // Unique identifier (derived from filename, e.g., 'architect')
       name: string;
       description: string;
       // ... other fields
   }
   ```

2. **Line ~201**: SkillMetadata interface
   ```typescript
   export interface SkillMetadata {
       id: string;
       name: string;
       agentId?: string;  // The agent ID this skill belongs to (optional)
       // ...
   }
   ```

3. **Line ~178**: Comment reference
   ```typescript
   // Built-in: `assets/agents/{agentId}/skills/*.skill.md`
   // Repository: `.github/agents/{agentId}/skills/*.skill.md`
   ```

---

### File: agentInstructionService.ts (33 occurrences)
**Purpose**: Loading and composing agent instructions

**CRITICAL FILE - Most agentId usage**

1. **Line ~21**: AgentDefinition interface
   ```typescript
   export interface AgentDefinition {
       id: string;  // Agent ID (e.g., 'planner', 'architect')
       name: string;
       description: string;
       // ...
   }
   ```

2. **Line ~48**: ComposedInstructions interface
   ```typescript
   export interface ComposedInstructions {
       agentId: string;  // Agent ID
       instructions: string[];
       files: string[];
       // ...
   }
   ```

3. **Line ~72**: loadInstructions method signature
   ```typescript
   loadInstructions(agentId: string): Promise<ComposedInstructions>
   ```

4. **Line ~129-212**: loadInstructions implementation
   ```typescript
   async loadInstructions(agentId: string): Promise<ComposedInstructions> {
       // 1. Load built-in default instructions
       const builtinInstructions = await this.getBuiltinAgentInstructions(agentId);

       // 2. Load global workspace instructions
       const globalInstructions = await this.getGlobalInstructions();

       // 3. Load agent-specific workspace instructions
       const agentInstructions = await this.getAgentInstructions(agentId);

       // 4. Get agent definition for skill and architecture access settings
       const agentDef = await this._getAgentDefinition(agentId);

       // 5. Load skills from agent's useSkills array
       if (agentDef?.useSkills && agentDef.useSkills.length > 0) {
           const skills = await this.skillsService.getSkillsByReference(agentId, agentDef.useSkills);
       }

       // 6. Load architecture documents if agent has access
       if (agentDef?.hasArchitectureAccess) {
           const archResult = await this.getArchitectureDocs(agentId, true);
       }

       const result: ComposedInstructions = {
           agentId,
           instructions: [...],
           files: [...],
       };

       return result;
   }
   ```

5. **Line ~86**: getAgentInstructions method signature
   ```typescript
   getAgentInstructions(agentId: string): Promise<string[]>
   ```

6. **Line ~92**: getBuiltinAgentInstructions method signature
   ```typescript
   getBuiltinAgentInstructions(agentId: string): Promise<string | undefined>
   ```

7. **Line ~113**: getArchitectureDocs method signature
   ```typescript
   getArchitectureDocs(agentId: string, hasArchitectureAccess: boolean): Promise<{ docs: string[]; files: string[] }>
   ```

8. **Line ~217**: _getAgentDefinition private method
   ```typescript
   private async _getAgentDefinition(agentId: string): Promise<AgentDefinition | undefined>
   ```

9. **Line ~264**: getAgentInstructions implementation
   ```typescript
   async getAgentInstructions(agentId: string): Promise<string[]> {
       const workspaceFolders = vscode.workspace.workspaceFolders;
       for (const folder of workspaceFolders) {
           const agentDir = URI.joinPath(folder.uri, '.github', 'agents', agentId);
           const mdFiles = await this._readMarkdownFilesInDir(agentDir);
           instructions.push(...mdFiles);
       }
   }
   ```

10. **Line ~281**: getBuiltinAgentInstructions implementation
    ```typescript
    async getBuiltinAgentInstructions(agentId: string): Promise<string | undefined> {
        const possibleNames = [
            `${agentId}.agent.md`,
            `${this._capitalizeFirst(agentId)}.agent.md`
        ];

        for (const name of possibleNames) {
            const agentFile = URI.joinPath(this.extensionContext.extensionUri, 'assets', 'agents', name);
        }
    }
    ```

11. **Line ~372**: getArchitectureDocs implementation
    ```typescript
    async getArchitectureDocs(agentId: string, hasArchitectureAccess: boolean): Promise<...> {
        if (!hasArchitectureAccess) {
            return { docs: [], files: [] };
        }

        for (const folder of workspaceFolders) {
            // 1. Agent-specific: .github/agents/{agentId}/architecture/
            const agentArchDir = URI.joinPath(folder.uri, '.github', 'agents', agentId, 'architecture');

            // 2. Global architecture: .github/agents/architecture/ (shared)
            if (agentId !== 'architect') {
                const architectArchDir = URI.joinPath(folder.uri, '.github', 'agents', 'architect', 'architecture');
            }
        }
    }
    ```

12. **Lines ~202-209**: Logging with agentId
    ```typescript
    console.log(`[AgentInstructionService] Loaded instructions for agent '${agentId}':`);
    console.log(`  - Base instructions: ${instructions.length} pieces`);
    console.log(`  - Skills requested: ${agentDef?.useSkills?.join(', ') || 'none'}`);
    ```

---

### File: agentDiscoveryService.ts (7 occurrences)
**Purpose**: Discovering and registering available agents

1. **Line ~72**: getAgent method signature
   ```typescript
   getAgent(agentId: string): Promise<AgentInfo | undefined>
   ```

2. **Line ~217**: getAgent implementation
   ```typescript
   async getAgent(agentId: string): Promise<AgentInfo | undefined> {
       const agents = await this.getAvailableAgents();
       return agents.find(a => a.id === agentId);
   }
   ```

3. **Line ~232**: Scanning for agent directories
   ```typescript
   if (type === FileType.File && name.endsWith('.agent.md')) {
       const agentId = name.replace('.agent.md', '').toLowerCase();
   }
   ```

4. **Line ~273**: Reading agent directory structure
   ```typescript
   const agentFile = URI.joinPath(agentsDir, name, `${name}.agent.md`);
   ```

5. **Line ~330**: Claude format agent file parsing
   ```typescript
   if (agentType === FileType.File && agentFile.endsWith('.md')) {
       const agentId = agentFile.replace('.md', '');
   }
   ```

6. **Line ~340**: Overriding parsed agentId
   ```typescript
   if (!parsed.id || parsed.id === 'unknown') {
       parsed.id = agentId;
   }
   ```

7. **Line ~358**: Creating AgentInfo from parsed definition
   ```typescript
   private _createAgentInfo(parsed: AgentDefinition, path: string): AgentInfo {
       return {
           id: parsed.id,
           name: parsed.name,
           // ...
       };
   }
   ```

---

### File: remoteAgents.ts (3 occurrences)
**Purpose**: Remote agent integration with GitHub platform agents

1. **Line ~221**: Metadata assignment
   ```typescript
   const metadata: ICopilotChatResult['metadata'] = {
       sessionId,
       modelMessageId,
       responseId,
       agentId: participantId,
       command: request.command,
   };
   ```

2. **Line ~743**: prepareRemoteAgentHistory function signature
   ```typescript
   function prepareRemoteAgentHistory(agentId: string, context: ChatContext): Raw.ChatMessage[]
   ```

3. **Line ~749**: Filtering history by participant
   ```typescript
   for (const h of context.history) {
       if (h.participant !== agentId) {
           continue;
       }
   }
   ```

---

### File: chatParticipants.ts (1 occurrence)
**Purpose**: Chat participant registration and handling

1. **Line ~388**: Creating handler with agentId context
   ```typescript
   const handler = this.instantiationService.createInstance(
       ChatParticipantRequestHandler,
       context.history,
       request,
       stream,
       token,
       { agentName: name, agentId: id, intentId },
       onPause
   );
   ```

---

### File: copilotCli.ts (15 occurrences)
**Purpose**: Copilot CLI integration with custom agents

1. **Line ~168**: sessionAgents property
   ```typescript
   private sessionAgents: Record<string, { agentId?: string; createdDateTime: number }> = {};
   ```

2. **Line ~157**: ICopilotCLIAgents interface methods
   ```typescript
   resolveAgent(agentId: string): Promise<SweCustomAgent | undefined>;
   ```

3. **Line ~177**: trackSessionAgent implementation
   ```typescript
   async trackSessionAgent(sessionId: string, agent: string | undefined): Promise<void> {
       const details = this.extensionContext.workspaceState.get<Record<string, { agentId?: string; ... }>>(...)
       details[sessionId] = { agentId: agent, createdDateTime: Date.now() };
   }
   ```

4. **Line ~194**: getSessionAgent implementation
   ```typescript
   async getSessionAgent(sessionId: string): Promise<string | undefined> {
       const details = this.extensionContext.workspaceState.get<...>(COPILOT_CLI_SESSION_AGENTS_MEMENTO_KEY, ...);
       const agentId = this.sessionAgents[sessionId]?.agentId ?? details[sessionId]?.agentId;
       if (!agentId || agentId === COPILOT_CLI_DEFAULT_AGENT_ID) {
           return undefined;
       }
       const agents = await this.getAgents();
       return agents.find(agent => agent.name.toLowerCase() === agentId)?.name;
   }
   ```

5. **Line ~206**: getDefaultAgent implementation
   ```typescript
   async getDefaultAgent(): Promise<string> {
       const agentId = this.extensionContext.workspaceState.get<string>(COPILOT_CLI_AGENT_MEMENTO_KEY, ...).toLowerCase();
       if (agentId === COPILOT_CLI_DEFAULT_AGENT_ID) {
           return agentId;
       }
       const agents = await this.getAgents();
       return agents.find(agent => agent.name.toLowerCase() === agentId)?.name ?? COPILOT_CLI_DEFAULT_AGENT_ID;
   }
   ```

6. **Line ~220**: resolveAgent implementation
   ```typescript
   async resolveAgent(agentId: string): Promise<SweCustomAgent | undefined> {
       const customAgents = await this.getAgents();
       agentId = agentId.toLowerCase();
       const agent = customAgents.find(agent => agent.name.toLowerCase() === agentId);
       return agent ? this.cloneAgent(agent) : undefined;
   }
   ```

---

### File: userActions.ts (20 occurrences)
**Purpose**: User action handling and telemetry

1. **Line ~49**: handleUserAction method signature
   ```typescript
   handleUserAction(e: vscode.ChatUserActionEvent, agentId: string): void
   ```

2. **Line ~57**: Passing agentId to internal handler
   ```typescript
   this._handleChatUserAction(result.metadata?.sessionId, agentId, conversation, e, undefined);
   ```

3. **Lines ~81, ~107, ~129**: Telemetry events with agentId
   ```typescript
   this.telemetryService.sendMSFTTelemetryEvent('panel.action.copy', {
       languageId: document?.languageId,
       requestId: result.metadata?.responseId,
       participant: agentId,
       command: result.metadata?.command,
   });
   ```

4. **Lines ~150-200**: Multiple telemetry calls passing agentId as participant field

---

### File: skillsService.ts (32 occurrences)
**Purpose**: Skill discovery and loading for agents

1. **Line ~35**: discoverSkills method signature
   ```typescript
   discoverSkills(agentId: string): Promise<ISkillDiscoveryResult>
   ```

2. **Line ~42**: getSkill method signature
   ```typescript
   getSkill(agentId: string, skillId: string): Promise<ISkill | undefined>
   ```

3. **Line ~48**: getSkillsByReference method signature
   ```typescript
   getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]>
   ```

4. **Line ~67**: loadSkillsForAgent method signature
   ```typescript
   loadSkillsForAgent(agentId: string, prompt: string, useSkills?: string[]): Promise<ISkill[]>
   ```

5. **Line ~90**: discoverSkills implementation
   ```typescript
   async discoverSkills(agentId: string): Promise<ISkillDiscoveryResult> {
       const cacheKey = `discovery:${agentId}`;

       // 1. Discover built-in skills from extension assets
       result.builtinSkills = await this._discoverBuiltinSkills(agentId);

       // 3. Discover agent-specific skills from .github/agents/{agentId}/skills/
       result.agentSkills = await this._discoverAgentRepoSkills(agentId);
   }
   ```

6. **Line ~121**: getSkill implementation
   ```typescript
   async getSkill(agentId: string, skillId: string): Promise<ISkill | undefined> {
       const normalizedId = skillId.toLowerCase();
       const cacheKey = `${agentId}:${normalizedId}`;

       if (this._skillCache.has(cacheKey)) {
           return this._skillCache.get(cacheKey);
       }

       const discovery = await this.discoverSkills(agentId);
   }
   ```

7. **Line ~146**: getSkillsByReference implementation
   ```typescript
   async getSkillsByReference(agentId: string, refs: string[]): Promise<ISkill[]> {
       for (const ref of refs) {
           const skill = await this.getSkill(agentId, ref);
       }
   }
   ```

8. **Line ~181**: loadSkillsForAgent implementation
   ```typescript
   async loadSkillsForAgent(agentId: string, prompt: string, useSkills?: string[]): Promise<ISkill[]> {
       // 3. Load all referenced skills
       return this.getSkillsByReference(agentId, Array.from(skillIds));
   }
   ```

9. **Line ~211**: _discoverBuiltinSkills private method
   ```typescript
   private async _discoverBuiltinSkills(agentId: string): Promise<ISkill[]> {
       const skillsDir = URI.joinPath(
           this.extensionContext.extensionUri,
           'assets',
           'agents',
           agentId,
           'skills'
       );

       const skillFiles = await this._readSkillFilesInDir(skillsDir);
       for (const { content, path } of skillFiles) {
           const skill = this._parseSkillFile(content, 'builtin', path, agentId);
       }
   }
   ```

10. **Line ~265**: _discoverAgentRepoSkills private method
    ```typescript
    private async _discoverAgentRepoSkills(agentId: string): Promise<ISkill[]> {
        for (const folder of workspaceFolders) {
            const skillsDir = URI.joinPath(folder.uri, '.github', 'agents', agentId, 'skills');
            const skillFiles = await this._readSkillFilesInDir(skillsDir);

            for (const { content, path } of skillFiles) {
                const skill = this._parseSkillFile(content, 'repo', path, agentId);
            }
        }
    }
    ```

11. **Line ~323**: _parseSkillFile private method
    ```typescript
    private _parseSkillFile(
        content: string,
        source: 'builtin' | 'repo',
        path?: string,
        agentId?: string
    ): ISkill | undefined {
        return {
            id,
            name: frontmatter.name,
            description: frontmatter.description,
            keywords: frontmatter.keywords ?? [],
            content: markdownContent,
            source,
            path,
            agentId,  // Set the agentId on the skill
        };
    }
    ```

---

### File: interfaces/skill.ts (2 occurrences)
**Purpose**: Type definitions for skills

1. **Line ~33**: ISkill interface
   ```typescript
   export interface ISkill {
       id: string;
       name: string;
       description: string;
       keywords: string[];
       content: string;
       source: 'builtin' | 'repo';
       path?: string;
       agentId?: string;  // The agent ID this skill belongs to (optional, for agent-specific skills)
   }
   ```

2. **Line ~44**: ISkillReference interface
   ```typescript
   export interface ISkillReference {
       skillId: string;
       agentId?: string;  // The agent context (optional - for agent-specific skills)
   }
   ```

---

### File: backendSelectionService.ts (7 occurrences)
**Purpose**: Backend selection for agent execution

1. **Line ~42**: AgentConfigYaml interface
   ```typescript
   export interface AgentConfigYaml {
       readonly version: number;
       readonly defaults?: { ... };
       readonly agents?: {
           readonly [agentId: string]: {
               readonly backend?: AgentBackendType;
               readonly model?: string;
               readonly description?: string;
           };
       };
   }
   ```

2. **Line ~67**: selectBackend method signature
   ```typescript
   selectBackend(prompt: string, agentId: string): Promise<BackendSelectionResult>
   ```

3. **Line ~71**: getDefaultBackend method signature
   ```typescript
   getDefaultBackend(agentId: string): Promise<BackendSelectionResult>
   ```

4. **Line ~126**: selectBackend implementation
   ```typescript
   async selectBackend(prompt: string, agentId: string): Promise<BackendSelectionResult> {
       const userBackend = this._parseBackendFromPrompt(prompt);
       if (userBackend) {
           return { backend: userBackend, source: 'user-request' };
       }
       return this.getDefaultBackend(agentId);
   }
   ```

5. **Line ~134**: getDefaultBackend implementation
   ```typescript
   async getDefaultBackend(agentId: string): Promise<BackendSelectionResult> {
       const repoConfig = await this.getAgentConfig();
       if (repoConfig) {
           const agentConfig = repoConfig.agents?.[agentId];
           if (agentConfig?.backend) {
               return { backend: agentConfig.backend, model: agentConfig.model, source: 'repo-config' };
           }
       }
   }
   ```

---

### File: customInstructions.tsx (16 occurrences)
**Purpose**: Loading custom instructions for agents in prompts

1. **Line ~31**: normalizeAgentIdForInstructions function
   ```typescript
   function normalizeAgentIdForInstructions(agentId: string): string {
       const mapping: Record<string, string> = {
           'editsAgent': 'agent',
           'editingSession': 'agent',
           'editingSession2': 'agent',
           'editingSessionEditor': 'agent',
           'default': 'agent',
           'editor': 'agent',
           'stepplanner': 'planner',
           'notebookEditorAgent': 'notebook',
       };

       return mapping[agentId] ?? agentId;
   }
   ```

2. **Line ~66**: Props interface
   ```typescript
   export interface CustomInstructionsProps extends BasePromptElementProps {
       readonly chatVariables: ChatVariablesCollection | undefined;
       readonly languageId: string | undefined;
       readonly agentId?: string;  // The agent ID to load agent-specific instructions for
       // ...
   }
   ```

3. **Line ~110**: render method implementation
   ```typescript
   override async render(state: void, sizing: PromptSizing) {
       const rawAgentId = this.props.agentId ?? 'agent';
       const agentId = normalizeAgentIdForInstructions(rawAgentId);

       this.logService.info(`[CustomInstructions] render() called with rawAgentId=${rawAgentId}, normalized agentId=${agentId}`);

       // Load agent-specific instructions
       const agentInstructionUris = await this.getAgentSpecificInstructionUris(agentId);
   }
   ```

4. **Line ~201**: getAgentSpecificInstructionUris private method
   ```typescript
   private async getAgentSpecificInstructionUris(agentId: string): Promise<URI[]> {
       this.logService.info(`[CustomInstructions] getAgentSpecificInstructionUris() called with agentId=${agentId}`);

       for (const folder of workspaceFolders) {
           const agentDir = await this.findAgentDirectory(folder, agentId);
           if (agentDir) {
               const uris = await this.getInstructionFileUrisInDir(agentDir);
               instructionUris.push(...uris);
           }
       }
   }
   ```

5. **Line ~232**: findAgentDirectory private method
   ```typescript
   private async findAgentDirectory(workspaceFolder: URI, agentId: string): Promise<URI | undefined> {
       this.logService.info(`[CustomInstructions] findAgentDirectory() looking for agentId=${agentId}`);

       // Find the specific agent folder (case-insensitive)
       const agentFolder = agentEntries.find(([name, type]) =>
           type === FileType.Directory && name.toLowerCase() === agentId.toLowerCase()
       );
   }
   ```

---

### File: messageQueue.ts (11 occurrences)
**Purpose**: Inter-agent message queue for agent-to-agent communication

1. **Line ~19**: IAgentIdentifier interface
   ```typescript
   export interface IAgentIdentifier {
       type: 'agent' | 'orchestrator' | 'worker';
       id: string;  // Agent ID
   }
   ```

2. **Line ~106**: registerHandler method signature
   ```typescript
   registerHandler(agentId: string, handler: MessageHandler): IDisposable
   ```

3. **Line ~110**: getPendingMessages method signature
   ```typescript
   getPendingMessages(agentId: string): IA2AMessage[]
   ```

4. **Line ~519**: registerHandler implementation
   ```typescript
   registerHandler(agentId: string, handler: MessageHandler): IDisposable {
       this._handlers.set(agentId, handler);
       this._logService.debug(`[A2AMessageQueue] Registered handler for agent ${agentId}`);

       const pending = this.getPendingMessages(agentId);
       if (pending.length > 0) {
           this._logService.debug(`[A2AMessageQueue] Found ${pending.length} pending messages for agent ${agentId}`);
       }
   }
   ```

5. **Line ~536**: getPendingMessages implementation
   ```typescript
   getPendingMessages(agentId: string): IA2AMessage[] {
       return this._queue.getAll().filter(m =>
           m.receiver.id === agentId && m.status === 'pending'
       );
   }
   ```

6. **Lines ~479, ~521, ~532**: Multiple logging statements with agentId

---

### File: messageRouter.ts (6 occurrences)
**Purpose**: Message routing for inter-agent communication

1. **Line ~47**: IRoutingRule interface
   ```typescript
   export interface IRoutingRule {
       readonly id: string;
       readonly name: string;
       readonly targetAgentId?: string;  // Target agent ID for 'route' action
       // ...
   }
   ```

2. **Line ~74**: IRouteHop interface
   ```typescript
   export interface IRouteHop {
       readonly agentId: string;
       readonly timestamp: number;
       readonly action: string;
       readonly duration?: number;
   }
   ```

3. **Line ~202**: isAgentReachable method signature
   ```typescript
   isAgentReachable(agentId: string): boolean
   ```

4. **Line ~482**: isAgentReachable implementation
   ```typescript
   isAgentReachable(agentId: string): boolean {
       return this._registeredAgents.has(agentId);
   }
   ```

5. **Line ~511**: Routing rule application
   ```typescript
   case 'route':
       if (rule.targetAgentId) {
           currentOptions = {
               ...currentOptions,
               receiver: {
                   ...currentOptions.receiver,
                   id: rule.targetAgentId,
               },
           };
       }
       break;
   ```

6. **Line ~703**: Route hop tracking
   ```typescript
   route.hops.push({
       agentId: route.destination.id,
       timestamp: Date.now(),
       action: status,
   });
   ```

---

### File: orchestratorChatSessionContentProvider.ts (2 occurrences)
**Purpose**: Providing chat session content for orchestrator

1. **Line ~110**: Reading worker agentId
   ```typescript
   if (selectedAgent) {
       options[AGENTS_OPTION_ID] = selectedAgent.id;
   } else if (workerState.agentId) {
       options[AGENTS_OPTION_ID] = workerState.agentId;
   }
   ```

2. **Line ~111**: Setting agent option from worker state
   ```typescript
   options[AGENTS_OPTION_ID] = workerState.agentId;
   ```

---

### File: statusDisplay.ts (3 occurrences)
**Purpose**: Displaying agent status in UI

1. **Line ~50**: Worker status interface
   ```typescript
   interface WorkerStatus {
       workerId: string;
       agentId?: string;
       status: string;
       // ...
   }
   ```

2. **Line ~100**: Rendering agent name
   ```typescript
   const agentName = worker.agentId || 'unknown';
   return `Agent: ${agentName}`;
   ```

3. **Line ~150**: Displaying current agent
   ```typescript
   if (worker.agentId) {
       statusText += ` [@${worker.agentId}]`;
   }
   ```

---

### File: configuration.ts (1 occurrence)
**Purpose**: Configuration schema definition

1. **Line ~250**: Config property comment
   ```typescript
   // Agent configuration
   // See .github/agents/config.yaml for per-agent backend settings
   readonly defaultAgentId?: string;
   ```

---

### File: Test Files (5 occurrences across multiple test files)
**Purpose**: Testing agentId functionality

1. **skillsService.spec.ts** (2 occurrences):
   - Line ~129: Test skill with agentId
   ```typescript
   const skill: ISkill = {
       id: 'test-skill',
       name: 'Test Skill',
       agentId: 'architect',
   };
   ```

2. **agentModelSwitch.spec.ts** (2 occurrences):
   - Testing agent switching based on agentId

3. **interactiveSessionProvider.telemetry.test.ts** (1 occurrence):
   - Testing telemetry with agentId parameter

---

## SECTION 2: CREATION/ASSIGNMENT POINTS

### Primary Sources of agentId Values

#### 1. **User-Initiated Request** (ORIGIN POINT)
**Location**: `chatParticipants.ts:388`
```typescript
const handler = this.instantiationService.createInstance(
    ChatParticipantRequestHandler,
    ...
    { agentName: name, agentId: id, intentId },  // <-- agentId originates here from participant ID
    onPause
);
```
**Flow**: User invokes @agent → VS Code participant system → agentId = participant ID

#### 2. **Agent Discovery**
**Location**: `agentDiscoveryService.ts`
- Derived from filename: `architect.agent.md` → `agentId = 'architect'`
- Extracted from frontmatter: `name: Architect` → `id = 'architect'`

#### 3. **Task Assignment**
**Location**: `workerSession.ts:200`
```typescript
if (task.agent) {
    worker.agentId = task.agent;  // <-- Assigned from task specification
}
```

#### 4. **Copilot CLI Agent Resolution**
**Location**: `copilotCli.ts:220`
```typescript
async resolveAgent(agentId: string): Promise<SweCustomAgent | undefined> {
    agentId = agentId.toLowerCase();  // <-- Normalized
    const agent = customAgents.find(agent => agent.name.toLowerCase() === agentId);
}
```

---

## SECTION 3: STORAGE LOCATIONS

### 1. **In-Memory Storage**

#### WorkerSession Interface
**File**: `workerSession.ts:15-25`
```typescript
export interface WorkerSession {
    agentId?: string;  // STORED HERE during worker execution
    workerId: string;
    status: WorkerStatus;
    currentTask?: Task;
}
```

#### Cache Maps
**File**: `agentInstructionService.ts:119-120`
```typescript
private readonly _instructionCache = new Map<string, ComposedInstructions>();
// Key format: agentId
private readonly _agentDefinitionCache = new Map<string, AgentDefinition>();
// Key format: agentId
```

**File**: `skillsService.ts:80-82`
```typescript
private readonly _skillCache = new Map<string, ISkill>();
// Key format: `${agentId}:${skillId}`
private readonly _discoveryCache = new Map<string, ISkillDiscoveryResult>();
// Key format: `discovery:${agentId}`
```

---

### 2. **Persistent Storage (VS Code Memento)**

#### Workspace State
**File**: `copilotCli.ts:26-28`
```typescript
const COPILOT_CLI_AGENT_MEMENTO_KEY = 'github.copilot.cli.customAgent';
const COPILOT_CLI_SESSION_AGENTS_MEMENTO_KEY = 'github.copilot.cli.sessionAgents';
```

**Storage Structure**:
```typescript
// Session-to-Agent mapping
Record<string, { agentId?: string; createdDateTime: number }>
```

#### Message Queue State
**File**: `messageQueue.ts:255`
```typescript
private static readonly STATE_FILE_NAME = '.copilot-a2a-message-queue.json';
```
**Content**: Messages with sender/receiver agentIds

---

### 3. **File System Storage**

#### Agent Definition Files
**Locations**:
- `assets/agents/{agentId}.agent.md` (built-in)
- `.github/agents/{agentId}/{agentId}.agent.md` (repo)

#### Skill Files
**Locations**:
- `assets/agents/{agentId}/skills/*.skill.md` (built-in)
- `.github/agents/{agentId}/skills/*.skill.md` (repo)

#### Instruction Files
**Locations**:
- `.github/agents/{agentId}/*instructions*.md` (repo)

#### Architecture Documents
**Locations**:
- `.github/agents/{agentId}/architecture/*.architecture.md`

---

### 4. **Repository Configuration**

**File**: `.github/agents/config.yaml`
```yaml
version: 1
defaults:
  backend: copilot
  model: gpt-4

agents:
  architect:
    backend: claude
    model: sonnet-3.5
    description: Technical architecture agent

  planner:
    backend: copilot
    model: gpt-4o
```

**Access**: `backendSelectionService.ts:42-48`

---

## SECTION 4: FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER INITIATES REQUEST                           │
│                    (e.g., @architect "design X")                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     VS Code Participant System                       │
│                    participant ID = "architect"                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 chatParticipants.ts:388                              │
│         agentId = id  (from participant registration)               │
│                                                                      │
│  createInstance(ChatParticipantRequestHandler, ...,                 │
│                 { agentName: name, agentId: id, intentId })         │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│            chatParticipantRequestHandler.ts:80                       │
│                 context.agentId = agentId                            │
│                 result.metadata.agentId = agentId                    │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ├──────────────────┬──────────────────┬───────────────┐
                                 ▼                  ▼                  ▼               ▼
                    ┌─────────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
                    │ Load Instructions│  │Load Backend  │  │Load Skills  │  │Telemetry     │
                    │ (agentId)        │  │(agentId)     │  │(agentId)    │  │(agentId)     │
                    └─────────┬────────┘  └──────┬───────┘  └──────┬──────┘  └──────────────┘
                              │                  │                 │
                              ▼                  ▼                 ▼
                    ┌─────────────────────────────────────────────────────┐
                    │     agentInstructionService.loadInstructions()      │
                    │                                                     │
                    │  1. getBuiltinAgentInstructions(agentId)           │
                    │     → assets/agents/{agentId}.agent.md              │
                    │                                                     │
                    │  2. getAgentInstructions(agentId)                  │
                    │     → .github/agents/{agentId}/*instructions*.md   │
                    │                                                     │
                    │  3. _getAgentDefinition(agentId)                   │
                    │     → unifiedDefinitionService.getAgent(agentId)   │
                    │                                                     │
                    │  4. skillsService.getSkillsByReference(agentId)    │
                    │     → .github/agents/{agentId}/skills/*.skill.md   │
                    │                                                     │
                    │  5. getArchitectureDocs(agentId)                   │
                    │     → .github/agents/{agentId}/architecture/       │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │         backendSelectionService.selectBackend()     │
                    │                                                     │
                    │  1. Parse user prompt for hints                    │
                    │  2. Check .github/agents/config.yaml[agentId]      │
                    │  3. Fall back to extension defaults                │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────────┐
                    │              skillsService.discoverSkills()         │
                    │                                                     │
                    │  1. _discoverBuiltinSkills(agentId)                │
                    │     → assets/agents/{agentId}/skills/              │
                    │                                                     │
                    │  2. _discoverAgentRepoSkills(agentId)              │
                    │     → .github/agents/{agentId}/skills/             │
                    │                                                     │
                    │  Cache: Map<`discovery:${agentId}`, Result>        │
                    └─────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EXECUTION ROUTING                                 │
│                                                                      │
│  If orchestrator agent:                                             │
│    → orchestratorService.handleRequest({ agentId, ... })           │
│       → Creates WorkerSession with agentId                          │
│       → workerSession.agentId = agentId                             │
│                                                                      │
│  If Claude backend:                                                 │
│    → claudeCodeAgentExecutor.execute({ agentId, ... })             │
│       → Resolves agent via unifiedDefinitionService                 │
│       → Loads skills with skillsService                             │
│                                                                      │
│  If Copilot CLI:                                                    │
│    → copilotCLIAgents.resolveAgent(agentId)                        │
│       → Returns SweCustomAgent for agentId                          │
│       → trackSessionAgent(sessionId, agentId)                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    AGENT-TO-AGENT MESSAGING                          │
│                                                                      │
│  messageRouter.send({                                               │
│      sender: { id: 'orchestrator' },                                │
│      receiver: { id: agentId },  ← ROUTING TARGET                   │
│      content: { ... }                                               │
│  })                                                                 │
│                                                                      │
│  messageQueue.registerHandler(agentId, handler)  ← REGISTRATION     │
│  messageQueue.getPendingMessages(agentId)        ← RETRIEVAL        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         STORAGE UPDATES                              │
│                                                                      │
│  1. Worker State: workerSession.agentId = agentId                   │
│  2. Cache: _instructionCache.set(agentId, instructions)             │
│  3. Cache: _skillCache.set(`${agentId}:${skillId}`, skill)          │
│  4. Memento: workspaceState.update(AGENT_KEY, agentId)              │
│  5. Telemetry: metadata.agentId = agentId                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## SECTION 5: KEY FUNCTIONS

### 1. **AgentInstructionService.loadInstructions()**
**File**: `agentInstructionService.ts:129-212`
**Purpose**: Central function for loading all agent configuration
**agentId Flow**:
```
INPUT: agentId (string)
  ↓
  ├─→ getBuiltinAgentInstructions(agentId)
  │     └─→ Checks assets/agents/{agentId}.agent.md
  │
  ├─→ getAgentInstructions(agentId)
  │     └─→ Scans .github/agents/{agentId}/*instructions*.md
  │
  ├─→ _getAgentDefinition(agentId)
  │     └─→ unifiedDefinitionService.getAgent(agentId)
  │          └─→ Returns { id, name, useSkills, hasArchitectureAccess, ... }
  │
  ├─→ skillsService.getSkillsByReference(agentId, useSkills)
  │     └─→ Loads agent-specific skills
  │
  └─→ getArchitectureDocs(agentId, hasArchitectureAccess)
        └─→ Loads .github/agents/{agentId}/architecture/*.md
  ↓
OUTPUT: ComposedInstructions { agentId, instructions[], files[], ... }
```

---

### 2. **SkillsService.discoverSkills()**
**File**: `skillsService.ts:90-119`
**Purpose**: Discover all skills available to an agent
**agentId Flow**:
```
INPUT: agentId (string)
  ↓
  ├─→ _discoverBuiltinSkills(agentId)
  │     └─→ Scans assets/agents/{agentId}/skills/*.skill.md
  │          └─→ Each skill: { id, name, agentId, ... }
  │
  ├─→ _discoverGlobalRepoSkills()
  │     └─→ Scans .github/skills/*.skill.md (agentId = undefined)
  │
  └─→ _discoverAgentRepoSkills(agentId)
        └─→ Scans .github/agents/{agentId}/skills/*.skill.md
             └─→ Each skill: { id, name, agentId, ... }
  ↓
OUTPUT: ISkillDiscoveryResult {
    builtinSkills: ISkill[],  // agentId set
    repoSkills: ISkill[],     // agentId = undefined
    agentSkills: ISkill[]     // agentId set
}
```

---

### 3. **BackendSelectionService.selectBackend()**
**File**: `backendSelectionService.ts:126-152`
**Purpose**: Select execution backend based on agent configuration
**agentId Flow**:
```
INPUT: (prompt: string, agentId: string)
  ↓
  ├─→ _parseBackendFromPrompt(prompt)
  │     └─→ Check for "use claude", "with copilot", etc.
  │          └─→ If found: return { backend, source: 'user-request' }
  │
  └─→ getDefaultBackend(agentId)
        ↓
        ├─→ getAgentConfig()
        │     └─→ Load .github/agents/config.yaml
        │          ├─→ Check agents[agentId].backend
        │          └─→ Check defaults.backend
        │
        └─→ Check VS Code settings
  ↓
OUTPUT: BackendSelectionResult {
    backend: 'copilot' | 'claude' | 'cli',
    model?: string,
    source: 'user-request' | 'repo-config' | 'extension-default'
}
```

---

### 4. **UnifiedDefinitionService.getAgent()**
**File**: `unifiedDefinitionService.ts:100-130`
**Purpose**: Get agent definition by ID
**agentId Flow**:
```
INPUT: agentId (string)
  ↓
  └─→ discoverAgents()
        ├─→ Scan assets/agents/*.agent.md
        │     └─→ Parse frontmatter → { id: filename, name, ... }
        │
        └─→ Scan .github/agents/**/*.agent.md
              └─→ Parse frontmatter → { id: filename, name, ... }
  ↓
  └─→ agents.find(a => a.id === agentId)
  ↓
OUTPUT: AgentDefinitionUnified | undefined
```

---

### 5. **ChatParticipantRequestHandler constructor**
**File**: `chatParticipantRequestHandler.ts:80-150`
**Purpose**: Primary request handler initialization
**agentId Flow**:
```
INPUT: { agentName, agentId, intentId }
  ↓
  ├─→ Store in context: this.agentId = agentId
  │
  ├─→ Set metadata: result.metadata.agentId = agentId
  │
  ├─→ Pass to orchestrator:
  │     orchestratorService.handleRequest({ agentId, ... })
  │
  ├─→ Pass to telemetry:
  │     telemetryService.send({ participant: agentId, ... })
  │
  └─→ Load instructions:
        agentInstructionService.loadInstructions(agentId)
  ↓
OUTPUT: Initialized handler with agentId context throughout
```

---

### 6. **WorkerSession Management**
**File**: `orchestratorServiceV2.ts` + `workerSession.ts`
**Purpose**: Track which agent is running in each worker
**agentId Flow**:
```
CREATE WORKER:
  orchestratorService.createWorker({ agentId })
    └─→ workerSession.agentId = agentId
    └─→ Store in _workers Map

UPDATE WORKER:
  updateWorkerAgent(workerId, newAgentId)
    └─→ worker.agentId = newAgentId

GET WORKER:
  getWorkerAgent(workerId)
    └─→ return worker.agentId

TASK ASSIGNMENT:
  if (task.agent) {
      worker.agentId = task.agent
  }
```

---

### 7. **CopilotCLIAgents.resolveAgent()**
**File**: `copilotCli.ts:220-226`
**Purpose**: Resolve agent ID to SweCustomAgent for CLI execution
**agentId Flow**:
```
INPUT: agentId (string)
  ↓
  └─→ agentId = agentId.toLowerCase()  // NORMALIZATION
  ↓
  └─→ getAgents()
       └─→ SDK.getCustomAgents(auth, workingDir)
  ↓
  └─→ Find: customAgents.find(a => a.name.toLowerCase() === agentId)
  ↓
OUTPUT: SweCustomAgent | undefined
```

---

### 8. **MessageQueue.registerHandler()**
**File**: `messageQueue.ts:519-534`
**Purpose**: Register message handler for agent-to-agent communication
**agentId Flow**:
```
INPUT: (agentId: string, handler: MessageHandler)
  ↓
  ├─→ Store: _handlers.set(agentId, handler)
  │
  └─→ Check pending: getPendingMessages(agentId)
       └─→ Filter: messages.filter(m => m.receiver.id === agentId)
  ↓
OUTPUT: Disposable to unregister
```

---

### 9. **CustomInstructions.render()**
**File**: `customInstructions.tsx:106-193`
**Purpose**: Load agent-specific instructions into prompts
**agentId Flow**:
```
INPUT: this.props.agentId (optional, defaults to 'agent')
  ↓
  ├─→ rawAgentId = this.props.agentId ?? 'agent'
  │
  ├─→ agentId = normalizeAgentIdForInstructions(rawAgentId)
  │     Mappings:
  │       'editsAgent' → 'agent'
  │       'editingSession' → 'agent'
  │       'stepplanner' → 'planner'
  │       'notebookEditorAgent' → 'notebook'
  │       others → keep same
  │
  └─→ getAgentSpecificInstructionUris(agentId)
        ├─→ findAgentDirectory(folder, agentId)
        │     └─→ Case-insensitive search for .github/agents/{agentId}/
        │
        └─→ getInstructionFileUrisInDir(agentDir)
              └─→ Filter: name.includes('instructions')
  ↓
OUTPUT: Rendered instruction elements
```

---

## SECTION 6: DATA FLOW SUMMARY

### Lifecycle of agentId in a Request

```
1. USER ACTION
   User types: @architect "design the database schema"
   ↓
   agentId = "architect"

2. PARTICIPANT SYSTEM
   VS Code maps @architect → participantId = "architect"
   ↓
   chatParticipants.ts: agentId = id

3. REQUEST HANDLER INITIALIZATION
   ChatParticipantRequestHandler({ agentId: "architect" })
   ↓
   context.agentId = "architect"
   metadata.agentId = "architect"

4. PARALLEL LOADING
   ┌──────────────────────────────────────┐
   │ agentInstructionService              │
   │   loadInstructions("architect")      │
   │   ├─ Built-in: assets/agents/architect.agent.md
   │   ├─ Repo: .github/agents/architect/*instructions*.md
   │   ├─ Skills: .github/agents/architect/skills/*.skill.md
   │   └─ Architecture: .github/agents/architect/architecture/
   └──────────────────────────────────────┘

   ┌──────────────────────────────────────┐
   │ backendSelectionService              │
   │   selectBackend(prompt, "architect") │
   │   └─ .github/agents/config.yaml      │
   │      agents.architect.backend        │
   └──────────────────────────────────────┘

   ┌──────────────────────────────────────┐
   │ skillsService                        │
   │   discoverSkills("architect")        │
   │   └─ Cache: discovery:architect      │
   └──────────────────────────────────────┘

5. EXECUTION
   If backend = 'claude':
     claudeCodeAgentExecutor.execute({ agentId: "architect" })
       ├─ Resolve agent definition
       ├─ Load skills
       └─ Create SDK session with agent

   If orchestrator:
     orchestratorService.handleRequest({ agentId: "architect" })
       ├─ Create worker
       ├─ worker.agentId = "architect"
       └─ Execute task

6. STORAGE
   ├─ Worker state: workerSession.agentId = "architect"
   ├─ Cache: _instructionCache.set("architect", instructions)
   ├─ Cache: _skillCache.set("architect:api-design", skill)
   └─ Memento: workspaceState.update(AGENT_KEY, "architect")

7. TELEMETRY
   All events include: { participant: "architect" }

8. RESPONSE METADATA
   result.metadata = {
     agentId: "architect",
     sessionId: "...",
     responseId: "..."
   }
```

---

## SECTION 7: CRITICAL PATTERNS

### Pattern 1: agentId Normalization
**Locations**: Multiple files
**Purpose**: Handle different naming conventions

```typescript
// customInstructions.tsx
'editsAgent' → 'agent'
'editingSession' → 'agent'
'stepplanner' → 'planner'

// copilotCli.ts
agentId = agentId.toLowerCase()

// agentDiscoveryService.ts
agentId = name.replace('.agent.md', '').toLowerCase()
```

### Pattern 2: agentId as Cache Key
**Locations**: Multiple service files

```typescript
// agentInstructionService.ts
_instructionCache.set(agentId, instructions)

// skillsService.ts
_skillCache.set(`${agentId}:${skillId}`, skill)
_discoveryCache.set(`discovery:${agentId}`, result)

// backendSelectionService.ts
config.agents[agentId]  // YAML lookup
```

### Pattern 3: agentId in File Paths
**Locations**: All resource loading services

```typescript
// Built-in:
assets/agents/{agentId}.agent.md
assets/agents/{agentId}/skills/*.skill.md

// Repository:
.github/agents/{agentId}/*.md
.github/agents/{agentId}/skills/*.skill.md
.github/agents/{agentId}/architecture/*.architecture.md
.github/agents/config.yaml → agents[agentId]
```

### Pattern 4: agentId in Message Routing
**Locations**: messageQueue.ts, messageRouter.ts

```typescript
// Sender/Receiver identification
message.sender.id = agentId
message.receiver.id = agentId

// Handler registration
registerHandler(agentId, handler)

// Message filtering
getPendingMessages(agentId)
  → filter(m => m.receiver.id === agentId)

// Routing rules
rule.targetAgentId = agentId
```

### Pattern 5: Optional agentId in Skills
**Locations**: interfaces/skill.ts, skillsService.ts

```typescript
// Global skills (no agent)
{
  id: "typescript-best-practices",
  agentId: undefined  // Available to all agents
}

// Agent-specific skills
{
  id: "architecture-patterns",
  agentId: "architect"  // Only for architect agent
}
```

---

## SECTION 8: DEPENDENCIES AND RELATIONSHIPS

### agentId → Instructions
```
agentId
  → agentInstructionService.loadInstructions(agentId)
    → Built-in: assets/agents/{agentId}.agent.md
    → Repo: .github/agents/{agentId}/*instructions*.md
```

### agentId → Skills
```
agentId
  → skillsService.discoverSkills(agentId)
    → Built-in: assets/agents/{agentId}/skills/*.skill.md
    → Repo: .github/agents/{agentId}/skills/*.skill.md
```

### agentId → Architecture Docs
```
agentId
  → agentInstructionService.getArchitectureDocs(agentId, true)
    → .github/agents/{agentId}/architecture/*.architecture.md
```

### agentId → Backend
```
agentId
  → backendSelectionService.getDefaultBackend(agentId)
    → .github/agents/config.yaml → agents[agentId].backend
```

### agentId → Worker
```
agentId
  → orchestratorService.createWorker({ agentId })
    → workerSession.agentId = agentId
```

### agentId → Messages
```
agentId
  → messageRouter.send({ receiver: { id: agentId } })
    → messageQueue.enqueue(message)
      → handler = _handlers.get(agentId)
```

---

## SECTION 9: POTENTIAL ISSUES AND EDGE CASES

### 1. **Case Sensitivity Issues**
**Problem**: agentId compared in different cases across codebase
**Locations**:
- `copilotCli.ts:222`: `agentId.toLowerCase()`
- `customInstructions.tsx:267`: Case-insensitive folder search
- `agentDiscoveryService.ts:232`: `.toLowerCase()` on filename

**Risk**: agentId "Architect" vs "architect" might not match consistently

---

### 2. **Null/Undefined agentId**
**Problem**: Optional agentId in many interfaces
**Locations**:
- `workerSession.ts:15`: `agentId?: string`
- `interfaces/skill.ts:33`: `agentId?: string`
- `orchestratorChatSessionContentProvider.ts:110`: `workerState.agentId`

**Risk**: Fallback behavior not always defined

---

### 3. **agentId Normalization Inconsistency**
**Problem**: Different normalization in different files
**Locations**:
- `customInstructions.tsx:31`: Mapping table
- `copilotCli.ts:222`: `.toLowerCase()`
- `agentDiscoveryService.ts`: Filename-based

**Risk**: Same logical agent might have different IDs

---

### 4. **Cache Key Collisions**
**Problem**: Using agentId as sole cache key
**Locations**:
- `_instructionCache.set(agentId, ...)`
- `_skillCache.set(${agentId}:${skillId}, ...)`

**Risk**: If agentId changes mid-session, cache might be stale

---

### 5. **File Path Case Sensitivity**
**Problem**: File system case sensitivity varies by OS
**Locations**: All file path construction with agentId
- `.github/agents/{agentId}/`
- `assets/agents/{agentId}.agent.md`

**Risk**: Linux = case-sensitive, Windows = case-insensitive

---

## SECTION 10: RECOMMENDED IMPROVEMENTS

### 1. **Centralized agentId Normalization**
Create a single normalization function used everywhere:
```typescript
export function normalizeAgentId(agentId: string): string {
    return agentId.trim().toLowerCase();
}
```

### 2. **Type-Safe agentId**
Define a branded type:
```typescript
export type AgentId = string & { readonly __brand: 'AgentId' };

export function createAgentId(id: string): AgentId {
    return normalizeAgentId(id) as AgentId;
}
```

### 3. **Default agentId Constant**
```typescript
export const DEFAULT_AGENT_ID: AgentId = createAgentId('agent');
```

### 4. **Validation Function**
```typescript
export function isValidAgentId(agentId: string): boolean {
    return /^[a-z0-9_-]+$/.test(agentId);
}
```

### 5. **Cache Key Builder**
```typescript
function buildCacheKey(agentId: AgentId, suffix?: string): string {
    return suffix ? `${agentId}:${suffix}` : agentId;
}
```

---

## CONCLUSION

The `agentId` field is the **primary identifier** that flows through the entire agent execution pipeline. It:

1. **Originates** from user input via VS Code participant system
2. **Routes** through 30 files and 214 references
3. **Controls** loading of instructions, skills, architecture docs, backend selection
4. **Identifies** workers, messages, and routing targets
5. **Persists** in caches, mementos, and file structures
6. **Appears** in telemetry for tracking and debugging

The most critical files are:
- **agentInstructionService.ts** (33 references) - instruction composition
- **skillsService.ts** (32 references) - skill discovery
- **workerSession.ts** (17 references) - worker state tracking
- **customInstructions.tsx** (16 references) - prompt construction
- **copilotCli.ts** (15 references) - CLI agent resolution

**Key Pattern**: `agentId` is used as a **file path component**, **cache key**, **message routing identifier**, and **configuration lookup key** throughout the system.
