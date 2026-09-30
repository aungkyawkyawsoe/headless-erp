/**
 * Field-level schema operations — the pure half of the field row's "⋯" menu.
 * The writer half (debounced saves, cache patches) stays in the workbench, so
 * these helpers are trivially testable and shared by every schema surface.
 */
import type { FieldDefinition } from './api';

/** Directus's duplicate convention: `<name>_copy`, then `_copy_2`, `_copy_3`… */
export function copyFieldName(fields: FieldDefinition[], source: string): string {
	const taken = new Set(fields.map((f) => f.name));
	let candidate = `${source}_copy`;
	let n = 2;
	while (taken.has(candidate)) candidate = `${source}_copy_${n++}`;
	return candidate;
}

/**
 * Whether a field can be duplicated at all. Two types cannot, for engine
 * reasons rather than preferences:
 *
 *  - `m2m` — the engine refuses a second m2m field between the same collection
 *    pair (both would share ONE junction table; `PUT /api/collections` answers
 *    400), so a duplicate here is an entry that can never succeed.
 *  - `table` — a composite's child rows are keyed by `parent_id` alone, so a
 *    second table field pointing at the same child collection would embed the
 *    same lines twice AND a save through either would replace the shared set.
 *
 * Everything else duplicates honestly — including a shared-read-only `o2m` and
 * a virtual formula.
 */
export function canDuplicateField(field: FieldDefinition): boolean {
	return field.type !== 'm2m' && field.type !== 'table';
}

/**
 * The field list with a duplicate of `source` appended — every property copied
 * verbatim, the name made unique, and the label marked "(copy)". The label is
 * the one honest mark: the Studio never renames a column after creation
 * (FieldInspector: "Renaming would migrate data"), so without it the copy would
 * be indistinguishable from its source in the grid AND on the rendered form.
 * `null` when the source is gone (a menu left open across a schema change) or
 * is a type that cannot be duplicated (see `canDuplicateField`) — the writer
 * half refuses even if a caller bypasses the menu.
 */
export function duplicatedFields(fields: FieldDefinition[], source: string): FieldDefinition[] | null {
	const field = fields.find((f) => f.name === source);
	if (!field || !canDuplicateField(field)) return null;
	const copy: FieldDefinition = { ...field, name: copyFieldName(fields, source) };
	if (field.label) copy.label = `${field.label} (copy)`;
	return [...fields, copy];
}

/**
 * The field list with `source` hidden from / shown on the record form (the field
 * "⋯" menu's Hide/Show entry). `hidden: true` writes the flag; `hidden: false`
 * REMOVES the key rather than writing `false`, so a field that was never hidden
 * and one that was shown again serialize identically — one state, one shape.
 * Returns `null` when the name is unknown (a menu left open across a schema
 * change), so the caller can skip the write.
 */
export function withFieldHidden(fields: FieldDefinition[], source: string, hidden: boolean): FieldDefinition[] | null {
	if (!fields.some((f) => f.name === source)) return null;
	return fields.map((f) => {
		if (f.name !== source) return f;
		if (hidden) return { ...f, hidden: true };
		const { hidden: _drop, ...rest } = f;
		return rest;
	});
}
