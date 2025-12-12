/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../platform/log/common/logService';
import { Emitter, Event } from '../../util/vs/base/common/event';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { createDecorator } from '../../util/vs/platform/instantiation/common/instantiation';

// ============================================================================
// Interfaces & Types
// ============================================================================

/**
 * Context type for determining appropriate depth limits.
 */
export type SpawnContext = 'orchestrator' | 'agent' | 'subtask';

/**
 * Configurable safety limits for sub-task management.
 */
export interface ISafetyLimitsConfig {
	/**
	 * Maximum sub-task nesting depth when spawned from orchestrator.
	 * Orchestrator → Worker (depth 1) → Sub-worker (depth 2) → NO MORE
	 * Default: 2
	 */
	maxDepthFromOrchestrator: number;
	/**
	 * Maximum sub-task nesting depth when spawned from a standalone agent (non-orchestrator).
	 * Agent → Subtask (depth 1) → NO MORE
	 * Default: 1
	 */
	maxDepthFromAgent: number;
	/** @deprecated Use maxDepthFromOrchestrator or maxDepthFromAgent instead */
	maxSubTaskDepth: number;
	/** Maximum total sub-tasks per worker (default: 100) */
	maxSubTasksPerWorker: number;
	/** Maximum parallel sub-tasks at once per worker (default: 20) */
	maxParallelSubTasks: number;
	/** Rate limit: max sub-task spawns per minute per worker (default: 100) */
	subTaskSpawnRateLimit: number;
}

/**
 * Cost tracking for a sub-task.
 */
export interface ISubTaskCost {
	/** ID of the sub-task */
	subTaskId: string;
	/** Number of tokens used */
	tokensUsed: number;
	/** Estimated cost in dollars */
	estimatedCost: number;
	/** Model used */
	model: string;
	/** Timestamp when tracked */
	timestamp: number;
}

/**
 * Token usage information from a model response.
 */
export interface ITokenUsage {
	/** Number of input/prompt tokens */
	promptTokens: number;
	/** Number of output/completion tokens */
	completionTokens: number;
	/** Total tokens */
	totalTokens: number;
}

/**
 * Options for emergency stop operation.
 */
export interface IEmergencyStopOptions {
	/** Scope of the emergency stop */
	scope: 'subtask' | 'worker' | 'plan' | 'global';
	/** Target ID (subtaskId, workerId, or planId) - required for non-global scope */
	targetId?: string;
	/** Reason for the emergency stop */
	reason: string;
}

/**
 * Result of an emergency stop operation.
 */
export interface IEmergencyStopResult {
	/** Number of sub-tasks killed */
	subTasksKilled: number;
	/** IDs of killed sub-tasks */
	killedSubTaskIds: string[];
	/** Timestamp of the stop */
	timestamp: number;
	/** Reason for the stop */
	reason: string;
}

/**
 * Information about a sub-task's ancestry for cycle detection.
 */
export interface ISubTaskAncestry {
	/** Sub-task ID */
	subTaskId: string;
	/** Parent sub-task ID (if any) */
	parentSubTaskId?: string;
	/** Worker ID that owns this sub-task chain */
	workerId: string;
	/** Plan ID */
	planId: string;
	/** Agent type */
	agentType: string;
	/** Prompt hash for detecting similar tasks */
	promptHash: string;
}

export const ISafetyLimitsService = createDecorator<ISafetyLimitsService>('safetyLimitsService');

/**
 * Service for enforcing safety limits on sub-task operations.
 */
export interface ISafetyLimitsService {
	readonly _serviceBrand: undefined;

	/**
	 * Get current safety limits configuration.
	 */
	readonly config: ISafetyLimitsConfig;

	/**
	 * Update safety limits configuration.
	 */
	updateConfig(config: Partial<ISafetyLimitsConfig>): void;

	/**
	 * Get the maximum depth allowed for a given spawn context.
	 * @param context The context from which subtasks are being spawned
	 */
	getMaxDepthForContext(context: SpawnContext): number;

	/**
	 * Enforce depth limit before spawning a sub-task.
	 * @param parentDepth Current depth of the parent
	 * @param context The spawning context (orchestrator, agent, or subtask)
	 * @throws Error if depth limit would be exceeded
	 */
	enforceDepthLimit(parentDepth: number, context?: SpawnContext): void;

