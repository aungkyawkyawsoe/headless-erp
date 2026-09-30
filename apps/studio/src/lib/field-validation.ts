/**
 * Client-side field validation — the form's inline-feedback half.
 *
 * PURE, total and side-effect free: `validateField(field, value)` returns a short
 * human message or `null`, and NEVER throws. It is called on blur (and again before
 * submit) by RecordFormDialog — the trigger is blur, `onChange` clears — so a
 * half-typed value is not scolded on every keystroke.
 *
 * It mirrors only what the SERVER already enforces and what can be decided from the
 * value alone, so the client never invents a rule the engine does not have:
 *  - `required` (the caller composes linkage-required into `field.required` first);
 *  - type/shape sanity: number bounds (`min`/`max`), email/url shape, calendar
 *    date / datetime / `HH:MM` time, parseable JSON, and select-option membership;
 *  - string length limits carried by the field's own `validation` rules
 *    (`min_length` / `max_length`) — server-enforced, so the message is honest.
 *
 * Deliberately OMITTED (would need server context or a fabricated rule): uniqueness
 * (needs the DB), relation existence (m2o/m2m), and validation rule kinds that are
 * not shape checks here (`regex` / `in` beyond select options, `unique`).
 */
import type { FieldDefinition } from './api';

/** Numeric field types — value constraints via the field's `min` / `max`. */
const NUMERIC_TYPES = new Set(['number', 'integer', 'bigint', 'currency', 'percent', 'rating', 'duration', 'progress']);

/** Optional scalar — a value the form treats as "not filled in". `false` is a real
 *  value (a required boolean is satisfiable by `false`), so it is not empty. */
function isEmpty(v: unknown): boolean {
	return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** Comparable string form of a raw form value. */
function textOf(v: unknown): string {
	if (typeof v === 'string') return v;
	if (v === null || v === undefined) return '';
	if (typeof v === 'object') {
		try {
			return JSON.stringify(v) ?? '';
		} catch {
			return String(v);
		}
	}
	return String(v);
}

/** A real `YYYY-MM-DD` calendar day (rejects 2026-02-30, 2026-13-01 …). */
function isRealYmd(s: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
	const dt = new Date(Date.UTC(y, mo - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** A `YYYY-MM-DD` day with an optional (valid) `THH:MM[:SS]` time — the ISO / SQLite
 *  shapes the engine stores for datetime/timestamp fields. */
function isRealDatetime(s: string): boolean {
	const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
	if (!m || !isRealYmd(m[1])) return false;
	if (m[2] === undefined) return true;
	return Number(m[2]) <= 23 && Number(m[3]) <= 59 && (m[4] === undefined || Number(m[4]) <= 59);
}

/** `HH:MM` or `HH:MM:SS`, 24-hour. */
function isClockTime(s: string): boolean {
	return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s);
}

/** An absolute http(s) URL with a host. */
function isHttpUrl(s: string): boolean {
	try {
		const u = new URL(s);
		return (u.protocol === 'http:' || u.protocol === 'https:') && Boolean(u.hostname);
	} catch {
		return false;
	}
}

/** Parse a field's `min`/`max` bound — `NaN`/absent means "no bound". */
function boundOf(v: number | string | undefined): number | null {
	if (v === undefined || v === '' || v === null) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** The select option VALUES, following RecordFieldInput's mapping (plain string, or
 *  a `{ label, value }` object whose value falls back to its label). */
function optionValues(field: FieldDefinition): string[] {
	return (field.options ?? []).map((o) => (typeof o === 'string' ? o : (o.value ?? o.label ?? '')));
}

/**
 * Validate one field's raw form value. Returns a short, actionable message or
 * `null` when valid (or when there is nothing the client can decide).
 *
 * Callers pass the effective field: compose linkage state first via
 * `{ ...field, required: runtimeRequired }` so a `required_when` rule is honoured.
 */
export function validateField(field: FieldDefinition, value: unknown): string | null {
	try {
		if (!field || typeof field !== 'object' || !field.type) return null;
		const name = field.label || field.name || 'This field';

		// Empty: required is the only rule that applies — every shape check below
		// would be noise on an untouched optional field.
		if (isEmpty(value)) return field.required ? `${name} is required` : null;

		const text = textOf(value);

		if (NUMERIC_TYPES.has(field.type)) {
			const n = typeof value === 'number' ? value : Number(text);
			if (!Number.isFinite(n)) return `${name} must be a number`;
			const min = boundOf(field.min);
			if (min !== null && n < min) return `${name} must be at least ${min}`;
			const max = boundOf(field.max);
			if (max !== null && n > max) return `${name} must be at most ${max}`;
		} else if (field.type === 'email') {
			if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `${name} must be a valid email address`;
		} else if (field.type === 'url') {
			if (!isHttpUrl(text)) return `${name} must be a valid URL`;
		} else if (field.type === 'date') {
			if (!isRealYmd(text)) return `${name} must be a valid date`;
		} else if (field.type === 'datetime' || field.type === 'timestamp') {
			if (!isRealDatetime(text)) return `${name} must be a valid date and time`;
		} else if (field.type === 'time') {
			if (!isClockTime(text)) return `${name} must be a valid time`;
		} else if (field.type === 'json') {
			// Engine-decodeJsonFields hands structured values back as objects — already
			// valid JSON. Only a raw editor string needs a parse check.
			if (typeof value === 'string' && value.trim() !== '') {
				try {
					JSON.parse(value);
				} catch {
					return `${name} must be valid JSON`;
				}
			}
		} else if (field.type === 'select') {
			const allowed = optionValues(field);
			if (allowed.length > 0 && !allowed.includes(text)) return `${name} must be one of the available options`;
		}

		// Length limits carried by the field's own (server-enforced) validation rules.
		for (const rule of field.validation ?? []) {
			if (!rule || typeof rule !== 'object') continue;
			if (rule.type === 'min_length' && typeof rule.value === 'number' && text.length < rule.value) {
				return rule.message || `${name} must be at least ${rule.value} characters`;
			}
			if (rule.type === 'max_length' && typeof rule.value === 'number' && text.length > rule.value) {
				return rule.message || `${name} must be at most ${rule.value} characters`;
			}
		}

		return null;
	} catch {
		// Total by contract: a malformed field/value must never blow up the form.
		return null;
	}
}
