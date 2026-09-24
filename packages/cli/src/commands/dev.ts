import type { Command } from 'commander';
import pc from 'picocolors';
import { spawn } from 'node:child_process';
import { getApiDir } from '../utils/file.js';
import { baseUrl } from '../utils/api.js';

/**
 * Resolve the dev port: the configured API base URL port (if set) → 8788.
 * Uses the shared single source of truth for the base URL (utils/api.ts).
 */
function defaultPort(): string {
	const m = baseUrl().match(/:\d+/);
	return m ? m[0].slice(1) : '8788';
}

export function registerDevCommand(program: Command): void {
	program
		.command('dev')
		.description('Start the API dev server (wraps wrangler dev)')
		.option('-p, --port <port>', 'Port to listen on (default: from .headlessrc apiUrl, else 8788)')
		.action(async (options: { port?: string }) => {
			const apiDir = getApiDir();
			const port = options.port ?? defaultPort();

			console.log(pc.cyan('\n◆ Starting dev server\n'));
			console.log(pc.dim(`  cd apps/api && npx wrangler dev --port ${port}`));
			console.log('');

			const child = spawn('npx', ['wrangler', 'dev', '--port', port], {
				cwd: apiDir,
				stdio: 'inherit',
				shell: true,
			});

			child.on('error', (err) => {
				console.error(pc.red('Failed to start wrangler dev:'), err.message);
				process.exit(1);
			});

			child.on('exit', (code) => {
				if (code !== 0 && code !== null) {
					console.error(pc.red(`wrangler dev exited with code ${code}`));
				}
				process.exit(code ?? 0);
			});

			// Forward SIGINT to child
			process.on('SIGINT', () => {
				child.kill('SIGINT');
			});
		});
}
