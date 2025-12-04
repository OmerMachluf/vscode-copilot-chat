/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult } from 'vscode';
import { formatAgentsForPrompt, IAgentDiscoveryService } from '../../orchestrator/agentDiscoveryService';
import { CreateTaskOptions, IOrchestratorService } from '../../orchestrator/orchestratorServiceV2';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';

interface IAddPlanTaskParams {
	description: string;
	planId?: string;
	name?: string;
	agent?: string;
	dependencies?: string[];
	targetFiles?: string[];
}

class AddPlanTaskTool implements ICopilotTool<IAddPlanTaskParams> {
	public static readonly toolName = ToolName.OrchestratorAddPlanTask;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<IAddPlanTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(options: LanguageModelToolInvocationOptions<IAddPlanTaskParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { description, planId, name, agent, dependencies, targetFiles } = options.input;

		const task = this._orchestratorService.addTask(description, {
			planId,
			name,
			agent,
			dependencies,
			targetFiles,
		});

		const planInfo = planId ? ` in plan ${planId}` : (task.planId ? ` in plan ${task.planId}` : ' (ad-hoc)');
		return new LanguageModelToolResult([
			new LanguageModelTextPart(`Task added${planInfo}: ${task.id} - ${description}`)
		]);
	}
}

interface IDeployParams {
	planId?: string;
	taskId?: string;
	modelId?: string;
}

