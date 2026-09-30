import type { FieldDefinition } from './api';
import { MAX_FIELD_SELECTIONS } from '@mmbix/types';
import { M2O_DISPLAY_FIELDS } from './record-label';

/**
 * Rows the engine returns per relation ARRAY (o2m/m2m/table) on a list read —
 * the `o2m_limit` default in `collection-query.service.ts` (the Studio never
 * overrides it). A relation cell showing exactly this many means "at least this
 * many", so `renderCell` marks it `50+` instead of under-reporting an exact count.
 */
export const RELATION_PAGE_LIMIT = 50;

/** Top-level `{{key}}` tokens from an m2o display template (dotted paths are not
 *  reachable from an expanded 1st-level relation, so they're skipped). */
function templateKeys(template: string | undefined): string[] {
	if (!template) return [];
	const out: string[] = [];
	const re = /\{\{\s*([\w.]+)\s*\}\}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(template))) {
		const key = m[1];
		if (key && !key.includes('.')) out.push(key);
	}
	return out;
}

/**
 * Directus-style `?fields=` projection for a collection LIST read that feeds the
 * generic table view — the lean alternative to the `*.*` default.
 *
 * `*.*` expands EVERY relation with EVERY column of its target: a page of the
 * employees table pulled 5 related collections' full rows (~22 KB / 5 extra D1
 * queries) just to label two m2o columns and to render three relation arrays the
 * table never shows meaningfully. This projects instead:
 *
 *   - `*`             — the collection's own columns (+ virtual formulas), exactly
 *                       what a table needs to render / sort / filter any column;
 *   - `<m2o>.id` plus — only the columns an m2o cell label can read: the fixed
 *     `<m2o>.<key>`     display-column candidates (`M2O_DISPLAY_FIELDS`) and the
 *                       field's `display_template` keys. Unknown names are
 *                       dropped server-side (`projectColumns` filters against the
 *                       real columns), so this is correct even before the related
 *                       schema has loaded;
 *   - `<rel>.id`      — relation ARRAYS (o2m/m2m/table) arrive id-only: enough for
 *                       the cell to show a related-row COUNT without pulling rows.
 *
 * `m2a` keeps its full expansion — polymorphic rows span collections, so there is
 * no fixed label shape to project.
 *
 * The result is a superset of the real columns, so it degrades safely: the server
 * keeps only the columns that exist, and `renderCell` falls back to `—` for an
 * m2o whose display column was genuinely absent.
 *
 * The projection NEVER exceeds `MAX_FIELD_SELECTIONS` (the engine's `?fields=`
 * ceiling). Each m2o costs ~18 entries (its id + the 16 conventional display
 * columns + template keys), so a relation-heavy collection — `serial_events`
 * has 6 m2o fields → 103 entries — used to blow the cap and fail the WHOLE list
 * read with `Too many field selections (max 100)`. The budget is spent
 * anchors-first, then COLUMN-MAJOR over the fallback candidates, so every
 * relation keeps its id + declared template/key and only the least-useful tail is
 * dropped on a wide schema.
 */
export function buildListFields(fields: FieldDefinition[]): string {
	if (fields.length === 0) return '*';
	const parts = new Set<string>(['*']);
	const add = (token: string): void => {
		if (parts.has(token) || parts.size < MAX_FIELD_SELECTIONS) parts.add(token);
	};

	// Pass 1 — anchors that must survive: own columns (`*`), every relation's `id`
	// (o2m/m2m/table cells count on it) and every DECLARED display_template key
	// (the label the schema author chose).
	const fallback: string[] = [];
	for (const f of fields) {
		if (f.type === 'm2o') {
			add(`${f.name}.id`);
			for (const key of templateKeys(f.display_template)) add(`${f.name}.${key}`);
			fallback.push(`${f.name}.`);
		} else if (f.type === 'o2m' || f.type === 'm2m' || f.type === 'table') {
			add(`${f.name}.id`);
		} else if (f.type === 'm2a') {
			add(f.name);
		}
	}

	// Pass 2 — the conventional display-column fallbacks, walked COLUMN-MAJOR (every
	// relation gets `plate_no`, then every relation gets `name_mm`, …) so the budget
	// is shared evenly instead of one relation eating it all. The server drops a
	// name its target does not have, so a dropped candidate only means that one
	// relation renders `—` rather than a 400 for the entire page.
	outer: for (const key of M2O_DISPLAY_FIELDS) {
		for (const prefix of fallback) {
			if (parts.size >= MAX_FIELD_SELECTIONS) break outer;
			add(prefix + key);
		}
	}

	return [...parts].join(',');
}
