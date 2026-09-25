/**
 * Deterministic field inference — the rules-first heart of the generation
 * pipeline.
 *
 * Design-to-schema inference is the one step that could be non-deterministic
 * (an LLM), so it is DETERMINISTIC FIRST: a pinned, ordered rule table maps a
 * design hint (a label, an observed value format) to a field type from the
 * field-type SSOT. An LLM is only ever consulted for the residue the rules
 * cannot place, and its output must still land on `VALID_FIELD_TYPES`.
 *
 * Properties this module guarantees (pinned by test):
 *   - Pure: same input ⇒ same output. No `Date.now`/`Math.random`.
 *   - Closed: an inferred type is ALWAYS a member of `VALID_FIELD_TYPES`; a
 *     non-member is dropped and surfaced as a warning, never invented.
 *   - Total: every hint yields a field — worst case `text` at confidence 0, so
 *     the human gate always has something visible to review.
 *   - O(hints): one pass, bounded by `maxFieldsPerProposal` at the call site.
 */

import { VALID_FIELD_TYPES } from '@mmbix/utils';
import type { DesignHint, DesignRelation, FieldProposal, FieldType, ProposalWarning, RelationProposal } from '@mmbix/types';

/** A rule: a label pattern → a field type. First match wins (order is pinned). */
interface NameRule {
	test: RegExp;
	type: FieldType;
	reason: string;
}

/**
 * The rules table. Ordered from most specific to most generic — `amount`
 * (currency) must be tested before a generic money/percent overlap, and
 * boolean prefixes before a `status`-ish `select`. Extending inference means
 * adding a row here, never branching in the resolver.
 */
const NAME_RULES: readonly NameRule[] = [
	{
		test: /\b(amount|price|cost|total|subtotal|balance|salary|wage|fee|tax|revenue|payment)\b/,
		type: 'currency',
		reason: 'money word in label',
	},
	{ test: /\b(percent|percentage|rate|discount)\b|%\b/, type: 'percent', reason: 'percentage word/symbol in label' },
	{ test: /\b(qty|quantity|count|units?|number of)\b/, type: 'integer', reason: 'quantity/count word in label' },
	{ test: /\b(uuid|guid)\b/, type: 'uuid', reason: 'uuid word in label' },
	{ test: /\b(email|e-mail)\b/, type: 'email', reason: 'email word in label' },
	{ test: /\b(phone|mobile|tel|telephone|contact no)\b/, type: 'phone', reason: 'phone word in label' },
	{ test: /\b(url|link|website|web site|homepage)\b/, type: 'url', reason: 'url word in label' },
	{ test: /\b(password|passcode|secret)\b/, type: 'password', reason: 'secret word in label' },
	{ test: /\b(datetime|timestamp)\b/, type: 'datetime', reason: 'datetime word in label' },
	{ test: /\b(date|dob|birth|expiry|expires|due|deadline)\b/, type: 'date', reason: 'date word in label' },
	{ test: /\b(time|hour)\b/, type: 'time', reason: 'time word in label' },
	{ test: /\b(rating|stars?|score)\b/, type: 'rating', reason: 'rating word in label' },
	{ test: /\b(image|photo|avatar|logo|thumbnail|picture)\b/, type: 'image', reason: 'image word in label' },
	{ test: /\b(file|attachment|document)\b/, type: 'file', reason: 'file word in label' },
	{ test: /\b(colou?r)\b/, type: 'color', reason: 'colour word in label' },
	{ test: /\b(location|address|geo|coordinates?|latitude|longitude)\b/, type: 'location', reason: 'location word in label' },
	{ test: /\b(description|notes?|remarks?|comments?|summary|details)\b/, type: 'longtext', reason: 'long-text word in label' },
	{ test: /\b(tags?|labels?)\b/, type: 'tags', reason: 'tags word in label' },
	{ test: /\b(signature)\b/, type: 'signature', reason: 'signature word in label' },
	{ test: /\b(barcode|sku|qr code)\b/, type: 'barcode', reason: 'barcode/sku word in label' },
	{ test: /\b(slug)\b/, type: 'slug', reason: 'slug word in label' },
	{ test: /\b(progress|completion)\b/, type: 'progress', reason: 'progress word in label' },
	{ test: /\b(duration|elapsed)\b/, type: 'duration', reason: 'duration word in label' },
	{ test: /\b(icon)\b/, type: 'icon', reason: 'icon word in label' },
	{ test: /\b(metadata|config|options)\b/, type: 'json', reason: 'structured word in label' },
	{
		test: /^(is|has|can|should|was|enabled|active|disabled)\b|\b(is_active|is_enabled|has_)/,
		type: 'boolean',
		reason: 'boolean-shaped label',
	},
	{ test: /\b(status|state|stage|category|kind|type)\b/, type: 'select', reason: 'enumerated word in label' },
];

