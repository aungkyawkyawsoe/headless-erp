import type { Command } from 'commander';
import pc from 'picocolors';
import { spawnSync, spawn } from 'node:child_process';
import { getApiDir, monorepoRoot, listDirs, getAppsDir } from '../utils/file.js';
import { guideMultiselect, guideSelect, isInteractive } from '../utils/prompt.js';
import { baseUrl, token } from '../utils/api.js';
import path from 'node:path';
import fs from 'node:fs';

// API base from the shared single source of truth (utils/api.ts).
const API_BASE = baseUrl();

interface DeployTarget {
	name: string;
	dir: string;
	type: 'api' | 'frontend' | 'worker';
	buildCmd?: string[];
}

interface DeployResult {
	name: string;
	type: 'api' | 'frontend' | 'worker';
	success: boolean;
	error?: string;
}

function discoverWorkerTargets(): DeployTarget[] {
	const appsDir = getAppsDir();
	const dirs = listDirs(appsDir);
	const targets: DeployTarget[] = [];

	for (const d of dirs) {
		// Match plugin-* and *-worker patterns, but exclude api and miniapp
		if (d === 'api' || d === 'miniapp') continue;
		if (d.startsWith('plugin-') || d.endsWith('-worker')) {
			targets.push({
				name: d,
				dir: path.join(appsDir, d),
				type: 'worker',
			});
		}
	}

	return targets;
}

function getDeployTargets(targetFilter: string): DeployTarget[] {
	const apiTarget: DeployTarget = { name: 'api', dir: getApiDir(), type: 'api' };
	const frontendTarget: DeployTarget = {
		name: 'miniapp',
		dir: path.resolve(monorepoRoot, 'apps', 'miniapp'),
		type: 'frontend',
		buildCmd: ['npm', 'run', 'build'],
	};
	const workerTargets = discoverWorkerTargets();

	switch (targetFilter) {
		case 'api':
			return [apiTarget];
		case 'miniapp':
			return [frontendTarget];
		case 'all':
			// Order: API first, then workers, then frontend last
			return [apiTarget, ...workerTargets, frontendTarget];
		default:
			// If a specific plugin/worker name is given, find it
			const matched =
				workerTargets.find((w) => w.name === targetFilter) ||
				workerTargets.find((w) => w.name === `plugin-${targetFilter}`) ||
				workerTargets.find((w) => w.name === `${targetFilter}-worker`);
			if (matched) return [matched];
			// Unknown target → fall back to 'all' with a warning
			console.log(pc.yellow(`Unknown target "${targetFilter}", deploying everything`));
			return [apiTarget, ...workerTargets, frontendTarget];
	}
}

function deployTarget(target: DeployTarget, dryRun: boolean): DeployResult {
	console.log(pc.cyan(`\n◆ Deploying ${target.name} (${target.type})`));

	if (dryRun) {
		if (target.buildCmd) {
			console.log(pc.dim(`  [dry-run] cd ${target.dir} && ${target.buildCmd.join(' ')}`));
		}
		console.log(pc.dim(`  [dry-run] cd ${target.dir} && npx wrangler deploy`));
		return { name: target.name, type: target.type, success: true };
	}

	// Build step for frontend
	if (target.buildCmd) {
		console.log(pc.dim(`  Building ${target.name}...`));
		const buildResult = spawnSync(target.buildCmd[0], target.buildCmd.slice(1), {
			cwd: target.dir,
			stdio: 'inherit',
			shell: true,
		});
		if (buildResult.status !== 0) {
			return {
				name: target.name,
				type: target.type,
				success: false,
				error: `Build failed with code ${buildResult.status}`,
			};
		}
	}

	const result = spawnSync('npx', ['wrangler', 'deploy'], {
		cwd: target.dir,
		stdio: 'inherit',
		shell: true,
	});

	return {
		name: target.name,
		type: target.type,
		success: result.status === 0,
		error: result.status !== 0 ? `Exit code ${result.status}` : undefined,
	};
}

function printDeploySummary(results: DeployResult[]): void {
	console.log(pc.cyan('\n◆ Deployment Summary\n'));
	const maxNameLen = Math.max(...results.map((r) => r.name.length), 10);
	const header = `  ${'Target'.padEnd(maxNameLen)}  ${'Type'.padEnd(10)}  Status`;
	console.log(pc.bold(header));
	console.log(pc.dim(`  ${'─'.repeat(maxNameLen)}  ${'─'.repeat(10)}  ──────────`));

	for (const r of results) {
		const name = r.name.padEnd(maxNameLen);
		const type = r.type.padEnd(10);
		const status = r.success ? pc.green('✅ deployed') : pc.red(`❌ failed${r.error ? ` (${r.error})` : ''}`);
		console.log(`  ${name}  ${type}  ${status}`);
	}
	console.log('');
}

// ─── Status Helpers ─────────────────────────────────────────

interface ServiceStatus {
	name: string;
	url: string;
	status: 'up' | 'down' | 'skipped';
	detail?: string;
}

