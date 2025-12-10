/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { IChatEndpoint } from '../../platform/networking/common/networking';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { createServiceIdentifier } from '../../util/common/services';
import { CancellationToken } from '../../util/vs/base/common/cancellation';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { extUriBiasedIgnorePathCase, relativePath } from '../../util/vs/base/common/resources';
import { URI } from '../../util/vs/base/common/uri';
import { IInstantiationService } from '../../util/vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from '../../util/vs/platform/instantiation/common/serviceCollection';
import { getContributedToolName, getToolName, mapContributedToolNamesInSchema, mapContributedToolNamesInString, ToolName } from '../tools/common/toolNames';
import { ICopilotTool, ICopilotToolExtension, ToolRegistry } from '../tools/common/toolsRegistry';
import { IToolsService, IToolValidationResult } from '../tools/common/toolsService';

export const IWorkerToolsService = createServiceIdentifier<IWorkerToolsService>('IWorkerToolsService');

/**
 * Context information about the current worker execution.
 * This is available to tools running within a worker's scoped instantiation service.
 */
export const IWorkerContext = createServiceIdentifier<IWorkerContext>('IWorkerContext');

export interface IWorkerContext {
	readonly _serviceBrand: undefined;
	/** The worker's unique ID */
	readonly workerId: string;
	/** Path to the worker's worktree */
	readonly worktreePath: string;
	/** The plan ID if this worker is part of a plan */
	readonly planId?: string;
	/** The task ID if this worker is executing a specific task */
	readonly taskId?: string;
	/** The current depth level (0=main task, 1=sub-task, etc.) */
	readonly depth: number;
}

/**
 * Implementation of worker context.
 */
class WorkerContextImpl implements IWorkerContext {
	readonly _serviceBrand: undefined;

	constructor(
		readonly workerId: string,
		readonly worktreePath: string,
		readonly planId?: string,
		readonly taskId?: string,
		readonly depth: number = 0,
	) { }
}

/**
 * Service for managing per-worker tool sets.
 * Each worker gets its own set of tools scoped to its worktree.
 */
export interface IWorkerToolsService {
	readonly _serviceBrand: undefined;

	/**
	 * Create a new tool set for a worker.
	 * @param workerId Unique identifier for the worker
	 * @param worktreePath Path to the worktree folder for this worker
	 * @param planId Optional plan ID if this worker is part of a plan
	 * @param taskId Optional task ID if this worker is executing a specific task
	 * @param depth The depth level (0=main task, 1=sub-task, etc.)
	 * @returns The created WorkerToolSet
	 */
	createWorkerToolSet(workerId: string, worktreePath: string, planId?: string, taskId?: string, depth?: number): WorkerToolSet;

	/**
	 * Get an existing tool set for a worker.
	 * @param workerId The worker's ID
	 * @returns The WorkerToolSet if it exists, undefined otherwise
	 */
	getWorkerToolSet(workerId: string): WorkerToolSet | undefined;

	/**
	 * Dispose and remove a worker's tool set.
	 * @param workerId The worker's ID
	 */
	disposeWorkerToolSet(workerId: string): void;

	/**
	 * Check if a file path is within any active worker's worktree.
	 * This is used to allow file operations in worktrees that are not
	 * part of the main VS Code workspace folders.
	 * @param filePath The file path to check (can be string or URI)
	 * @returns The worktree path if the file is within one, undefined otherwise
	 */
	getWorktreeForPath(filePath: string | URI): string | undefined;

	/**
	 * Get all active worktree paths.
	 * @returns Array of worktree paths from active workers
	 */
	getActiveWorktrees(): string[];

	/**
	 * Event fired when a worker tool set is created.
	 */
	onDidCreateToolSet: Event<{ workerId: string; toolSet: WorkerToolSet }>;

	/**
	 * Event fired when a worker tool set is disposed.
	 */
	onDidDisposeToolSet: Event<{ workerId: string }>;
}

/**
 * A scoped workspace service that restricts the workspace to a specific folder (e.g., a worktree).
 * This ensures that tools and services see only the scoped folder as the workspace,
 * applying the same access restrictions as if VS Code was opened directly on that folder.
 */
class ScopedWorkspaceService implements IWorkspaceService {
	readonly _serviceBrand: undefined;

	private readonly _scopedFolderUri: URI;

	constructor(
		private readonly _delegate: IWorkspaceService,
		scopedFolderPath: string
	) {
		this._scopedFolderUri = URI.file(scopedFolderPath);
	}

