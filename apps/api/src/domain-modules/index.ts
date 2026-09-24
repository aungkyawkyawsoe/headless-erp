/**
 * Domain Modules — business-specific endpoints mounted on the factory worker.
 *
 * The factory core (`routes/`, `plugins/`, `lib/`, `services/`) is domain-agnostic
 * and NEVER imports these modules. It reads the `ModuleManifest` each folder
 * declares (`<id>/manifest.ts`) and mounts it only when the deployment allows it
 * AND it is installed.
 *
 * Two gates, both must pass:
 *   1. BUILD allowlist — `DOMAIN_MODULES` (isModuleEnabled);
 *   2. RUNTIME install state — the `_addons` table (see `lib/addon-registry.ts`).
 *
 * This repo ships ONE factory-level module: `idp` (the Internal Developer
 * Platform admin surface).
 *
 * Adding a vertical = write `domain-modules/<id>/{routes,manifest}.ts`, push the
 * manifest into `moduleManifests`, then list the id in `DOMAIN_MODULES`
 * (infra/env.prod) + `pnpm gen:infra`. A disabled/uninstalled module is a 404 and
 * registers NOTHING — no routes, no hooks.
 */

import type { Context, Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { isModuleEnabled } from '@mmbix/config';
import { modulePath, type ModuleManifest } from '@mmbix/types';
import { fail } from '@/lib/api/response';
import { addonInstalled } from '@/lib/addon-registry';
import { idpManifest } from './idp/manifest';

/**
 * Modules shipped in this worker. Each is gated by `isModuleEnabled(env, id)`
 * (build) AND the `_addons` install state (runtime).
 */
export const moduleManifests: ModuleManifest[] = [idpManifest];

/** The add-on ids this build makes AVAILABLE (the `DOMAIN_MODULES` allowlist). */
function availableIds(env: Record<string, unknown>): Set<string> {
	return new Set(moduleManifests.filter((m) => isModuleEnabled(env, m.id)).map((m) => m.id));
}

/** Module ids whose compiled hooks have already been registered this isolate. */
const bootedHooks = new Set<string>();

/**
 * Register the compiled hooks of every INSTALLED module — ONCE per isolate.
 *
 * Hooks fire on ENGINE collections (e.g. a write to `orders`), so they must be
 * live for requests that never touch `/api/<module>`. Called from a global
 * middleware on every request; the `bootedHooks` set makes it a no-op after the
 * first. A disabled/uninstalled module registers nothing.
 */
export async function bootModuleHooks(env: Record<string, unknown>, db: D1Client): Promise<void> {
	const available = availableIds(env);
	for (const manifest of moduleManifests) {
		if (!manifest.hooks?.length || bootedHooks.has(manifest.id)) continue;
		if (!(await addonInstalled(available, db, manifest.id))) continue;
		bootedHooks.add(manifest.id);
		for (const register of manifest.hooks) register();
	}
}

/** Mount every available+installed module's routes; otherwise answer 404. */
export function mountDomainModules(app: Hono<{ Bindings: Record<string, unknown> }>): void {
	for (const manifest of moduleManifests) {
		const path = modulePath(manifest);
		app.use(`${path}/*`, async (c: Context, next) => {
			const env = (c.env ?? {}) as Record<string, unknown>;
			const available = availableIds(env);
			if (!available.has(manifest.id)) {
				return fail(c, `Route not found: ${c.req.method} ${c.req.path}`, 404, 'NOT_FOUND');
			}
			const db = new D1Client((env as { DB: D1Database }).DB);
			if (!(await addonInstalled(available, db, manifest.id))) {
				return fail(c, `Route not found: ${c.req.method} ${c.req.path}`, 404, 'NOT_FOUND');
			}
			await next();
		});
		app.route(path, manifest.routes);
	}
}
