import type { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, saveConfig, getCurrentProfile } from '../utils/config.js';
import type { HeadlessConfig } from '../utils/config.js';
import { printDetail, printTable, success, error, info } from '../utils/format.js';
import { enableTelemetry, disableTelemetry, isTelemetryEnabled, getTelemetryStats, getPrivacyNotice } from '../utils/telemetry.js';

// ── config:init ─────────────────────────────────────────

async function initConfig(): Promise<void> {
	console.log(pc.cyan('\n◆ Initialize .headlessrc\n'));

	const existing = loadConfig();
	if (Object.keys(existing).length > 0) {
		const overwrite = (await p.confirm({
			message: '.headlessrc already exists. Overwrite?',
			initialValue: false,
		})) as boolean | symbol;
		if (p.isCancel(overwrite) || !overwrite) return;
	}

	const apiUrl = (await p.text({
		message: 'API URL',
		placeholder: 'http://localhost:8788',
		defaultValue: 'http://localhost:8788',
	})) as string | symbol;
	if (p.isCancel(apiUrl)) return;

	const authToken = (await p.text({
		message: 'Auth token (dev-token or JWT)',
		placeholder: 'dev-token',
		defaultValue: 'dev-token',
	})) as string | symbol;
	if (p.isCancel(authToken)) return;

	const addProfiles = (await p.confirm({
		message: 'Add named profiles? (e.g. staging, prod)',
		initialValue: false,
	})) as boolean | symbol;
	if (p.isCancel(addProfiles)) return;

	const config: HeadlessConfig = {
		apiUrl: apiUrl as string,
		authToken: authToken as string,
		profile: 'default',
		profiles: {
			default: {
				apiUrl: apiUrl as string,
				authToken: authToken as string,
				description: 'Default profile',
			},
		},
	};

	if (addProfiles) {
		let adding: boolean | symbol = true;
		while (adding === true) {
			const name = (await p.text({
				message: 'Profile name (e.g. staging, prod)',
				placeholder: 'staging',
			})) as string | symbol;
			if (p.isCancel(name)) break;

			const profileUrl = (await p.text({
				message: `API URL for "${name}"`,
				placeholder: 'https://staging.example.com',
			})) as string | symbol;
			if (p.isCancel(profileUrl)) break;

			const profileToken = (await p.text({
				message: `Auth token for "${name}"`,
				placeholder: 'xxx',
			})) as string | symbol;
			if (p.isCancel(profileToken)) break;

			const desc = (await p.text({
				message: `Description (optional)`,
				placeholder: 'Staging environment',
			})) as string | symbol;
			if (p.isCancel(desc)) break;

			config.profiles![name as string] = {
				apiUrl: profileUrl as string,
				authToken: profileToken as string,
				description: (desc as string) || undefined,
			};

			adding = await p.confirm({
				message: 'Add another profile?',
				initialValue: false,
			});
			if (p.isCancel(adding)) break;
		}
	}

	const s = p.spinner();
	s.start('Writing .headlessrc...');

	try {
		saveConfig(config);
		s.stop(pc.green('Config saved to .headlessrc'));

		console.log('');
		console.log(pc.green('✓ Configuration saved!'));
		console.log(`  ${pc.cyan('.headlessrc')} — project-level config`);
		if (addProfiles) {
			const profileNames = Object.keys(config.profiles || {});
			console.log(`  Profiles: ${pc.cyan(profileNames.join(', '))}`);
			console.log('');
			console.log(`  Switch profile: ${pc.cyan('headless config profile switch <name>')}`);
		}
		console.log('');
	} catch (err) {
		s.stop(pc.red('Failed to save config'));
		console.error(pc.red(String(err)));
	}
}

// ── config:show ─────────────────────────────────────────

