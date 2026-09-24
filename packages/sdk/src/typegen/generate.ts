/**
 * Typegen — schema → ONE generated `schema.ts` file.
 *
 * The generated file is the single source of truth for both compile-time types
 * AND runtime validation (Zod) — one output, zero drift. It powers:
 *   - typed `client.items('hr_attendance')` (Schema map + per-collection types)
 *   - `schemas.hr_attendance.parse(...)` runtime purification of API responses
 */
import type { RawCollection, RawField } from './schema';

// ── Field → TS type mapping ────────────────────────────────

const STRING_TYPES = new Set([
	'text',
	'longtext',
	'text_editor',
	'markdown',
	'code',
	'slug',
	'phone',
	'email',
	'url',
	'icon',
	'barcode',
	'csv',
	'tags',
	'uuid',
	'color',
	'time',
	'password',
	'rich_text',
	'm2o',
]);

const NUMBER_TYPES = new Set(['integer', 'number', 'decimal', 'float']);

/** Field types that exist on the wire as plain values. */
const VIRTUAL_TYPES = new Set(['o2m', 'm2m', 'table']);

/**
 * Formula fields: STORED (store:true) are real columns — typed by result_type.
 * Virtual formulas are computed on read and omitted from the row shape ('never')
 * exactly like other expanded-only virtual fields.
 */
function formulaType(field: RawField): string | 'never' {
	if (field.store !== true) return 'never';
	switch (field.result_type ?? 'number') {
		case 'boolean':
			return 'boolean | number'; // D1 stores booleans as INTEGER 0/1
		case 'string':
			return 'string';
		case 'json':
			return 'string'; // D1 stores JSON columns as text
		default:
			return 'number';
	}
}

function selectOptions(field: RawField): string[] | null {
	if (typeof field.options === 'string') {
		return field.options
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}
	if (Array.isArray(field.options)) return field.options.filter((o): o is string => typeof o === 'string');
	return null;
}

