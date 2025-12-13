/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken, LanguageModelTextPart, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, ProviderResult } from 'vscode';
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
						const sessionStr = task.sessionUri ? ` | Session: ${task.sessionUri}` : '';

						lines.push(`  ${taskIcon} ${task.id}: ${task.name}${agentStr} - ${task.status}${depsStr}${sessionStr}`);
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
				const sessionStr = task.sessionUri ? ` | Session: ${task.sessionUri}` : '';
				lines.push(`${taskIcon} ${task.id}: ${task.name} - ${task.status}${sessionStr}`);
			}
			lines.push('');
		}

		// Show active workers (now called Active Sessions)
		const workers = this._orchestratorService.getWorkerStates();
		if (workers.length > 0) {
			lines.push('## Active Sessions\n');
			for (const w of workers) {
				const statusIcon = w.status === 'running' ? '🔄' :
					w.status === 'idle' ? '💤' :
						w.status === 'waiting-approval' ? '⏳' :
							w.status === 'paused' ? '⏸️' :
								w.status === 'completed' ? '✅' :
									w.status === 'error' ? '❌' : '❓';

				// Find the task to get session URI
				const tasks = this._orchestratorService.getTasks();
				const linkedTask = tasks.find(t => t.workerId === w.id);
				const sessionUri = linkedTask?.sessionUri;

				lines.push(`${statusIcon} **${w.id}** (${w.name})`);
				lines.push(`   Status: ${w.status}`);
				lines.push(`   Task: ${w.task}`);
				if (sessionUri) {
					lines.push(`   Session: ${sessionUri}`);
				}
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

ToolRegistry.registerTool(AddPlanTaskTool);
ToolRegistry.registerTool(ListWorkersTool);
ToolRegistry.registerTool(ListAgentsTool);
ToolRegistry.registerTool(SavePlanTool);

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

ToolRegistry.registerTool(CancelTaskTool);
ToolRegistry.registerTool(RetryTaskTool);

// ============================================================================
// Complete Task Tool
// ============================================================================

interface ICompleteTaskParams {
	taskId: string;
}

class CompleteTaskTool implements ICopilotTool<ICompleteTaskParams> {
	public static readonly toolName = ToolName.OrchestratorCompleteTask;

	constructor(
		@IOrchestratorService private readonly _orchestratorService: IOrchestratorService
	) { }

	prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<ICompleteTaskParams>, _token: CancellationToken): ProviderResult<any> {
		return {
			confirmationMessages: {
				title: 'Complete Task',
				message: `Mark task "${options.input.taskId}" as completed? This will remove the worker and trigger deployment of dependent tasks.`
			}
		};
	}

	async invoke(options: LanguageModelToolInvocationOptions<ICompleteTaskParams>, _token: CancellationToken): Promise<LanguageModelToolResult> {
		const { taskId } = options.input;

		try {
			await this._orchestratorService.completeTask(taskId);
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`✅ Task "${taskId}" marked as completed. Worker removed and dependent tasks will be deployed.`)
			]);
		} catch (e: any) {
			return new LanguageModelToolResult([
				new LanguageModelTextPart(`❌ Failed to complete task: ${e.message}`)
			]);
		}
	}
}

ToolRegistry.registerTool(CompleteTaskTool);