class DeployTool implements ICopilotTool<IDeployParams> {
	public static readonly toolName = ToolName.OrchestratorDeploy;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<IDeployParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(options: LanguageModelToolInvocationOptions<IDeployParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { planId, taskId, modelId } = options.input;
		const deployOptions = modelId ? { modelId } : undefined;

		try {
			// Option 1: Deploy a specific task by taskId
			if (taskId) {
				const worker = await this._orchestratorService.deploy(taskId, deployOptions);
				const modelInfo = modelId ? ` (model: ${modelId})` : '';
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`✅ Deployed worker ${worker.id} for task: ${taskId}${modelInfo}\nTask: ${worker.task}`)
				]);
			}

			// Option 2: Deploy all ready tasks in a plan
			if (planId) {
				const plan = this._orchestratorService.getPlanById(planId);
				if (!plan) {
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`Error: Plan "${planId}" not found. Use orchestrator_listWorkers to see available plans.`)
					]);
				}

				// Start the plan if not already active
				if (plan.status !== 'active') {
					await this._orchestratorService.startPlan(planId);
				}

				// Deploy ALL ready tasks in the plan
				const workers = await this._orchestratorService.deployAll(planId, deployOptions);

				if (workers.length === 0) {
					const readyTasks = this._orchestratorService.getReadyTasks(planId);
					if (readyTasks.length === 0) {
						return new LanguageModelToolResult([
							new LanguageModelTextPart(`⚠️ Plan "${plan.name}" has no ready tasks to deploy. All tasks may be pending dependencies or already running/completed.`)
						]);
					}
					return new LanguageModelToolResult([
						new LanguageModelTextPart(`⚠️ Plan "${plan.name}" has ${readyTasks.length} ready task(s) but deployment failed. Check task status with orchestrator_listWorkers.`)
					]);
				}

				const modelInfo = modelId ? ` using model ${modelId}` : '';
				const workerInfo = workers.map(w => `  - ${w.id}: ${w.task}`).join('\n');
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`✅ Plan "${plan.name}" (${planId}) - deployed ${workers.length} worker(s)${modelInfo}:\n${workerInfo}`)
				]);
			}

			// No planId or taskId provided - error with guidance
			return new LanguageModelToolResult([
				new LanguageModelTextPart('Error: Please specify either planId (to deploy all ready tasks in a plan) or taskId (to deploy a specific task). Use orchestrator_listWorkers to see available plans and tasks.')
			]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Error deploying: ${e.message}`)
			]);
		}
	}
}

class ListWorkersTool implements ICopilotTool<void> {
	public static readonly toolName = ToolName.OrchestratorListWorkers;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<void>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(_options: LanguageModelToolInvocationOptions<void>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const lines: string[] = [];

		// Show plans and their tasks
		const plans = this._orchestratorService.getPlans();
		if (plans.length > 0) {
			lines.push('## Plans\n');
			for (const plan of plans) {
				const statusIcon = plan.status === 'active' ? '🟢' :
					plan.status === 'completed' ? '✅' :
						plan.status === 'failed' ? '❌' :
							plan.status === 'paused' ? '⏸️' : '📋';

				lines.push(`### ${statusIcon} ${plan.name} (${plan.id})`);
				lines.push(`Status: ${plan.status}`);
				lines.push(`Description: ${plan.description}`);
				if (plan.baseBranch) {
					lines.push(`Base branch: ${plan.baseBranch}`);
				}
				lines.push('');

				// Show tasks for this plan
				const tasks = this._orchestratorService.getTasks(plan.id);
				if (tasks.length > 0) {
					lines.push('**Tasks:**');
					for (const task of tasks) {
						const taskIcon = task.status === 'completed' ? '✅' :
							task.status === 'running' ? '🔄' :
								task.status === 'failed' ? '❌' :
									task.status === 'blocked' ? '🚫' :
										task.status === 'queued' ? '⏳' : '⬜';

						const depsStr = task.dependencies.length > 0
							? ` (depends on: ${task.dependencies.join(', ')})`
							: ' (no dependencies)';
						const agentStr = task.agent ? ` [${task.agent}]` : '';

						lines.push(`  ${taskIcon} ${task.id}: ${task.name}${agentStr} - ${task.status}${depsStr}`);
					}
					lines.push('');
				}

				// Show ready tasks
				const readyTasks = this._orchestratorService.getReadyTasks(plan.id);
				if (readyTasks.length > 0) {
					lines.push(`**Ready to deploy:** ${readyTasks.map(t => t.id).join(', ')}`);
					lines.push('');
				}
			}
		}

		// Show ad-hoc tasks (tasks without a plan)
		const adHocTasks = this._orchestratorService.getTasks(undefined);
		if (adHocTasks.length > 0) {
			lines.push('## Ad-hoc Tasks\n');
			for (const task of adHocTasks) {
				const taskIcon = task.status === 'completed' ? '✅' :
					task.status === 'running' ? '🔄' :
						task.status === 'failed' ? '❌' : '⬜';
				lines.push(`${taskIcon} ${task.id}: ${task.name} - ${task.status}`);
			}
			lines.push('');
		}

		// Show active workers
		const workers = this._orchestratorService.getWorkerStates();
		if (workers.length > 0) {
			lines.push('## Active Workers\n');
			for (const w of workers) {
				const statusIcon = w.status === 'running' ? '🔄' :
					w.status === 'idle' ? '💤' :
						w.status === 'waiting-approval' ? '⏳' :
							w.status === 'paused' ? '⏸️' :
								w.status === 'completed' ? '✅' :
									w.status === 'error' ? '❌' : '❓';

				lines.push(`${statusIcon} **${w.id}** (${w.name})`);
				lines.push(`   Status: ${w.status}`);
				lines.push(`   Task: ${w.task}`);
				if (w.planId) {
					lines.push(`   Plan: ${w.planId}`);
				}
				if (w.errorMessage) {
					lines.push(`   Error: ${w.errorMessage}`);
				}
				lines.push('');
			}
		}

		if (lines.length === 0) {
			return new LanguageModelToolResult([new LanguageModelTextPart('No plans, tasks, or workers.')]);
		}

		return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);
	}
}

interface ISendMessageParams {
	receiver: string;
	message: string;
}

