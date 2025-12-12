/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { DisposableStore } from '../../../util/vs/base/common/lifecycle';
import { IPermissionRequest, OrchestratorPermissionService } from '../orchestratorPermissions';
import { OrchestratorQueueService } from '../orchestratorQueue';
import { OrchestratorService } from '../orchestratorServiceV2';
import { SubTaskManager } from '../subTaskManager';

// Mock fs
vi.mock('fs', () => ({
	writeFileSync: vi.fn(),
	readFileSync: vi.fn().mockReturnValue('{}'),
	existsSync: vi.fn().mockReturnValue(false),
	mkdirSync: vi.fn(),
	rmSync: vi.fn(),
}));

// Mock vscode
vi.mock('vscode', () => {
	return {
		workspace: {
			onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
			getConfiguration: vi.fn(),
			workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
		},
		window: {
			showInformationMessage: vi.fn(),
		},
		Uri: {
			file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => `file://${path}` }),
			joinPath: (uri: any, ...pathSegments: string[]) => ({ fsPath: `${uri.fsPath}/${pathSegments.join('/')}`, scheme: 'file' }),
		},
		lm: {
			selectChatModels: vi.fn().mockResolvedValue([]),
		},
		l10n: { t: (s: string) => s },
		Position: class { constructor(public line: number, public character: number) { } },
		Range: class { constructor(public start: any, public end: any) { } },
		Selection: class { constructor(public anchor: any, public active: any) { } },
		EventEmitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn(); },
		CancellationTokenSource: class { token = { isCancellationRequested: false, onCancellationRequested: vi.fn() }; cancel = vi.fn(); dispose = vi.fn(); },
		Disposable: class { static from(...disposables: any[]) { return { dispose: () => disposables.forEach(d => d.dispose()) }; } dispose() { } },
		MarkdownString: class { constructor(public value: string) { } },
		Diagnostic: class { },
		TextEdit: class { },
		WorkspaceEdit: class { },
		TextEditorCursorStyle: {},
		TextEditorLineNumbersStyle: {},
		TextEditorRevealType: {},
		EndOfLine: {},
		DiagnosticSeverity: {},
		ExtensionMode: {},
		Location: class { },
		DiagnosticRelatedInformation: class { },
		ChatVariableLevel: {},
		ChatResponseClearToPreviousToolInvocationReason: {},
		ChatResponseMarkdownPart: class { },
		ChatResponseThinkingProgressPart: class { },
		ChatResponseFileTreePart: class { },
		ChatResponseAnchorPart: class { },
		ChatResponseProgressPart: class { },
		ChatResponseProgressPart2: class { },
		ChatResponseReferencePart: class { },
		ChatResponseReferencePart2: class { },
		ChatResponseCodeCitationPart: class { },
		ChatResponseCommandButtonPart: class { },
		ChatResponseWarningPart: class { },
		ChatResponseMovePart: class { },
		ChatResponseExtensionsPart: class { },
		ChatResponseExternalEditPart: class { },
		ChatResponsePullRequestPart: class { },
		ChatResponseMarkdownWithVulnerabilitiesPart: class { },
		ChatResponseCodeblockUriPart: class { },
		ChatResponseTextEditPart: class { },
		ChatResponseNotebookEditPart: class { },
		ChatResponseConfirmationPart: class { },
		ChatPrepareToolInvocationPart: class { },
		ChatRequest: class { },
		ChatRequestTurn: class { },
		ChatResponseTurn: class { },
		NewSymbolName: class { },
		NewSymbolNameTag: {},
		NewSymbolNameTriggerKind: {},
		ChatLocation: {},
		ChatRequestEditorData: class { },
		ChatRequestNotebookData: class { },
		LanguageModelToolInformation: class { },
		LanguageModelToolResult: class { },
		ExtendedLanguageModelToolResult: class { },
		LanguageModelToolResult2: class { },
		SymbolInformation: class { },
		LanguageModelPromptTsxPart: class { },
		LanguageModelTextPart: class { },
		LanguageModelTextPart2: class { },
		LanguageModelThinkingPart: class { },
		LanguageModelDataPart: class { },
		LanguageModelDataPart2: class { },
		LanguageModelPartAudience: {},
		LanguageModelToolMCPSource: class { },
		LanguageModelToolExtensionSource: class { },
		ChatReferenceBinaryData: class { },
		ChatReferenceDiagnostic: class { },
		TextSearchMatch2: class { },
		AISearchKeyword: class { },
		ExcludeSettingOptions: {},
		NotebookCellKind: {},
		NotebookRange: class { },
		NotebookEdit: class { },
		NotebookCellData: class { },
		NotebookData: class { },
		ChatErrorLevel: {},
		TerminalShellExecutionCommandLineConfidence: {},
		ChatRequestEditedFileEventKind: {},
		Extension: class { },
		LanguageModelToolCallPart: class { },
		LanguageModelToolResultPart: class { },
		LanguageModelToolResultPart2: class { },
		LanguageModelChatMessageRole: {},
		TextEditorSelectionChangeKind: {},
		TextDocumentChangeReason: {},
		ChatToolInvocationPart: class { },
		ChatResponseTurn2: class { },
		ChatRequestTurn2: class { },
		LanguageModelError: class { },
		SymbolKind: {},
		SnippetString: class { },
		SnippetTextEdit: class { },
		FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
		ChatSessionStatus: {},
		ThemeColor: class { },
		TreeItem: class { },
		TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
		UIKind: { Desktop: 1, Web: 2 },
		LogLevel: { Trace: 1, Debug: 2, Info: 3, Warning: 4, Error: 5, Critical: 6, Off: 7 },
		ChatResponseStream: class { },
	};
});

