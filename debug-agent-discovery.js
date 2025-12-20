/**
 * Debug script to test agent discovery without running full extension
 */

const fs = require('fs');
const path = require('path');

function scanGitHubAgentsDir(agentsDir) {
	const agents = [];

	if (!fs.existsSync(agentsDir)) {
		console.log(`❌ Directory doesn't exist: ${agentsDir}`);
		return agents;
	}

	console.log(`\n📁 Scanning: ${agentsDir}`);

	const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isDirectory()) {
			const name = entry.name;
			const expectedFile = path.join(agentsDir, name, `${name}.agent.md`);

			console.log(`  Checking: ${name}/`);
			console.log(`    Looking for: ${expectedFile}`);

			if (fs.existsSync(expectedFile)) {
				console.log(`    ✅ Found!`);

				// Try to parse frontmatter
				const content = fs.readFileSync(expectedFile, 'utf-8');
				const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);

				if (frontmatterMatch) {
					console.log(`    📋 Frontmatter:`);
					console.log(frontmatterMatch[1].split('\n').map(line => `      ${line}`).join('\n'));
				} else {
					console.log(`    ⚠️  No frontmatter found`);
				}

				agents.push({ name, path: expectedFile });
			} else {
				console.log(`    ❌ NOT FOUND`);
			}
		}
	}

	return agents;
}

console.log('🔍 Agent Discovery Debug\n');
console.log('=' .repeat(60));

const rootDir = __dirname;
const agentsDir = path.join(rootDir, '.github', 'agents');

const found = scanGitHubAgentsDir(agentsDir);

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Summary: Found ${found.length} agents`);
found.forEach(agent => console.log(`  - ${agent.name}`));

if (found.length === 0) {
	console.log('\n❌ NO AGENTS FOUND!');
	console.log('\nExpected structure:');
	console.log('  .github/agents/{name}/{name}.agent.md');
} else {
	console.log('\n✅ Discovery working!');
}
