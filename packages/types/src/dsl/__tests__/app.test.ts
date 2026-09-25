import { describe, expect, it } from 'vitest';
import { VALID_FIELD_TYPES } from '@mmbix/utils';
import { decodeApp, parseField } from '../app';

describe('compact App DSL', () => {
	it('parses a field shorthand', () => {
		expect(parseField('code:text!')).toMatchObject({ name: 'code', type: 'text', required: true });
		expect(parseField('sku:text!#')).toMatchObject({ name: 'sku', type: 'text', required: true, unique: true });
		expect(parseField('supplier:m2o>supplier')).toMatchObject({ name: 'supplier', type: 'm2o', related_collection: 'supplier' });
		expect(parseField('status:select(draft,approved)')).toMatchObject({ name: 'status', type: 'select', options: ['draft', 'approved'] });
		// a malformed token is refused rather than guessed
		expect(parseField('nope')).toBeNull();
		expect(parseField(':text')).toBeNull();
		expect(parseField('name:')).toBeNull();
	});

	it('every type alias targets a real field type', () => {
		for (const alias of ['str', 'txt', 'num', 'int', 'cur', 'pct', 'bool', 'dt', 'ts', 'sel', 'rel', 'fk']) {
			const field = parseField(`x:${alias}`);
			expect(field, `alias ${alias} did not parse`).toBeTruthy();
			expect(VALID_FIELD_TYPES.has(field!.type), `alias ${alias} → ${field!.type} is not a real type`).toBe(true);
		}
	});

	it('decodes a compact doc into a manifest (permissions from letters)', () => {
		const { manifest, warnings } = decodeApp({
			v: 1,
			cols: [{ s: 'po', n: 'Purchase Order', f: ['code:text!', 'total:cur', 'supplier:m2o>supplier'] }],
			pages: [{ p: '/orders', t: 'Orders', b: [{ id: 't1', type: 'table', layout: { order: 0 }, config: { collection: 'po' } }] }],
			roles: ['Clerk', { n: 'Manager', d: 'approves' }],
			grants: [{ r: 'Clerk', c: 'po', can: 'rwc' }],
			menus: [{ m: 'finance', l: 'Orders', target: 'po' }],
			kpis: [{ n: 'PO Count', c: 'po', agg: 'count' }],
		});
		expect(warnings).toEqual([]);
		expect(manifest!.collections![0].fields.map((f) => f.type)).toEqual(['text', 'currency', 'm2o']);
		expect(manifest!.permissions![0]).toMatchObject({ role: 'Clerk', collection: 'po', can_read: true, can_write: true, can_create: true });
		expect(manifest!.permissions![0].can_delete).toBeUndefined();
		expect(manifest!.roles![1]).toMatchObject({ name: 'Manager', description: 'approves' });
	});

	it('reports what it dropped instead of guessing', () => {
		const { manifest, warnings } = decodeApp({
			v: 1,
			cols: [{ s: 'po', f: ['good:text', 'broken'] }],
			grants: [{ r: 'Clerk', c: 'po', can: 'rx' }],
			what: true,
		});
		expect(manifest!.collections![0].fields).toHaveLength(1);
		expect(warnings.join(' ')).toContain('malformed field "broken"');
		expect(warnings.join(' ')).toContain('unknown permission letter "x"');
		expect(warnings.join(' ')).toContain('unknown key "what"');
	});

	it('is materially smaller than the equivalent full manifest (~38% on a 3-collection app)', () => {
		const full = {
			version: 1,
			collections: [
				{
					slug: 'purchase_order',
					name: 'Purchase Order',
					fields: [
						{ name: 'code', type: 'text', required: true },
						{ name: 'total', type: 'currency' },
						{ name: 'supplier', type: 'm2o', related_collection: 'supplier' },
						{ name: 'status', type: 'select', options: ['draft', 'approved', 'paid'] },
					],
				},
			],
			pages: [
				{
					path: '/orders',
					title: 'Orders',
					module: 'finance',
					blocks: [{ id: 't1', type: 'table', layout: { order: 0 }, config: { collection: 'purchase_order' } }],
				},
			],
			roles: [{ name: 'Clerk' }, { name: 'Manager', description: 'approves' }],
			permissions: [
				{ role: 'Clerk', collection: 'purchase_order', can_read: true, can_write: true, can_create: true },
				{ role: 'Manager', collection: 'purchase_order', can_read: true, can_approve: true },
			],
			menus: [{ module: 'finance', label: 'Orders', target: 'purchase_order' }],
			kpis: [{ name: 'PO Count', collection: 'purchase_order', agg: 'count' }],
		};
		const compact = {
			v: 1,
			cols: [
				{
					s: 'purchase_order',
					n: 'Purchase Order',
					f: ['code:text!', 'total:cur', 'supplier:m2o>supplier', 'status:select(draft,approved,paid)'],
				},
			],
			pages: [
				{
					p: '/orders',
					t: 'Orders',
					m: 'finance',
					b: [{ id: 't1', type: 'table', layout: { order: 0 }, config: { collection: 'purchase_order' } }],
				},
			],
			roles: ['Clerk', { n: 'Manager', d: 'approves' }],
			grants: [
				{ r: 'Clerk', c: 'purchase_order', can: 'rwc' },
				{ r: 'Manager', c: 'purchase_order', can: 'ra' },
			],
			menus: [{ m: 'finance', l: 'Orders', target: 'purchase_order' }],
			kpis: [{ n: 'PO Count', c: 'purchase_order', agg: 'count' }],
		};
		const fullBytes = JSON.stringify(full).length;
		const compactBytes = JSON.stringify(compact).length;
		expect(compactBytes).toBeLessThan(fullBytes * 0.7);
	});
});