	// Delegate event properties
	get textDocuments() { return this._delegate.textDocuments; }
	get notebookDocuments() { return this._delegate.notebookDocuments; }
	get onDidOpenTextDocument() { return this._delegate.onDidOpenTextDocument; }
	get onDidCloseTextDocument() { return this._delegate.onDidCloseTextDocument; }
	get onDidOpenNotebookDocument() { return this._delegate.onDidOpenNotebookDocument; }
	get onDidCloseNotebookDocument() { return this._delegate.onDidCloseNotebookDocument; }
	get onDidChangeTextDocument() { return this._delegate.onDidChangeTextDocument; }
	get onDidChangeNotebookDocument() { return this._delegate.onDidChangeNotebookDocument; }
	get onDidChangeWorkspaceFolders() { return this._delegate.onDidChangeWorkspaceFolders; }
	get onDidChangeTextEditorSelection() { return this._delegate.onDidChangeTextEditorSelection; }
	get fs() { return this._delegate.fs; }

	// Delegate methods that don't need scoping
	openTextDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
		return this._delegate.openTextDocument(uri);
	}

	showTextDocument(document: vscode.TextDocument): Promise<void> {
		return this._delegate.showTextDocument(document);
	}

	openTextDocumentAndSnapshot(uri: vscode.Uri): Promise<any> {
		return this._delegate.openTextDocumentAndSnapshot(uri);
	}

	openNotebookDocumentAndSnapshot(uri: vscode.Uri, format: 'xml' | 'json' | 'text'): Promise<any> {
		return this._delegate.openNotebookDocumentAndSnapshot(uri, format);
	}

	openNotebookDocument(arg1: vscode.Uri | string, arg2?: vscode.NotebookData): Promise<vscode.NotebookDocument> {
		if (typeof arg1 === 'string') {
			return this._delegate.openNotebookDocument(arg1, arg2);
		}
		return this._delegate.openNotebookDocument(arg1);
	}

	applyEdit(edit: vscode.WorkspaceEdit): Thenable<boolean> {
		return this._delegate.applyEdit(edit);
	}

	ensureWorkspaceIsFullyLoaded(): Promise<void> {
		return this._delegate.ensureWorkspaceIsFullyLoaded();
	}

	showWorkspaceFolderPicker(): Promise<vscode.WorkspaceFolder | undefined> {
		return Promise.resolve({
			uri: this._scopedFolderUri,
			name: this._scopedFolderUri.fsPath.split(/[/\\]/).pop() || 'Worktree',
			index: 0,
		});
	}

	// SCOPED METHODS - These are the key overrides that restrict workspace access

	getWorkspaceFolders(): URI[] {
		return [this._scopedFolderUri];
	}

	getWorkspaceFolder(resource: URI): URI | undefined {
		if (extUriBiasedIgnorePathCase.isEqualOrParent(resource, this._scopedFolderUri)) {
			return this._scopedFolderUri;
		}
		return undefined;
	}

	getWorkspaceFolderName(workspaceFolderUri: URI): string {
		if (extUriBiasedIgnorePathCase.isEqual(workspaceFolderUri, this._scopedFolderUri)) {
			return this._scopedFolderUri.fsPath.split(/[/\\]/).pop() || 'Worktree';
		}
		return '';
	}

	asRelativePath(pathOrUri: string | vscode.Uri, includeWorkspaceFolder?: boolean): string {
		let resource: URI | undefined;
		let path: string = '';

		if (typeof pathOrUri === 'string') {
			resource = URI.file(pathOrUri);
			path = pathOrUri;
		} else if (pathOrUri) {
			resource = pathOrUri;
			path = pathOrUri.fsPath;
		}

		if (!resource) {
			return path;
		}

		const rel = relativePath(this._scopedFolderUri, resource);
		if (rel !== undefined) {
			if (includeWorkspaceFolder) {
				const folderName = this._scopedFolderUri.fsPath.split(/[/\\]/).pop() || 'Worktree';
				return `${folderName}/${rel}`;
			}
			return rel;
		}

		return path;
	}
}

/**
 * A set of tools scoped to a specific worker and its worktree.
 * Provides tool management capabilities including enabling/disabling tools
 * and future MCP connection management.
 */
export class WorkerToolSet extends Disposable implements IToolsService {
	readonly _serviceBrand: undefined;

	private readonly _scopedInstantiationService: IInstantiationService;
	private readonly _copilotTools: Map<ToolName, ICopilotTool<any>>;
	private readonly _toolExtensions: Map<ToolName, ICopilotToolExtension<any>>;
	private readonly _enabledTools: Set<ToolName>;
	private readonly _disabledTools: Set<ToolName>;
	private readonly _workerContext: IWorkerContext;

