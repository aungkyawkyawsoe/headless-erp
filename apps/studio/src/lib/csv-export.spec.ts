import { describe, expect, it } from 'vitest';
import type { ActiveFilter, ColumnDef, FetchParams } from '@mmbix/design-system/datatable';
import { buildCsv, fieldMapOf, itemsParamsFromFetch } from './csv-export';
import type { FieldDefinition } from './api';

const textField = (name: string): FieldDefinition => ({ name, type: 'text' });

function fetchParams(overrides: Partial<FetchParams> = {}): FetchParams {
	return {
		sorting: null,
		filters: [],
		globalFilter: '',
		pagination: { pageIndex: 1, pageSize: 25 },
		cursor: undefined,
		...overrides,
	};
}

describe('fieldMapOf', () => {
	it('keys fields by name for the renderCell lookup', () => {
		const map = fieldMapOf([textField('name'), { name: 'qty', type: 'integer' }]);
		expect(map.get('name')?.type).toBe('text');
		expect(map.get('qty')?.type).toBe('integer');
		expect(map.has('nope')).toBe(false);
	});
});

describe('itemsParamsFromFetch', () => {
	it('translates pagination into limit and builds the lean projection', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams());
		expect(out.limit).toBe(25);
		expect(out.fields).toBe('*'); // no relations → own columns only
		expect(out.search).toBeUndefined();
		expect(out.sort).toBeUndefined();
		expect(out.filters).toBeUndefined();
		expect(out.dir).toBeUndefined();
	});

	it('maps a descent sort to the engine "-field" form', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams({ sorting: { id: 'name', direction: 'desc' } }));
		expect(out.sort).toBe('-name');
	});

	it('maps an ascending sort to the bare field', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams({ sorting: { id: 'created_at', direction: 'asc' } }));
		expect(out.sort).toBe('created_at');
	});

	it('carries the global search into the backend search param', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams({ globalFilter: 'mff' }));
		expect(out.search).toBe('mff');
	});

	it('carries the cursor so the export walk continues where the page stopped', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams({ cursor: 'abc123' }));
		expect(out.cursor).toBe('abc123');
		expect(out.dir).toBe('after');
	});

	it('serialises rich table filters into entity filter conditions', () => {
		const filter: ActiveFilter = { id: 'name', operator: 'equals', value: 'Bridgestone' };
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams({ filters: [filter] }));
		expect(out.filters).toEqual({ name: { operator: '_eq', value: 'Bridgestone' } });
	});

	it('keeps the caller base params (e.g. trashed) on top of the translation', () => {
		const out = itemsParamsFromFetch([textField('name')], {}, fetchParams(), { trashed: true });
		expect(out.trashed).toBe(true);
	});

	it('defaults cleanly when the DataTable never fetched (nothing but page shape)', () => {
		const out = itemsParamsFromFetch([textField('name')], {});
		expect(out.limit).toBe(0);
		expect(out.sort).toBeUndefined();
		expect(out.search).toBeUndefined();
		expect(out.filters).toBeUndefined();
	});
});

describe('buildCsv', () => {
	const col = (id: string, header?: string): ColumnDef<Record<string, unknown>> => ({ id, header: header ?? id });

	it('writes a header row from the column headers', () => {
		const csv = buildCsv([], [col('name', 'Name'), col('price', 'Price')], fieldMapOf([]));
		expect(csv).toBe('Name,Price');
	});

	it('falls back to the column id when a header is not a string', () => {
		const csv = buildCsv([], [col('name'), { id: 'price', header: (() => 'Price') as never }], fieldMapOf([]));
		expect(csv).toBe('name,price');
	});

	it('renders values through renderCell (the table display), not raw bytes', () => {
		const csv = buildCsv(
			[{ name: 'Bridgestone', qty: 3 }],
			[col('name'), col('qty')],
			fieldMapOf([textField('name'), { name: 'qty', type: 'integer' }]),
		);
		expect(csv).toBe('name,qty\nBridgestone,3');
	});

	it('shows the renderCell placeholder for null/undefined instead of a blank or "null"', () => {
		const csv = buildCsv([{ name: null }, { name: undefined }], [col('name')], fieldMapOf([textField('name')]));
		expect(csv).toBe('name\n—\n—');
	});

	it('quotes cells containing a comma, a quote, or a newline — and doubles inner quotes', () => {
		const csv = buildCsv(
			[{ note: 'a, b' }, { note: 'say "hi"' }, { note: 'line1\nline2' }, { note: 'plain' }],
			[col('note')],
			fieldMapOf([textField('note')]),
		);
		expect(csv).toBe('note\n"a, b"\n"say ""hi"""\n"line1\nline2"\nplain');
	});

	it('does not quote a plain cell even when the display passes through', () => {
		const csv = buildCsv([{ name: 'Bridge-stone' }], [col('name')], fieldMapOf([textField('name')]));
		expect(csv).toBe('name\nBridge-stone');
	});

	it('renders columns that are not schema fields by stringifying the raw value', () => {
		const csv = buildCsv([{ system_col: 7 }, { system_col: null }], [col('system_col')], fieldMapOf([]));
		expect(csv).toBe('system_col\n7\n');
	});
});
