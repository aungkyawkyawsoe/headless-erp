/**
 * Field formatting — the single source of truth for how record values are
 * rendered as display strings. Shared by the Studio previews (apps/studio) and
 * the runtime pages (the client app) so preview == runtime.
 *
 * Handles every engine field type:
 *   - relations (m2o/m2a → label via display_template `{{name}}` or a smart
 *     default field; o2m/m2m/table → item list or count)
 *   - dates/times (locale-aware, no raw ISO strings)
 *   - numbers/currency/percent/progress/rating (grouped digits)
 *   - structured values (tags/csv/json/location), booleans, files, password,
 *     signature, color, uuid — each with a sensible default representation.
 */

const EMPTY = '—';

/** True when a value is empty (null/undefined/blank/empty array/empty object). */
export function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) return true;
	if (typeof value === 'string') return value.trim() === '';
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
	return false;
}

/** One entry in a select field's option list — legacy plain strings or
 *  Studio-style `{ value, label }` pairs (label may be blank → show the value). */
export type FieldSelectOption = string | { value?: string | number; label?: string };

/** Normalize a select option to `{ value, label }`; a blank/missing label falls back to the value. */
export function selectOptionOf(option: FieldSelectOption): { value: string; label: string } {
	if (typeof option === 'string') return { value: option, label: option };
	const value = String(option.value ?? option.label ?? '');
	const label = option.label === undefined || option.label === '' ? value : String(option.label);
	return { value, label };
}

/**
 * The display label for a stored select value — the matching option's label.
 * Returns null when the value is empty, no option matches, or the option has no
 * distinct label (plain-string options and `{ value }` entries) so enum-style
 * tokens can fall through to `humanizeEnumValue`.
 */
export function selectOptionLabel(value: unknown, options?: FieldSelectOption[] | null): string | null {
	if (isEmptyValue(value) || !options || options.length === 0) return null;
	const key = String(value);
	for (const option of options) {
		const entry = selectOptionOf(option);
		if (entry.value === key) return entry.label === key ? null : entry.label;
	}
	return null;
}

/**
 * Word-capitalize an enum-style token that carries no explicit label:
 *   - snake_case — `late_in` → `Late In`, `grace_early_out` → `Grace Early Out`
 *   - single lowercase word — `male` → `Male`, `present` → `Present`
 * Used as the display fallback for select/formula string values.
 * Returns null for anything that isn't such a token (free text with spaces,
 * capitalized words, dates, punctuation, long hash-like strings…).
 */
export function humanizeEnumValue(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	// All-lowercase alphabetic tokens, digits allowed inside a word, optional
	// underscore separators (`male`, `late_in`) — narrow enough that ordinary
	// sentences/names pass through untouched.
	if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)) return null;
	// A single long all-lowercase run is a hash/base64-style blob, not an enum
	// token — leave it raw. (Underscore-separated phrases are always tokens.)
	if (!value.includes('_') && value.length > 32) return null;
	return value
		.split('_')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

/**
 * The display text for a stored select value — the matching option's distinct
 * label wins, otherwise enum-style tokens humanize (`male` → `Male`,
 * `late_in` → `Late In`), otherwise the raw value is shown. The stored value
 * never changes — only the displayed text does.
 */
export function selectDisplayLabel(value: unknown, options?: FieldSelectOption[] | null): string {
	return selectOptionLabel(value, options) ?? humanizeEnumValue(value) ?? String(value ?? '');
}

/** Format a date/time value into a compact, locale-aware string. */
export function formatDateValue(value: unknown, withTime: boolean): string {
	if (isEmptyValue(value)) return EMPTY;
	const d = new Date(String(value));
	if (Number.isNaN(d.getTime())) return String(value);
	const date = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
	if (!withTime) return date;
	const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	return `${date}, ${time}`;
}

/** Interpolate `{{field}}` placeholders in a display template (Studio template-editor syntax). */
export function applyDisplayTemplate(template: string, row: Record<string, unknown>): string {
	return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key: string) => {
		const v = key
			.split('.')
			.reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), row);
		return isEmptyValue(v) ? '' : String(v);
	});
}

/** Common human-readable fields used to label a record by default. */
const LABEL_FIELDS = [
	'label',
	'name',
	'title',
	'full_name',
	'display_name',
	'subject',
	'code',
	// CRM-style record names (collections that use these as their display field).
	'customer_name',
	'lead_name',
	'opportunity_name',
	'applicant_name',
	'contact_name',
	'employee_name',
	'first_name',
	'last_name',
];

