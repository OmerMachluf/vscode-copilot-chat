/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptReference, PromptSizing, TextChunk } from '@vscode/prompt-tsx';
import type { ChatLanguageModelToolReference } from 'vscode';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { CustomInstructionsKind, ICustomInstructions, ICustomInstructionsService } from '../../../../platform/customInstructions/common/customInstructionsService';
import { IFileSystemService } from '../../../../platform/filesystem/common/fileSystemService';
import { FileType } from '../../../../platform/filesystem/common/fileTypes';
import { ILogService } from '../../../../platform/log/common/logService';
import { IPromptPathRepresentationService } from '../../../../platform/prompts/common/promptPathRepresentationService';
import { IWorkspaceService } from '../../../../platform/workspace/common/workspaceService';
import { isUri } from '../../../../util/common/types';
import { ResourceSet } from '../../../../util/vs/base/common/map';
import { isString } from '../../../../util/vs/base/common/types';
import { URI } from '../../../../util/vs/base/common/uri';
import { ChatVariablesCollection, isPromptInstruction } from '../../../prompt/common/chatVariablesCollection';
import { IPromptVariablesService } from '../../../prompt/node/promptVariablesService';
import { Tag } from '../base/tag';

/**
 * Regex to match paths inside .github/agents/
 */
const AGENTS_PATH_REGEX = /[/\\]\.github[/\\]agents[/\\]/i;

/**
 * Map VS Code participant names to instruction folder names.
 * The VS Code participant system uses names like 'editsAgent', 'workflowPlanner',
 * but users expect folder names like 'agent', 'planner', etc.
 */
function normalizeAgentIdForInstructions(agentId: string): string {
	// Map common VS Code participant names to folder names
	// Note: Some agents have distinct folders (architect, orchestrator, reviewer, workflowPlanner, planner)
	// while others share the 'agent' folder (editsAgent, editingSession, default, editor)
	const mapping: Record<string, string> = {
		// Main agent variants -> 'agent' folder
		'editsAgent': 'agent',
		'editingSession': 'agent',
		'editingSession2': 'agent',
		'editingSessionEditor': 'agent',
		'default': 'agent',
		'editor': 'agent',
		// Step planner uses same folder as planner
		'stepplanner': 'planner',
		// Notebook agent
		'notebookEditorAgent': 'notebook',
		// These agents keep their own folder names (no mapping needed, handled by fallback):
		// - 'architect' -> 'architect'
		// - 'orchestrator' -> 'orchestrator'
		// - 'reviewer' -> 'reviewer'
		// - 'workflowPlanner' -> 'workflowPlanner'
		// - 'planner' -> 'planner'
	};

	return mapping[agentId] ?? agentId;
}

export interface CustomInstructionsProps extends BasePromptElementProps {
	readonly chatVariables: ChatVariablesCollection | undefined;

	readonly languageId: string | undefined;
	/**
	 * The agent ID to load agent-specific instructions for.
	 * @default 'agent'
	 */
	readonly agentId?: string;
	/**
	 * @default true
	 */
	readonly includeCodeGenerationInstructions?: boolean;
	/**
	 * @default false
	 */
	readonly includeTestGenerationInstructions?: boolean;
	/**
	 * @default false
	 */
	readonly includeCodeFeedbackInstructions?: boolean;
	/**
	 * @default false
	 */
	readonly includeCommitMessageGenerationInstructions?: boolean;
	/**
	 * @default false
	 */
	readonly includePullRequestDescriptionGenerationInstructions?: boolean;
	readonly customIntroduction?: string;

	/**
	 * @default true
	 */
	readonly includeSystemMessageConflictWarning?: boolean;
}

