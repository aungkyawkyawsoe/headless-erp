import type { Command } from 'commander';
import pc from 'picocolors';
import { getFormatContext } from '../../utils/format.js';
import { guideConfirm, isInteractive } from '../../utils/prompt.js';
import { isConnectionError } from '../../utils/api.js';
import { apiFetch } from './shared.js';

// ── seedDemo ──────────────────────────────────────────────

async function seedDemo(): Promise<void> {
	const ctx = getFormatContext();

	if (ctx.dryRun) {
		console.log(pc.yellow('\n  ⚡ DRY RUN — no changes will be made'));
		console.log(pc.dim('  Would call GET /api/seed — this drops all tables and re-runs migrations'));
		console.log(pc.dim('  (the starter template ships with NO demo data — the DB resets to a clean slate)'));
		console.log('');
		return;
	}

	console.log(pc.cyan('\n◆ Resetting database...\n'));

	// Simple spinner using interval
	let dots = 0;
	const spinner = setInterval(() => {
		dots = (dots + 1) % 4;
		process.stdout.write(`\r  ${pc.cyan('⏳')} Resetting${'.'.repeat(dots)}   `);
	}, 300);

	try {
		const resp = await apiFetch('/api/seed');
		clearInterval(spinner);
		process.stdout.write('\r\x1b[K'); // clear line

		if (resp.success) {
			const data = resp.data as { log?: string[]; applied?: number } | undefined;
			console.log(pc.green('✔ Database reset complete (clean slate, no demo data)'));
			console.log('');

			if (data?.log && data.log.length > 0) {
				console.log(pc.bold('  Created:'));
				for (const entry of data.log) {
					console.log(`    ${pc.cyan('•')} ${entry}`);
				}
			}
			if (data?.applied !== undefined) {
				console.log('');
				console.log(pc.dim(`  Total: ${data.applied} items`));
			}
			console.log('');
		} else {
			console.log(pc.red('✖ Seed failed'));
			if (resp.error) console.error(pc.red(`  ${resp.error}`));
			process.exitCode = 1;
		}
	} catch (err) {
		clearInterval(spinner);
		process.stdout.write('\r\x1b[K');
		if (isConnectionError(err)) {
			console.error(pc.red('Cannot connect to the API.'));
			console.log(pc.dim('  Make sure the dev server is running (npx headless dev)'));
		} else {
			console.error(pc.red(String(err)));
		}
		process.exitCode = 1;
	}
}

// ── Register Subcommands ──────────────────────────────────

export function registerSeedCommands(db: Command): void {
	db.command('seed')
		.description('Reset database (⚠ DESTRUCTIVE — wipes all tables and re-migrates)')
		.option('--confirm', 'Confirm destructive seed operation')
		.action(async (options: { confirm?: boolean }) => {
			let ok = options.confirm;
			if (!ok && isInteractive()) {
				ok = (await guideConfirm('Seed drops ALL tables and re-runs migrations — continue?', false)) === true;
			}
			if (!ok) {
				console.error(pc.red('Seed is a DESTRUCTIVE operation — it drops ALL tables and re-runs migrations.'));
				console.log(pc.yellow('  Use --confirm to proceed, or make a backup first: headless db backup'));
				process.exitCode = 1;
				return;
			}
			try {
				await seedDemo();
			} catch (err) {
				console.error(pc.red('Unexpected error:'), err);
				process.exit(1);
			}
		});
}