	private readonly _onWillInvokeTool = this._register(new Emitter<{ toolName: string }>());
	public readonly onWillInvokeTool = this._onWillInvokeTool.event;

	private readonly _onDidChangeEnabledTools = this._register(new Emitter<void>());
	public readonly onDidChangeEnabledTools = this._onDidChangeEnabledTools.event;

	private readonly _contributedToolCache: {
		input: readonly vscode.LanguageModelToolInformation[];
		output: readonly vscode.LanguageModelToolInformation[];
	} = { input: [], output: [] };

	constructor(
		public readonly workerId: string,
		public readonly worktreePath: string,
		parentInstantiationService: IInstantiationService,
		planId: string | undefined,
		taskId: string | undefined,
		depth: number,
		@IWorkspaceService workspaceService: IWorkspaceService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Create scoped workspace service for this worktree
		const scopedWorkspaceService = new ScopedWorkspaceService(workspaceService, worktreePath);

		// Create worker context for this worker
		this._workerContext = new WorkerContextImpl(workerId, worktreePath, planId, taskId, depth);

		// Create child instantiation service with scoped workspace and worker context
		this._scopedInstantiationService = parentInstantiationService.createChild(
			new ServiceCollection(
				[IWorkspaceService, scopedWorkspaceService],
				[IWorkerContext, this._workerContext]
			)
		);

		// Initialize tool collections
		this._copilotTools = new Map();
		this._toolExtensions = new Map();
		this._enabledTools = new Set();
		this._disabledTools = new Set();

		// Create tool instances with the scoped instantiation service
		this._initializeTools();

		this._logService.debug(`[WorkerToolSet] Created tool set for worker ${workerId} at ${worktreePath}`);
	}

	private _initializeTools(): void {
		// Create all registered tools with the scoped instantiation service
		for (const toolCtor of ToolRegistry.getTools()) {
			try {
				const tool = this._scopedInstantiationService.createInstance(toolCtor);
				this._copilotTools.set(toolCtor.toolName, tool);
			} catch (e) {
				this._logService.error(`[WorkerToolSet] Failed to create tool ${toolCtor.toolName}:`, e);
			}
		}

		// Create tool extensions
		for (const extCtor of ToolRegistry.getToolExtensions()) {
			try {
				const ext = this._scopedInstantiationService.createInstance(extCtor);
				this._toolExtensions.set(extCtor.toolName, ext);
			} catch (e) {
				this._logService.error(`[WorkerToolSet] Failed to create tool extension ${extCtor.toolName}:`, e);
			}
		}
	}

	/**
	 * Get the scoped instantiation service for this worker.
	 * Use this when creating services that need to be scoped to the worker's worktree.
	 */
	get scopedInstantiationService(): IInstantiationService {
		return this._scopedInstantiationService;
	}

	/**
	 * Get the worker context for this tool set.
	 */
	get workerContext(): IWorkerContext {
		return this._workerContext;
	}

	/**
	 * Get all available tools (from vscode.lm.tools), with worker-specific modifications applied.
	 */
	get tools(): ReadonlyArray<vscode.LanguageModelToolInformation> {
		const arraysEqual = (a: readonly vscode.LanguageModelToolInformation[], b: readonly vscode.LanguageModelToolInformation[]) => {
			if (a.length !== b.length) { return false; }
			for (let i = 0; i < a.length; i++) {
				if (a[i] !== b[i]) { return false; }
			}
			return true;
		};

		if (arraysEqual(this._contributedToolCache.input, vscode.lm.tools)) {
			return this._contributedToolCache.output;
		}

		const input = [...vscode.lm.tools];
		const contributedTools = [...input]
			.sort((a, b) => {
				const aIsBuiltin = a.name.startsWith('vscode_') || a.name.startsWith('copilot_');
				const bIsBuiltin = b.name.startsWith('vscode_') || b.name.startsWith('copilot_');
				if (aIsBuiltin && bIsBuiltin) {
					return a.name.localeCompare(b.name);
				} else if (!aIsBuiltin && !bIsBuiltin) {
					return a.name.localeCompare(b.name);
				}
				return aIsBuiltin ? -1 : 1;
			})
			.map(tool => {
				const owned = this._copilotTools.get(getToolName(tool.name) as ToolName);
				return owned?.alternativeDefinition?.(tool) ?? tool;
			});

		const result: vscode.LanguageModelToolInformation[] = contributedTools.map(tool => {
			return {
				...tool,
				name: getToolName(tool.name),
				description: mapContributedToolNamesInString(tool.description),
				inputSchema: tool.inputSchema && mapContributedToolNamesInSchema(tool.inputSchema),
			};
		});

		this._contributedToolCache.input = input;
		this._contributedToolCache.output = result;

		return result;
	}