class SendMessageTool implements ICopilotTool<ISendMessageParams> {
	public static readonly toolName = ToolName.OrchestratorSendMessage;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<ISendMessageParams>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(options: LanguageModelToolInvocationOptions<ISendMessageParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { receiver, message } = options.input;
		if (!receiver) {
			return new LanguageModelToolResult([new LanguageModelTextPart('Error: receiver is required. Specify the worker ID to send the message to.')]);
		}
		this._orchestratorService.sendMessageToWorker(receiver, message);
		return new LanguageModelToolResult([new LanguageModelTextPart(`Message sent to ${receiver}`)]);
	}
}

/**
 * Tool to list available agents for plan creation.
 * Returns both built-in and repo-defined agents.
 */
class ListAgentsTool implements ICopilotTool<void> {
	public static readonly toolName = ToolName.OrchestratorListAgents;

	constructor(
		@IAgentDiscoveryService private readonly _agentDiscoveryService: IAgentDiscoveryService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<void>, _token: CancellationToken): ProviderResult<any> {
		return { presentation: 'hidden' };
	}

	async invoke(_options: LanguageModelToolInvocationOptions<void>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const agents = await this._agentDiscoveryService.getAvailableAgents();
		if (agents.length === 0) {
			return new LanguageModelToolResult([new LanguageModelTextPart('No agents available.')]);
		}
		const formatted = formatAgentsForPrompt(agents);
		return new LanguageModelToolResult([new LanguageModelTextPart(formatted)]);
	}
}

// ============================================================================
// Plan Task Definition (for SavePlanTool input)
// ============================================================================

/**
 * A task definition within a plan (from Planner agent output)
 */
interface IPlanTaskDefinition {
	/** Unique identifier for the task within the plan (e.g., "investigate", "implement-auth") */
	id: string;
	/** Human-readable name for display and branch naming */
	name?: string;
	/** Description of what this task should accomplish */
	description: string;
	/** Agent to assign (e.g., "@agent", "@architect", "@reviewer", or custom) */
	agent?: string;
	/** IDs of tasks that must complete before this one */
	dependencies?: string[];
	/** Tasks in same parallelGroup can potentially run together if no file overlap */
	parallelGroup?: string;
	/** Target files this task will touch (helps with parallelization) */
	targetFiles?: string[];
	/** Priority level for this task */
	priority?: 'critical' | 'high' | 'normal' | 'low';
}

/**
 * A complete plan definition (from Planner agent output)
 */
interface ISavePlanParams {
	/** Name of the plan (used for identification and branch naming) */
	name: string;
	/** Description of what the plan aims to accomplish */
	description: string;
	/** Base branch to create worktrees from (defaults to main/master) */
	baseBranch?: string;
	/** Array of tasks to execute */
	tasks: IPlanTaskDefinition[];
	/** Whether to start executing the plan immediately */
	autoStart?: boolean;
}

/**
 * Validation result for a plan
 */
interface PlanValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

/**
 * Validates a plan definition for consistency
 */
