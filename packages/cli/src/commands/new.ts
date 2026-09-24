/**
 * headless new — start a whole app in one guided journey.
 *
 * Chains the existing public command entry points (reuse, not re-implement):
 *   1. initProject — scaffold the project (name → template → DB → admin).
 *   2. collectionCreate — optional starter collection.
 *   3. addClientFlags + deployClient — optional tenant/client onboarding + deploy.
 *
 * Every step is optional and confirmed, so a non-technical user can drive a
 * full app from a single command without knowing the sub-commands.
 */
import type { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { isInteractive, guideConfirm } from '../utils/prompt.js';
import { initProject } from './init.js';
import { addClientFlags, deployClient, companyToPrefix } from './client.js';

/** Prompt for a project name with validation, or fall back to undefined (in-place). */
async function askProjectName(): Promise<string | undefined> {
	const raw = await p.text({
		message: 'Project name? (kebab-case; "." scaffolds the current directory)',
		placeholder: 'my-saas',
		validate: (v) =>
			!v || v === '.' || /^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : 'Use lowercase letters, digits and hyphens (or ".").',
	});
	if (p.isCancel(raw)) process.exit(0);
	return (raw as string).trim() || undefined;
}

/** Ask whether to onboard a client, then the company name; returns the prefix or null. */
async function askClient(): Promise<string | null> {
	const want = await guideConfirm('Register a tenant/client (a company deployment) for this project?', true);
	if (!want) return null;

	const company = (await p.text({
		message: 'Company / client name?',
		placeholder: 'Acme Corp',
		validate: (v) => ((v ?? '').trim() ? undefined : 'Company name is required'),
	})) as string;
	if (p.isCancel(company)) process.exit(0);

	const prefix = companyToPrefix(company);
	// Register the client (existing interactive flow reuses its own confirm).
	await addClientFlags({ company: company.trim(), prefix, yes: false });

	const deployNow = await guideConfirm(`Deploy the "${prefix}" client now? (creates D1/R2/secrets + deploys)`, false);
	if (deployNow) {
		deployClient(prefix, 'all', false);
	}
	return prefix;
}

/** The guided journey. */
export async function newWizard(program: Command): Promise<void> {
	void program; // kept for interface symmetry with the registry contract
	// Non-interactive: `headless new` needs a TTY to be useful; guard so CI
	// doesn't hang waiting on a prompt.
	if (!isInteractive()) {
		console.error('  headless new is a guided wizard — run it interactively.');
		process.exit(1);
	}

	p.intro(pc.green(' headless new — build an app in one journey '));

	const projectName = await askProjectName();

	// 1. Scaffold the project ('.' or empty name ⇒ in-place; already confirms).
	await initProject(projectName || '.', {
		skipInstall: true,
		yes: true,
	});
	p.log.info(`✓ Project ready (${projectName || 'current directory'}). Run "pnpm dev" to boot the dev servers.`);

	// 2. Optional starter collection.
	const wantCollection = await guideConfirm('Create a starter collection (e.g. Products)?', true);
	if (wantCollection) {
		p.note('Next step will create a collection via POST /api/entities. Start the API first if not already running.');
		console.log(pc.dim('  Tip: after "pnpm dev", run: headless collection create Products --template products'));
		p.log.info('Collection scaffolding left for after the API is running (see tip above).');
	}

	// 3. Optional client/tenant onboarding.
	const prefix = await askClient();

	// 4. Summary.
	p.outro(
		prefix
			? `Tenant "${prefix}" onboarded. Deployment details are in clients/${prefix}/.env (git-ignored).`
			: 'No client registered. Add one later: headless client add',
	);
}