async function showConfig(program: Command): Promise<void> {
	const opts = program.opts<{ profile?: string }>();
	const config = loadConfig();

	if (Object.keys(config).length === 0) {
		console.log(pc.yellow('No config found. Run `headless config init` to create one.'));
		return;
	}

	// If a --profile flag was passed globally, resolve that specific profile
	const resolvedProfile = opts.profile || config.profile || 'default';
	const profile = getCurrentProfile({ ...config, profile: resolvedProfile });

	console.log(pc.cyan(`\n◆ Configuration (profile: ${resolvedProfile})\n`));

	const detail: Record<string, unknown> = {
		'Active profile': resolvedProfile,
		'API URL': profile.apiUrl,
		'Auth token': profile.authToken ? `${profile.authToken.slice(0, 8)}...` : '(none)',
		Description: profile.description || '(none)',
	};

	if (config.profiles && Object.keys(config.profiles).length > 0) {
		detail['Profiles'] = Object.keys(config.profiles).join(', ');
	}

	printDetail(detail);

	// Show all profiles if there are multiple
	if (config.profiles && Object.keys(config.profiles).length > 1) {
		console.log('');
		console.log(pc.bold('All profiles:'));
		const rows = Object.entries(config.profiles).map(([name, p]) => ({
			Name: name === resolvedProfile ? pc.green(`* ${name}`) : `  ${name}`,
			URL: p.apiUrl,
			Description: p.description || '',
		}));
		printTable(rows, ['Name', 'URL', 'Description']);
	}

	console.log('');
}

// ── config:profile add ──────────────────────────────────

async function addProfile(): Promise<void> {
	console.log(pc.cyan('\n◆ Add profile\n'));

	const config = loadConfig();

	const name = (await p.text({
		message: 'Profile name (e.g. staging, prod)',
		placeholder: 'staging',
		validate(value) {
			if (!value) return 'Profile name is required';
			if (config.profiles?.[value]) return `Profile "${value}" already exists`;
		},
	})) as string | symbol;
	if (p.isCancel(name)) return;

	const apiUrl = (await p.text({
		message: 'API URL',
		placeholder: 'https://staging.example.com',
		validate(value) {
			if (!value) return 'API URL is required';
		},
	})) as string | symbol;
	if (p.isCancel(apiUrl)) return;

	const authToken = (await p.text({
		message: 'Auth token',
		placeholder: 'your-jwt-token',
	})) as string | symbol;
	if (p.isCancel(authToken)) return;

	const description = (await p.text({
		message: 'Description (optional)',
		placeholder: 'Staging environment',
	})) as string | symbol;
	if (p.isCancel(description)) return;

	if (!config.profiles) config.profiles = {};
	config.profiles[name as string] = {
		apiUrl: apiUrl as string,
		authToken: (authToken as string) || undefined,
		description: (description as string) || undefined,
	};

	const s = p.spinner();
	s.start('Saving...');
	try {
		saveConfig(config);
		s.stop(pc.green(`Profile "${name}" added.`));
		success(`Use 'headless config profile switch ${name}' to activate it.`);
	} catch (err) {
		s.stop(pc.red('Failed to save config'));
		console.error(pc.red(String(err)));
	}
}

// ── config:profile remove ───────────────────────────────

async function removeProfile(): Promise<void> {
	console.log(pc.cyan('\n◆ Remove profile\n'));

	const config = loadConfig();

	if (!config.profiles || Object.keys(config.profiles).length === 0) {
		console.log(pc.yellow('No profiles configured.'));
		return;
	}

	const profileNames = Object.keys(config.profiles);

	const name = (await p.select({
		message: 'Select profile to remove',
		options: profileNames.map((n) => ({
			value: n,
			label: n,
			hint: config.profiles?.[n]?.description,
		})),
	})) as string | symbol;
	if (p.isCancel(name)) return;

	if (name === config.profile) {
		const changeDefault = (await p.confirm({
			message: `"${name}" is the active profile. Remove it anyway?`,
			initialValue: false,
		})) as boolean | symbol;
		if (p.isCancel(changeDefault) || !changeDefault) return;
	}

	const confirmed = (await p.confirm({
		message: `Really remove profile "${name}"?`,
		initialValue: false,
	})) as boolean | symbol;
	if (p.isCancel(confirmed) || !confirmed) return;

	delete config.profiles[name as string];

	if (config.profile === name) {
		// Switch to first remaining profile
		const remaining = Object.keys(config.profiles);
		config.profile = remaining.length > 0 ? remaining[0] : undefined;
	}

	const s = p.spinner();
	s.start('Saving...');
	try {
		saveConfig(config);
		s.stop(pc.green(`Profile "${name}" removed.`));
	} catch (err) {
		s.stop(pc.red('Failed to save config'));
		console.error(pc.red(String(err)));
	}
}