function validatePlan(params: ISavePlanParams): PlanValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];
	const taskIds = new Set<string>();

	// Check plan name
	if (!params.name || params.name.trim().length === 0) {
		errors.push('Plan name is required');
	}

	// Check description
	if (!params.description || params.description.trim().length === 0) {
		errors.push('Plan description is required');
	}

	// Check tasks array
	if (!params.tasks || params.tasks.length === 0) {
		errors.push('Plan must have at least one task');
		return { valid: false, errors, warnings };
	}

	// Validate each task
	for (const task of params.tasks) {
		// Check task ID
		if (!task.id || task.id.trim().length === 0) {
			errors.push('Each task must have an id');
			continue;
		}

		// Check for duplicate IDs
		if (taskIds.has(task.id)) {
			errors.push(`Duplicate task id: ${task.id}`);
		}
		taskIds.add(task.id);

		// Check description
		if (!task.description || task.description.trim().length === 0) {
			errors.push(`Task "${task.id}" must have a description`);
		}

		// Validate priority if specified
		if (task.priority && !['critical', 'high', 'normal', 'low'].includes(task.priority)) {
			errors.push(`Task "${task.id}" has invalid priority: ${task.priority}`);
		}
	}

	// Validate dependencies exist
	for (const task of params.tasks) {
		if (task.dependencies) {
			for (const depId of task.dependencies) {
				if (!taskIds.has(depId)) {
					errors.push(`Task "${task.id}" depends on non-existent task "${depId}"`);
				}
			}
		}
	}

	// Check for circular dependencies
	const visited = new Set<string>();
	const recStack = new Set<string>();

	function hasCycle(taskId: string): boolean {
		if (!visited.has(taskId)) {
			visited.add(taskId);
			recStack.add(taskId);

			const task = params.tasks.find(t => t.id === taskId);
			if (task?.dependencies) {
				for (const depId of task.dependencies) {
					if (!visited.has(depId) && hasCycle(depId)) {
						return true;
					} else if (recStack.has(depId)) {
						return true;
					}
				}
			}
		}
		recStack.delete(taskId);
		return false;
	}

	for (const task of params.tasks) {
		if (hasCycle(task.id)) {
			errors.push('Plan contains circular dependencies');
			break;
		}
	}

	// Warnings
	if (params.tasks.some(t => !t.agent)) {
		warnings.push('Some tasks have no agent assigned (will use default @agent)');
	}

	if (params.tasks.some(t => !t.targetFiles || t.targetFiles.length === 0)) {
		warnings.push('Some tasks have no targetFiles specified (parallelization may be limited)');
	}

	return {
		valid: errors.length === 0,
		errors,
		warnings
	};
}

/**
 * Tool to save a structured workflow plan from the Planner agent.
 * Creates a plan with all tasks, dependencies, and agent assignments.
 */
class SavePlanTool implements ICopilotTool<ISavePlanParams> {
	public static readonly toolName = ToolName.OrchestratorSavePlan;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(_options: LanguageModelToolInvocationPrepareOptions<ISavePlanParams>, _token: CancellationToken): ProviderResult<any> {
		return {
			confirmationMessages: {
				title: 'Save Workflow Plan',
				message: `Save plan "${_options.input.name}" with ${_options.input.tasks?.length ?? 0} tasks?`
			}
		};
	}

