import { describe, expect, it } from 'vitest';
import { generateTypes, pascalName } from '../src/typegen';
import { normalizeCollection } from '../src/typegen';
import type { RawCollection } from '../src/typegen';

const SAMPLE: RawCollection[] = [
	{
		slug: 'records',
		name: 'HR Attendance',
		schema_json: {
			fields: [
				{ name: 'person_id', type: 'text', required: false },
				{ name: 'type', type: 'select', options: ['check-in', 'check-out'], required: true },
				{ name: 'timestamp', type: 'datetime', required: false },
				{ name: 'status', type: 'select', options: ['on_time', 'late_in'], required: false },
				{ name: 'location', type: 'json', required: false },
				{ name: 'note', type: 'text', required: false },
			],
		},
		system_field_options: { fields: [{ name: 'created_at', type: 'timestamp', required: false }] },
	},
	{
		slug: 'requests',
		name: 'HR Requests',
		schema_json: {
			fields: [
				{ name: 'person_id', type: 'text', required: false },
				{ name: 'request_type', type: 'select', options: ['leave', 'ot', 'early', 'onduty'], required: true },
				{ name: 'status', type: 'select', options: ['pending', 'approved', 'rejected', 'cancelled'], required: true },
				{ name: 'from_date', type: 'date', required: false },
				{ name: 'to_date', type: 'date', required: false },
			],
		},
	},
];

