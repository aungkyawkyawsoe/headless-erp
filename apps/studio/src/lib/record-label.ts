/**
 * Shared related-record label resolution for the Studio.
 *
 * Single source of truth for turning a relation value into a human label —
 * used by the collection table cells, the record create/edit forms (m2o
 * selects + o2m related lists) and the batch-edit dialog. Rules:
 *
 *   1. The relation field's `display_template` wins when it resolves (data-driven).
 *   2. Otherwise the row's first conventional display column wins
 *      (`name_mm`/`name_en`/`name`/`code` … — see M2O_DISPLAY_FIELDS).
 *   3. The raw UUID is only ever a LAST resort (and never for table cells,
 *      where an unlabelable row renders '—' instead).
 *
 * Keeping these helpers in one module prevents the "shows a raw id instead of
 * a label" drift that recurred while the logic was copy-pasted across files.
 */

/** Substitute {{field}} placeholders in a display template from a related object. */
export function renderTemplate(template: string | undefined, obj: Record<string, unknown>): string {
	if (!template) return '';
	return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
		const v = key
			.split('.')
			.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
		return v === null || v === undefined ? '' : String(v);
	});
}

/** Conventional display columns of a related row, in priority order — used when no display_template resolves. */
export const M2O_DISPLAY_FIELDS = [
	'plate_no',
	'name_mm',
	'name_en',
	'item_name_mm',
	'item_name_en',
	'name',
	'full_name',
	'display_name',
	'title',
	'label',
	'value',
	'code',
	'description_mm',
	'description_en',
	'description',
	'ref',
];

/** Label of an expanded m2o value ({ id, name_en, … }) — or null when nothing readable is present. */
export function m2oLabel(v: unknown): string | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const obj = v as Record<string, unknown>;
	for (const key of M2O_DISPLAY_FIELDS) {
		const val = obj[key];
		if (val !== null && val !== undefined && String(val).trim() !== '') return String(val);
	}
	return null;
}

/** Display label of a fetched related row.
 *
 *  Prefers the field's display_template, then the row's conventional display
 *  columns, then — only so a select stays usable for label-less rows — its id.
 */
export function rowLabel(row: Record<string, unknown>, template?: string): string {
	return renderTemplate(template, row) || m2oLabel(row) || (row.id === null || row.id === undefined ? '' : String(row.id));
}

/**
 * Ids of an m2m value. Reads arrive as an array of EXPANDED related rows
 * ({ id, … }) from '*.*' reads, but a value may also already be plain ids — the
 * form always stores/edits just the ids (the engine's payload contract).
 */
export function m2mIds(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const ids: string[] = [];
	for (const r of raw) {
		const id = r && typeof r === 'object' && !Array.isArray(r) ? (r as { id?: unknown }).id : r;
		const s = String(id ?? '');
		if (s && !ids.includes(s)) ids.push(s); // dedupe — a repeated id would write a duplicate junction row
	}
	return ids;
}