	async invoke(options: LanguageModelToolInvocationOptions<ISavePlanParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { name, description, baseBranch, tasks, autoStart } = options.input;

		// Validate the plan
		const validation = validatePlan(options.input);
		if (!validation.valid) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`Plan validation failed:\n${validation.errors.map(e => `- ${e}`).join('\n')}`)
			]);
		}

		try {
			// Create the plan
			const plan = this._orchestratorService.createPlan(name, description, baseBranch);

			// Create a map from task definition IDs to orchestrator task IDs
			const taskIdMap = new Map<string, string>();

			// Add all tasks to the plan
			for (const taskDef of tasks) {
				// Map dependency IDs from plan definition to orchestrator task IDs
				const mappedDependencies = taskDef.dependencies
					?.map(depId => taskIdMap.get(depId))
					.filter((id): id is string => id !== undefined) ?? [];

				const taskOptions: CreateTaskOptions = {
					name: taskDef.name ?? taskDef.id,
					planId: plan.id,
					dependencies: mappedDependencies,
					parallelGroup: taskDef.parallelGroup,
					agent: taskDef.agent,
					targetFiles: taskDef.targetFiles,
					priority: taskDef.priority ?? 'normal',
				};

				const task = this._orchestratorService.addTask(taskDef.description, taskOptions);
				taskIdMap.set(taskDef.id, task.id);
			}

			// Build response
			const lines: string[] = [
				`✅ Plan "${name}" created successfully`,
				`   ID: ${plan.id}`,
				`   Tasks: ${tasks.length}`,
			];

			if (validation.warnings.length > 0) {
				lines.push('');
				lines.push('⚠️ Warnings:');
				for (const warning of validation.warnings) {
					lines.push(`   - ${warning}`);
				}
			}

			// Auto-start if requested
			if (autoStart) {
				await this._orchestratorService.startPlan(plan.id);
				lines.push('');
				lines.push('🚀 Plan execution started');
			} else {
				lines.push('');
				lines.push('📋 Plan is ready. Call startPlan or use the dashboard to begin execution.');
			}

			return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to save plan: ${e.message}`)
			]);
		}
	}
}

// ============================================================================
// Expand Implementation Tool
// ============================================================================

/**
 * File modification from Architect output
 */
interface IArchitectFileModification {
	path: string;
	changes: string;
	complexity?: 'small' | 'medium' | 'large';
}

/**
 * Parallelization group from Architect output
 */
interface IArchitectParallelGroup {
	group: string;
	files: string[];
	reason?: string;
}

/**
 * Architect output structure (parsed from YAML)
 */
interface IArchitectOutput {
	summary?: string;
	files_to_modify?: IArchitectFileModification[];
	files_to_create?: Array<{ path: string; purpose: string }>;
	parallelization?: IArchitectParallelGroup[];
}

/**
 * Parameters for expanding implementation tasks
 */
interface IExpandImplementationParams {
	parentTaskId: string;
	planId?: string;
	architectOutput: IArchitectOutput;
	strategy?: 'balanced' | 'max-parallel' | 'sequential';
}

/**
 * Tool to create implementation sub-tasks from Architect output.
 * The Orchestrator uses this to break down the "implement" stage into
 * concrete, potentially parallelizable tasks.
 */
class ExpandImplementationTool implements ICopilotTool<IExpandImplementationParams> {
	public static readonly toolName = ToolName.OrchestratorExpandImplementation;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<IExpandImplementationParams>, _token: CancellationToken): ProviderResult<any> {
		const taskCount = this._estimateTaskCount(options.input);
		return {
			confirmationMessages: {
				title: 'Expand Implementation',
				message: `Create ~${taskCount} implementation task(s) from Architect design?`
			}
		};
	}

	private _estimateTaskCount(params: IExpandImplementationParams): number {
		const { architectOutput, strategy = 'balanced' } = params;

		if (strategy === 'sequential') {
			return 1;
		}

		const groups = architectOutput.parallelization?.length ?? 0;
		if (strategy === 'max-parallel') {
			return Math.max(1, groups);
		}

		// Balanced: consider file count and complexity
		const fileCount = (architectOutput.files_to_modify?.length ?? 0) +
			(architectOutput.files_to_create?.length ?? 0);

		// Heuristic: 1 task per 3-5 files, minimum 1, max based on groups
		const estimatedTasks = Math.max(1, Math.min(groups, Math.ceil(fileCount / 4)));
		return estimatedTasks;
	}

	async invoke(options: LanguageModelToolInvocationOptions<IExpandImplementationParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { parentTaskId, planId, architectOutput, strategy = 'balanced' } = options.input;

		try {
			// Find the parent task
			const parentTask = this._orchestratorService.getTaskById(parentTaskId);
			if (!parentTask) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`❌ Parent task "${parentTaskId}" not found.`)
				]);
			}

			const targetPlanId = planId ?? parentTask.planId;
			if (!targetPlanId) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`❌ No plan ID found. Provide planId or ensure parent task belongs to a plan.`)
				]);
			}

			// Collect all files to work on
			const allFiles: string[] = [];
			if (architectOutput.files_to_modify) {
				allFiles.push(...architectOutput.files_to_modify.map(f => f.path));
			}
			if (architectOutput.files_to_create) {
				allFiles.push(...architectOutput.files_to_create.map(f => f.path));
			}

			if (allFiles.length === 0) {
				return new LanguageModelToolResult([
					new LanguageModelTextPart(`⚠️ No files to modify or create in Architect output.`)
				]);
			}

			// Group files based on strategy
			const taskGroups = this._groupFilesForTasks(architectOutput, strategy, allFiles);
			const createdTasks: string[] = [];

			// Create sub-tasks
			for (let i = 0; i < taskGroups.length; i++) {
				const group = taskGroups[i];
				const taskName = taskGroups.length === 1
					? `impl-${parentTask.name}`
					: `impl-${parentTask.name}-${i + 1}`;

				const description = this._buildTaskDescription(group, architectOutput);

				const task = this._orchestratorService.addTask(description, {
					planId: targetPlanId,
					name: taskName,
					agent: '@agent',
					dependencies: [parentTaskId],
					targetFiles: group.files,
				});

				createdTasks.push(`${task.id}: ${group.files.length} file(s)`);
			}

			const lines = [
				`✅ Created ${createdTasks.length} implementation task(s):`,
				...createdTasks.map(t => `   - ${t}`),
				'',
				`Strategy: ${strategy}`,
				`Parent: ${parentTaskId}`,
			];

			if (createdTasks.length > 1) {
				lines.push('', '⚡ Tasks can run in parallel (no file overlap).');
			}

			return new LanguageModelToolResult([new LanguageModelTextPart(lines.join('\n'))]);

		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to expand implementation: ${e.message}`)
			]);
		}
	}

	/**
	 * Group files into tasks based on strategy
	 */
	private _groupFilesForTasks(
		output: IArchitectOutput,
		strategy: string,
		allFiles: string[]
	): Array<{ name: string; files: string[] }> {
		if (strategy === 'sequential') {
			// All files in one task
			return [{ name: 'all', files: allFiles }];
		}

		if (strategy === 'max-parallel' && output.parallelization) {
			// One task per parallelization group
			return output.parallelization.map(g => ({
				name: g.group,
				files: g.files,
			}));
		}

		// Balanced strategy: intelligent grouping
		if (output.parallelization && output.parallelization.length > 0) {
			// Use parallelization groups but consider merging small ones
			const groups = output.parallelization;

			// If all groups are small (1-2 files), merge into fewer tasks
			const totalFiles = groups.reduce((sum, g) => sum + g.files.length, 0);
			const avgFilesPerGroup = totalFiles / groups.length;

			if (avgFilesPerGroup < 2 && groups.length > 3) {
				// Too many small groups, merge them
				const merged: Array<{ name: string; files: string[] }> = [];
				let currentGroup: { name: string; files: string[] } = { name: 'batch-1', files: [] };

				for (const g of groups) {
					if (currentGroup.files.length + g.files.length <= 5) {
						currentGroup.files.push(...g.files);
					} else {
						if (currentGroup.files.length > 0) {
							merged.push(currentGroup);
						}
						currentGroup = { name: `batch-${merged.length + 2}`, files: [...g.files] };
					}
				}
				if (currentGroup.files.length > 0) {
					merged.push(currentGroup);
				}
				return merged;
			}

			// Groups are reasonably sized, use as-is
			return groups.map(g => ({ name: g.group, files: g.files }));
		}

		// No parallelization info, group by directory
		const byDir = new Map<string, string[]>();
		for (const file of allFiles) {
			const dir = file.split('/').slice(0, -1).join('/') || 'root';
			if (!byDir.has(dir)) {
				byDir.set(dir, []);
			}
			byDir.get(dir)!.push(file);
		}

		return Array.from(byDir.entries()).map(([dir, files]) => ({
			name: dir.replace(/\//g, '-') || 'root',
			files,
		}));
	}

	/**
	 * Build a task description from file group and architect output
	 */
	private _buildTaskDescription(
		group: { name: string; files: string[] },
		output: IArchitectOutput
	): string {
		const lines = [`Implement changes for: ${group.name}`];

		if (output.summary) {
			lines.push('');
			lines.push('Context: ' + output.summary.split('\n')[0]);
		}

		lines.push('');
		lines.push('Files to work on:');

		for (const file of group.files) {
			const modification = output.files_to_modify?.find(f => f.path === file);
			const creation = output.files_to_create?.find(f => f.path === file);

			if (modification) {
				lines.push(`- ${file}: ${modification.changes}`);
			} else if (creation) {
				lines.push(`- ${file} (new): ${creation.purpose}`);
			} else {
				lines.push(`- ${file}`);
			}
		}

		return lines.join('\n');
	}
}