// A string literal for the generated source, preferring SINGLE quotes. `JSON.stringify`
// always emits double quotes, which the repo's Prettier config rewrites — so every
// regeneration left `src/generated/schema.ts` failing `prettier --check` (and the CI
// format gate) until someone hand-ran Prettier on a DO-NOT-EDIT file. Escaping the
// quote and backslash characters here keeps the output clean by construction.
function stringLiteral(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Mirrors `.prettierrc` (repo root) — the width the emitter folds long lines to. */
const PRINT_WIDTH = 140;

/**
 * Printable width of a line, matching how Prettier measures it.
 *
 * `String.length` counts UTF-16 code units, which is right for ASCII but wrong
 * for the Burmese option labels in this schema (…ပိုင်းဆိုင်ရာ) — they drive the
 * fold decision for the vehicle-issue category list, where a miscount flips the
 * output between the inline and one-per-line shapes and re-breaks the format
 * gate. Counting CODE POINTS (not grapheme clusters) is what matches here; the
 * labels carry no combining marks or emoji that would need cluster counting.
 */
function stringWidth(value: string): number {
	return [...value].length;
}

/** A `z.enum([...])` on ONE line — the form used whenever the whole field line fits. */
function zodEnumOneLine(options: string[]): string {
	return `z.enum([${options.map((o) => stringLiteral(o)).join(', ')}])`;
}

/**
 * A field's Zod expression, folded the way Prettier would fold it.
 *
 * Two independent folds can apply, and Prettier picks by fit:
 *
 *  1. the `.optional()/.nullable()` chain peels onto its own lines when the full
 *     line would exceed `printWidth`;
 *  2. a long `z.enum([...])` argument list either stays inline at the chain indent
 *     or goes one-option-per-line.
 *
 * Getting either wrong made `src/generated/schema.ts` fail `prettier --check`
 * after every regeneration (the licence-township enums have eleven options and
 * always overflow), so the CI format gate needed a hand-run of Prettier on a
 * DO-NOT-EDIT file. Both shapes are reproduced here instead.
 *
 * `indent` is the Zod property depth — the fields sit one level inside
 * `z.object({`, and Prettier indents the folded chain ONE level deeper still
 * (a continuation line is indented relative to the member, not aligned to it).
 */
function zodFieldValue(options: string[], optional: boolean, indent: string): string {
	const suffix = `${optional ? '.optional()' : ''}.nullable()`;
	const oneLineValue = zodEnumOneLine(options);

	// 1. Does the whole field line fit? Then nothing folds at all.
	if (`${indent}PLACEHOLDER: ${oneLineValue}${suffix},`.length <= PRINT_WIDTH) return `${oneLineValue}${suffix},`;

	// 2. The chain folds. `z` leads the member line, and the chain hangs one
	//    level deeper; the `.enum` arguments one deeper again.
	//
	//    The arguments stay INLINE while the `.enum(…)` line fits. Two details
	//    matter and both are easy to get wrong:
	//      • the line includes its trailing comma — the eleven township options
	//        measure 139 without it (under the limit) but 141 with it, which is
	//        why Prettier splits them; and
	//      • width is measured in code points, not UTF-16 units, so the Burmese
	//        category list (112) stays inline.
	const chainIndent = `${indent}\t`;
	const argsIndent = `${chainIndent}\t`;
	const inlineArgs = `${chainIndent}.enum([${options.map((o) => stringLiteral(o)).join(', ')}])`;
	// The trailing comma rides the `.enum(…)` line for the WIDTH TEST only — it is
	// part of the measured line (that is what tips the township list over), but it
	// is emitted after the chain, not between `.enum()` and `.optional()`.
	if (stringWidth(`${inlineArgs},`) < PRINT_WIDTH) {
		return ['z', inlineArgs, `${chainIndent}.optional()`, `${chainIndent}.nullable(),`].join('\n');
	}

	// 3. The arguments do not fit either — one option per line.
	return [
		'z',
		`${chainIndent}.enum([`,
		...options.map((o) => `${argsIndent}${stringLiteral(o)},`),
		`${chainIndent}])`,
		`${chainIndent}.optional()`,
		`${chainIndent}.nullable(),`,
	].join('\n');
}

function tsTypeFor(field: RawField): string {
	if (field.type === 'formula') return formulaType(field);
	if (field.type === 'select') {
		const options = selectOptions(field);
		if (options && options.length > 0) return options.map((o) => stringLiteral(o)).join(' | ');
		return 'string';
	}
	if (field.type === 'boolean') return 'boolean | number'; // D1 stores booleans as INTEGER 0/1 — the wire value is a number
	if (NUMBER_TYPES.has(field.type)) return 'number';
	if (field.type === 'json') return 'string'; // D1 stores JSON columns as text
	if (STRING_TYPES.has(field.type) || field.type === 'datetime' || field.type === 'timestamp' || field.type === 'date') {
		return 'string';
	}
	if (VIRTUAL_TYPES.has(field.type)) return 'never'; // only present when expanded
	return 'string';
}

/** Collection "hr_attendance" → "HrAttendance" (collision-safe suffix). */
export function pascalName(slug: string): string {
	const base = slug
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join('');
	const name = base || 'Collection';
	return /^\d/.test(name) ? `C${name}` : name;
}

// ── Codegen-injection guard ────────────────────────────────
// Slugs/field names are interpolated into generated TS — a hostile `--schema`
// file (or a compromised API response) must never be able to emit executable
// code into `schema.ts`. They are server-validated upstream, so this is defense
// in depth: reject anything that is not a plain identifier BEFORE emitting.
const SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const FIELD_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const TS_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function assertSafeSlug(slug: string): void {
	if (!SLUG_RE.test(slug)) {
		throw new Error(
			`Typegen: collection slug "${slug}" is not a safe identifier (expected /^[a-zA-Z0-9_-]+$/) — refusing to generate code for it`,
		);
	}
}

function assertSafeFieldName(name: string, slug: string): void {
	if (!FIELD_NAME_RE.test(name)) {
		throw new Error(
			`Typegen: field name "${name}" in collection "${slug}" is not a safe identifier (expected /^[a-zA-Z_][a-zA-Z0-9_]*$/) — refusing to generate code for it`,
		);
	}
}

function assertSafeTypeName(name: string, slug: string): void {
	if (!TS_IDENT_RE.test(name)) {
		throw new Error(`Typegen: collection slug "${slug}" produces invalid type name "${name}" — refusing to generate code for it`);
	}
}

function fieldList(collection: RawCollection): { field: RawField; system: boolean }[] {
	// Generated collections may arrive with schema_json still as a string
	// (normalizeCollection is applied by the CLI, but direct callers can pass
	// raw API shapes) — treat non-object values as empty.
	const declared = typeof collection.schema_json === 'object' ? (collection.schema_json?.fields ?? []) : [];
	const system = typeof collection.system_field_options === 'object' ? (collection.system_field_options?.fields ?? []) : [];
	return [...declared.map((field) => ({ field, system: false })), ...system.map((field) => ({ field, system: true }))];
}

/** Declared fields default to REQUIRED; system/engine-managed columns are
 *  ALWAYS optional (D1 returns NULL for e.g. `deleted_at` on live rows and
 *  `display_number` before a naming-series runs — their metadata `required`
 *  flag is not a reliable NOT-NULL guarantee). */
function isOptional(field: RawField, system: boolean): boolean {
	return system ? true : field.required === false;
}

function zodTypeFor(field: RawField, optional: boolean, indent: string): string {
	// Every branch returns the COMPLETE member value, suffix and trailing comma
	// included — an early return that forgot them silently emitted `total: z.number()`
	// with no `.optional().nullable(),` (the typegen test caught exactly that).
	const suffix = `${optional ? '.optional()' : ''}.nullable(),`;

	if (field.type === 'formula') {
		// Stored formulas are real columns; virtual ones are omitted upstream.
		switch (field.result_type ?? 'number') {
			case 'boolean':
				return `z.union([z.boolean(), z.number()])${suffix}`;
			case 'string':
			case 'json':
				return `z.string()${suffix}`;
			default:
				return `z.number()${suffix}`;
		}
	}
	if (field.type === 'select') {
		const options = selectOptions(field);
		if (options && options.length > 0) return zodFieldValue(options, optional, indent);
	}
	return `${zodScalarTypeFor(field)}${suffix}`;
}

/** The scalar (non-select) Zod call for a field — the chain suffix is added by the caller. */
function zodScalarTypeFor(field: RawField): string {
	if (field.type === 'boolean') return 'z.union([z.boolean(), z.number()])'; // D1 returns raw 0/1 integers for boolean columns
	if (NUMBER_TYPES.has(field.type)) return 'z.number()';
	if (field.type === 'json') return 'z.string()';
	if (field.type === 'datetime' || field.type === 'timestamp' || field.type === 'date') return 'z.string()';
	return 'z.string()';
}

// ── Generation ─────────────────────────────────────────────

export interface TypegenOutput {
	/** The generated `schema.ts` file content (types + Zod in one file). */
	content: string;
	/** Human summary for the CLI. */
	summary: string;
}

/** Provenance recorded in the generated header (staleness detection). */
export interface TypegenSourceMeta {
	/** Where the schema came from — the `--schema` path or the API URL. */
	source?: string;
	/** SHA-256 of the source schema bytes (offline schema files). */
	sourceHash?: string;
}

function headerFor(meta?: TypegenSourceMeta): string {
	// The provenance markers are plain `//` lines so CI/tooling can grep them
	// without parsing the doc block: `typegen:check` compares the regenerated
	// file byte-for-byte, and source-hash pins the exact source revision.
	const markers = meta?.sourceHash ? [`// generated from ${meta.source ?? '<unknown source>'}`, `// source-hash: ${meta.sourceHash}`] : [];
	return [
		`/* eslint-disable */`,
		...markers,
		`/**
 * AUTO-GENERATED by @mmbix/sdk typegen — DO NOT EDIT.
 *
 * Single source of truth for the entity schema: TypeScript types (compile-time)
 * AND Zod schemas (runtime validation). Re-run the generator after any schema
 * change; both sides update together — no drift.
 *
 * Usage:
 *   import type { Schema } from './generated/schema';
 *   import { Schemas } from './generated/schema';
 *   createClient<Schema>({ ... });
 *   Schemas.hr_attendance.parse(response); // runtime purification
 */`,
	].join('\n');
}

/** Prefix a field entry's FIRST line with the object indent. A folded Zod value
 *  carries its own indentation on the following lines, so re-indenting those too
 *  would double their tabs. */
function indentFirstLine(entry: string): string {
	return `\t${entry}`;
}

export function generateTypes(collections: RawCollection[], meta?: TypegenSourceMeta): TypegenOutput {
	const schemas: string[] = [];
	const mapEntries: string[] = [];

	for (const collection of collections) {
		assertSafeSlug(collection.slug);
		const name = pascalName(collection.slug);
		assertSafeTypeName(name, collection.slug);
		const fields = fieldList(collection);
		// Each entry is the field's EXACT text: `name: <zodValue>`. A folded Zod value
		// is already multi-line and self-indented, so the enclosing `z.object({`
		// indent is applied to the first line only (see `indentFirstLine`).
		const zodFields = ['id: z.string(),'];

		for (const { field: f, system } of fields) {
			if (f.name === 'id') continue;
			assertSafeFieldName(f.name, collection.slug);
			// Virtual fields (o2m/m2m/table + non-stored formula) are only present
			// when expanded — omit them from the row shape; they are not plain
			// columns. STORED formulas are real columns and stay.
			if (tsTypeFor(f) === 'never') continue;
			const optional = isOptional(f, system);
			// `.optional()` = may be absent (declared optional / engine columns);
			// `.nullable()` ALWAYS = D1 can return NULL even for "required" fields
			// (e.g. `display_number` before its naming series runs). The client read
			// schema tolerates null — required-ness is enforced server-side on writes.
			// Indented with a tab: the fields sit one level inside `z.object({`.
			const zodValue = zodTypeFor(f, optional, '\t');
			zodFields.push(`${f.name}: ${zodValue}`);
		}

		// ONE definition per collection — the row type is INFERRED from the Zod
		// schema, so types and runtime validation can never drift. Every emitted
		// identifier was validated above (assertSafe*) — a slug/field name that
		// could break out of its string/key position throws BEFORE any code is
		// emitted, so interpolation here is provably inert.
		//
		// A folded Zod value is already multi-line and self-indented, so the enclosing
		// `z.object({` indent is applied to the first line only (see `indentFirstLine`).
		schemas.push(`export const ${name}Schema = z.object({\n${zodFields.map(indentFirstLine).join('\n')}\n});`);
		// Unquoted key: `assertSafeSlug` guarantees a bare identifier is valid, and
		// Prettier strips redundant quotes from object-type members.
		mapEntries.push(`\t${collection.slug}: z.infer<typeof ${name}Schema>;`);
	}

	// `mapEntries` already carry their own leading tab, so they are joined as-is;
	// `indentFirstLine` is for the Zod field list, which does not.
	const schemaType = `export type Schema = {\n${mapEntries.join('\n')}\n};`;
	// Unquoted keys throughout — Prettier strips redundant quotes from object keys,
	// and `assertSafeSlug` already proved every slug is a bare identifier.
	const schemasMap = `export const Schemas = {\n${collections.map((c) => `\t${c.slug}: ${pascalName(c.slug)}Schema,`).join('\n')}\n};`;

	const content = [
		headerFor(meta),
		`import { z } from 'zod';`,
		'',
		'// ── Runtime validation (Zod) — the SINGLE source of truth ──',
		...schemas,
		'',
		'// ── Schema map — feeds createClient<Schema>() ──────────',
		schemaType,
		'',
		schemasMap,
		'',
	].join('\n');

	return {
		content,
		summary: `${collections.length} collections → ${collections.reduce((n, c) => n + fieldList(c).length, 0)} fields`,
	};
}
