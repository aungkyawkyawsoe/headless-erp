/**
 * Kanban-view editor config — how a collection's records render as a kanban
 * board (columns by a group field, cards with title/amount/tags, per-column
 * progress metric). Written by the Studio's kanban editor
 * (schema_json.kanban_view) and consumed by the admin frontend's collection
 * list — preview == runtime.
 */

export interface KanbanFieldMeta {
	name: string;
	visible?: boolean;
	/** Display label override — defaults to the field's label. */
	label?: string;
}

export interface KanbanViewConfig {
	/** Field used to group records into columns (select/text — e.g. stage, status). */
	groupBy?: string;
	/** Ordered column values — configured columns first, then any extra values found in the data. */
	columns?: string[];
	/** Field rendered as the card title (fallback: the collection's display field). */
	titleField?: string;
	/** Numeric/currency field — summed per column (progress metric) and shown on the card. */
	amountField?: string;
	/** Metric label shown above the column sum (default: 'Total'). */
	metricLabel?: string;
	/** Show the column sum in the column header (default true when amountField is set). */
	showMetric?: boolean;
	/** Show a count chip in the column header (default true). */
	showCount?: boolean;
	/** Info fields rendered as muted lines under the title/amount (e.g. customer, contact). */
	infoFields?: string[];
	/** Fields rendered as soft tag pills on the card (e.g. source, category). */
	tagFields?: string[];
	/** m2o field whose record avatar shows in the card footer (e.g. assigned_to). */
	assignedToField?: string;
	/** Column width in px (default 300). */
	columnWidth?: number;
	/** Allow dragging cards between columns (calls onMoveCard to persist the group field). */
	dragEnabled?: boolean;
}

export interface KanbanColumn {
	/** Group value — '' for rows without a group value. */
	key: string;
	/** Display label — the select option's label, else a title-cased key. */
	label: string;
	rows: Array<Record<string, unknown>>;
	count: number;
	/** Sum of amountField over the column's rows — null when no amountField configured. */
	sum: number | null;
	/** Allow dragging cards between columns (calls onMoveCard to persist the group field). */
	dragEnabled?: boolean;
}

import { SYSTEM_FIELD_NAMES } from './system-fields';

/** Resolve the group-by field definition from the collection's fields. */
export function kanbanGroupField(kv: KanbanViewConfig | null | undefined, fields: Array<{ name: string }>): { name: string } | null {
	const name = kv?.groupBy;
	if (!name) return null;
	return fields.find((f) => f.name === name) ?? null;
}

/** Pretty column label for a raw group value. */
export function kanbanGroupLabel(value: unknown, options?: Array<{ label?: string; value?: string }> | null): string {
	if (value === null || value === undefined || value === '') return 'Uncategorized';
	const key = String(value);
	if (options?.length) {
		const opt = options.find((o) => String(o.value) === key);
		if (opt?.label) return opt.label;
	}
	// Title-case snake/kebab keys: "prospecting" → "Prospecting", "on_hold" → "On Hold".
	return key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Resolve the ordered visible field list shown on kanban cards. */
export function kanbanCardFields(kv: KanbanViewConfig | null | undefined, fields: Array<{ name: string }>): KanbanFieldMeta[] {
	const user = fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const known = new Set([...(kv?.infoFields ?? []), ...(kv?.tagFields ?? [])]);
	return user.filter((f) => known.has(f.name)).map((f) => ({ name: f.name, visible: true }));
}

/**
 * Group rows into ordered kanban columns.
 * Configured `columns` come first (empty columns included — the pipeline shows
 * every stage even with no cards), then any extra distinct values in the data,
 * then rows without a group value in a trailing 'Uncategorized' column.
 */
export function groupRowsForKanban(
	rows: Array<Record<string, unknown>>,
	kv: KanbanViewConfig | null | undefined,
	options?: Array<{ label?: string; value?: string }> | null,
): KanbanColumn[] {
	const groupBy = kv?.groupBy;
	const amountField = kv?.amountField;
	if (!groupBy) return [{ key: '', label: 'All', rows: rows ?? [], count: rows?.length ?? 0, sum: null }];

	const buckets = new Map<string, Array<Record<string, unknown>>>();
	for (const row of rows ?? []) {
		const v = row[groupBy];
		const key = v === null || v === undefined ? '' : String(v);
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key)!.push(row);
	}

	const sumOf = (bucket: Array<Record<string, unknown>>): number | null => {
		if (!amountField) return null;
		let total = 0;
		let found = false;
		for (const r of bucket) {
			const n = typeof r[amountField] === 'number' ? (r[amountField] as number) : Number(r[amountField]);
			if (Number.isNaN(n) || n === null) continue;
			total += n;
			found = true;
		}
		return found ? total : null;
	};

	const columns: KanbanColumn[] = [];
	const seen = new Set<string>();
	for (const key of kv?.columns ?? []) {
		if (seen.has(key)) continue;
		seen.add(key);
		const bucket = buckets.get(key) ?? [];
		columns.push({ key, label: kanbanGroupLabel(key, options), rows: bucket, count: bucket.length, sum: sumOf(bucket) });
	}
	for (const [key, bucket] of buckets) {
		if (seen.has(key)) continue;
		seen.add(key);
		columns.push({ key, label: kanbanGroupLabel(key, options), rows: bucket, count: bucket.length, sum: sumOf(bucket) });
	}
	return columns;
}