// Mock services
const createMockLogService = () => ({
	_serviceBrand: undefined,
	debug: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	trace: vi.fn(),
});

const createMockFileSystemService = () => ({
	_serviceBrand: undefined,
	readFile: vi.fn(),
	exists: vi.fn(),
});

const createMockExtensionContext = () => ({
	extensionUri: { fsPath: '/extension' },
});

describe('Orchestrator Permission Flow', () => {
	let disposables: DisposableStore;
	let orchestratorService: OrchestratorService;
	let subTaskManager: SubTaskManager;
	let permissionService: OrchestratorPermissionService;
	let queueService: OrchestratorQueueService;

	// Mock dependencies
	let mockAgentInstructionService: any;
	let mockAgentRunner: any;
	let mockWorkerToolsService: any;
	let mockSafetyLimitsService: any;
	let mockParentCompletionService: any;

	beforeEach(() => {
		vi.clearAllMocks();
		disposables = new DisposableStore();

		// Setup mocks
		mockAgentInstructionService = { loadInstructions: vi.fn().mockResolvedValue({ instructions: [] }) };
		mockAgentRunner = { run: vi.fn() };
		mockWorkerToolsService = {
			createWorkerToolSet: vi.fn(),
			getWorkerToolSet: vi.fn(),
			disposeWorkerToolSet: vi.fn()
		};
		mockSafetyLimitsService = {
			config: {
				maxSubTasksPerWorker: 10,
				maxParallelSubTasks: 5,
				subTaskSpawnRateLimit: 20,
			},
			enforceDepthLimit: vi.fn(),
			checkRateLimit: vi.fn().mockReturnValue(true),
			checkTotalLimit: vi.fn().mockReturnValue(true),
			checkParallelLimit: vi.fn().mockReturnValue(true),
			getAncestryChain: vi.fn().mockReturnValue([]),
			detectCycle: vi.fn().mockReturnValue(false),
			registerAncestry: vi.fn(),
			recordSpawn: vi.fn(),
			clearAncestry: vi.fn(),
			onEmergencyStop: vi.fn(() => ({ dispose: vi.fn() })),
		};

		mockParentCompletionService = {
			_serviceBrand: undefined,
			registerParentHandler: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			hasParentHandler: vi.fn().mockReturnValue(false),
			getPendingCompletions: vi.fn().mockReturnValue([]),
			formatAsUserMessage: vi.fn().mockReturnValue(''),
			onCompletionDelivered: { dispose: vi.fn() },
			onCompletionQueued: { dispose: vi.fn() },
			deliverCompletion: vi.fn(),
		};

		const mockSubtaskProgressService = {
			_serviceBrand: undefined,
			registerStream: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			getStream: vi.fn().mockReturnValue(undefined),
			createProgress: vi.fn().mockReturnValue({
				update: vi.fn(),
				complete: vi.fn(),
				fail: vi.fn(),
				dispose: vi.fn(),
			}),
			createParallelRenderer: vi.fn(),
			onProgressCreated: { dispose: vi.fn() },
			onProgressUpdated: { dispose: vi.fn() },
		};

		// Initialize services
		queueService = new OrchestratorQueueService(createMockLogService() as any);
		disposables.add(queueService);

		permissionService = new OrchestratorPermissionService(
			createMockFileSystemService() as any,
			createMockExtensionContext() as any,
			createMockLogService() as any
		);
		disposables.add(permissionService);

		subTaskManager = new SubTaskManager(
			mockAgentRunner,
			mockWorkerToolsService,
			createMockLogService() as any,
			mockSafetyLimitsService
		);
		disposables.add(subTaskManager);

		orchestratorService = new OrchestratorService(
			mockAgentInstructionService,
			mockAgentRunner,
			mockWorkerToolsService,
			queueService,
			subTaskManager,
			permissionService,
			mockParentCompletionService,
			mockSubtaskProgressService as any,
			createMockLogService() as any
		);
		disposables.add(orchestratorService);

		// Add a dummy task for the queue messages
		const task = orchestratorService.addTask('test task', { planId: 'plan-1' });
		// We need to force the ID to match what we use in tests, or update tests to use this ID
		(task as any).id = 'task-1';
	});

	it('should auto-approve if action is within inherited permissions', () => {
		// Setup inherited permissions
		const inheritedPermissions = {
			auto_approve: ['read_file'],
			ask_user: [],
			auto_deny: [],
			limits: {
				max_subtask_depth: 2,
				max_subtasks_per_worker: 10,
				max_parallel_subtasks: 5,
				subtask_spawn_rate_limit: 20
			}
		};

		// Create sub-task with inherited permissions
		const subTask = subTaskManager.createSubTask({
			parentWorkerId: 'worker-1',
			parentTaskId: 'task-1',
			planId: 'plan-1',
			worktreePath: '/worktree',
			agentType: '@agent',
			prompt: 'read a file',
			expectedOutput: 'content',
			currentDepth: 0,
			inheritedPermissions
		});

		// Check permission
		const approved = subTaskManager.checkPermission(subTask.id, 'read_file');
		expect(approved).toBe(true);
	});

	it('should not auto-approve if action is not in inherited permissions', () => {
		const inheritedPermissions = {
			auto_approve: ['read_file'],
			ask_user: [],
			auto_deny: [],
			limits: { max_subtask_depth: 2, max_subtasks_per_worker: 10, max_parallel_subtasks: 5, subtask_spawn_rate_limit: 20 }
		};

		const subTask = subTaskManager.createSubTask({
			parentWorkerId: 'worker-1',
			parentTaskId: 'task-1',
			planId: 'plan-1',
			worktreePath: '/worktree',
			agentType: '@agent',
			prompt: 'write a file',
			expectedOutput: 'done',
			currentDepth: 0,
			inheritedPermissions
		});

		const approved = subTaskManager.checkPermission(subTask.id, 'write_file');
		expect(approved).toBe(false);
	});

	it('should escalate to orchestrator and auto-approve if global permissions allow', async () => {
		// Mock global permissions
		vi.spyOn(permissionService, 'evaluatePermission').mockReturnValue('auto_approve');

		const request: IPermissionRequest = {
			id: 'req-1',
			requesterId: 'subtask-1',
			requesterType: 'subtask',
			action: 'safe_action',
			context: {},
			escalationPath: ['subtask-1'],
			timeout: 1000,
			defaultAction: 'deny',
			createdAt: Date.now()
		};

		// Enqueue permission request
		queueService.enqueueMessage({
			id: 'msg-1',
			timestamp: Date.now(),
			priority: 'high',
			planId: 'plan-1',
			taskId: 'task-1',
			workerId: 'worker-1',
			worktreePath: '/worktree',
			type: 'permission_request',
			content: request
		});

		// Wait for processing
		await new Promise(resolve => setTimeout(resolve, 100));

		// Verify evaluatePermission was called
		expect(permissionService.evaluatePermission).toHaveBeenCalledWith('safe_action', {});
	});

	it('should escalate to orchestrator and ask user if needed', async () => {
		// Mock global permissions to ask user
		vi.spyOn(permissionService, 'evaluatePermission').mockReturnValue('ask_user');

		// Mock user approval
		(vscode.window.showInformationMessage as any).mockResolvedValue('Approve');

		const request: IPermissionRequest = {
			id: 'req-2',
			requesterId: 'subtask-1',
			requesterType: 'subtask',
			action: 'risky_action',
			context: {},
			escalationPath: ['subtask-1'],
			timeout: 1000,
			defaultAction: 'deny',
			createdAt: Date.now()
		};

		queueService.enqueueMessage({
			id: 'msg-2',
			timestamp: Date.now(),
			priority: 'high',
			planId: 'plan-1',
			taskId: 'task-1',
			workerId: 'worker-1',
			worktreePath: '/worktree',
			type: 'permission_request',
			content: request
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(permissionService.evaluatePermission).toHaveBeenCalledWith('risky_action', {});
		expect(vscode.window.showInformationMessage).toHaveBeenCalled();
	});

	it('should escalate to orchestrator and auto-deny if global permissions deny', async () => {
		vi.spyOn(permissionService, 'evaluatePermission').mockReturnValue('auto_deny');

		const request: IPermissionRequest = {
			id: 'req-3',
			requesterId: 'subtask-1',
			requesterType: 'subtask',
			action: 'forbidden_action',
			context: {},
			escalationPath: ['subtask-1'],
			timeout: 1000,
			defaultAction: 'deny',
			createdAt: Date.now()
		};

		queueService.enqueueMessage({
			id: 'msg-3',
			timestamp: Date.now(),
			priority: 'high',
			planId: 'plan-1',
			taskId: 'task-1',
			workerId: 'worker-1',
			worktreePath: '/worktree',
			type: 'permission_request',
			content: request
		});

		await new Promise(resolve => setTimeout(resolve, 100));

		expect(permissionService.evaluatePermission).toHaveBeenCalledWith('forbidden_action', {});
		expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
	});

	it('should apply default action (approve) on timeout', async () => {
		vi.spyOn(permissionService, 'evaluatePermission').mockReturnValue('ask_user');

		// Mock user dialog that never resolves (simulates user not responding)
		(vscode.window.showInformationMessage as any).mockImplementation(() =>
			new Promise(() => { }) // Never resolves
		);

		const request: IPermissionRequest = {
			id: 'req-timeout-1',
			requesterId: 'subtask-timeout-1',
			requesterType: 'subtask',
			action: 'timeout_action_approve',
			context: {},
			escalationPath: ['subtask-timeout-1'],
			timeout: 50, // Very short timeout for testing
			defaultAction: 'approve', // Default to approve on timeout
			createdAt: Date.now()
		};

		queueService.enqueueMessage({
			id: 'msg-timeout-1',
			timestamp: Date.now(),
			priority: 'high',
			planId: 'plan-1',
			taskId: 'task-1',
			workerId: 'worker-1',
			worktreePath: '/worktree',
			type: 'permission_request',
			content: request
		});

		// Wait longer than the timeout to ensure default action is applied
		await new Promise(resolve => setTimeout(resolve, 150));

		// The permission should have been evaluated and user asked
		expect(permissionService.evaluatePermission).toHaveBeenCalledWith('timeout_action_approve', {});
		expect(vscode.window.showInformationMessage).toHaveBeenCalled();
	});

	it('should apply default action (deny) on timeout', async () => {
		vi.spyOn(permissionService, 'evaluatePermission').mockReturnValue('ask_user');

		// Mock user dialog that never resolves (simulates user not responding)
		(vscode.window.showInformationMessage as any).mockImplementation(() =>
			new Promise(() => { }) // Never resolves
		);

		const request: IPermissionRequest = {
			id: 'req-timeout-2',
			requesterId: 'subtask-timeout-2',
			requesterType: 'subtask',
			action: 'timeout_action_deny',
			context: {},
			escalationPath: ['subtask-timeout-2'],
			timeout: 50, // Very short timeout for testing
			defaultAction: 'deny', // Default to deny on timeout
			createdAt: Date.now()
		};

		queueService.enqueueMessage({
			id: 'msg-timeout-2',
			timestamp: Date.now(),
			priority: 'high',
			planId: 'plan-1',
			taskId: 'task-1',
			workerId: 'worker-1',
			worktreePath: '/worktree',
			type: 'permission_request',
			content: request
		});

		// Wait longer than the timeout to ensure default action is applied
		await new Promise(resolve => setTimeout(resolve, 150));

		// The permission should have been evaluated and user asked
		expect(permissionService.evaluatePermission).toHaveBeenCalledWith('timeout_action_deny', {});
		expect(vscode.window.showInformationMessage).toHaveBeenCalled();
	});
});
