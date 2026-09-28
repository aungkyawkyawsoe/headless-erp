/**
 * Dart typegen — schema → ONE generated `schema.dart` file (`--target dart`).
 *
 * The Dart counterpart of `generate.ts`: plain-Dart row models (fromJson/toJson,
 * no build_runner), field-name constants for the `F.*` filter factories, and the
 * canonical API error codes. The output is deterministic so the drift gate can
 * byte-compare a committed example after regeneration.
 *
 * Choices that mirror the TS emitter (and the engine's real wire behavior):
 *   - virtual fields (o2m/m2m/table + non-stored formulas) are omitted — they
 *     only appear when expanded, they own no column;
 *   - booleans decode through `_dbBool` — D1 returns raw 0/1 integers;
 *   - numbers stay `num` — JSON `1` vs `1.0` never gets cast;
 *   - every declared field is still NULLABLE on read (D1 can return NULL even
 *     for `required: true`); only `id` is non-null — the server always assigns it.
 *
 * Dart-specific decisions:
 *   - `toJson()` OMITS null fields — absent ≠ explicit null on this API (an
 *     explicit null would clear the column), so a round-tripped row never
 *     silently wipes server data;
 *   - snake_case wire names become camelCase members, with REFUSED collisions —
 *     `person_id` and `personId` can never silently fuse;
 *   - Dart reserved words are escaped with a trailing `_` (`class` → `class_`);
 *   - the provenance header records ONLY the source hash (never the source
 *     path): the committed example must stay byte-stable across invocation
 *     styles (`--schema ./x.json` vs `--schema /abs/x.json`).
 */
import type { FormulaResultType } from '@mmbix/types';
import { assertSafeFieldName, assertSafeSlug, fieldKind, fieldList, pascalName } from './generate';
import type { TypegenOutput, TypegenSourceMeta } from './generate';
import type { RawCollection, RawField } from './schema';

// ── Field → Dart type mapping ──────────────────────────────

type DartKind = 'string' | 'number' | 'boolean';

/** Dart member type + `fromJson` decode expression per kind. The decode takes
 *  the QUOTED wire key (a Dart string literal). */
const DART_TYPE: Record<DartKind, { type: string; decode: (key: string) => string }> = {
	string: { type: 'String?', decode: (key) => `json[${key}] as String?` },
	number: { type: 'num?', decode: (key) => `json[${key}] as num?` },
	boolean: { type: 'bool?', decode: (key) => `_dbBool(json[${key}])` },
};

/** Formula `result_type` → Dart kind — mirrors the TS `FORMULA_TS_TYPE` table. */
const FORMULA_KIND: Record<FormulaResultType, DartKind> = {
	number: 'number',
	boolean: 'boolean', // decoded through `_dbBool` (D1 stores 0/1)
	string: 'string',
	json: 'string',
};

/** The column kind for a Dart row model — null = virtual (expansion-only, omitted). */
function dartKindOf(field: RawField): DartKind | null {
	if (field.type === 'formula') {
		if (field.store !== true) return null; // virtual formula — computed on read
		const rt = (field.result_type ?? 'number') as FormulaResultType;
		return FORMULA_KIND[rt] ?? 'number'; // out-of-union falls back like the engine
	}
	switch (fieldKind(field)) {
		case 'number':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'virtual':
			return null;
		default:
			// Every TEXT/JSON-backed type, `select` (incl. with options — Dart has
			// no literal unions; options stay server-validated), and unknown types.
			return 'string';
	}
}

// ── Identifier mapping ─────────────────────────────────────

/** Dart reserved words + built-in identifiers that cannot name a member. */
const DART_KEYWORDS = new Set([
	'abstract',
	'as',
	'assert',
	'async',
	'await',
	'base',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'covariant',
	'default',
	'deferred',
	'do',
	'dynamic',
	'else',
	'enum',
	'export',
	'extends',
	'extension',
	'external',
	'factory',
	'false',
	'final',
	'finally',
	'for',
	'get',
	'hide',
	'if',
	'implements',
	'import',
	'in',
	'interface',
	'is',
	'late',
	'library',
	'mixin',
	'new',
	'null',
	'of',
	'on',
	'operator',
	'part',
	'required',
	'rethrow',
	'return',
	'sealed',
	'set',
	'show',
	'static',
	'super',
	'switch',
	'sync',
	'this',
	'throw',
	'true',
	'try',
	'type',
	'typedef',
	'var',
	'void',
	'when',
	'while',
	'with',
	'yield',
]);

/**
 * `person_id` → `personId` — the member name a wire field becomes. Deterministic:
 * parts are lowercased and re-capped, digits keep their position (`x_2fa` →
 * `x2fa`). A Dart reserved word gets a trailing `_` (`class` → `class_`, the
 * analyzer-clean escape). A name that still cannot be an identifier throws.
 */
