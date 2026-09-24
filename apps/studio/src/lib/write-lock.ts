import type { EntitySchema } from './api';

/**
 * The Studio's view of a collection's engine-enforced WRITE policy
 * (`schema_json.policies.writes`) — the SAME document the entity API honours, so
 * the data table never offers a create / edit / delete the server would refuse
 * (e.g. "order_lines is maintained by its domain service and cannot be
 * written through the generic entity API").
 *
 * `serviceOnly` ⇒ no generic writes at all (create included). `appendOnly` ⇒ rows
 * can be added but never updated / deleted / restored. `frozenFields` are silently
 * stripped from a generic write (make them read-only in the form). `freezeWhen` is
 * ROW-level: once the row's `field` holds one of `values` the row is frozen.
 */
export interface CollectionWriteLock {
	/** `writes.mode === 'service'` — ONLY the domain service may write. */
	serviceOnly: boolean;
	/** `writes.append_only` — create allowed; update / delete / restore refused. */
	appendOnly: boolean;
	/** May a record be CREATED from the Studio? */
	canCreate: boolean;
	/** May a record be UPDATED / DELETED / restored from the Studio? */
	canMutate: boolean;
	/** Field names the engine strips from a generic write — read-only in the form. */
	frozenFields: readonly string[];
	/** Row-level freeze rule (`freeze_when`), or null. */
	freezeWhen: { field: string; values: readonly string[] } | null;
	/** The reason to show the operator, or null when generically writable. */
	reason: string | null;
}

const GENERICALLY_WRITABLE: CollectionWriteLock = {
	serviceOnly: false,
	appendOnly: false,
	canCreate: true,
	canMutate: true,
	frozenFields: [],
	freezeWhen: null,
	reason: null,
};

/** Derive the write lock from a collection schema (its `schema_json.policies.writes`). */
export function writeLockOf(schema: EntitySchema | null | undefined): CollectionWriteLock {
	const writes = schema?.schema_json?.policies?.writes;
	if (!writes) return GENERICALLY_WRITABLE;

	const serviceOnly = writes.mode === 'service';
	const appendOnly = writes.append_only === true;
	const frozenFields = Array.isArray(writes.frozen_fields) ? writes.frozen_fields : [];
	const freezeField = writes.freeze_when?.field;
	const freezeValues = Array.isArray(writes.freeze_when?.values) ? writes.freeze_when.values : [];
	const freezeWhen = serviceOnly || appendOnly || !freezeField ? null : { field: freezeField, values: freezeValues };

	const reason = serviceOnly
		? 'This collection is maintained by its domain service — its records can only be written through that service, never the generic entity API.'
		: appendOnly
			? 'This collection is append-only — records can be added, but not edited, deleted or restored.'
			: null;

	return {
		serviceOnly,
		appendOnly,
		canCreate: !serviceOnly,
		canMutate: !serviceOnly && !appendOnly,
		frozenFields,
		freezeWhen,
		reason,
	};
}

/** Whether a whole ROW is frozen by `freeze_when` — its watched field holds one of
 *  the values, so the engine 403s any update / delete on it. */
export function isRowFrozen(lock: CollectionWriteLock, row: Record<string, unknown> | null | undefined): boolean {
	if (!lock.freezeWhen || !row) return false;
	const value = row[lock.freezeWhen.field];
	return value != null && lock.freezeWhen.values.includes(String(value));
}

/**
 * Split a SELECTION into the rows a generic bulk write may touch and the rows the
 * engine will 403 (`freeze_when`). Bulk delete / restore call this so one frozen
 * row can't fail the whole batch (`12 of 17 failed`).
 */
export function partitionFrozenRows<T extends Record<string, unknown>>(
	lock: CollectionWriteLock,
	rows: readonly T[],
): { writable: T[]; frozen: T[] } {
	if (!lock.freezeWhen) return { writable: [...rows], frozen: [] };
	const writable: T[] = [];
	const frozen: T[] = [];
	for (const row of rows) (isRowFrozen(lock, row) ? frozen : writable).push(row);
	return { writable, frozen };
}

/** The note shown after a bulk write skipped frozen rows — names the rule. */
export function frozenRowsReason(lock: CollectionWriteLock, count: number): string {
	const rule = lock.freezeWhen ? ` (${lock.freezeWhen.field} is ${lock.freezeWhen.values.join(' / ')})` : '';
	return `${count} row${count === 1 ? '' : 's'} skipped — frozen${rule}: reverse or amend them through the domain service, not a generic write.`;
}
