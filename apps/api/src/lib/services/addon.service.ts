/**
 * Addon Service — the install/remove half of the factory's add-on model.
 *
 * The catalog is built from the compiled `ModuleManifest`s; `resolveAddons`
 * (in `@mmbix/types`) turns them + the build allowlist + the install state into
 * a graph with issues. Install/uninstall validate the graph (deps, extends,
 * capabilities) and persist to `_addons` — so "only what you need" is a RUNTIME
 * decision, not only a build-time one.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import { resolveAddons, type AddonCatalogEntry, type ModuleManifest } from '@mmbix/types';
import { isModuleEnabled } from '@mmbix/config';
import { installedAddonIds, invalidateAddons } from '@/lib/addon-registry';

type ManifestLite = Pick<ModuleManifest, 'id' | 'name' | 'version' | 'scope' | 'depends' | 'provides' | 'requires' | 'extends'>;

export interface AddonCatalog {
	catalog: AddonCatalogEntry[];
	issues: Array<{ id: string; issue: string }>;
}

export class AddonService {
	constructor(private readonly db: D1Client) {}

	/** The build allowlist for this deployment (what CAN be installed). */
	private availableIds(env: Record<string, unknown>, manifests: ModuleManifest[]): Set<string> {
		return new Set(manifests.filter((m) => isModuleEnabled(env, m.id)).map((m) => m.id));
	}

	private lite(manifests: ModuleManifest[]): ManifestLite[] {
		return manifests.map((m) => ({
			id: m.id,
			name: m.name,
			version: m.version,
			scope: m.scope,
			depends: m.depends,
			provides: m.provides,
			requires: m.requires,
			extends: m.extends,
		}));
	}

	async catalog(env: Record<string, unknown>, manifests: ModuleManifest[]): Promise<AddonCatalog> {
		const availableIds = this.availableIds(env, manifests);
		const installed = await installedAddonIds(this.db, availableIds);
		return resolveAddons(this.lite(manifests), availableIds, installed);
	}

	/** Install an add-on after validating deps / extends / capabilities. Idempotent. */
	async install(env: Record<string, unknown>, manifests: ModuleManifest[], id: string): Promise<void> {
		const availableIds = this.availableIds(env, manifests);
		if (!availableIds.has(id)) throw new Error(`Add-on "${id}" is not available in this build`);
		const { catalog } = await this.catalog(env, manifests);
		const entry = catalog.find((c) => c.id === id);
		if (!entry) throw new Error(`Unknown add-on "${id}"`);
		if (entry.installed) return;

		const installedIds = new Set(catalog.filter((c) => c.installed).map((c) => c.id));
		for (const dep of entry.depends) {
			if (!installedIds.has(dep)) throw new Error(`Cannot install "${id}": dependency "${dep}" is not installed`);
		}
		for (const base of entry.extends) {
			if (!installedIds.has(base)) throw new Error(`Cannot install "${id}": extends "${base}" is not installed`);
		}
		const provided = new Set(catalog.filter((c) => c.installed).flatMap((c) => c.provides));
		for (const cap of entry.requires) {
			if (!provided.has(cap)) throw new Error(`Cannot install "${id}": missing capability "${cap}"`);
		}

		await this.persist(manifests, id, 1);
		invalidateAddons();
	}

	/** Uninstall an add-on; refused while an installed add-on still depends on it. */
	async uninstall(env: Record<string, unknown>, manifests: ModuleManifest[], id: string): Promise<void> {
		const { catalog } = await this.catalog(env, manifests);
		const entry = catalog.find((c) => c.id === id);
		if (!entry) throw new Error(`Unknown add-on "${id}"`);
		if (!entry.installed) return;
		const dependents = catalog.filter((c) => c.installed && c.id !== id && (c.depends.includes(id) || c.extends.includes(id)));
		if (dependents.length > 0) {
			throw new Error(`Cannot uninstall "${id}": required by ${dependents.map((d) => d.id).join(', ')}`);
		}
		await this.persist(manifests, id, 0);
		invalidateAddons();
	}

	private async persist(manifests: ModuleManifest[], id: string, installed: 0 | 1): Promise<void> {
		const manifest = manifests.find((m) => m.id === id)!;
		const now = new Date().toISOString();
		const existing = await this.db.first<{ id: string }>(QueryBuilder.from('_addons').select('id').where('id', id).toSelect());
		if (existing) {
			await this.db.run(
				QueryBuilder.from('_addons')
					.where('id', id)
					.toUpdate({ installed, updated_at: now, ...(installed ? { installed_at: now } : {}) }),
			);
			return;
		}
		await this.db.run(
			QueryBuilder.from('_addons').toInsert({
				id,
				version: manifest.version,
				scope: manifest.scope ?? 'domain',
				installed,
				installed_at: installed ? now : null,
				updated_at: now,
			}),
		);
	}
}