/**
 * Label a resolved relation object (m2o / m2m item / m2a reference).
 * Honors the field's `display_template` (`{{name}}`, `{{code}} — {{name}}` …);
 * the registry default `{{id}}` is treated as "no template" and falls back to
 * the smart default so raw UUIDs never leak into the UI.
 */
export function relationLabel(value: unknown, displayTemplate?: string | null): string {
	if (isEmptyValue(value)) return EMPTY;
	if (typeof value !== 'object') return String(value);
	const o = value as Record<string, unknown>;
	if (displayTemplate && !/^\{\{\s*id\s*\}\}$/.test(displayTemplate)) {
		const out = applyDisplayTemplate(displayTemplate, o);
		if (out.trim()) return out;
	}
	for (const k of LABEL_FIELDS) {
		const v = o[k];
		if (!isEmptyValue(v)) return String(v);
	}
	if (typeof o.id === 'string') return o.id.slice(0, 8);
	return EMPTY;
}

/** Label an o2m/m2m/table value: comma list of item labels, or a count. */
export function formatRelationList(value: unknown, displayTemplate?: string | null): string {
	if (isEmptyValue(value)) return EMPTY;
	if (!Array.isArray(value)) return String(value);
	if (value.length === 0) return EMPTY;
	if (value.length > 3) return `${value.length} items`;
	return value.map((v) => relationLabel(v, displayTemplate)).join(', ');
}

/** Strip HTML/markdown/code to plain text and clamp for table cells. */
function toPlainText(value: unknown, maxLen = 100): string {
	const s = String(value)
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}

/**
 * Format a raw cell value into its display string by field type.
 * `field` only needs `{ type, display_template?, options? }` — compatible with
 * both the Studio's FieldDefinition and the frontend's FieldDef.
 */
export function formatFieldValue(
	field: { type: string; display_template?: string | null; options?: FieldSelectOption[] | null },
	value: unknown,
): string {
	if (isEmptyValue(value)) return EMPTY;
	const t = field.type;
	switch (t) {
		case 'm2o':
		case 'm2a':
			return relationLabel(value, field.display_template);
		case 'o2m':
		case 'm2m':
		case 'table':
			return formatRelationList(value, field.display_template);
		case 'date':
			return formatDateValue(value, false);
		case 'datetime':
		case 'timestamp':
			return formatDateValue(value, true);
		case 'time': {
			const s = String(value);
			return s.length >= 5 ? s.slice(0, 5) : s;
		}
		case 'currency':
		case 'number':
		case 'bigint':
		case 'integer': {
			const n = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(n)) return String(value);
			return n.toLocaleString(undefined, t === 'number' ? { maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
		}
		case 'percent':
		case 'progress': {
			const n = typeof value === 'number' ? value : Number(value);
			if (Number.isNaN(n)) return String(value);
			return `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
		}
		case 'rating':
			return String(value);
		case 'boolean':
			return value ? 'Yes' : 'No';
		case 'tags':
		case 'csv': {
			if (Array.isArray(value)) return value.join(', ');
			if (typeof value === 'string') {
				try {
					const arr = JSON.parse(value);
					return Array.isArray(arr) ? arr.join(', ') : value;
				} catch {
					return value;
				}
			}
			return String(value);
		}
		case 'json':
			return typeof value === 'string' ? value : JSON.stringify(value);
		case 'location': {
			if (typeof value === 'object') {
				const o = value as Record<string, unknown>;
				return `${o.lat ?? '?'}, ${o.lng ?? '?'}`;
			}
			return String(value);
		}
		case 'password':
			return '••••••••';
		case 'signature':
			return '✍ Signed';
		case 'file': {
			const s = String(value);
			return s.split('/').pop() || s;
		}
		case 'color':
			return String(value);
		case 'uuid':
			return String(value).slice(0, 8);
		case 'select':
			// Store the value, display the label — an explicit option label wins,
			// otherwise enum-style tokens (`male`, `late_in`) render humanized
			// (`Male`, `Late In`).
			return selectDisplayLabel(value, field.options);
		case 'formula':
			// String-result formulas often emit enum classifications (`late_in`) —
			// humanize those tokens; everything else stays the raw computed value.
			return humanizeEnumValue(value) ?? String(value);
		case 'text_editor':
		case 'markdown':
		case 'code':
			return toPlainText(value);
		default:
			// text, longtext, slug, phone, email, url, icon, barcode
			return String(value);
	}
}