export class CustomInstructions extends PromptElement<CustomInstructionsProps> {
	constructor(
		props: CustomInstructionsProps,
		@ICustomInstructionsService private readonly customInstructionsService: ICustomInstructionsService,
		@IPromptPathRepresentationService private readonly promptPathRepresentationService: IPromptPathRepresentationService,
		@IPromptVariablesService private readonly promptVariablesService: IPromptVariablesService,
		@IFileSystemService private readonly fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly workspaceService: IWorkspaceService,
		@ILogService private readonly logService: ILogService,
	) {
		super(props);
	}
	override async render(state: void, sizing: PromptSizing) {

		const { includeCodeGenerationInstructions, includeTestGenerationInstructions, includeCodeFeedbackInstructions, includeCommitMessageGenerationInstructions, includePullRequestDescriptionGenerationInstructions, customIntroduction } = this.props;
		const includeSystemMessageConflictWarning = this.props.includeSystemMessageConflictWarning ?? true;
		const rawAgentId = this.props.agentId ?? 'agent';
		const agentId = normalizeAgentIdForInstructions(rawAgentId);

		const chunks = [];

		this.logService.info(`[CustomInstructions] render() called with rawAgentId=${rawAgentId}, normalized agentId=${agentId}`);

		if (includeCodeGenerationInstructions !== false) {
			const instructionFiles = new ResourceSet(await this.customInstructionsService.getAgentInstructions());
			this.logService.info(`[CustomInstructions] getAgentInstructions() returned ${instructionFiles.size} files`);
			if (this.props.chatVariables) {
				for (const variable of this.props.chatVariables) {
					if (isPromptInstruction(variable)) {
						if (isString(variable.value)) {
							this.logService.info(`[CustomInstructions] chatVariable string value: ${variable.value.substring(0, 100)}...`);
							chunks.push(<TextChunk>{variable.value}</TextChunk>);
						} else if (isUri(variable.value)) {
							// Filter out any instruction files from .github/agents/ - we'll load those ourselves
							const uriString = variable.value.toString();
							const isAgentPath = AGENTS_PATH_REGEX.test(uriString);
							this.logService.info(`[CustomInstructions] chatVariable URI: ${uriString}, isAgentPath=${isAgentPath}, filtered=${isAgentPath}`);
							if (!isAgentPath) {
								instructionFiles.add(variable.value);
							}
						}
					}
				}
			}
			// Load agent-specific instructions (only files with 'instructions' in name, like orchestrator does)
			const agentInstructionUris = await this.getAgentSpecificInstructionUris(agentId);
			for (const uri of agentInstructionUris) {
				instructionFiles.add(uri);
			}

			for (const instructionFile of instructionFiles) {
				if (!hasSeen.has(instructionFile)) {
					hasSeen.add(instructionFile);
					const chunk = await this.createElementFromURI(instructionFile);
					if (chunk) {
						chunks.push(chunk);
					}
				}
			}
		}

		const customInstructions: ICustomInstructions[] = [];
		if (includeCodeGenerationInstructions !== false) {
			customInstructions.push(...await this.customInstructionsService.fetchInstructionsFromSetting(ConfigKey.CodeGenerationInstructions));
		}
		if (includeTestGenerationInstructions) {
			customInstructions.push(...await this.customInstructionsService.fetchInstructionsFromSetting(ConfigKey.TestGenerationInstructions));
		}
		if (includeCodeFeedbackInstructions) {
			customInstructions.push(...await this.customInstructionsService.fetchInstructionsFromSetting(ConfigKey.CodeFeedbackInstructions));
		}
		if (includeCommitMessageGenerationInstructions) {
			customInstructions.push(...await this.customInstructionsService.fetchInstructionsFromSetting(ConfigKey.CommitMessageGenerationInstructions));
		}
		if (includePullRequestDescriptionGenerationInstructions) {
			customInstructions.push(...await this.customInstructionsService.fetchInstructionsFromSetting(ConfigKey.PullRequestDescriptionGenerationInstructions));
		}
		for (const instruction of customInstructions) {
			const chunk = this.createInstructionElement(instruction);
			if (chunk) {
				chunks.push(chunk);
			}
		}
		if (chunks.length === 0) {
			return undefined;
		}
		const introduction = customIntroduction ?? 'When generating code, please follow these user provided coding instructions.';
		const systemMessageConflictWarning = includeSystemMessageConflictWarning && ' You can ignore an instruction if it contradicts a system message.';

		return (<>
			{introduction}{systemMessageConflictWarning}<br />
			<Tag name='instructions'>
				{
					...chunks
				}
			</Tag>

		</>);
	}