describe('generateTypes', () => {
	it('emits one Zod schema per collection (single source of truth)', () => {
		const { content } = generateTypes(SAMPLE);
		expect(content).toContain('export const RecordsSchema = z.object({');
		expect(content).toContain("type: z.enum(['check-in', 'check-out']).nullable(),");
		expect(content).toContain('person_id: z.string().optional().nullable(),');
		expect(content).toContain('created_at: z.string().optional().nullable(),'); // from system_field_options
		expect(content).toContain('export const RequestsSchema = z.object({');
	});

	it('derives row types from Zod via the Schema map (zero drift)', () => {
		const { content } = generateTypes(SAMPLE);
		expect(content).toContain('export type Schema = {');
		expect(content).toContain('records: z.infer<typeof RecordsSchema>;');
		expect(content).toContain('requests: z.infer<typeof RequestsSchema>;');
		expect(content).not.toContain('export interface Records'); // no hand-written interface to drift
	});

	it('emits the Schemas registry for runtime purification', () => {
		const { content } = generateTypes(SAMPLE);
		expect(content).toContain('export const Schemas = {');
		expect(content).toContain('records: RecordsSchema,');
	});

	it('marks select fields with no options as string', () => {
		const { content } = generateTypes([{ slug: 'x', schema_json: { fields: [{ name: 'color', type: 'select', required: false }] } }]);
		expect(content).toContain('color: z.string().optional().nullable(),');
	});

	it('types boolean columns as boolean | number (D1 returns raw 0/1 integers)', () => {
		const { content } = generateTypes([
			{ slug: 'flags', schema_json: { fields: [{ name: 'enabled', type: 'boolean', required: false }] } },
		]);
		expect(content).toContain('enabled: z.union([z.boolean(), z.number()]).optional().nullable(),');
		expect(content).toContain('flags: z.infer<typeof FlagsSchema>;');
	});

	it('skips virtual relation fields (o2m/m2m) from the row shape', () => {
		const { content } = generateTypes([
			{
				slug: 'parent',
				schema_json: {
					fields: [
						{ name: 'title', type: 'text', required: true },
						{ name: 'children', type: 'o2m', required: false },
					],
				},
			},
		]);
		expect(content).toContain('title: z.string().nullable(),');
		expect(content).not.toContain('children');
	});

	it('types STORED formulas by result_type and skips virtual formulas', () => {
		const { content } = generateTypes([
			{
				slug: 'invoices',
				schema_json: {
					fields: [
						{ name: 'total', type: 'formula', store: true, formula: 'qty * rate', required: false },
						{ name: 'is_overdue', type: 'formula', store: true, result_type: 'boolean', formula: 'due < NOW()', required: false },
						{ name: 'label', type: 'formula', store: true, result_type: 'string', formula: 'name', required: false },
						{ name: 'doubled', type: 'formula', formula: 'total * 2', required: false }, // virtual — omitted
					],
				},
			},
		]);
		expect(content).toContain('total: z.number().optional().nullable(),');
		expect(content).toContain('is_overdue: z.union([z.boolean(), z.number()]).optional().nullable(),');
		expect(content).toContain('label: z.string().optional().nullable(),');
		expect(content).not.toContain('doubled');
	});

	it('pascalName converts slugs and guards numeric starts', () => {
		expect(pascalName('records')).toBe('Records');
		expect(pascalName('vehicle-trips')).toBe('VehicleTrips');
		expect(pascalName('2fa_codes')).toBe('C2faCodes');
	});

	it('emits select options with single quotes so the output is Prettier-clean', () => {
		// `JSON.stringify` emits double quotes; the repo formats with
		// `singleQuote: true`, so every regeneration used to leave the file failing
		// `prettier --check` (and the CI format gate).
		const { content } = generateTypes([
			{ slug: 'x', schema_json: { fields: [{ name: 'color', type: 'select', options: ['red', 'blue'], required: false }] } },
		]);
		expect(content).toContain("color: z.enum(['red', 'blue']).optional().nullable(),");
		expect(content).not.toContain('"red"');
	});

	it('folds a long select option list one-per-line, matching Prettier', () => {
		// Eleven options overflow `printWidth` (140), so the chain peels and the
		// arguments go one per line. Getting this wrong re-breaks the format gate
		// on every regeneration.
		const townships = [
			'Bago',
			'Hlaing',
			'Mandalay',
			'Mandalay(South)',
			'MDY',
			'Thanlyin',
			'TharYarWady',
			'Yangon',
			'YGN',
			'YwarTharGyi',
			'Ywarthargyi',
		];
		const { content } = generateTypes([
			{ slug: 'x', schema_json: { fields: [{ name: 'township', type: 'select', options: townships, required: false }] } },
		]);
		expect(content).toContain("township: z\n\t\t.enum([\n\t\t\t'Bago',\n");
		expect(content).toContain("\t\t\t'Ywarthargyi',\n\t\t])\n\t\t.optional()\n\t\t.nullable(),");
	});

	it('keeps a short option list inline', () => {
		const { content } = generateTypes([
			{ slug: 'x', schema_json: { fields: [{ name: 'place', type: 'select', options: ['AYY', 'BGO', 'YGN'], required: false }] } },
		]);
		expect(content).toContain("place: z.enum(['AYY', 'BGO', 'YGN']).optional().nullable(),");
	});

	it('refuses slugs/field names that could break out of generated code (codegen injection)', () => {
		// These would previously emit executable code at import time (RCE on the
		// machine that builds/imports the generated file).
		const maliciousSlug = "orders'; console" + ".log('INJECTED'); //";
		expect(() => generateTypes([{ slug: maliciousSlug, schema_json: { fields: [] } }])).toThrow();
		expect(() => generateTypes([{ slug: 'ok', schema_json: { fields: [{ name: 'x; process.exit(99); //', type: 'text' }] } }])).toThrow();
		expect(() => generateTypes([{ slug: 'backtick`evil', schema_json: { fields: [] } }])).toThrow();
	});
});

describe('normalizeCollection', () => {
	it('parses string schema_json/system_field_options', () => {
		const raw = {
			slug: 'x',
			schema_json: JSON.stringify({ fields: [{ name: 'a', type: 'text', required: false }] }),
			system_field_options: JSON.stringify({ fields: [{ name: 'b', type: 'text', required: false }] }),
		} as unknown as RawCollection;
		const normalized = normalizeCollection(raw);
		const declared = typeof normalized.schema_json === 'object' ? normalized.schema_json?.fields : [];
		const system = typeof normalized.system_field_options === 'object' ? normalized.system_field_options?.fields : [];
		expect(Array.isArray(declared)).toBe(true);
		expect(Array.isArray(system)).toBe(true);
	});

	it('tolerates malformed schema_json', () => {
		const raw = { slug: 'x', schema_json: '{oops' } as unknown as RawCollection;
		expect(normalizeCollection(raw).schema_json).toEqual({});
	});
});