	/**
	 * Detect if spawning a new sub-task would create a cycle.
	 * @param newSubTaskId ID of the new sub-task
	 * @param ancestry Ancestry chain including the new sub-task
	 * @returns true if a cycle is detected
	 */
	detectCycle(newSubTaskId: string, ancestry: ISubTaskAncestry[]): boolean;

	/**
	 * Register a sub-task's ancestry for cycle detection.
	 */
	registerAncestry(ancestry: ISubTaskAncestry): void;

	/**
	 * Get the ancestry chain for a sub-task.
	 */
	getAncestryChain(subTaskId: string): ISubTaskAncestry[];

	/**
	 * Clear ancestry for a sub-task (on completion/failure).
	 */
	clearAncestry(subTaskId: string): void;

	/**
	 * Check rate limit for spawning sub-tasks.
	 * @returns true if within rate limit, false if exceeded
	 */
	checkRateLimit(workerId: string): boolean;

	/**
	 * Check total sub-task limit for a worker.
	 * @returns true if within limit, false if exceeded
	 */
	checkTotalLimit(workerId: string, currentTotal: number): boolean;

	/**
	 * Check parallel sub-task limit for a worker.
	 * @returns true if within limit, false if exceeded
	 */
	checkParallelLimit(workerId: string, currentParallel: number): boolean;

	/**
	 * Record a sub-task spawn for rate limiting.
	 */
	recordSpawn(workerId: string): void;

	/**
	 * Track cost for a sub-task.
	 */
	trackSubTaskCost(subTaskId: string, usage: ITokenUsage, model: string): void;

	/**
	 * Get total cost for all sub-tasks of a worker.
	 */
	getTotalCostForWorker(workerId: string): number;

	/**
	 * Get cost details for a specific sub-task.
	 */
	getSubTaskCost(subTaskId: string): ISubTaskCost | undefined;

	/**
	 * Get all cost entries for a worker.
	 */
	getCostEntriesForWorker(workerId: string): ISubTaskCost[];

	/**
	 * Emergency stop to kill all sub-tasks in scope.
	 */
	emergencyStop(options: IEmergencyStopOptions): Promise<IEmergencyStopResult>;

	/**
	 * Register a callback for emergency stop (called for each sub-task).
	 */
	onEmergencyStop: Event<IEmergencyStopOptions>;

	/**
	 * Reset all tracking for a worker (on worker completion/disposal).
	 */
	resetWorkerTracking(workerId: string): void;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Default safety limits configuration.
 *
 * Depth limits:
 * - Orchestrator context: orchestrator → worker (1) → sub-worker (2) → STOP
 * - Agent context: agent → subtask (1) → STOP
 */
const DEFAULT_SAFETY_LIMITS: ISafetyLimitsConfig = {
	maxDepthFromOrchestrator: 2,
	maxDepthFromAgent: 1,
	maxSubTaskDepth: 2, // Deprecated, kept for backward compatibility
	maxSubTasksPerWorker: 100,
	maxParallelSubTasks: 20,
	subTaskSpawnRateLimit: 100,
};

/**
 * Cost per 1K tokens by model (approximate).
 * These are rough estimates and should be updated based on actual pricing.
 */
const MODEL_COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
	'gpt-4o': { input: 0.005, output: 0.015 },
	'gpt-4': { input: 0.03, output: 0.06 },
	'gpt-4-turbo': { input: 0.01, output: 0.03 },
	'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
	'claude-3-opus': { input: 0.015, output: 0.075 },
	'claude-3-sonnet': { input: 0.003, output: 0.015 },
	'claude-3-haiku': { input: 0.00025, output: 0.00125 },
	'claude-sonnet-4-20250514': { input: 0.003, output: 0.015 },
	'default': { input: 0.01, output: 0.03 },
};

/**
 * Implementation of the safety limits service.
 */
export class SafetyLimitsService extends Disposable implements ISafetyLimitsService {
	readonly _serviceBrand: undefined;

	private _config: ISafetyLimitsConfig;

	/** Rate limiting: workerId → timestamps of recent spawns */
	private readonly _spawnTimestamps = new Map<string, number[]>();

	/** Cost tracking: subTaskId → cost info */
	private readonly _costTracking = new Map<string, ISubTaskCost>();

	/** Worker to sub-task mapping for cost aggregation */
	private readonly _workerSubTasks = new Map<string, Set<string>>();

	/** Ancestry tracking for cycle detection: subTaskId → ancestry info */
	private readonly _ancestryMap = new Map<string, ISubTaskAncestry>();