	/**
	 * Get URIs for agent-specific instruction files from .github/agents/{agentId}/.
	 * Only returns files that contain 'instructions' in the name (filters out skills, etc.).
	 * This mirrors the logic in AgentInstructionService.getAgentInstructions().
	 * Supports case-insensitive folder matching (e.g., 'agent', 'Agent', 'AGENT').
	 */
	private async getAgentSpecificInstructionUris(agentId: string): Promise<URI[]> {
		this.logService.info(`[CustomInstructions] getAgentSpecificInstructionUris() called with agentId=${agentId}`);
		const workspaceFolders = this.workspaceService.getWorkspaceFolders();
		this.logService.info(`[CustomInstructions] workspaceFolders count: ${workspaceFolders.length}`);
		if (workspaceFolders.length === 0) {
			this.logService.info(`[CustomInstructions] No workspace folders found, returning empty`);
			return [];
		}

		const instructionUris: URI[] = [];

		for (const folder of workspaceFolders) {
			this.logService.info(`[CustomInstructions] Processing workspace folder: ${folder.toString()}`);
			// Try to find the agents folder with case-insensitive matching
			const agentDir = await this.findAgentDirectory(folder, agentId);
			this.logService.info(`[CustomInstructions] findAgentDirectory returned: ${agentDir?.toString() ?? 'undefined'}`);
			if (agentDir) {
				const uris = await this.getInstructionFileUrisInDir(agentDir);
				this.logService.info(`[CustomInstructions] getInstructionFileUrisInDir returned ${uris.length} URIs`);
				instructionUris.push(...uris);
			}
		}

		this.logService.info(`[CustomInstructions] Total instruction URIs found: ${instructionUris.length}`);
		return instructionUris;
	}

	/**
	 * Find the agent directory with case-insensitive matching.
	 * Looks for .github/agents/{agentId} with any casing.
	 */
	private async findAgentDirectory(workspaceFolder: URI, agentId: string): Promise<URI | undefined> {
		this.logService.info(`[CustomInstructions] findAgentDirectory() looking for agentId=${agentId} in ${workspaceFolder.toString()}`);
		try {
			// First, find the .github folder (case-insensitive)
			const rootEntries = await this.fileSystemService.readDirectory(workspaceFolder);
			this.logService.info(`[CustomInstructions] Root entries: ${rootEntries.map(([n, t]) => `${n}(${t})`).join(', ')}`);
			const githubFolder = rootEntries.find(([name, type]) =>
				type === FileType.Directory && name.toLowerCase() === '.github'
			);
			if (!githubFolder) {
				this.logService.info(`[CustomInstructions] .github folder NOT found`);
				return undefined;
			}
			this.logService.info(`[CustomInstructions] .github folder found: ${githubFolder[0]}`);

			const githubDir = URI.joinPath(workspaceFolder, githubFolder[0]);

			// Find the agents folder (case-insensitive)
			const githubEntries = await this.fileSystemService.readDirectory(githubDir);
			this.logService.info(`[CustomInstructions] .github entries: ${githubEntries.map(([n, t]) => `${n}(${t})`).join(', ')}`);
			const agentsFolder = githubEntries.find(([name, type]) =>
				type === FileType.Directory && name.toLowerCase() === 'agents'
			);
			if (!agentsFolder) {
				this.logService.info(`[CustomInstructions] agents folder NOT found`);
				return undefined;
			}
			this.logService.info(`[CustomInstructions] agents folder found: ${agentsFolder[0]}`);

			const agentsDir = URI.joinPath(githubDir, agentsFolder[0]);

			// Find the specific agent folder (case-insensitive)
			const agentEntries = await this.fileSystemService.readDirectory(agentsDir);
			this.logService.info(`[CustomInstructions] agents entries: ${agentEntries.map(([n, t]) => `${n}(${t})`).join(', ')}`);
			const agentFolder = agentEntries.find(([name, type]) =>
				type === FileType.Directory && name.toLowerCase() === agentId.toLowerCase()
			);
			if (!agentFolder) {
				this.logService.info(`[CustomInstructions] agent folder '${agentId}' NOT found`);
				return undefined;
			}
			this.logService.info(`[CustomInstructions] agent folder found: ${agentFolder[0]}`);

			return URI.joinPath(agentsDir, agentFolder[0]);
		} catch (e) {
			// Directory doesn't exist or can't be read
			this.logService.info(`[CustomInstructions] findAgentDirectory error: ${e}`);
			return undefined;
		}
	}