/** An observed value format → a concrete type (a stronger signal than a label word). */
const SAMPLE_FORMAT_TYPES: Readonly<Record<NonNullable<DesignHint['sampleFormat']>, FieldType>> = {
	currency: 'currency',
	date: 'date',
	phone: 'phone',
	email: 'email',
	number: 'number',
	boolean: 'boolean',
	text: 'text',
};

/** snake_case identifier, no leading digit, no reserved noise. Deterministic. */
export function snakeName(label: string): string {
	const cleaned = label
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_{2,}/g, '_');
	if (!cleaned) return '';
	// An identifier may not start with a digit (SQL identifier rule).
	return /^[0-9]/.test(cleaned) ? `f_${cleaned}` : cleaned;
}

export interface InferredField extends FieldProposal {}

/**
 * Infer one field from a single hint. Always returns a field whose type is a
 * member of `VALID_FIELD_TYPES`; a declared sample format outranks a label rule,
 * which outranks the text fallback.
 */
export function inferFieldType(hint: DesignHint): FieldProposal | null {
	const name = snakeName(hint.label);
	if (!name) return null;
	if (hint.sampleFormat) {
		const declared = SAMPLE_FORMAT_TYPES[hint.sampleFormat];
		if (declared && VALID_FIELD_TYPES.has(declared)) {
			return {
				name,
				type: declared,
				required: false,
				inference: { confidence: 2, reason: `design declared ${hint.sampleFormat} format`, source: 'declared' },
			};
		}
	}
	const lower = hint.label.toLowerCase();
	for (const rule of NAME_RULES) {
		if (!rule.test.test(lower)) continue;
		if (!VALID_FIELD_TYPES.has(rule.type)) break; // never invent a non-member type
		return { name, type: rule.type, required: false, inference: { confidence: 1, reason: rule.reason, source: 'rule' } };
	}
	return {
		name,
		type: 'text',
		required: false,
		inference: { confidence: 0, reason: 'no rule matched — defaulted to text', source: 'rule' },
	};
}

/**
 * Infer a de-duplicated field list from a set of hints. Unknown/duplicate names
 * are dropped with a warning; the type is always a SSOT member.
 */
export function inferFields(hints: readonly DesignHint[]): { fields: FieldProposal[]; warnings: ProposalWarning[] } {
	const fields: FieldProposal[] = [];
	const warnings: ProposalWarning[] = [];
	const seen = new Set<string>();
	for (const hint of hints) {
		const field = inferFieldType(hint);
		if (!field) {
			warnings.push({ code: 'unnameable_hint', message: `Skipped hint with no usable label: "${hint.label}"` });
			continue;
		}
		if (!VALID_FIELD_TYPES.has(field.type)) {
			warnings.push({ code: 'unknown_type', message: `Dropped "${field.name}": inferred type not in the field-type catalog` });
			continue;
		}
		if (seen.has(field.name)) {
			warnings.push({ code: 'duplicate_field', message: `Skipped duplicate field "${field.name}"` });
			continue;
		}
		seen.add(field.name);
		fields.push(field);
	}
	return { fields, warnings };
}

/**
 * Turn declared relations into relation proposals. Cardinality `many` on the
 * parent side is an `o2m`; `one` is an `m2o`. Deterministic and pure.
 */
export function inferRelations(relations: readonly DesignRelation[]): RelationProposal[] {
	return relations.map((r) => ({
		from: r.from,
		to: r.to,
		cardinality: r.cardinality,
		confidence: 2,
		reason: r.label ? `declared relation "${r.label}"` : 'declared relation',
	}));
}
