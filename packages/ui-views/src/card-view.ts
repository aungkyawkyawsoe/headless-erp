/**
 * Card-view editor config — the single source of truth for how a collection's
 * records render as a card grid (title field, optional image hero, info fields,
 * grid columns). Written by the Studio's card editor (schema_json.card_view)
 * and consumed by the admin frontend's collection list — preview == runtime.
 */

export interface CardFieldMeta {
	name: string;
	visible?: boolean;
	/** Display label override — defaults to the field's label. */
	label?: string;
}

export interface CardViewConfig {
	/** Field rendered as the card title (fallback: first visible field). */
	titleField?: string;
	/** Optional image/file field rendered as the card hero (skipped when empty). */
	imageField?: string;
	/** Ordered info fields — later entries come after earlier ones. Omitted fields default to visible at the end. */
	fields?: CardFieldMeta[];
	/** Grid columns: 1 | 2 | 3 | 4 | 5 (default 3). Rendered EXACTLY — no auto-fit. */
	columns?: number;
	/** Show an edit/open button on each card. */
	rowActions?: boolean;
	/**
	 * Card layout — 'hero' (default): image band on top, details below.
	 * 'row': photo sidebar on the left, details on the right (directory-card style).
	 */
	layout?: 'hero' | 'row';
	/** Row layout: boolean/select field whose value colors the photo's status dot. */
	statusField?: string;
	/** Row layout: 1-2 fields overlaid on the photo's bottom edge (e.g. code, department). */
	overlayFields?: string[];
	/** Row layout: field rendered as a blue pill badge next to the title (e.g. gender). */
	badgeField?: string;
	/** Row layout: date field whose age appends to the badge (e.g. date_of_birth → "♂ 24"). */
	ageField?: string;
	/** Row layout: field rendered as the teal accent line under the title (e.g. designation). */
	accentField?: string;
	/** Row layout: field rendered as a muted line under the accent (e.g. department). */
	subtitleField?: string;
	/** Row layout: fields rendered as compact soft pills at the card bottom (e.g. employment type). */
	footerFields?: string[];
	/** Row layout: up to 3 numeric/relation fields rendered as colored counter boxes (green/orange/red). */
	counterFields?: string[];
}

import { SYSTEM_FIELD_NAMES } from './system-fields';

/** Resolve the ordered, visible field list for a card grid given its config. */
export function cardFieldsOf(cv: CardViewConfig | null | undefined, fields: Array<{ name: string }>): CardFieldMeta[] {
	const user = fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const configured = (cv?.fields ?? [])
		.map((c) => ({ ...c, visible: c.visible !== false }))
		.filter((c) => user.some((f) => f.name === c.name));
	const known = new Set(configured.map((c) => c.name));
	// Fields missing from the config (e.g. added later) appear at the end, visible.
	const rest = user.filter((f) => !known.has(f.name)).map((f) => ({ name: f.name }));
	return [...configured, ...rest];
}