	get copilotTools(): ReadonlyMap<ToolName, ICopilotTool<any>> {
		return this._copilotTools;
	}

	getCopilotTool(name: string): ICopilotTool<any> | undefined {
		return this._copilotTools.get(name as ToolName);
	}

	getTool(name: string): vscode.LanguageModelToolInformation | undefined {
		return this.tools.find(tool => tool.name === name);
	}

	getToolByToolReferenceName(name: string): vscode.LanguageModelToolInformation | undefined {
		throw new Error('getToolByToolReferenceName is for tests only');
	}

	invokeTool(name: string | ToolName, options: vscode.LanguageModelToolInvocationOptions<Object>, token: CancellationToken): Thenable<vscode.LanguageModelToolResult | vscode.LanguageModelToolResult2> {
		this._onWillInvokeTool.fire({ toolName: name as string });
		return vscode.lm.invokeTool(getContributedToolName(name), options, token);
	}

	// From BaseToolsService - validation methods
	validateToolInput(name: string, input: string): IToolValidationResult {
		// Simplified validation - full implementation would use ajv like BaseToolsService
		const tool = this.tools.find(t => t.name === name);
		if (!tool) {
			return { error: `ERROR: The tool "${name}" does not exist` };
		}
		try {
			const inputObj = JSON.parse(input) ?? {};
			return { inputObj };
		} catch (err) {
			return { error: `ERROR: Your input to the tool was invalid (${err})` };
		}
	}

	validateToolName(name: string): string | undefined {
		const tool = this.tools.find(t => t.name === name);
		if (!tool) {
			return name.replace(/[^\w-]/g, '_');
		}
		return undefined;
	}

	/**
	 * Get tools that should be enabled for the given request.
	 */
	getEnabledTools(
		request: vscode.ChatRequest,
		endpoint: IChatEndpoint,
		filter?: (tool: vscode.LanguageModelToolInformation) => boolean | undefined
	): vscode.LanguageModelToolInformation[] {
		const toolMap = new Map(this.tools.map(t => [t.name, t]));

		return this.tools
			.map(tool => {
				const owned = this._copilotTools.get(getToolName(tool.name) as ToolName);
				let resultTool = tool;
				if (owned?.alternativeDefinition) {
					resultTool = owned.alternativeDefinition(resultTool, endpoint);
				}

				const extension = this._toolExtensions.get(getToolName(tool.name) as ToolName);
				if (extension?.alternativeDefinition) {
					resultTool = extension.alternativeDefinition(resultTool, endpoint);
				}

				return resultTool;
			})
			.filter(tool => {
				const toolName = getToolName(tool.name) as ToolName;

				// Check if explicitly disabled for this worker
				if (this._disabledTools.has(toolName)) {
					return false;
				}

				// Check tool picker selection from request
				const toolPickerSelection = request.tools.get(getContributedToolName(tool.name));
				if (toolPickerSelection === false) {
					return false;
				}

				// Check consumer filter
				const explicit = filter?.(tool);
				if (explicit !== undefined) {
					return explicit;
				}

				// Check if explicitly enabled for this worker
				if (this._enabledTools.has(toolName)) {
					return true;
				}

				// Check for enable_other_tool tags
				for (const ref of request.toolReferences) {
					const usedTool = toolMap.get(ref.name);
					if (usedTool?.tags.includes(`enable_other_tool_${tool.name}`)) {
						return true;
					}
				}

				// Extension-installed tools
				if (toolPickerSelection === undefined && tool.tags.includes('extension_installed_by_tool')) {
					return true;
				}

				if (toolPickerSelection === true) {
					return true;
				}

				return false;
			});
	}

	// --- Worker-specific tool management ---

	/**
	 * Enable a specific tool for this worker.
	 */
	enableTool(toolName: ToolName): void {
		this._disabledTools.delete(toolName);
		this._enabledTools.add(toolName);
		this._onDidChangeEnabledTools.fire();
		this._logService.debug(`[WorkerToolSet] Enabled tool ${toolName} for worker ${this.workerId}`);
	}

	/**
	 * Disable a specific tool for this worker.
	 */
	disableTool(toolName: ToolName): void {
		this._enabledTools.delete(toolName);
		this._disabledTools.add(toolName);
		this._onDidChangeEnabledTools.fire();
		this._logService.debug(`[WorkerToolSet] Disabled tool ${toolName} for worker ${this.workerId}`);
	}

