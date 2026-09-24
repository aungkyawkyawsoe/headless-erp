/**
 * Add-on registry (runtime install state).
 *
 * Two layers decide whether a module/add-on is LIVE:
 *   1. the BUILD allowlist — `DOMAIN_MODULES` / `PLUGINS` (what is available);
 *   2. the RUNTIME install state — the `_addons` table (what is installed).
 *
 * A module is mounted only when BOTH pass. The DB is the source of truth for
 * (2); a module with NO `_addons` row is installed when it is available
 * (backward compatible — a fresh DB mounts everything the build allows), and an
 * explicit `installed = 0` row turns it off at runtime with no redeploy.
 *
 * The installed set is memoized per isolate (one small read) and invalidated by
 * install/uninstall, so the route gate costs no D1 read after the first request.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';

let memo: Promise<Set<string>> | null = null;

/** Drop the per-isolate memo — call after any install/uninstall. */
export function invalidateAddons(): void {
	memo = null;
}

async function loadInstalled(db: D1Client, availableIds: Set<string>): Promise<Set<string>> {
	let rows: Array<{ id: string; installed: number }> = [];
	try {
		rows = await db.all<{ id: string; installed: number }>(QueryBuilder.from('_addons').select('id', 'installed').toSelect());
	} catch {
		// `_addons` not migrated yet — treat every available add-on as installed.
		rows = [];
	}
	const off = new Set(rows.filter((r) => r.installed === 0).map((r) => r.id));
	return new Set([...availableIds].filter((id) => !off.has(id)));
}

/** The installed add-on ids (available ∩ not-explicitly-disabled). Memoized. */
export async function installedAddonIds(db: D1Client, availableIds: Set<string>): Promise<Set<string>> {
	if (!memo) memo = loadInstalled(db, availableIds);
	return memo;
}

/** Is add-on `id` installed? `false` when it is not even available in this build. */
export async function addonInstalled(availableIds: Set<string>, db: D1Client, id: string): Promise<boolean> {
	if (!availableIds.has(id)) return false;
	return (await installedAddonIds(db, availableIds)).has(id);
}