function camelMemberName(wire: string, slug: string): string {
	const parts = wire
		.split('_')
		.filter(Boolean)
		.map((p) => p.toLowerCase());
	let name = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
	if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) {
		throw new Error(`Typegen(dart): field name "${wire}" in collection "${slug}" does not map to an identifier-safe Dart member name`);
	}
	if (DART_KEYWORDS.has(name)) name = `${name}_`;
	return name;
}

/** Canonical error codes are `[A-Z][A-Z0-9_]*` — anything else is refused. */
function assertSafeErrorCode(code: string): void {
	if (!/^[A-Z][A-Z0-9_]*$/.test(code)) {
		throw new Error(`Typegen(dart): error code "${code}" is not identifier-safe (expected /^[A-Z][A-Z0-9_]*$/) — refusing to emit it`);
	}
}

/**
 * A single-quoted Dart string literal. `$` is escaped too — it opens string
 * interpolation in Dart, so an unescaped one would be executable (the same
 * defense-in-depth as the TS emitter's `stringLiteral`, where the danger is
 * quote-breaking instead).
 */
function dartStringLiteral(value: string): string {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
}

// ── Generation ─────────────────────────────────────────────

export interface DartTypegenOptions {
	/** Provenance recorded in the generated header (the source hash marker). */
	meta?: TypegenSourceMeta;
	/** Canonical API error codes (`GET /api/meta → error_codes`, or the bundled
	 *  `@mmbix/types` catalog) — emitted as `ApiErrorCodes` when non-empty. */
	errorCodes?: readonly string[];
}

function headerFor(meta?: TypegenSourceMeta): string {
	// Hash-only provenance on purpose: the source PATH would make the committed
	// example depend on how the CLI was invoked (`./x.json` vs an absolute
	// path), breaking the byte-for-byte drift gate for no informational gain.
	const markers = meta?.sourceHash ? [`// source-hash: ${meta.sourceHash}`] : [];
	return [
		`// AUTO-GENERATED by @mmbix/sdk typegen (--target dart) — DO NOT EDIT.`,
		...markers,
		`//`,
		`// Row models for the entity schema — one plain-Dart class per collection`,
		`// (fromJson/toJson, no build_runner), field-name constants for the F.* filter`,
		`// factories, and the canonical API error codes this deployment emits.`,
		`// Re-run the generator after any schema change; everything updates together.`,
	].join('\n');
}

/** The `_dbBool` decode helper — emitted ONLY when a boolean column needs it
 *  (an unused private function would itself be an analyzer warning). */
const DB_BOOL_HELPER = [
	`/// D1 stores booleans as INTEGER 0/1 (JSON \`number\`) — normalize to \`bool\`.`,
	`bool? _dbBool(Object? value) {`,
	`\tif (value is bool) return value;`,
	`\tif (value is num) return value != 0;`,
	`\treturn null;`,
	`}`,
].join('\n');

interface DartRowField {
	member: string;
	wire: string;
	kind: DartKind;
}

