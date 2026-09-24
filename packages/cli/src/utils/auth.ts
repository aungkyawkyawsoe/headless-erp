/**
 * Admin credential resolution — NEVER hardcoded.
 *
 * Priority:
 *   1. MMBIX_ADMIN_EMAIL + MMBIX_ADMIN_PASSWORD env vars (auto-loaded from
 *      .env.local by bin/cli.ts — written by `headless init` / `./start.sh`)
 *   2. Interactive prompt (TTY only — masked password)
 *   3. Error with setup instructions (non-TTY / CI)
 */
import * as p from '@clack/prompts';
import { isInteractive } from './prompt.js';

export interface AdminCredentials {
	email: string;
	password: string;
}

export async function resolveAdminCredentials(): Promise<AdminCredentials> {
	const email = process.env.MMBIX_ADMIN_EMAIL?.trim();
	const password = process.env.MMBIX_ADMIN_PASSWORD;
	if (email && password) return { email, password };

	if (!isInteractive()) {
		throw new Error(
			'Admin credentials are not configured.\n' +
				'  Set MMBIX_ADMIN_EMAIL and MMBIX_ADMIN_PASSWORD (e.g. run `headless init` or `./start.sh` to generate .env.local),\n' +
				'  or run this command interactively and you will be prompted.',
		);
	}

	const promptedEmail = await p.text({
		message: 'Admin email',
		validate: (v) => (v && v.includes('@') ? undefined : 'Enter a valid email address'),
	});
	if (p.isCancel(promptedEmail)) throw new Error('Cancelled');

	const promptedPassword = await p.password({
		message: 'Admin password',
		mask: '*',
		validate: (v) => (v && v.length >= 8 ? undefined : 'Password must be at least 8 characters'),
	});
	if (p.isCancel(promptedPassword)) throw new Error('Cancelled');

	return { email: promptedEmail as string, password: promptedPassword as string };
}
