import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { getToken } from '@/shared/auth';
import type {
	MovementDirection,
	MovementGroupFeed,
	MovementGroupMaster,
	MovementGroupsFeed,
	MovementLedger,
	MovementModelMaster,
	MovementModelsFeed,
	MovementStoreScope,
} from './types';

/**
 * Data access for the ပစ္စည်းလှုပ်ရှားမှု (Movement) module.
 *
 * The group directory (Screen 1) + line feed + ledger reads are RAW
 * `/api/mro/movement/*` report routes — the same custom-endpoint pattern as the
 * shared `mroApi` helpers / the goods-issues `confirmOutbound` local fetch
 * (authed Bearer fetch, `{ data }` envelope), NOT entity CRUD — so they go
 * through a module-local `movementFetch` helper rather than the SDK client.
 *
 * The only entity reads are lean by-id master lookups — the `mro_item_name`
 * group behind Screen 2's title and the `mro_item_model` model behind the
 * ledger header's name (each screen carries the id alone), via the same
 * local-cast `ops` pattern every MRO module uses.
 */

/** The engine's success envelope is `{ success, data }`; errors `{ error }`. */
interface MovementEnvelope<T> {
	success?: boolean;
	error?: string;
	data?: T;
}

/**
 * In-flight GET dedupe — identical concurrent `/mro/movement/*` requests share
 * ONE network call (React StrictMode double-mounts every page in dev, which
 * would otherwise fire the cursor page-1 fetch twice; a remount during a slow
 * read would too). The promise is dropped as soon as it settles, so a later
 * retry/refetch always issues a fresh request.
 */
const movementInflight = new Map<string, Promise<unknown>>();

async function movementFetch<T>(path: string): Promise<T> {
	const hit = movementInflight.get(path);
	if (hit) return hit as Promise<T>;

	const token = getToken();
	const run = (async () => {
		const res = await fetch(`/api${path}`, {
			headers: {
				'Content-Type': 'application/json',
				...(token ? { Authorization: `Bearer ${token}` } : {}),
			},
		});
		const body = (await res.json().catch(() => null)) as MovementEnvelope<T> | null;
		if (!res.ok || body?.success === false) throw new Error(body?.error ?? `HTTP ${res.status}`);
		return body?.data as T;
	})();
	const tracked = run.finally(() => {
		movementInflight.delete(path);
	});
	movementInflight.set(path, tracked);
	return tracked;
}

/** The shared Screen 2/3 query-string scope — `direction` when not `all`, and
 *  `location` only when a concrete store is picked (absent = every store). */
function scopeQuery(direction: MovementDirection, location: MovementStoreScope): string {
	const params = new URLSearchParams();
	if (direction !== 'all') params.set('direction', direction);
	if (location) params.set('location', location);
	return params.toString();
}

/**
 * Screen 1 — the item-name masters that have CONFIRMED movement, name-sorted
 * + keyset-paginated (the group directory is scoped to movement and paged on
 * the server, so opening the launcher never walks the whole SKU catalog).
 *
 * `search` narrows it SERVER-side for the kiosk's type-ahead — matched against
 * the group's display names and its live models' names. The kiosk passes no
 * cursor: a term's matches fit one page (the answer list is capped anyway).
 */
export async function fetchMovementGroups(input: { cursor?: string | null; search?: string | null }): Promise<MovementGroupsFeed> {
	const params = new URLSearchParams();
	if (input.cursor) params.set('cursor', input.cursor);
	if (input.search?.trim()) params.set('search', input.search.trim());
	const query = params.toString();
	return movementFetch<MovementGroupsFeed>(`/mro/movement/groups${query ? `?${query}` : ''}`);
}

/**
 * Screen 2 — ONE item-name group's CONFIRMED movement LINE feed (newest first,
 * keyset-paginated): every in/out/transfer line of the models under the group,
 * narrowed by the active direction tab + store scope. Each row names its own
 * model (`model` id + `model_name`) so the mixed feed stays readable and a tap
 * can drill to that model's Screen 3 ledger.
 */
export async function fetchMovementGroupLines(input: {
	group: string;
	direction: MovementDirection;
	location: MovementStoreScope;
	cursor?: string | null;
}): Promise<MovementGroupFeed> {
	const params = new URLSearchParams(scopeQuery(input.direction, input.location));
	params.set('group', input.group);
	if (input.cursor) params.set('cursor', input.cursor);
	return movementFetch<MovementGroupFeed>(`/mro/movement/lines?${params.toString()}`);
}

/**
 * Screen 2's DEFAULT rows — ONE group's SKUs that have confirmed movement, each
 * with its aggregated in/out/trf totals, line + document counts and newest
 * movement day. Keyset-paginated (`cursor`) exactly like the line feed, so a
 * group with hundreds of SKUs streams on scroll instead of dumping one page.
 */
export async function fetchMovementGroupModels(input: {
	group: string;
	direction: MovementDirection;
	location: MovementStoreScope;
	cursor?: string | null;
}): Promise<MovementModelsFeed> {
	const params = new URLSearchParams(scopeQuery(input.direction, input.location));
	params.set('group', input.group);
	if (input.cursor) params.set('cursor', input.cursor);
	return movementFetch<MovementModelsFeed>(`/mro/movement/models?${params.toString()}`);
}

/**
 * Screen 3 — ONE model's line-level ledger (newest first, keyset-paginated):
 * the page rows + the opaque `nextCursor` (null = done) + the scope summary.
 */
export async function fetchMovementLedger(input: {
	model: string;
	direction: MovementDirection;
	location: MovementStoreScope;
	cursor?: string | null;
}): Promise<MovementLedger> {
	const params = new URLSearchParams(scopeQuery(input.direction, input.location));
	params.set('model', input.model);
	if (input.cursor) params.set('cursor', input.cursor);
	return movementFetch<MovementLedger>(`/mro/movement/ledger?${params.toString()}`);
}

/** The typed client for the entity reads — the same local-cast pattern as the
 *  mro-categories / goods-issues modules (the app-wide client is typed against
 *  the placeholder typegen `Schema`, which knows no `mro_*` collections). */
type OpsSchema = {
	mro_item_name: MovementGroupMaster;
	mro_item_model: MovementModelMaster;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** One `mro_item_name` master by id — `null` when the row is gone (the group's
 *  models may still have lines). Feeds Screen 2's app-bar title. */
export async function fetchMovementGroupName(id: string): Promise<{ id: string; nameEn: string | null } | null> {
	const res = await ops.items('mro_item_name').list({ fields: ['id', 'name_en'], filter: { id: { _eq: id } }, limit: 1 });
	const row = res.data[0];
	if (!row) return null;
	return { id: row.id, nameEn: row.name_en?.trim() || null };
}

/** One `mro_item_model` master by id — `null` when the row is gone (a deleted
 *  SKU whose ledger lines still exist). Feeds the Screen 3 header's name. */
export async function fetchMovementModel(id: string): Promise<{ id: string; name: string | null } | null> {
	const res = await ops.items('mro_item_model').list({ fields: ['id', 'name_en', 'name_mm'], filter: { id: { _eq: id } }, limit: 1 });
	const row = res.data[0];
	if (!row) return null;
	return { id: row.id, name: row.name_en?.trim() || row.name_mm?.trim() || null };
}