	/** Parent to children mapping for ancestry chains */
	private readonly _childrenMap = new Map<string, Set<string>>();

	private readonly _onEmergencyStop = this._register(new Emitter<IEmergencyStopOptions>());
	readonly onEmergencyStop = this._onEmergencyStop.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._config = { ...DEFAULT_SAFETY_LIMITS };
	}

	get config(): ISafetyLimitsConfig {
		return { ...this._config };
	}

	updateConfig(config: Partial<ISafetyLimitsConfig>): void {
		this._config = { ...this._config, ...config };
		this._logService.debug(`[SafetyLimitsService] Config updated: ${JSON.stringify(this._config)}`);
	}

	// ========================================================================
	// Depth Limit Enforcement
	// ========================================================================

	getMaxDepthForContext(context: SpawnContext): number {
		switch (context) {
			case 'orchestrator':
				return this._config.maxDepthFromOrchestrator;
			case 'agent':
				return this._config.maxDepthFromAgent;
			case 'subtask':
				// Subtasks inherit the limit from their root context
				// If a subtask is at depth 1 from orchestrator (max 2), it can spawn 1 more
				// If a subtask is at depth 1 from agent (max 1), it cannot spawn more
				return this._config.maxSubTaskDepth;
			default:
				return this._config.maxSubTaskDepth;
		}
	}

	enforceDepthLimit(parentDepth: number, context: SpawnContext = 'subtask'): void {
		const effectiveMaxDepth = this.getMaxDepthForContext(context);

		if (parentDepth >= effectiveMaxDepth) {
			const contextLabel = context === 'orchestrator' ? 'orchestrator-deployed worker' :
				context === 'agent' ? 'standalone agent' : 'sub-task';
			const error = new Error(
				`Sub-task depth limit (${effectiveMaxDepth}) exceeded for ${contextLabel}. ` +
				`Cannot spawn deeper sub-tasks from depth ${parentDepth}. ` +
				`Consider completing this task directly instead of delegating further.`
			);
			this._logService.warn(`[SafetyLimitsService] Depth limit exceeded: ${error.message}`);
			throw error;
		}
	}

	// ========================================================================
	// Cycle Detection
	// ========================================================================

	detectCycle(newSubTaskId: string, ancestry: ISubTaskAncestry[]): boolean {
		if (ancestry.length === 0) {
			return false;
		}

		// Build a set of unique identifiers from ancestry
		// A cycle is detected if we see the same (workerId, agentType, promptHash) combination
		const seen = new Set<string>();

		for (const ancestor of ancestry) {
			const key = `${ancestor.workerId}:${ancestor.agentType}:${ancestor.promptHash}`;

			if (seen.has(key)) {
				this._logService.warn(
					`[SafetyLimitsService] Cycle detected for sub-task ${newSubTaskId}. ` +
					`Duplicate key: ${key}`
				);
				return true;
			}
			seen.add(key);
		}

		// Also check for direct ID cycles (A → B → C → A)
		const idSet = new Set<string>();
		for (const ancestor of ancestry) {
			if (idSet.has(ancestor.subTaskId)) {
				this._logService.warn(
					`[SafetyLimitsService] Direct cycle detected for sub-task ${newSubTaskId}. ` +
					`Duplicate ID: ${ancestor.subTaskId}`
				);
				return true;
			}
			idSet.add(ancestor.subTaskId);
		}

		return false;
	}

	registerAncestry(ancestry: ISubTaskAncestry): void {
		this._ancestryMap.set(ancestry.subTaskId, ancestry);

		// Track parent-child relationship
		if (ancestry.parentSubTaskId) {
			let children = this._childrenMap.get(ancestry.parentSubTaskId);
			if (!children) {
				children = new Set();
				this._childrenMap.set(ancestry.parentSubTaskId, children);
			}
			children.add(ancestry.subTaskId);
		}

		// Track worker to sub-task mapping
		let workerSubTasks = this._workerSubTasks.get(ancestry.workerId);
		if (!workerSubTasks) {
			workerSubTasks = new Set();
			this._workerSubTasks.set(ancestry.workerId, workerSubTasks);
		}
		workerSubTasks.add(ancestry.subTaskId);

		this._logService.debug(
			`[SafetyLimitsService] Registered ancestry for ${ancestry.subTaskId}, ` +
			`parent: ${ancestry.parentSubTaskId ?? 'none'}`
		);
	}

	getAncestryChain(subTaskId: string): ISubTaskAncestry[] {
		const chain: ISubTaskAncestry[] = [];
		let currentId: string | undefined = subTaskId;

		while (currentId) {
			const ancestry = this._ancestryMap.get(currentId);
			if (!ancestry) {
				break;
			}
			chain.unshift(ancestry); // Add to beginning to maintain order
			currentId = ancestry.parentSubTaskId;
		}

		return chain;
	}

	clearAncestry(subTaskId: string): void {
		const ancestry = this._ancestryMap.get(subTaskId);
		if (ancestry) {
			// Remove from parent's children
			if (ancestry.parentSubTaskId) {
				const siblings = this._childrenMap.get(ancestry.parentSubTaskId);
				siblings?.delete(subTaskId);
			}

			// Remove from worker's sub-tasks
			const workerSubTasks = this._workerSubTasks.get(ancestry.workerId);
			workerSubTasks?.delete(subTaskId);
		}

		// Remove the ancestry entry
		this._ancestryMap.delete(subTaskId);

		// Also clear this task's children references
		this._childrenMap.delete(subTaskId);

		this._logService.debug(`[SafetyLimitsService] Cleared ancestry for ${subTaskId}`);
	}

	// ========================================================================
	// Rate Limiting
	// ========================================================================

	checkRateLimit(workerId: string): boolean {
		const timestamps = this._spawnTimestamps.get(workerId) ?? [];
		const oneMinuteAgo = Date.now() - 60000;

		// Count spawns in the last minute
		const recentSpawns = timestamps.filter(t => t > oneMinuteAgo).length;
		const withinLimit = recentSpawns < this._config.subTaskSpawnRateLimit;

		if (!withinLimit) {
			this._logService.warn(
				`[SafetyLimitsService] Rate limit exceeded for worker ${workerId}. ` +
				`${recentSpawns} spawns in last minute, limit is ${this._config.subTaskSpawnRateLimit}`
			);
		}

		return withinLimit;
	}

	checkTotalLimit(workerId: string, currentTotal: number): boolean {
		const withinLimit = currentTotal < this._config.maxSubTasksPerWorker;

		if (!withinLimit) {
			this._logService.warn(
				`[SafetyLimitsService] Total sub-task limit exceeded for worker ${workerId}. ` +
				`${currentTotal} sub-tasks, limit is ${this._config.maxSubTasksPerWorker}`
			);
		}

		return withinLimit;
	}

	checkParallelLimit(workerId: string, currentParallel: number): boolean {
		const withinLimit = currentParallel < this._config.maxParallelSubTasks;

		if (!withinLimit) {
			this._logService.warn(
				`[SafetyLimitsService] Parallel sub-task limit exceeded for worker ${workerId}. ` +
				`${currentParallel} parallel sub-tasks, limit is ${this._config.maxParallelSubTasks}`
			);
		}

		return withinLimit;
	}

	recordSpawn(workerId: string): void {
		let timestamps = this._spawnTimestamps.get(workerId);
		if (!timestamps) {
			timestamps = [];
			this._spawnTimestamps.set(workerId, timestamps);
		}

		timestamps.push(Date.now());

		// Clean up old timestamps (older than 1 minute)
		const oneMinuteAgo = Date.now() - 60000;
		const filtered = timestamps.filter(t => t > oneMinuteAgo);
		this._spawnTimestamps.set(workerId, filtered);
	}

	// ========================================================================
	// Cost Tracking
	// ========================================================================

	trackSubTaskCost(subTaskId: string, usage: ITokenUsage, model: string): void {
		const modelKey = model.toLowerCase();
		const pricing = MODEL_COST_PER_1K_TOKENS[modelKey] ?? MODEL_COST_PER_1K_TOKENS['default'];

		const inputCost = (usage.promptTokens / 1000) * pricing.input;
		const outputCost = (usage.completionTokens / 1000) * pricing.output;
		const totalCost = inputCost + outputCost;

		const costEntry: ISubTaskCost = {
			subTaskId,
			tokensUsed: usage.totalTokens,
			estimatedCost: totalCost,
			model,
			timestamp: Date.now(),
		};

		this._costTracking.set(subTaskId, costEntry);

		this._logService.debug(
			`[SafetyLimitsService] Tracked cost for ${subTaskId}: ` +
			`${usage.totalTokens} tokens, $${totalCost.toFixed(6)} (${model})`
		);
	}

	getTotalCostForWorker(workerId: string): number {
		const subTaskIds = this._workerSubTasks.get(workerId);
		if (!subTaskIds) {
			return 0;
		}

		let totalCost = 0;
		for (const subTaskId of subTaskIds) {
			const cost = this._costTracking.get(subTaskId);
			if (cost) {
				totalCost += cost.estimatedCost;
			}
		}

		return totalCost;
	}

	getSubTaskCost(subTaskId: string): ISubTaskCost | undefined {
		return this._costTracking.get(subTaskId);
	}

	getCostEntriesForWorker(workerId: string): ISubTaskCost[] {
		const subTaskIds = this._workerSubTasks.get(workerId);
		if (!subTaskIds) {
			return [];
		}

		const entries: ISubTaskCost[] = [];
		for (const subTaskId of subTaskIds) {
			const cost = this._costTracking.get(subTaskId);
			if (cost) {
				entries.push(cost);
			}
		}

		return entries;
	}

	// ========================================================================
	// Emergency Stop
	// ========================================================================

	async emergencyStop(options: IEmergencyStopOptions): Promise<IEmergencyStopResult> {
		this._logService.warn(
			`[SafetyLimitsService] Emergency stop initiated. ` +
			`Scope: ${options.scope}, Target: ${options.targetId ?? 'N/A'}, Reason: ${options.reason}`
		);

		const killedSubTaskIds: string[] = [];

		// Fire the emergency stop event so listeners can handle the actual stopping
		this._onEmergencyStop.fire(options);

		// Collect affected sub-tasks based on scope
		switch (options.scope) {
			case 'subtask': {
				if (options.targetId) {
					killedSubTaskIds.push(options.targetId);
					this.clearAncestry(options.targetId);
					this._costTracking.delete(options.targetId);
				}
				break;
			}

			case 'worker': {
				if (options.targetId) {
					const subTaskIds = this._workerSubTasks.get(options.targetId);
					if (subTaskIds) {
						for (const subTaskId of subTaskIds) {
							killedSubTaskIds.push(subTaskId);
							this.clearAncestry(subTaskId);
							this._costTracking.delete(subTaskId);
						}
						this._workerSubTasks.delete(options.targetId);
					}
					this._spawnTimestamps.delete(options.targetId);
				}
				break;
			}

			case 'plan': {
				if (options.targetId) {
					// Find all sub-tasks belonging to this plan
					for (const [subTaskId, ancestry] of this._ancestryMap) {
						if (ancestry.planId === options.targetId) {
							killedSubTaskIds.push(subTaskId);
							this.clearAncestry(subTaskId);
							this._costTracking.delete(subTaskId);
						}
					}
				}
				break;
			}

			case 'global': {
				// Kill everything
				for (const subTaskId of this._ancestryMap.keys()) {
					killedSubTaskIds.push(subTaskId);
				}
				this._ancestryMap.clear();
				this._childrenMap.clear();
				this._workerSubTasks.clear();
				this._spawnTimestamps.clear();
				this._costTracking.clear();
				break;
			}
		}

		const result: IEmergencyStopResult = {
			subTasksKilled: killedSubTaskIds.length,
			killedSubTaskIds,
			timestamp: Date.now(),
			reason: options.reason,
		};

		this._logService.warn(
			`[SafetyLimitsService] Emergency stop completed. ` +
			`Killed ${result.subTasksKilled} sub-tasks.`
		);

		return result;
	}

	// ========================================================================
	// Cleanup
	// ========================================================================

	resetWorkerTracking(workerId: string): void {
		// Clear all sub-tasks for this worker
		const subTaskIds = this._workerSubTasks.get(workerId);
		if (subTaskIds) {
			for (const subTaskId of subTaskIds) {
				this.clearAncestry(subTaskId);
				this._costTracking.delete(subTaskId);
			}
		}

		this._workerSubTasks.delete(workerId);
		this._spawnTimestamps.delete(workerId);

		this._logService.debug(`[SafetyLimitsService] Reset tracking for worker ${workerId}`);
	}
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a hash for a prompt string for cycle detection.
 * Uses a simple hash to detect similar prompts.
 */
export function hashPrompt(prompt: string): string {
	// Normalize: lowercase, trim, collapse whitespace
	const normalized = prompt.toLowerCase().trim().replace(/\s+/g, ' ');

	// Simple DJB2 hash
	let hash = 5381;
	for (let i = 0; i < normalized.length; i++) {
		hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
		hash = hash & hash; // Convert to 32-bit integer
	}

	return Math.abs(hash).toString(36);
}
