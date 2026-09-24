import { describe, it, expect } from 'vitest';
import { decodeMeta, encodeMeta, META_WIRE_VERSION, type MetaSnapshot } from './meta-codec';

describe('meta wire codec', () => {
	it('round-trips a snapshot losslessly', () => {
		const snapshot: MetaSnapshot = {
			components: [
				{ id: 'core/a', name: 'a', label: 'A', is_active: 1, demo_json: '{"x":1}' },
				{ id: 'core/b', name: 'b', label: 'B', is_active: 0, demo_json: null },
			],
			props: [{ id: 'p1', component_id: 'core/a', label: 'Title' }],
		};

		expect(decodeMeta(encodeMeta(snapshot))).toEqual(snapshot);
	});

	it('round-trips an empty table to an empty array', () => {
		const snapshot: MetaSnapshot = { styles: [], components: [{ id: 'x' }] };

		expect(decodeMeta(encodeMeta(snapshot))).toEqual(snapshot);
	});

	it('keeps null values as null (never drops the key)', () => {
		const snapshot: MetaSnapshot = { config: [{ config_key: 'k', config_val: null, description: null }] };

		expect(decodeMeta(encodeMeta(snapshot))).toEqual(snapshot);
	});

	it('names each column once, not once per row — the whole point of the codec', () => {
		const rows = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, label: `Label ${i}` }));
		const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
		const objectBytes = byteLength({ components: rows });
		const wireBytes = byteLength(encodeMeta({ components: rows }));

		// Repeated key names dominate the object form; the columnar form removes it.
		expect(wireBytes).toBeLessThan(objectBytes);
		// Guard the order-of-magnitude win (≈2× on this shape) rather than a brittle byte count.
		expect(wireBytes).toBeLessThan(objectBytes * 0.75);
	});

	it('unions ragged rows so a column is never silently dropped', () => {
		const snapshot: MetaSnapshot = { t: [{ a: 1 }, { a: 2, b: 3 }] };

		expect(decodeMeta(encodeMeta(snapshot))).toEqual({
			t: [
				{ a: 1, b: null },
				{ a: 2, b: 3 },
			],
		});
	});

	it('passes a plain object map straight through (tolerant of an older server)', () => {
		const legacy: MetaSnapshot = { components: [{ id: 'x' }] };

		expect(decodeMeta(legacy)).toBe(legacy);
	});

	it('treats a wire table with malformed rows as empty', () => {
		const wire = { v: META_WIRE_VERSION, tables: { broken: { columns: null, rows: null } } };

		expect(decodeMeta(wire)).toEqual({ broken: [] });
	});

	it('returns an empty snapshot for non-object input', () => {
		expect(decodeMeta(null)).toEqual({});
		expect(decodeMeta(undefined)).toEqual({});
		expect(decodeMeta('nope')).toEqual({});
	});
});
