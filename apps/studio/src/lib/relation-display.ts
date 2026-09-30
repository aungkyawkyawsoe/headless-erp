/**
 * "Which field of the related row does this relation column show?" — the Studio
 * table's per-column display pick (the choice offered in the header menu's
 * Columns list).
 *
 * Stored per FOCUSED collection + relation field name in localStorage, so the
 * operator's pick survives a reload without touching the schema. An absent entry
 * means AUTOMATIC: the field's `display_template`, then the related row's
 * conventional display columns (`record-label.ts` / `collection-table-filters.ts`
 * `displayLeafField`) — exactly how every relation column behaved before.
 *
 * Storage only: WHICH related field a pick resolves to (and what happens when the
 * related collection no longer has it) lives in `collection-table-filters.ts`, so
 * the cell label, the `?fields=` projection and the filter leaf share one answer.
 */
import type { FieldDefinition } from './api';

/** relation field name → the related field it displays. */
export type RelationDisplayLeaves = Record<string, string>;

const STORAGE_PREFIX = 'studio-relation-display:';

/** Field types whose value is a relation/media blob rather than a readable label. */
const NON_SCALAR_TYPES = new Set(['m2o', 'o2m', 'm2m', 'm2a', 'table', 'alias', 'presentation', 'divider', 'group']);

function keyOf(slug: string): string {
	return `${STORAGE_PREFIX}${slug}`;
}

/** The stored picks for a collection — `{}` when none / unreadable storage. */
export function loadRelationLeaves(slug: string | null | undefined): RelationDisplayLeaves {
	if (!slug) return {};
	try {
		const raw = localStorage.getItem(keyOf(slug));
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: RelationDisplayLeaves = {};
		for (const [name, leaf] of Object.entries(parsed as Record<string, unknown>)) {
			if (typeof leaf === 'string' && leaf.trim() !== '') out[name] = leaf;
		}
		return out;
	} catch {
		// Corrupt JSON / storage blocked — every column just stays automatic.
		return {};
	}
}

export function saveRelationLeaves(slug: string, leaves: RelationDisplayLeaves): void {
	try {
		if (Object.keys(leaves).length === 0) localStorage.removeItem(keyOf(slug));
		else localStorage.setItem(keyOf(slug), JSON.stringify(leaves));
	} catch {
		// Private mode / quota — the pick still applies for this session.
	}
}

/** The map after setting a column's pick (or clearing it with `leaf: null`). */
export function withRelationLeaf(leaves: RelationDisplayLeaves, fieldName: string, leaf: string | null): RelationDisplayLeaves {
	const next = { ...leaves };
	if (!leaf) delete next[fieldName];
	else next[fieldName] = leaf;
	return next;
}

/**
 * The fields of a related collection the picker may offer. Scalar values only:
 * an id, a hidden/system column, a credential, an encrypted value or another
 * relation is not something a table cell can show as a label.
 */
export function selectableDisplayFields(fields: FieldDefinition[]): FieldDefinition[] {
	return fields.filter(
		(f) => f.name !== 'id' && !f.name.startsWith('_') && !NON_SCALAR_TYPES.has(f.type) && f.type !== 'password' && f.encrypted !== true,
	);
}