export function generateDartModels(collections: RawCollection[], options?: DartTypegenOptions): TypegenOutput {
	// Determinism: the API/file order of collections is NOT part of the contract
	// — pin it by slug (a reordering API must not churn the file).
	const ordered = [...collections].sort((a, b) => a.slug.localeCompare(b.slug));

	const models: string[] = [];
	const constants: string[] = [];
	// Collision guard across EVERY emitted class name (model + field constants):
	// slugs like `a-b` and `a_b` must not silently produce the same class.
	const usedClassNames = new Map<string, string>();
	let fieldCount = 0;
	let usesDbBool = false;

	for (const collection of ordered) {
		assertSafeSlug(collection.slug);
		const name = pascalName(collection.slug);
		const fieldsName = `${name}Fields`;
		for (const candidate of [name, fieldsName]) {
			const previous = usedClassNames.get(candidate);
			if (previous !== undefined) {
				throw new Error(
					`Typegen(dart): collections "${previous}" and "${collection.slug}" both emit the class name "${candidate}" — rename one slug`,
				);
			}
			usedClassNames.set(candidate, collection.slug);
		}

		// Rows = real columns only, declared then system (id is always first and
		// handled explicitly — the server assigns it, so it is non-null even though
		// every other field stays nullable on read).
		const rows: DartRowField[] = [];
		const members = new Map<string, string>(); // member → wire (camel collision guard)
		for (const { field } of fieldList(collection)) {
			const kind = dartKindOf(field);
			if (kind === null || field.name === 'id') continue;
			assertSafeFieldName(field.name, collection.slug);
			const member = camelMemberName(field.name, collection.slug);
			const clash = members.get(member);
			if (clash !== undefined) {
				throw new Error(
					`Typegen(dart): fields "${clash}" and "${field.name}" in collection "${collection.slug}" both map to member "${member}" — rename one field`,
				);
			}
			members.set(member, field.name);
			rows.push({ member, wire: field.name, kind });
			fieldCount++;
		}
		if (rows.some((r) => r.kind === 'boolean')) usesDbBool = true;

		// ── Row model ──
		const model: string[] = [];
		model.push(`/// Row model for the \`${collection.slug}\` collection.`);
		model.push(`class ${name} {`);
		model.push(`\tconst ${name}({`);
		model.push(`\t\trequired this.id,`);
		for (const r of rows) model.push(`\t\tthis.${r.member},`);
		model.push(`\t});`);
		model.push(``);
		model.push(`\tfinal String id;`);
		for (const r of rows) model.push(`\tfinal ${DART_TYPE[r.kind].type} ${r.member};`);
		model.push(``);
		model.push(`\tfactory ${name}.fromJson(Map<String, Object?> json) => ${name}(`);
		model.push(`\t\tid: json['id'] as String,`);
		for (const r of rows) model.push(`\t\t${r.member}: ${DART_TYPE[r.kind].decode(dartStringLiteral(r.wire))},`);
		model.push(`\t);`);
		model.push(``);
		model.push(`\t/// PATCH-style payload — null fields are OMITTED (absent ≠ explicit`);
		model.push(`\t/// null), so a round-tripped row never silently clears a column.`);
		model.push(`\tMap<String, Object?> toJson() => {`);
		model.push(`\t\t'id': id,`);
		for (const r of rows) model.push(`\t\tif (${r.member} != null) ${dartStringLiteral(r.wire)}: ${r.member},`);
		model.push(`\t};`);
		model.push(`}`);
		models.push(model.join('\n'));

		// ── Field constants (the same member↔wire mapping as the model) ──
		const block: string[] = [];
		// The doc example names the FIRST emitted field so it always resolves to a
		// real constant (a hardcoded `.status` would not exist on a collection
		// without one — an illustrative snippet that does not compile is worse
		// than a plain one). `id` always exists as the fallback.
		const exampleMember = rows.length > 0 ? rows[0].member : 'id';
		block.push(`/// Field-name constants for the \`${collection.slug}\` collection — pass them to`);
		block.push(`/// the \`F.*\` filter factories (\`F.eq(${fieldsName}.${exampleMember}, …)\`); a misspelled`);
		block.push(`/// field is a compile error.`);
		block.push(`abstract final class ${fieldsName} {`);
		block.push(`\tstatic const id = 'id';`);
		for (const r of rows) block.push(`\tstatic const ${r.member} = ${dartStringLiteral(r.wire)};`);
		block.push(`}`);
		constants.push(block.join('\n'));
	}

	// ── Canonical API error codes ──
	let codesBlock: string | null = null;
	const errorCodes = options?.errorCodes ?? [];
	if (errorCodes.length > 0) {
		const seenCodes = new Set<string>();
		const seenMembers = new Set<string>();
		const codeRows: { member: string; code: string }[] = [];
		for (const code of errorCodes) {
			assertSafeErrorCode(code);
			if (seenCodes.has(code)) throw new Error(`Typegen(dart): duplicate error code "${code}"`);
			seenCodes.add(code);
			const member = camelMemberName(code, 'error_codes');
			if (seenMembers.has(member)) throw new Error(`Typegen(dart): error codes collide on member "${member}" — refusing to emit`);
			seenMembers.add(member);
			codeRows.push({ member, code });
		}
		const lines: string[] = [];
		lines.push(`/// Canonical API error codes this deployment emits — \`GET /api/meta\` →`);
		lines.push(`/// \`error_codes\`. Compare against \`ErpHttpException.apiCode\`.`);
		lines.push(`abstract final class ApiErrorCodes {`);
		for (const r of codeRows) lines.push(`\tstatic const ${r.member} = ${dartStringLiteral(r.code)};`);
		lines.push(``);
		lines.push(`\t/// Every code, in catalog order.`);
		lines.push(`\tstatic const List<String> all = [`);
		for (const r of codeRows) lines.push(`\t\t${r.member},`);
		lines.push(`\t];`);
		lines.push(`}`);
		codesBlock = lines.join('\n');
	}

	const sections: string[] = [headerFor(options?.meta)];
	if (models.length > 0) sections.push(``, `// ── Row models ─────────────────────────────────────────────`, ``, models.join('\n\n'));
	if (constants.length > 0) {
		sections.push(``, `// ── Field constants (F.* factories) ────────────────────────`, ``, constants.join('\n\n'));
	}
	if (codesBlock) sections.push(``, `// ── Canonical API error codes ──────────────────────────────`, ``, codesBlock);
	if (usesDbBool) sections.push(``, `// ── Internals ──────────────────────────────────────────────`, ``, DB_BOOL_HELPER);
	sections.push(``);

	const codeSummary = codesBlock ? `, ${errorCodes.length} error codes` : '';
	return {
		content: sections.join('\n'),
		summary: `${collections.length} collections → ${fieldCount} fields${codeSummary}`,
	};
}