// ── config:profile switch ───────────────────────────────

async function switchProfile(name?: string): Promise<void> {
	const config = loadConfig();

	if (!config.profiles || Object.keys(config.profiles).length === 0) {
		console.log(pc.yellow('No profiles configured. Run `headless config init` or `headless config profile add`.'));
		return;
	}

	let target: string;

	if (name) {
		target = name;
	} else {
		console.log(pc.cyan('\n◆ Switch profile\n'));
		const profileNames = Object.keys(config.profiles);
		const selected = (await p.select({
			message: 'Select profile',
			options: profileNames.map((n) => ({
				value: n,
				label: n,
				hint: config.profiles?.[n]?.description || config.profiles?.[n]?.apiUrl,
			})),
		})) as string | symbol;
		if (p.isCancel(selected)) return;
		target = selected;
	}

	if (!config.profiles[target]) {
		error(`Profile "${target}" not found. Available: ${Object.keys(config.profiles).join(', ')}`);
		return;
	}

	config.profile = target;

	const s = p.spinner();
	s.start('Saving...');
	try {
		saveConfig(config);
		s.stop(pc.green(`Switched to profile "${target}".`));
		info(`API URL: ${config.profiles[target].apiUrl}`);
	} catch (err) {
		s.stop(pc.red('Failed to save config'));
		console.error(pc.red(String(err)));
	}
}

// ── Register subcommands ────────────────────────────────

export function registerConfigCommands(program: Command): void {
	const configCmd = program.command('config').description('Manage CLI configuration and profiles');

	configCmd
		.command('init')
		.description('Initialize .headlessrc interactively')
		.action(async () => {
			try {
				await initConfig();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	configCmd
		.command('show')
		.description('Show current configuration')
		.action(async function (this: Command) {
			try {
				await showConfig(program);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	// ── config:telemetry sub-group ───────────────────────
	const telemetryCmd = configCmd.command('telemetry').description('Manage anonymous usage telemetry');

	telemetryCmd
		.command('on')
		.description('Enable telemetry')
		.option('--endpoint <url>', 'Optional remote telemetry endpoint')
		.action(async (options: { endpoint?: string }) => {
			enableTelemetry(options.endpoint);
			console.log(pc.green('✔ Telemetry enabled.'));
			console.log(getPrivacyNotice());
		});

	telemetryCmd
		.command('off')
		.description('Disable telemetry')
		.action(async () => {
			disableTelemetry();
			console.log(pc.yellow('⚠ Telemetry disabled.'));
		});

	telemetryCmd
		.command('status')
		.description('Show telemetry status and stats')
		.action(async () => {
			const enabled = isTelemetryEnabled();
			console.log(
				pc.bold(`
Telemetry: ${enabled ? pc.green('enabled') : pc.yellow('disabled')}`),
			);

			const stats = getTelemetryStats();
			console.log(`  Total events recorded: ${stats.totalEvents}`);

			if (stats.totalEvents > 0) {
				console.log('');
				console.log(pc.bold('  Commands:'));
				const rows = Object.entries(stats.commands)
					.sort((a, b) => b[1] - a[1])
					.map(([cmd, count]) => ({ Command: cmd, Count: String(count) }));
				printTable(rows, ['Command', 'Count']);
			}

			console.log('');
			if (enabled) {
				console.log(getPrivacyNotice());
			}
		});

	// ── config:profile sub-group ─────────────────────────
	const profileCmd = configCmd.command('profile').description('Manage named profiles');

	profileCmd
		.command('add')
		.description('Add a new profile')
		.action(async () => {
			try {
				await addProfile();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	profileCmd
		.command('remove')
		.description('Remove a profile')
		.action(async () => {
			try {
				await removeProfile();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});

	profileCmd
		.command('switch [name]')
		.description('Switch active profile')
		.action(async (name?: string) => {
			try {
				await switchProfile(name);
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