ToolRegistry.registerTool(AddPlanTaskTool);
ToolRegistry.registerTool(DeployTool);
ToolRegistry.registerTool(ListWorkersTool);
ToolRegistry.registerTool(SendMessageTool);
ToolRegistry.registerTool(ListAgentsTool);
ToolRegistry.registerTool(SavePlanTool);
ToolRegistry.registerTool(ExpandImplementationTool);

// ============================================================================
// Kill Worker Tool
// ============================================================================

interface IKillWorkerParams {
	workerId: string;
	removeWorktree?: boolean;
	resetTask?: boolean;
}

class KillWorkerTool implements ICopilotTool<IKillWorkerParams> {
	public static readonly toolName = ToolName.OrchestratorKillWorker;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<IKillWorkerParams>, _token: CancellationToken): ProviderResult<any> {
		return {
			confirmationMessages: {
				title: 'Kill Worker',
				message: `Kill worker "${options.input.workerId}"? This will stop the process and clean up the worktree.`
			}
		};
	}

	async invoke(options: LanguageModelToolInvocationOptions<IKillWorkerParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { workerId, removeWorktree = true, resetTask = true } = options.input;

		try {
			await this._orchestratorService.killWorker(workerId, { removeWorktree, resetTask });
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`✅ Worker "${workerId}" killed successfully.${resetTask ? ' Task reset to pending.' : ''}${removeWorktree ? ' Worktree removed.' : ''}`)
			]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to kill worker: ${e.message}`)
			]);
		}
	}
}

// ============================================================================
// Cancel Task Tool
// ============================================================================

interface ICancelTaskParams {
	taskId: string;
	remove?: boolean;
}

class CancelTaskTool implements ICopilotTool<ICancelTaskParams> {
	public static readonly toolName = ToolName.OrchestratorCancelTask;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<ICancelTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return {
			confirmationMessages: {
				title: 'Cancel Task',
				message: `Cancel task "${options.input.taskId}"?${options.input.remove ? ' The task will be removed.' : ' The task will be reset to pending.'}`
			}
		};
	}

	async invoke(options: LanguageModelToolInvocationOptions<ICancelTaskParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { taskId, remove = false } = options.input;

		try {
			await this._orchestratorService.cancelTask(taskId, remove);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`✅ Task "${taskId}" ${remove ? 'removed' : 'cancelled and reset to pending'}.`)
			]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to cancel task: ${e.message}`)
			]);
		}
	}
}

// ============================================================================
// Retry Task Tool
// ============================================================================

interface IRetryTaskParams {
	taskId: string;
	modelId?: string;
}

class RetryTaskTool implements ICopilotTool<IRetryTaskParams> {
	public static readonly toolName = ToolName.OrchestratorRetryTask;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<IRetryTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return {
			confirmationMessages: {
				title: 'Retry Task',
				message: `Retry task "${options.input.taskId}"? A new worker will be deployed.`
			}
		};
	}

	async invoke(options: LanguageModelToolInvocationOptions<IRetryTaskParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { taskId, modelId } = options.input;
		const deployOptions = modelId ? { modelId } : undefined;

		try {
			const worker = await this._orchestratorService.retryTask(taskId, deployOptions);
			const modelInfo = modelId ? ` (model: ${modelId})` : '';
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`✅ Task "${taskId}" retried${modelInfo}. New worker: ${worker.id}`)
			]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to retry task: ${e.message}`)
			]);
		}
	}
}

ToolRegistry.registerTool(KillWorkerTool);
ToolRegistry.registerTool(CancelTaskTool);
ToolRegistry.registerTool(RetryTaskTool);
