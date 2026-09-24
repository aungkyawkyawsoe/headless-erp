/**
 * Field Utils Unit Tests — data-integrity audit fixes
 *
 *   - 'date' field type: accepted by the type union, maps to a TEXT column
 *   - SYSTEM_FIELDS no longer reserves `data` / `sort` (user fields survive writes)
 *   - coerceValue: boolean truthiness bug, integer numeric-string parsing
 *   - mergeRowData: physical columns win over stale _meta keys
 */
import { describe, it, expect, vi } from 'vitest';
import { applyFieldDefinitions, buildSystemColumnsList, coerceValue, decodeJsonFields, mergeRowData, splitRowData } from '../field-utils';
import { SchemaBuilder } from '../../db/schema-builder';
import { SYSTEM_FIELDS } from '@mmbix/types';
import type { FieldDefinition } from '@mmbix/types';

// ─── date field type ─────────────────────────────────────

describe('date field type', () => {
	it('is a valid FieldType (SYSTEM_FIELDS-adjacent union) and not reserved', () => {
		// SYSTEM_FIELDS lives in types; the union is compile-time. We assert the
		// runtime side: applying a 'date' field produces a TEXT column.
		expect(SYSTEM_FIELDS.has('date')).toBe(false);
	});

	it('applyFieldDefinitions builds a TEXT column for date (no crash)', () => {
		const sb = new SchemaBuilder();
		const stmts = sb.createTable('cms_events', (t) => {
			t.uuid('id');
			applyFieldDefinitions(t, [{ name: 'event_date', type: 'date' } as FieldDefinition], false);
		});
		expect(stmts[0].sql).toContain('"event_date" TEXT NOT NULL');
	});

	it('coerces date values as strings (same as datetime)', () => {
		expect(coerceValue('2026-08-08', 'date')).toBe('2026-08-08');
	});
});

// ─── image field type (media analogue of file) ────────────────

describe('image field type', () => {
	it('is a valid FieldType and not reserved', () => {
		expect(SYSTEM_FIELDS.has('image')).toBe(false);
	});

	it('applyFieldDefinitions builds a nullable TEXT column for image (like file)', () => {
		const sb = new SchemaBuilder();
		const stmts = sb.createTable('cms_photos', (t) => {
			t.uuid('id');
			applyFieldDefinitions(t, [{ name: 'photo', type: 'image', required: false }] as FieldDefinition[], false);
		});
		expect(stmts[0].sql).toContain('"photo" TEXT');
		// Optional → nullable, exactly the shape `file` already maps to.
		expect(stmts[0].sql).not.toContain('"photo" TEXT NOT NULL');
	});

	it('coerces image values as strings (media URL / path, same as file)', () => {
		expect(coerceValue('/api/media/abc123', 'image')).toBe('/api/media/abc123');
		expect(coerceValue('https://cdn.example.com/img.png', 'image')).toBe('https://cdn.example.com/img.png');
	});
});

// ─── SYSTEM_FIELDS / data + sort ─────────────────────────

describe('SYSTEM_FIELDS no longer swallows data/sort', () => {
	it('data and sort are NOT system columns anymore', () => {
		expect(SYSTEM_FIELDS.has('data')).toBe(false);
		expect(SYSTEM_FIELDS.has('sort')).toBe(false);
	});

	it('splitRowData writes a user `data` field as a real column', () => {
		const fields = [
			{ name: 'data', type: 'json', required: false },
			{ name: 'sort', type: 'integer', required: false },
		] as FieldDefinition[];
		const { columns, meta } = splitRowData({ data: { x: 1 }, sort: '5', unrelated: 'meta-only' }, fields);
		expect(columns).toHaveProperty('data', '{"x":1}');
		expect(columns).toHaveProperty('sort', 5); // numeric-string parsed + floored
		expect(meta).toEqual({ unrelated: 'meta-only' });
	});

	it('buildSystemColumnsList keeps the canonical set incl. id', () => {
		const all = buildSystemColumnsList();
		expect(all).toContain('id');
		expect(all).toContain('_meta');
		expect(all).toContain('created_at');
		expect(all).toContain('updated_at');
		expect(all).not.toContain('data');
		expect(all).not.toContain('sort');
	});
});

// ─── coerceValue ─────────────────────────────────────────

describe('coerceValue', () => {
	it('boolean: accepts true/false/1/0/strings case-insensitively, else 0', () => {
		expect(coerceValue(true, 'boolean')).toBe(1);
		expect(coerceValue(false, 'boolean')).toBe(0);
		expect(coerceValue(1, 'boolean')).toBe(1);
		expect(coerceValue(0, 'boolean')).toBe(0);
		expect(coerceValue('true', 'boolean')).toBe(1);
		expect(coerceValue('FALSE', 'boolean')).toBe(0);
		expect(coerceValue('1', 'boolean')).toBe(1);
		expect(coerceValue('0', 'boolean')).toBe(0);
		// The old `value ? 1 : 0` bug: "false" was truthy → 1. Now 0.
		expect(coerceValue('false', 'boolean')).toBe(0);
		// Anything unrecognized → 0 (e.g. 2, "yes", "").
		expect(coerceValue(2, 'boolean')).toBe(0);
		expect(coerceValue('yes', 'boolean')).toBe(0);
		expect(coerceValue('', 'boolean')).toBe(0);
	});

	it('integer: parses numeric strings and floors', () => {
		expect(coerceValue('12.7', 'integer')).toBe(12);
		expect(coerceValue(12.9, 'integer')).toBe(12);
		expect(coerceValue('42', 'integer')).toBe(42);
		expect(coerceValue(' 7 ', 'integer')).toBe(7);
	});

	it('integer: non-numeric → 0 (required-rule reports real errors)', () => {
		expect(coerceValue('abc', 'integer')).toBe(0);
		expect(coerceValue('12.7abc', 'integer')).toBe(0);
	});

	it('number: parses numeric strings', () => {
		expect(coerceValue('12.7', 'number')).toBe(12.7);
		expect(coerceValue(3, 'number')).toBe(3);
	});

	it('null/undefined pass through as null', () => {
		expect(coerceValue(null, 'boolean')).toBeNull();
		expect(coerceValue(undefined, 'text')).toBeNull();
	});
});

