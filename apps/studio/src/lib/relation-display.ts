/**
 * "Which field of the related row does this relation column show?" — the Studio
 * table's per-column display pick (the choice offered in the header menu's
 * Columns list) — and "which of the related row's fields get a column of their
 * own?" (the same menu's toggles, e.g. `item_name.name_en`).
 *
 * Stored per FOCUSED collection + relation field name in localStorage, so the
 * operator's picks survive a reload without touching the schema. An absent display
 * entry means AUTOMATIC: the field's `display_template`, then the related row's
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

/** relation field name → related field names shown as their OWN table columns. */
export type RelationExtraColumns = Record<string, string[]>;

const STORAGE_PREFIX = 'studio-relation-display:';
const COLUMNS_PREFIX = 'studio-relation-columns:';

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

function columnsKeyOf(slug: string): string {
	return `${COLUMNS_PREFIX}${slug}`;
}

/** The stored extra columns for a collection — `{}` when none / unreadable storage. */
export function loadRelationColumns(slug: string | null | undefined): RelationExtraColumns {
	if (!slug) return {};
	try {
		const raw = localStorage.getItem(columnsKeyOf(slug));
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: RelationExtraColumns = {};
		for (const [name, leaves] of Object.entries(parsed as Record<string, unknown>)) {
			if (!Array.isArray(leaves)) continue;
			const names = leaves.filter((l): l is string => typeof l === 'string' && l.trim() !== '');
			if (names.length > 0) out[name] = names;
		}
		return out;
	} catch {
		// Corrupt JSON / storage blocked — no related columns, table unchanged.
		return {};
	}
}

export function saveRelationColumns(slug: string, columns: RelationExtraColumns): void {
	try {
		if (Object.keys(columns).length === 0) localStorage.removeItem(columnsKeyOf(slug));
		else localStorage.setItem(columnsKeyOf(slug), JSON.stringify(columns));
	} catch {
		// Private mode / quota — the columns still apply for this session.
	}
}

/** The map after toggling one related field as its own column (`on` = show it). */
export function withRelationColumn(columns: RelationExtraColumns, fieldName: string, leaf: string, on: boolean): RelationExtraColumns {
	const current = columns[fieldName] ?? [];
	const next = on ? (current.includes(leaf) ? current : [...current, leaf]) : current.filter((l) => l !== leaf);
	const out = { ...columns };
	if (next.length === 0) delete out[fieldName];
	else out[fieldName] = next;
	return out;
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
