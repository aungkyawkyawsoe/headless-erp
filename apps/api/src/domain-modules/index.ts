/**
 * Domain Modules — business-specific endpoints mounted on the factory worker.
 *
 * The factory core (`routes/`, `plugins/`, `lib/`, `services/`) is domain-agnostic
 * and NEVER imports these modules. It reads the `ModuleManifest` each folder
 * declares (`<id>/manifest.ts`) and mounts it only when the deployment enables it.
 *
 * This repo ships ONE factory-level module:
 *   - `idp` — the Internal Developer Platform admin surface (catalog, scorecard,
 *     deployments, environments, ownership). It is the Studio's operate + govern
 *     backend, not a business vertical.
 *
 * Adding a vertical = write `domain-modules/<id>/{routes,manifest}.ts`, push the
 * manifest into `moduleManifests`, then list the id in `DOMAIN_MODULES`
 * (infra/env.prod) + `pnpm gen:infra`. A disabled module is a 404 and registers
 * NOTHING — no routes, no hooks.
 */

import type { Context, Hono } from 'hono';
import { isModuleEnabled } from '@mmbix/config';
import { modulePath, type ModuleManifest } from '@mmbix/types';
import { fail } from '@/lib/api/response';
import { idpManifest } from './idp/manifest';

/**
 * Modules shipped in this worker. Each is gated by `isModuleEnabled(env, id)`
 * and returns 404 when disabled — the factory core stays clean, the module set
 * stays configurable per deployment.
 */
export const moduleManifests: ModuleManifest[] = [idpManifest];

/** Module ids whose compiled hooks have already been registered this isolate. */
const bootedHooks = new Set<string>();

/**
 * Register the compiled hooks of every ENABLED module — ONCE per isolate.
 *
 * Hooks fire on ENGINE collections (e.g. a write to `orders`), so they must be
 * live for requests that never touch `/api/<module>`. Called from a global
 * middleware on every request; the `bootedHooks` set makes it a no-op after the
 * first. A disabled module registers nothing.
 */
export function bootModuleHooks(env: Record<string, unknown>): void {
	for (const manifest of moduleManifests) {
		if (!manifest.hooks?.length || bootedHooks.has(manifest.id)) continue;
		if (!isModuleEnabled(env, manifest.id)) continue;
		bootedHooks.add(manifest.id);
		for (const register of manifest.hooks) register();
	}
}

/** Mount every enabled domain module's routes; a disabled one answers 404. */
export function mountDomainModules(app: Hono<{ Bindings: Record<string, unknown> }>): void {
	for (const manifest of moduleManifests) {
		const path = modulePath(manifest);
		app.use(`${path}/*`, async (c: Context, next) => {
			if (!isModuleEnabled(c.env, manifest.id)) {
				return fail(c, `Route not found: ${c.req.method} ${c.req.path}`, 404, 'NOT_FOUND');
			}
			await next();
		});
		app.route(path, manifest.routes);
	}
}
