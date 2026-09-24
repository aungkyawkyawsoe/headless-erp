/**
 * Permission-aware field pruning — the client half of "ask only what you may
 * see" (the server always ENFORCES the same rules; this avoids even asking).
 *
 * `allowed` semantics match `/auth/me?collection=`:
 *   null      → no restrictions (role sees every field)
 *   []        → deny all (only `id` survives)
 *   string[]  → whitelist of visible fields
 */
import type { ListQuery } from './query';

/** Normalize a fields projection to a plain string[] (undefined = not specified). */
export function fieldsToArray<T>(fields: ListQuery<T>['fields'] | undefined): string[] | undefined {
	if (fields === undefined || fields === null) return undefined;
	if (typeof fields === 'string') {
		if (fields === '*') return ['*'];
		return fields
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (Array.isArray(fields)) return fields.map(String);
}

/**
 * Intersect a requested projection with the caller's field whitelist.
 * Returns the projection to actually send — never larger than allowed.
 */
export function restrictFields(requested: string[] | undefined, allowed: string[] | null | undefined): string[] | undefined {
	if (allowed === null || allowed === undefined) return requested; // no restrictions
	if (allowed.length === 0) return ['id']; // deny all
	if (!requested || requested.length === 0) return allowed; // no projection → whitelist caps it
	if (requested.includes('*')) return allowed; // "everything" → whitelist caps it
	const allowedSet = new Set(allowed);
	return requested.filter((f) => allowedSet.has(f)); // intersect named fields
}
