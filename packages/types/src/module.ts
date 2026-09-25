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
	/**
	 * Compiled hook registrars — run once per isolate, only when enabled.
	 *
	 * Each registrar MUST register through `pluginHookRegistry.createAPI(manifest.id)`
	 * so its hooks carry the module id: `bootModuleHooks` revokes a module's hooks
	 * by that id when the module is UNINSTALLED at runtime. Registering under any
	 * other id (or bypassing the registry) makes the module un-revocable — its
	 * hooks would keep firing until the isolate recycles.
	 */
	hooks?: Array<() => void>;
	/** Plugin ids this module depends on (enabled together). */
	plugins?: string[];
	/** Roles + grants the module provisions. */
	roles?: ModuleRole[];
	/** Identity directory the module provides (optional). */
	identity?: ModuleIdentity;

	// ── Add-on graph (install/remove + capability resolution) ──────────────
	/** Tier hint: platform service · business vertical · UI (web-only). */
	scope?: 'platform' | 'domain' | 'ui';
	/** Other add-on ids that must be INSTALLED before this one (install order). */
	depends?: string[];
	/** Capabilities this add-on provides to others (e.g. ['payments']). */
	provides?: string[];
	/** Capabilities this add-on needs from the installed set (e.g. ['storage']). */
	requires?: string[];
	/**
	 * Inheritance — base add-on ids whose collections/fields/views this add-on
	 * EXTENDS (add fields, override views) instead of forking. The resolver
	 * refuses an `extends` target that is not installed.
	 */
	extends?: string[];
	/** Declarative collections provisioned on install (data add-on). */
	collections?: ModuleCollectionDef[];
}

/** A declarative collection an add-on provisions on install (no code). */
export interface ModuleCollectionDef {
	slug: string;
	name: string;
	fields: Array<{ name: string; type: string; required?: boolean; [key: string]: unknown }>;
	description?: string | null;
}

/** The URL prefix a manifest is mounted at (explicit `path`, else `/api/<id>`). */
export function modulePath(manifest: Pick<ModuleManifest, 'id' | 'path'>): string {
	return manifest.path ?? `/api/${manifest.id}`;
}

/** One row in the resolved add-on catalog (available + installed + graph). */
export interface AddonCatalogEntry {
	id: string;
	name: string;
	version: string;
	scope: 'platform' | 'domain' | 'ui';
	/** Shipped in this build (`DOMAIN_MODULES` allowlist). */
	available: boolean;
	/** Installed at runtime (and available). */
	installed: boolean;
	depends: string[];
	provides: string[];
	requires: string[];
	extends: string[];
}

/** Resolve the add-on graph: catalog + install issues (missing deps/capabilities). */
export function resolveAddons(
	manifests: Array<Pick<ModuleManifest, 'id' | 'name' | 'version' | 'scope' | 'depends' | 'provides' | 'requires' | 'extends'>>,
	availableIds: Set<string>,
	installedIds: Set<string>,
): { catalog: AddonCatalogEntry[]; issues: Array<{ id: string; issue: string }> } {
	const catalog: AddonCatalogEntry[] = manifests.map((m) => ({
		id: m.id,
		name: m.name,
		version: m.version,
		scope: m.scope ?? 'domain',
		available: availableIds.has(m.id),
		installed: availableIds.has(m.id) && installedIds.has(m.id),
		depends: m.depends ?? [],
		provides: m.provides ?? [],
		requires: m.requires ?? [],
		extends: m.extends ?? [],
	}));
	const byId = new Map(catalog.map((c) => [c.id, c]));
	const installedProvides = new Set(catalog.filter((c) => c.installed).flatMap((c) => c.provides));
	const issues: Array<{ id: string; issue: string }> = [];
	for (const entry of catalog) {
		if (!entry.installed) continue;
		for (const dep of entry.depends) {
			if (!byId.get(dep)?.installed) issues.push({ id: entry.id, issue: `missing dependency: ${dep}` });
		}
		for (const base of entry.extends) {
			if (!byId.get(base)?.installed) issues.push({ id: entry.id, issue: `extends uninstalled add-on: ${base}` });
		}
		for (const cap of entry.requires) {
			if (!installedProvides.has(cap)) issues.push({ id: entry.id, issue: `missing capability: ${cap}` });
		}
	}
	return { catalog, issues };
}
