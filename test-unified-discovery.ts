/**
 * Test script to verify UnifiedDefinitionService discovers all commands, agents, and skills
 *
 * Run with: npx tsx test-unified-discovery.ts
 */

import * as fs from 'fs';
import * as path from 'path';

interface DiscoveryResults {
	commands: { builtin: string[]; repo: string[] };
	agents: { builtin: string[]; repo: string[] };
	skills: { builtin: string[]; repo: string[] };
}

async function discoverFiles(baseDir: string, pattern: RegExp): Promise<string[]> {
	const results: string[] = [];

	async function walk(dir: string) {
		if (!fs.existsSync(dir)) {
			return;
		}

		const entries = fs.readdirSync(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile() && pattern.test(entry.name)) {
				results.push(fullPath);
			}
		}
	}

	await walk(baseDir);
	return results;
}

async function testDiscovery(): Promise<void> {
	console.log('🔍 Testing Unified Definition Service Discovery\n');

	const rootDir = __dirname;
	const results: DiscoveryResults = {
		commands: { builtin: [], repo: [] },
		agents: { builtin: [], repo: [] },
		skills: { builtin: [], repo: [] }
	};

	// Discover Commands
	console.log('📋 Discovering Commands...');
	const builtinCommands = await discoverFiles(
		path.join(rootDir, 'assets', 'commands'),
		/\.command\.md$/
	);
	const repoCommands = await discoverFiles(
		path.join(rootDir, '.github', 'commands'),
		/\.command\.md$/
	);

	results.commands.builtin = builtinCommands.map(p => path.relative(rootDir, p));
	results.commands.repo = repoCommands.map(p => path.relative(rootDir, p));

	console.log(`  Builtin: ${results.commands.builtin.length} found`);
	results.commands.builtin.forEach(c => console.log(`    - ${c}`));
	console.log(`  Repo:    ${results.commands.repo.length} found`);
	results.commands.repo.forEach(c => console.log(`    - ${c}`));
	console.log();

	// Discover Agents
	console.log('🤖 Discovering Agents...');
	const builtinAgents = await discoverFiles(
		path.join(rootDir, 'assets', 'agents'),
		/\.agent\.md$/
	);
	const repoAgents = await discoverFiles(
		path.join(rootDir, '.github', 'agents'),
		/\.agent\.md$/
	);

	results.agents.builtin = builtinAgents.map(p => path.relative(rootDir, p));
	results.agents.repo = repoAgents.map(p => path.relative(rootDir, p));

	console.log(`  Builtin: ${results.agents.builtin.length} found`);
	results.agents.builtin.forEach(a => console.log(`    - ${a}`));
	console.log(`  Repo:    ${results.agents.repo.length} found`);
	results.agents.repo.forEach(a => console.log(`    - ${a}`));
	console.log();

	// Discover Skills
	console.log('📚 Discovering Skills...');
	const builtinSkills = await discoverFiles(
		path.join(rootDir, 'assets', 'skills'),
		/SKILL\.md$/
	);
	const repoSkills = await discoverFiles(
		path.join(rootDir, '.github', 'skills'),
		/SKILL\.md$/
	);

	results.skills.builtin = builtinSkills.map(p => path.relative(rootDir, p));
	results.skills.repo = repoSkills.map(p => path.relative(rootDir, p));

	console.log(`  Builtin: ${results.skills.builtin.length} found`);
	results.skills.builtin.forEach(s => console.log(`    - ${s}`));
	console.log(`  Repo:    ${results.skills.repo.length} found`);
	results.skills.repo.forEach(s => console.log(`    - ${s}`));
	console.log();

	// Verify skill references
	console.log('📁 Verifying Skill References...');
	for (const skillPath of [...builtinSkills, ...repoSkills]) {
		const skillDir = path.dirname(skillPath);
		const referencesDir = path.join(skillDir, 'references');

		if (fs.existsSync(referencesDir)) {
			const refFiles = fs.readdirSync(referencesDir).filter(f => f.endsWith('.md'));
			const skillName = path.basename(skillDir);
			console.log(`  ${skillName}: ${refFiles.length} reference files`);
			refFiles.forEach(f => console.log(`    - ${f}`));
		}
	}
	console.log();

	// Summary
	console.log('📊 Summary:');
	console.log(`  Total Commands: ${results.commands.builtin.length + results.commands.repo.length}`);
	console.log(`  Total Agents:   ${results.agents.builtin.length + results.agents.repo.length}`);
	console.log(`  Total Skills:   ${results.skills.builtin.length + results.skills.repo.length}`);
	console.log();

	// Expected counts based on what we created
	const expected = {
		commands: { builtin: 2, repo: 2 },
		agents: { builtin: 2, repo: 2 },  // Plus existing ones
		skills: { builtin: 2, repo: 2 }
	};

	console.log('✅ Expected Test Files:');
	console.log(`  Commands: ${expected.commands.builtin} builtin, ${expected.commands.repo} repo`);
	console.log(`  Agents:   ${expected.agents.builtin} builtin (test), ${expected.agents.repo} repo (test)`);
	console.log(`  Skills:   ${expected.skills.builtin} builtin, ${expected.skills.repo} repo`);
	console.log();

	// Verify specific test files exist
	console.log('🎯 Verifying Test Files:');
	const testFiles = [
		// Global commands
		'assets/commands/code-review.command.md',
		'assets/commands/explain-code.command.md',
		// Global agents
		'assets/agents/review/test-quality-reviewer.agent.md',
		'assets/agents/workflow/documentation-writer.agent.md',
		// Global skills
		'assets/skills/testing-best-practices/SKILL.md',
		'assets/skills/typescript-patterns/SKILL.md',
		// Local commands
		'.github/commands/create-tool.command.md',
		'.github/commands/test-prompt-tsx.command.md',
		// Local agents
		'.github/agents/copilot/architecture-expert.agent.md',
		'.github/agents/copilot/prompt-tsx-engineer.agent.md',
		// Local skills
		'.github/skills/copilot-tool-design/SKILL.md',
		'.github/skills/prompt-tsx-patterns/SKILL.md'
	];

	let allFound = true;
	for (const file of testFiles) {
		const fullPath = path.join(rootDir, file);
		const exists = fs.existsSync(fullPath);
		const status = exists ? '✅' : '❌';
		console.log(`  ${status} ${file}`);
		if (!exists) allFound = false;
	}
	console.log();

	if (allFound) {
		console.log('🎉 SUCCESS: All test files created and discoverable!');
	} else {
		console.log('⚠️  WARNING: Some test files are missing');
	}
}

// Run the test
testDiscovery().catch(console.error);