	/**
	 * Get URIs of markdown files in a directory that contain 'instructions' in the name (case-insensitive).
	 * Matches patterns like: instructions.md, agent-instructions.md, agent.instructions.md, Instructions.md, etc.
	 */
	private async getInstructionFileUrisInDir(dirUri: URI): Promise<URI[]> {
		this.logService.info(`[CustomInstructions] getInstructionFileUrisInDir() scanning ${dirUri.toString()}`);
		try {
			const entries = await this.fileSystemService.readDirectory(dirUri);
			this.logService.info(`[CustomInstructions] Directory entries: ${entries.map(([n, t]) => `${n}(${t})`).join(', ')}`);
			const mdFiles = entries
				.filter(([name, type]) => type === FileType.File && name.toLowerCase().endsWith('.md') && name.toLowerCase().includes('instructions'))
				.sort(([a], [b]) => a.localeCompare(b)); // Sort alphabetically for consistent ordering
			this.logService.info(`[CustomInstructions] Filtered instruction files: ${mdFiles.map(([n]) => n).join(', ')}`);

			const uris: URI[] = [];
			for (const [name] of mdFiles) {
				const fileUri = URI.joinPath(dirUri, name);
				this.logService.info(`[CustomInstructions] Found instruction file URI: ${fileUri.toString()}`);
				uris.push(fileUri);
			}

			this.logService.info(`[CustomInstructions] Total URIs found: ${uris.length}`);
			return uris;
		} catch (e) {
			this.logService.info(`[CustomInstructions] getInstructionFileUrisInDir error: ${e}`);
			return [];
		}
	}

	private async createElementFromURI(uri: URI) {
		const instructions = await this.customInstructionsService.fetchInstructionsFromFile(uri);
		if (instructions) {
			return <Tag name='attachment' attrs={{ filePath: this.promptPathRepresentationService.getFilePath(uri) }}>
				<references value={[new CustomInstructionPromptReference(instructions, instructions.content.map(instruction => instruction.instruction))]} />
				{instructions.content.map(instruction => <TextChunk>{instruction.instruction}</TextChunk>)}
			</Tag>;
		} catch (e) {
			this.logService.debug(`Instruction file not found: ${fileUri.toString()}`);
			return undefined;
		}
	}

	private createInstructionElement(instructions: ICustomInstructions) {
		const lines = [];
		for (const entry of instructions.content) {
			if (entry.languageId) {
				if (entry.languageId === this.props.languageId) {
					lines.push(`For ${entry.languageId} code: ${entry.instruction}`);
				}
			} else {
				lines.push(entry.instruction);
			}
		}
		if (lines.length === 0) {
			return undefined;
		}

		return (<>
			<references value={[new CustomInstructionPromptReference(instructions, lines)]} />
			<>
				{
					lines.map(line => <TextChunk>{line}</TextChunk>)
				}
			</>
		</>);
	}

}

export class CustomInstructionPromptReference extends PromptReference {
	constructor(public readonly instructions: ICustomInstructions, public readonly usedInstructions: string[]) {
		super(instructions.reference);
	}
}

export class InstructionFileReference extends PromptReference {
	constructor(public readonly ref: URI, public readonly instruction: string) {
		super(ref);
	}
}

export function getCustomInstructionTelemetry(references: readonly PromptReference[]): { codeGenInstructionsCount: number; codeGenInstructionsLength: number; codeGenInstructionsFilteredCount: number; codeGenInstructionFileCount: number; codeGenInstructionSettingsCount: number } {
	let codeGenInstructionsCount = 0;
	let codeGenInstructionsFilteredCount = 0;
	let codeGenInstructionsLength = 0;
	let codeGenInstructionFileCount = 0;
	let codeGenInstructionSettingsCount = 0;

	for (const reference of references) {
		if (reference instanceof CustomInstructionPromptReference) {
			codeGenInstructionsCount += reference.usedInstructions.length;
			codeGenInstructionsLength += reference.usedInstructions.reduce((acc, instruction) => acc + instruction.length, 0);
			codeGenInstructionsFilteredCount += Math.max(reference.instructions.content.length - reference.usedInstructions.length, 0);
			if (reference.instructions.kind === CustomInstructionsKind.File) {
				codeGenInstructionFileCount++;
			} else {
				codeGenInstructionSettingsCount += reference.usedInstructions.length;
			}
		} else if (reference instanceof InstructionFileReference) {
			codeGenInstructionsLength += reference.instruction.length;
			codeGenInstructionsCount++;
			codeGenInstructionFileCount++;
		}
	}
	return { codeGenInstructionsCount, codeGenInstructionsLength, codeGenInstructionsFilteredCount, codeGenInstructionFileCount, codeGenInstructionSettingsCount };

}
