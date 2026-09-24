/**
 * Module Manifest — the contract for a business/vertical module mounted on the
 * headless factory worker.
 *
 * The factory core (`routes/`, `lib/`, `services/`, `plugins/`) is
 * domain-agnostic and NEVER imports a module. It learns about modules only
 * through these manifests, so adding a vertical is:
 *
 *   1. write `apps/api/src/domain-modules/<id>/` (routes + any compiled hooks),
 *   2. export a `ModuleManifest` from `<id>/manifest.ts`,
 *   3. add it to `moduleManifests` in `domain-modules/index.ts`,
 *   4. list the id in `DOMAIN_MODULES` (infra/env.prod) + `pnpm gen:infra`.
 *
 * A disabled module is a 404 and registers NOTHING (no routes, no hooks).
 */

import type { Hono } from 'hono';

/** One collection grant a module's role receives. */
export interface ModuleRoleGrant {
	slug: string;
	read?: boolean;
	write?: boolean;
	create?: boolean;
	delete?: boolean;
	submit?: boolean;
	approve?: boolean;
	/** A DataFilter JSON object (or string) scoping the role to its own rows. */
	row_filter?: unknown;
}

/** A role a module provisions (idempotently) when it is enabled. */
export interface ModuleRole {
	name: string;
	description?: string;
	grants: ModuleRoleGrant[];
}

/** The identity directory a module provides (Telegram login gate + employee link). */
export interface ModuleIdentity {
	directory_collection: string;
	directory_field: string;
	role_field?: string;
}

/**
 * A mounted module. `routes` is the module's Hono app; `hooks` are compiled
 * hook registrars invoked ONCE per isolate, and only when the module is enabled
 * for this deployment.
 */
export interface ModuleManifest {
	/** Config key matched against `DOMAIN_MODULES` (e.g. 'idp', 'crm'). */
	id: string;
	/** Human-readable name. */
	name: string;
	/** Module version. */
	version: string;
	/** URL prefix. Defaults to `/api/${id}`. */
	path?: string;
	/** The module's Hono app, mounted at `path`. */
	routes: Hono;
	/** Compiled hook registrars — run once per isolate, only when enabled. */
	hooks?: Array<() => void>;
	/** Plugin ids this module depends on (enabled together). */
	plugins?: string[];
	/** Roles + grants the module provisions. */
	roles?: ModuleRole[];
	/** Identity directory the module provides (optional). */
	identity?: ModuleIdentity;
}

/** The URL prefix a manifest is mounted at (explicit `path`, else `/api/<id>`). */
export function modulePath(manifest: Pick<ModuleManifest, 'id' | 'path'>): string {
	return manifest.path ?? `/api/${manifest.id}`;
}