async function checkUrl(name: string, url: string, timeoutMs = 3000): Promise<ServiceStatus> {
	try {
		const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (resp.ok) {
			let detail = `HTTP ${resp.status}`;
			try {
				const body = (await resp.json()) as Record<string, unknown>;
				if (body.version) detail += ` | v${body.version}`;
				if (body.status) detail += ` | ${body.status}`;
			} catch {
				// Not JSON — just use status code
			}
			return { name, url, status: 'up', detail };
		}
		return { name, url, status: 'down', detail: `HTTP ${resp.status}` };
	} catch {
		return { name, url, status: 'down', detail: 'unreachable' };
	}
}

function readWranglerPort(appDir: string): number | null {
	// Check wrangler config first
	const candidates = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'];
	for (const f of candidates) {
		const content = (() => {
			try {
				return fs.readFileSync(path.join(appDir, f), 'utf-8');
			} catch {
				return null;
			}
		})();
		if (content) {
			const m = content.match(/"port"\s*:\s*(\d+)/) || content.match(/port\s*=\s*(\d+)/);
			if (m) return parseInt(m[1], 10);
		}
	}
	// Fallback: check package.json dev script for --port N
	try {
		const pkgRaw = fs.readFileSync(path.join(appDir, 'package.json'), 'utf-8');
		const pkg = JSON.parse(pkgRaw);
		const devScript = (pkg?.scripts?.dev as string) || '';
		const portMatch = devScript.match(/--port\s+(\d+)/);
		if (portMatch) return parseInt(portMatch[1], 10);
	} catch {
		// ignore
	}
	return null;
}

function discoverWorkerDirectories(): { name: string; dir: string }[] {
	const appsDir = getAppsDir();
	const dirs = listDirs(appsDir);
	return dirs
		.filter((d) => d !== 'api' && d !== 'miniapp')
		.filter((d) => d.startsWith('plugin-') || d.endsWith('-worker'))
		.map((d) => ({ name: d, dir: path.join(appsDir, d) }));
}

// ─── Command Registration ──────────────────────────────────

