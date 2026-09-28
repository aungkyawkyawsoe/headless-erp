/**
 * Dart typegen (`--target dart`) — emitter units, the committed-example drift
 * gate, and the Dart SDK error-catalog contract.
 *
 * The drift gate regenerates `packages/mex-flutter-sdk/example/schema.dart`
 * from `schema.source.json` IN MEMORY and byte-compares it with the committed
 * file: editing the emitter (or the fixture) without regenerating the example
 * fails HERE — in the TS suite CI already runs — before a stale golden reaches
 * a Flutter app.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { API_ERROR_CODES, ERROR_CODES } from '@mmbix/types';
import { fetchErrorCodes, generateDartModels, normalizeCollection } from '../src/typegen';
import type { RawCollection } from '../src/typegen';

const SAMPLE: RawCollection[] = [
	{
		slug: 'work_orders',
		schema_json: {
			fields: [
				{ name: 'code', type: 'slug', required: true },
				{ name: 'status', type: 'select', options: ['draft', 'done'], required: false },
				{ name: 'priority', type: 'integer', required: false },
				{ name: 'is_billable', type: 'boolean', required: false },
				{ name: 'meta_note', type: 'json', required: false },
				{ name: 'lines', type: 'o2m', required: false },
				{ name: 'total', type: 'formula', store: true, result_type: 'number', formula: 'rate * qty' },
				{ name: 'health_label', type: 'formula', formula: 'title' },
			],
		},
		system_field_options: { fields: [{ name: 'created_at', type: 'timestamp', required: false }] },
	},
	{ slug: 'contacts', schema_json: { fields: [{ name: 'full_name', type: 'text', required: true }] } },
];

describe('generateDartModels', () => {
	it('emits one plain-Dart model per collection (fromJson/toJson, no build_runner)', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('class WorkOrders {');
		expect(content).toContain('class Contacts {');
		expect(content).toContain('factory WorkOrders.fromJson(Map<String, Object?> json) => WorkOrders(');
		expect(content).toContain('Map<String, Object?> toJson() => {');
	});

	it('maps snake_case wire names to camelCase members (wire keys stay snake_case)', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('this.isBillable,');
		expect(content).toContain('final String? fullName;');
		expect(content).toContain("fullName: json['full_name'] as String?,");
		expect(content).toContain("if (isBillable != null) 'is_billable': isBillable,");
	});

	it('keeps id the only non-null member — even a required field is nullable on read', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('required this.id,');
		expect(content).toContain('final String id;');
		expect(content).toContain("id: json['id'] as String,");
		expect(content).toContain('final String? code;'); // `required: true` on the wire, still String?
		expect(content).toContain("code: json['code'] as String?,");
	});

	it('never duplicates the id member when the schema declares its own id field', () => {
		const { content } = generateDartModels([
			{
				slug: 'x',
				schema_json: {
					fields: [
						{ name: 'id', type: 'text' },
						{ name: 'title', type: 'text' },
					],
				},
			},
		]);
		expect(content.match(/final String id;/g)).toHaveLength(1);
	});

	it('keeps numbers as num? (JSON 1 vs 1.0 never gets cast)', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('final num? priority;');
		expect(content).toContain("priority: json['priority'] as num?,");
	});

	it('decodes booleans through _dbBool, and emits the helper only when needed', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain("isBillable: _dbBool(json['is_billable']),");
		expect(content).toContain('bool? _dbBool(Object? value) {');
		const { content: noBool } = generateDartModels([{ slug: 'plain', schema_json: { fields: [{ name: 'title', type: 'text' }] } }]);
		expect(noBool).not.toContain('_dbBool'); // an unused private helper would trip the analyzer
	});

	it('emits toJson in PATCH style — null fields are omitted, never emitted unconditionally', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain("if (code != null) 'code': code,");
		expect(content).not.toMatch(/^\t\t'code': code,$/m); // the unconditional shape would clear columns
		expect(content).toContain("'id': id,");
	});

	it('omits virtual fields (o2m/table + non-stored formulas) from models and constants', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).not.toContain('lines');
		expect(content).not.toContain('healthLabel');
		expect(content).not.toContain('health_label');
	});

	it('types STORED formulas by result_type (boolean decodes via _dbBool)', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('final num? total;');
		expect(content).toContain("total: json['total'] as num?,");
		const { content: boolFormula } = generateDartModels([
			{
				slug: 'x',
				schema_json: { fields: [{ name: 'is_overdue', type: 'formula', store: true, result_type: 'boolean', formula: 'a < b' }] },
			},
		]);
		expect(boolFormula).toContain('final bool? isOverdue;');
		expect(boolFormula).toContain("isOverdue: _dbBool(json['is_overdue']),");
	});

	it('types select as String? — options stay server-validated, never inlined', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('final String? status;');
		expect(content).not.toContain('draft'); // no literal-union emulation in Dart
	});

	it('emits field constants mirroring the wire names, including system fields', () => {
		const { content } = generateDartModels(SAMPLE);
		expect(content).toContain('abstract final class WorkOrdersFields {');
		expect(content).toContain("static const id = 'id';");
		expect(content).toContain("static const createdAt = 'created_at';");
		expect(content).toContain("static const fullName = 'full_name';");
		// The doc example names a REAL field of each collection — a hardcoded
		// `.status` would not exist on `contacts` (an example that cannot compile).
		expect(content).toContain('F.eq(ContactsFields.fullName, …)');
		expect(content).toContain('F.eq(WorkOrdersFields.code, …)');
	});

	it('escapes Dart reserved words with a trailing underscore', () => {
		const { content } = generateDartModels([{ slug: 'x', schema_json: { fields: [{ name: 'class', type: 'text' }] } }]);
		expect(content).toContain('this.class_,');
		expect(content).toContain('final String? class_;');
		expect(content).toContain("class_: json['class'] as String?,");
		expect(content).toContain("static const class_ = 'class';");
	});

	it('refuses wire names that collide on one camelCase member', () => {
		expect(() =>
			generateDartModels([
				{
					slug: 'x',
					schema_json: {
						fields: [
							{ name: 'person_id', type: 'text' },
							{ name: 'person__id', type: 'text' },
						],
					},
				},
			]),
		).toThrow(/both map to member "personId"/);
	});

	it('refuses slugs that collide on one generated class name', () => {
		expect(() =>
			generateDartModels([
				{ slug: 'a-b', schema_json: { fields: [] } },
				{ slug: 'a_b', schema_json: { fields: [] } },
			]),
		).toThrow(/class name/);
	});

	it('refuses slugs/field names that could break out of generated Dart (codegen injection)', () => {
		const maliciousSlug = "orders'; console" + ".log('INJECTED'); //";
		expect(() => generateDartModels([{ slug: maliciousSlug, schema_json: { fields: [] } }])).toThrow();
		expect(() =>
			generateDartModels([{ slug: 'ok', schema_json: { fields: [{ name: 'x; process.exit(99); //', type: 'text' }] } }]),
		).toThrow();
		// `$` opens Dart string interpolation — refused upstream like every other
		// non-identifier character.
		expect(() => generateDartModels([{ slug: 'ok', schema_json: { fields: [{ name: 'a$b', type: 'text' }] } }])).toThrow();
	});

	it('is order-independent — collections are sorted by slug (deterministic output)', () => {
		const forward = generateDartModels(SAMPLE);
		const reversed = generateDartModels([...SAMPLE].reverse());
		expect(reversed.content).toBe(forward.content);
	});

	it('records ONLY the source hash in the header — no path, so goldens stay byte-stable', () => {
		const { content } = generateDartModels(SAMPLE, { meta: { source: '/abs/path/schema.json', sourceHash: 'deadbeef' } });
		expect(content).toContain('// source-hash: deadbeef');
		expect(content).not.toContain('/abs/path');
	});

	it('emits ApiErrorCodes only when codes are provided (and refuses unsafe ones)', () => {
		expect(generateDartModels(SAMPLE).content).not.toContain('ApiErrorCodes');
		const { content } = generateDartModels(SAMPLE, { errorCodes: ['NOT_FOUND', 'PAYLOAD_TOO_LARGE'] });
		expect(content).toContain('abstract final class ApiErrorCodes {');
		expect(content).toContain("static const notFound = 'NOT_FOUND';");
		expect(content).toContain("static const payloadTooLarge = 'PAYLOAD_TOO_LARGE';");
		expect(content).toContain('static const List<String> all = [');
		expect(() => generateDartModels(SAMPLE, { errorCodes: ['not-found'] })).toThrow(/identifier-safe/);
		expect(() => generateDartModels(SAMPLE, { errorCodes: ['NOT_FOUND', 'NOT_FOUND'] })).toThrow(/duplicate error code/);
		expect(() => generateDartModels(SAMPLE, { errorCodes: ['FOO_BAR', 'FOO__BAR'] })).toThrow(/collide/);
	});

	it('summarizes emitted fields (and codes when present) for the CLI', () => {
		expect(generateDartModels(SAMPLE).summary).toBe('2 collections → 8 fields');
		expect(generateDartModels(SAMPLE, { errorCodes: [...API_ERROR_CODES] }).summary).toBe('2 collections → 8 fields, 12 error codes');
	});
});

describe('fetchErrorCodes', () => {
	it('reads GET /api/meta → data.error_codes (trailing slash normalized)', async () => {
		const fetchImpl = vi.fn(async (url: unknown) => {
			expect(String(url)).toBe('https://api.example.com/api/meta');
			return { ok: true, json: async () => ({ data: { error_codes: ['NOT_FOUND', 'CONFLICT'] } }) };
		}) as unknown as typeof fetch;
		expect(await fetchErrorCodes({ url: 'https://api.example.com/api/', token: 't', fetchImpl })).toEqual(['NOT_FOUND', 'CONFLICT']);
	});

	it('filters non-string entries and degrades to null on every failure', async () => {
		const ok = vi.fn(async () => ({ ok: true, json: async () => ({ data: { error_codes: ['A_B', 1, null, 'C_D'] } }) }));
		expect(await fetchErrorCodes({ url: 'https://x/api', token: 't', fetchImpl: ok as unknown as typeof fetch })).toEqual(['A_B', 'C_D']);

		const notOk = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
		expect(await fetchErrorCodes({ url: 'https://x/api', token: 't', fetchImpl: notOk as unknown as typeof fetch })).toBeNull();

		const malformed = vi.fn(async () => ({ ok: true, json: async () => ({ data: { error_codes: 'NOPE' } }) }));
		expect(await fetchErrorCodes({ url: 'https://x/api', token: 't', fetchImpl: malformed as unknown as typeof fetch })).toBeNull();

		const unreachable = vi.fn(async () => {
			throw new Error('offline');
		});
		expect(await fetchErrorCodes({ url: 'https://x/api', token: 't', fetchImpl: unreachable as unknown as typeof fetch })).toBeNull();
	});

	it('never calls fetch without a url + token', async () => {
		const fetchImpl = vi.fn();
		expect(await fetchErrorCodes({ fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
		expect(await fetchErrorCodes({ url: 'https://x/api', fetchImpl: fetchImpl as unknown as typeof fetch })).toBeNull();
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

// ── Committed-example gates (skipped when the sibling package is absent) ──

const exampleDir = new URL('../../mex-flutter-sdk/example/', import.meta.url);
const dartErrorsUrl = new URL('../../mex-flutter-sdk/lib/src/errors.dart', import.meta.url);

describe.skipIf(!existsSync(fileURLToPath(exampleDir)))('committed Dart example (drift gate)', () => {
	it('regenerates example/schema.dart byte-for-byte from its source JSON', () => {
		const fixturePath = fileURLToPath(new URL('schema.source.json', exampleDir));
		const goldenPath = fileURLToPath(new URL('schema.dart', exampleDir));
		// Exactly what the CLI does offline: hash the raw source BYTES, normalize
		// each collection, emit with the bundled error catalog.
		const bytes = readFileSync(fixturePath);
		const sourceHash = createHash('sha256').update(bytes).digest('hex');
		const collections = (JSON.parse(bytes.toString('utf-8')) as RawCollection[]).map(normalizeCollection);
		const { content } = generateDartModels(collections, {
			meta: { source: 'packages/mex-flutter-sdk/example/schema.source.json', sourceHash },
			errorCodes: API_ERROR_CODES,
		});
		expect(content).toBe(readFileSync(goldenPath, 'utf-8'));
	});
});

describe.skipIf(!existsSync(fileURLToPath(dartErrorsUrl)))('Dart SDK error catalog (SSOT contract)', () => {
	const listIn = (source: string, name: string): string[] => {
		const block = new RegExp(`const List<String> ${name} = \\[(.*?)\\];`, 's').exec(source);
		expect(block, `${name} list not found in errors.dart`).not.toBeNull();
		return [...block![1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
	};

	it('errors.dart mirrors ERROR_CODES / API_ERROR_CODES (no drift)', () => {
		// The SSOT is `packages/utils/src/errors/codes.ts` (re-exported by
		// `@mmbix/types`, served by `/api/meta`, pinned by apps/api contract.spec.ts).
		// This closes the loop from the TS side: a PR that edits the catalog but
		// forgets the Dart port fails the TS suite CI already runs.
		const source = readFileSync(fileURLToPath(dartErrorsUrl), 'utf-8');
		expect(listIn(source, 'errorCodes')).toEqual([...ERROR_CODES]);
		expect(listIn(source, 'apiErrorCodes')).toEqual([...API_ERROR_CODES]);
	});
});