// ─── mergeRowData ────────────────────────────────────────

describe('mergeRowData', () => {
	it('physical row columns win over stale _meta keys', () => {
		const row = { id: '1', title: 'real column', _meta: JSON.stringify({ title: 'stale _meta value' }) };
		expect(mergeRowData(row).title).toBe('real column');
	});

	it('still surfaces non-colliding _meta keys', () => {
		const row = { id: '1', _meta: JSON.stringify({ theme: 'dark' }) };
		expect(mergeRowData(row).theme).toBe('dark');
	});

	it('logs and skips malformed _meta instead of crashing', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const row = { id: '1', _meta: '{not json' };
		expect(mergeRowData(row).id).toBe('1');
		expect(warn).toHaveBeenCalled();
		warn.mockRestore();
	});
});

// ─── decodeJsonFields (storage → wire) ───────────────────

describe('decodeJsonFields', () => {
	it('parses json-typed fields stored as TEXT back into values', () => {
		const rows = [{ id: '1', tags: '[{"tg_id":"x"}]', note: '{not json', plain: 'hello' }];
		decodeJsonFields(rows, [
			{ name: 'tags', type: 'json' },
			{ name: 'note', type: 'json' },
		]);
		expect(rows[0].tags).toEqual([{ tg_id: 'x' }]);
		expect(rows[0].note).toBe('{not json'); // unparseable stays raw
		expect(rows[0].plain).toBe('hello');
	});

	it('returns rows untouched when no json/boolean fields are present', () => {
		const rows = [{ id: '1', active: 1 }];
		expect(decodeJsonFields(rows, [{ name: 'title', type: 'text' }])).toBe(rows);
	});

	it('coerces boolean fields from stored 1/0 integers to true/false', () => {
		const rows = [{ id: '1', active: 1, retired: 0, maybe: null }];
		decodeJsonFields(rows, [
			{ name: 'active', type: 'boolean' },
			{ name: 'retired', type: 'boolean' },
			{ name: 'maybe', type: 'boolean' },
		]);
		expect(rows[0].active).toBe(true);
		expect(rows[0].retired).toBe(false);
		expect(rows[0].maybe).toBeNull();
	});

	it('coerces stored boolean formulas (result_type boolean) too', () => {
		const rows = [{ id: '1', is_overdue: 1 }];
		decodeJsonFields(rows, [{ name: 'is_overdue', type: 'formula', result_type: 'boolean' }]);
		expect(rows[0].is_overdue).toBe(true);
	});

	it('leaves already-decoded boolean and truthy non-boolean values alone', () => {
		const rows = [{ id: '1', active: true, ratio: 2 }];
		decodeJsonFields(rows, [
			{ name: 'active', type: 'boolean' },
			{ name: 'ratio', type: 'number' },
		]);
		expect(rows[0].active).toBe(true);
		expect(rows[0].ratio).toBe(2);
	});
});

// ─── formula: virtual vs stored ──────────────────────────

describe('formula fields — virtual vs stored', () => {
	it('virtual formula (default) has NO column', () => {
		const sb = new SchemaBuilder();
		const stmts = sb.createTable('cms_orders', (t) => {
			t.uuid('id');
			applyFieldDefinitions(t, [{ name: 'total', type: 'formula', formula: 'qty * rate' } as FieldDefinition], false);
		});
		expect(stmts[0].sql).not.toContain('total');
	});

	it('stored formula (store: true) creates a REAL column typed by result_type', () => {
		const sb = new SchemaBuilder();
		const stmts = sb.createTable('cms_orders', (t) => {
			t.uuid('id');
			applyFieldDefinitions(
				t,
				[
					{ name: 'total', type: 'formula', store: true, formula: 'qty * rate' } as FieldDefinition,
					{ name: 'is_overdue', type: 'formula', store: true, result_type: 'boolean', formula: 'false' } as FieldDefinition,
				],
				false,
			);
		});
		expect(stmts[0].sql).toContain('"total" REAL');
		expect(stmts[0].sql).toContain('"is_overdue" INTEGER');
	});

	it('stored formula supports index + unique like any column', () => {
		const sb = new SchemaBuilder();
		const stmts = sb.createTable('cms_orders', (t) => {
			t.uuid('id');
			applyFieldDefinitions(
				t,
				[{ name: 'grand_total', type: 'formula', store: true, formula: 'total * 1.1', index: true } as FieldDefinition],
				false,
			);
		});
		expect(stmts[0].sql).toContain('"grand_total" REAL');
		// index() emits a separate CREATE INDEX statement (stmts[1])
		expect(stmts[1].sql).toContain('CREATE INDEX');
		expect(stmts[1].sql).toContain('grand_total');
	});

	it('physicalColumnNames includes stored formulas but not virtual ones', async () => {
		const { physicalColumnNames } = await import('../field-utils');
		const fields = [
			{ name: 'total', type: 'formula', store: true, formula: 'qty * rate' } as FieldDefinition,
			{ name: 'discount', type: 'formula', formula: '10' } as FieldDefinition,
			{ name: 'note', type: 'text', required: false } as FieldDefinition,
		];
		expect(physicalColumnNames(fields)).toEqual(['total', 'note']);
	});
});