export function registerOpsCommands(program: Command): void {
	// ── deploy ──────────────────────────────────────────

	program
		.command('deploy')
		.description('Deploy API, workers, and the mini app to Cloudflare')
		.option('--target <name>', 'Target to deploy: api, miniapp, all, or a plugin/worker name', 'all')
		.option('--dry-run', 'Show what would be deployed without executing')
		.action(async (options: { target: string; dryRun?: boolean }, command: Command) => {
			const isDryRun = options.dryRun ?? command.parent?.opts<{ dryRun?: boolean }>()?.dryRun ?? false;
			const explicitlyPassed = (command as unknown as { getOptionValue?: (k: string) => unknown }).getOptionValue?.('target') !== 'all';

			let targetFilter = options.target;
			// Guided mode: no --target → multiselect what to deploy
			if (!explicitlyPassed && isInteractive()) {
				const base = getDeployTargets('all');
				const picked = await guideMultiselect(
					'What do you want to deploy? (space to toggle, enter to confirm)',
					base.map((t) => ({ value: t.name, label: t.name, hint: t.type })),
					{ required: true },
				);
				if (picked.length === 0) return;
				targetFilter = picked.join(',');
			}

			const targets = targetFilter.split(',').flatMap((t) => getDeployTargets(t.trim()));
			const unique = targets.filter((t, i, arr) => arr.findIndex((x) => x.name === t.name) === i);

			if (unique.length === 0) {
				console.log(pc.yellow(`No deploy targets found for "${targetFilter}"`));
				return;
			}

			console.log(pc.cyan(`\n◆ Deploying ${unique.length} target(s)${isDryRun ? ' (dry-run)' : ''}`));
			for (const t of unique) {
				console.log(pc.dim(`  - ${t.name} (${t.type})`));
			}

			const results: DeployResult[] = [];
			for (const target of unique) {
				const result = deployTarget(target, isDryRun);
				results.push(result);
			}

			printDeploySummary(results);

			const failed = results.filter((r) => !r.success);
			if (failed.length > 0) {
				process.exitCode = 1;
			}
		});

	// ── status ──────────────────────────────────────────

	program
		.command('status')
		.description('Health-check all services')
		.option('--api-url <url>', 'API base URL', API_BASE)
		.option('--miniapp-url <url>', 'MiniApp URL', 'http://localhost:5175')
		.option('--timeout <ms>', 'Timeout per service in milliseconds', '3000')
		.action(async (options: { apiUrl: string; miniappUrl: string; timeout: string }) => {
			const timeoutMs = parseInt(options.timeout, 10) || 3000;
			const apiUrl = options.apiUrl || API_BASE;
			const feUrl = options.miniappUrl || 'http://localhost:5175';
			const services: ServiceStatus[] = [];

			console.log(pc.cyan('\n◆ Checking service health\n'));

			// API health
			const apiStatus = await checkUrl('API', `${apiUrl}/api/health`, timeoutMs);
			services.push(apiStatus);

			// MiniApp
			const feStatus = await checkUrl('MiniApp', feUrl, timeoutMs);
			services.push(feStatus);

			// D1 check via API — bearer token from the shared single source of truth
			const TOKEN = await token();
			async function checkAuthUrl(name: string, url: string, timeoutMs: number): Promise<ServiceStatus> {
				try {
					const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${TOKEN}` } });
					if (resp.ok) return { name, url, status: 'up', detail: `HTTP ${resp.status}` };
					return { name, url, status: 'down', detail: `HTTP ${resp.status}` };
				} catch {
					return { name, url, status: 'down', detail: 'unreachable' };
				}
			}
			if (apiStatus.status === 'up') {
				const d1Status = await checkAuthUrl('D1 (via API)', `${apiUrl}/api/entities?limit=1`, timeoutMs);
				services.push({ ...d1Status, name: 'D1 (via API)' });
			} else {
				services.push({
					name: 'D1 (via API)',
					url: `${apiUrl}/api/entities?limit=1`,
					status: 'skipped',
					detail: 'API not reachable',
				});
			}

			// Plugin workers
			const workers = discoverWorkerDirectories();
			if (workers.length > 0) {
				for (const w of workers) {
					const port = readWranglerPort(w.dir);
					if (port) {
						const status = await checkUrl(`Worker: ${w.name}`, `http://localhost:${port}/health`, timeoutMs);
						services.push(status);
					} else {
						services.push({
							name: `Worker: ${w.name}`,
							url: `(no port configured)`,
							status: 'skipped',
							detail: 'no port in wrangler config',
						});
					}
				}
			}

			// Print table
			const maxNameLen = Math.max(...services.map((s) => s.name.length), 12);
			const maxDetailLen = Math.max(...services.map((s) => s.detail?.length ?? 0), 16);

			console.log(pc.bold(`  ${'Service'.padEnd(maxNameLen)}  Status    ${'Detail'.padEnd(maxDetailLen)}`));
			console.log(pc.dim(`  ${'─'.repeat(maxNameLen)}  ────────  ${'─'.repeat(Math.max(maxDetailLen, 6))}`));

			for (const s of services) {
				const name = s.name.padEnd(maxNameLen);
				const icon = s.status === 'up' ? pc.green('● up ') : s.status === 'skipped' ? pc.yellow('○ skip') : pc.red('✖ down');
				const detail = (s.detail ?? '').padEnd(maxDetailLen);
				console.log(`  ${name}  ${icon}     ${pc.dim(detail)}`);
			}

			console.log('');

			const hasDown = services.some((s) => s.status === 'down');
			if (hasDown) {
				process.exitCode = 1;
			}
		});

	// ── logs ────────────────────────────────────────────

	program
		.command('logs')
		.description('Stream live logs from a deployed worker (wraps wrangler tail)')
		.argument('[worker]', 'Worker to tail: api, miniapp, or a plugin/worker name')
		.action(async (worker?: string) => {
			let dir: string;
			let label: string;

			// Guided mode: no worker → pick one
			if (!worker && isInteractive()) {
				const appsDir = getAppsDir();
				const choices = [
					{ value: 'api', label: 'api', hint: 'core API worker' },
					{ value: 'miniapp', label: 'miniapp', hint: 'BFF + SPA' },
					...listDirs(appsDir)
						.filter((d) => d !== 'api' && d !== 'miniapp' && (d.startsWith('plugin-') || d.endsWith('-worker')))
						.map((d) => ({ value: d, label: d })),
				];
				const picked = await guideSelect('Which worker logs do you want to tail?', choices);
				if (!picked) {
					if (!isInteractive()) console.error(pc.red('  Usage: headless logs [api|miniapp|<worker>]'));
					return;
				}
				worker = picked;
			}

			if (!worker || worker === 'api') {
				dir = getApiDir();
				label = 'API';
			} else if (worker === 'miniapp') {
				dir = path.resolve(monorepoRoot, 'apps', 'miniapp');
				label = 'MiniApp';
			} else {
				// Try to find the plugin/worker directory
				const appsDir = getAppsDir();
				const dirs = listDirs(appsDir);
				const match =
					dirs.find((d) => d === worker) || dirs.find((d) => d === `plugin-${worker}`) || dirs.find((d) => d === `${worker}-worker`);

				if (!match) {
					console.error(pc.red(`Unknown worker: "${worker}"`));
					console.log(
						pc.dim(`  Available: api, frontend, ${dirs.filter((d) => d.startsWith('plugin-') || d.endsWith('-worker')).join(', ')}`),
					);
					process.exit(1);
				}

				dir = path.join(appsDir, match);
				label = match;
			}

			console.log(pc.cyan(`\n◆ Tailing logs for ${label}`));
			console.log(pc.dim(`  cd ${dir} && npx wrangler tail\n`));

			const child = spawn('npx', ['wrangler', 'tail'], {
				cwd: dir,
				stdio: 'inherit',
				shell: true,
			});

			child.on('error', (err) => {
				console.error(pc.red('Failed to start wrangler tail:'), err.message);
				process.exit(1);
			});

			child.on('exit', (code) => {
				if (code !== 0 && code !== null) {
					console.error(pc.red(`wrangler tail exited with code ${code}`));
				}
				process.exit(code ?? 0);
			});

			process.on('SIGINT', () => {
				child.kill('SIGINT');
			});
		});
}