	/**
	 * Check if a tool is enabled for this worker.
	 */
	isToolEnabled(toolName: ToolName): boolean {
		if (this._disabledTools.has(toolName)) {
			return false;
		}
		// If not explicitly disabled, it's enabled by default
		return true;
	}

	/**
	 * Get list of explicitly enabled tools.
	 */
	getExplicitlyEnabledTools(): ToolName[] {
		return Array.from(this._enabledTools);
	}

	/**
	 * Get list of explicitly disabled tools.
	 */
	getExplicitlyDisabledTools(): ToolName[] {
		return Array.from(this._disabledTools);
	}

	/**
	 * Reset tool enabling/disabling to defaults.
	 */
	resetToolState(): void {
		this._enabledTools.clear();
		this._disabledTools.clear();
		this._onDidChangeEnabledTools.fire();
		this._logService.debug(`[WorkerToolSet] Reset tool state for worker ${this.workerId}`);
	}

	// --- Future: MCP Connection Management ---
	// TODO: Add methods for managing MCP connections per worker
	// addMCPConnection(config: MCPConfig): Promise<void>
	// removeMCPConnection(connectionId: string): void
	// getMCPConnections(): MCPConnection[]
}

/**
 * Implementation of the worker tools service.
 */
export class WorkerToolsService extends Disposable implements IWorkerToolsService {
	readonly _serviceBrand: undefined;

	private readonly _workerToolSets = new Map<string, WorkerToolSet>();

	private readonly _onDidCreateToolSet = this._register(new Emitter<{ workerId: string; toolSet: WorkerToolSet }>());
	public readonly onDidCreateToolSet = this._onDidCreateToolSet.event;

	private readonly _onDidDisposeToolSet = this._register(new Emitter<{ workerId: string }>());
	public readonly onDidDisposeToolSet = this._onDidDisposeToolSet.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	createWorkerToolSet(workerId: string, worktreePath: string, planId?: string, taskId?: string, depth: number = 0): WorkerToolSet {
		// Dispose existing tool set if present
		this.disposeWorkerToolSet(workerId);

		// Create new tool set with context
		const toolSet = new WorkerToolSet(
			workerId,
			worktreePath,
			this._instantiationService,
			planId,
			taskId,
			depth,
			this._workspaceService,
			this._logService,
		);

		this._workerToolSets.set(workerId, toolSet);
		this._onDidCreateToolSet.fire({ workerId, toolSet });

		this._logService.debug(`[WorkerToolsService] Created tool set for worker ${workerId} (plan: ${planId}, task: ${taskId}, depth: ${depth})`);

		return toolSet;
	}

	getWorkerToolSet(workerId: string): WorkerToolSet | undefined {
		return this._workerToolSets.get(workerId);
	}

	disposeWorkerToolSet(workerId: string): void {
		const toolSet = this._workerToolSets.get(workerId);
		if (toolSet) {
			toolSet.dispose();
			this._workerToolSets.delete(workerId);
			this._onDidDisposeToolSet.fire({ workerId });
			this._logService.debug(`[WorkerToolsService] Disposed tool set for worker ${workerId}`);
		}
	}

	getWorktreeForPath(filePath: string | URI): string | undefined {
		const filePathStr = typeof filePath === 'string' ? filePath : filePath.fsPath;
		const normalizedFilePath = filePathStr.toLowerCase().replace(/\\/g, '/');

		this._logService.info(`[WorkerToolsService] getWorktreeForPath: ${normalizedFilePath}`);
		this._logService.info(`[WorkerToolsService] Active worktrees (${this._workerToolSets.size}): ${this.getActiveWorktrees().join(', ')}`);

		for (const [workerId, toolSet] of this._workerToolSets) {
			const normalizedWorktree = toolSet.worktreePath.toLowerCase().replace(/\\/g, '/');
			this._logService.info(`[WorkerToolsService] Comparing against worktree[${workerId}]: ${normalizedWorktree}`);

			if (normalizedFilePath.startsWith(normalizedWorktree + '/') || normalizedFilePath === normalizedWorktree) {
				this._logService.info(`[WorkerToolsService] Match found! Path is in worktree: ${toolSet.worktreePath}`);
				return toolSet.worktreePath;
			}
		}

		this._logService.info(`[WorkerToolsService] No matching worktree found for path`);
		return undefined;
	}

	getActiveWorktrees(): string[] {
		return Array.from(this._workerToolSets.values()).map(ts => ts.worktreePath);
	}

	override dispose(): void {
		// Dispose all tool sets
		for (const [workerId] of this._workerToolSets) {
			this.disposeWorkerToolSet(workerId);
		}
		super.dispose();
	}
}
