import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, policyFeatures, resolvePolicy } from '../policy-resolver';

describe('resolvePolicy', () => {
	it('applies the built-in defaults when a collection declares nothing', () => {
		const p = resolvePolicy(undefined);
		expect(p.autoIndex).toEqual({ enabled: true, mode: 'auto', maxDynamic: 4 });
		expect(p.cache).toEqual({ enabled: true, ttlS: 60, layer: 'auto' });
		// Rows are normally writable through the generic entity API; only a
		// collection that declares `writes` opts into the service-only/append-only lock.
		expect(p.writes).toEqual({ mode: 'any', appendOnly: false, frozenFields: [], freezeWhen: null, confirmable: false });
		// Substring search by default — a collection opts into index-backed `prefix`
		// only by declaring `search.fields` explicitly.
		expect(p.search).toEqual({ mode: 'contains', fields: [] });
		// No creator-attribution fields are stamped unless the collection declares them.
		expect(p.actorFields).toEqual([]);
		expect(p.audit).toBe(false);
		expect(p.hooks).toBe(true);
	});

	it('merges a per-collection actor_fields list', () => {
		expect(resolvePolicy({ actor_fields: ['reported_by', 'requested_by'] }).actorFields).toEqual(['reported_by', 'requested_by']);
		// Non-string entries are dropped so a malformed list can never reach the engine.
		expect(resolvePolicy({ actor_fields: ['ok', 5 as unknown as string] }).actorFields).toEqual(['ok']);
	});

	it('merges a per-collection writes patch over the defaults', () => {
		expect(resolvePolicy({ writes: { mode: 'service' } }).writes).toEqual({
			mode: 'service',
			appendOnly: false,
			frozenFields: [],
			freezeWhen: null,
			confirmable: false,
		});
		expect(resolvePolicy({ writes: { append_only: true } }).writes).toEqual({
			mode: 'any',
			appendOnly: true,
			frozenFields: [],
			freezeWhen: null,
			confirmable: false,
		});
		expect(resolvePolicy({ writes: { mode: 'service', append_only: true } }).writes).toEqual({
			mode: 'service',
			appendOnly: true,
			frozenFields: [],
			freezeWhen: null,
			confirmable: false,
		});
	});

	it('opts into the generic confirm transition via writes.confirmable', () => {
		expect(resolvePolicy({ writes: { confirmable: true } }).writes.confirmable).toBe(true);
		expect(resolvePolicy({ writes: { confirmable: false } }).writes.confirmable).toBe(false);
	});

	it('merges a per-collection frozen_fields list (workflow columns only the service may set)', () => {
		const p = resolvePolicy({ writes: { frozen_fields: ['status', 'approved_by'] } });
		expect(p.writes.frozenFields).toEqual(['status', 'approved_by']);
		// Non-string entries are dropped so a malformed list can never reach the engine.
		expect(resolvePolicy({ writes: { frozen_fields: ['ok', 5 as unknown as string] } }).writes.frozenFields).toEqual(['ok']);
	});

	it('merges writes.freeze_when (state-conditional immutability) and rejects malformed shapes', () => {
		const p = resolvePolicy({ writes: { freeze_when: { field: 'doc_status', values: ['confirmed'] } } });
		expect(p.writes.freezeWhen).toEqual({ field: 'doc_status', values: ['confirmed'] });
		// A bare field with no values, or a non-string value list, is ignored (no freeze).
		expect(resolvePolicy({ writes: { freeze_when: { field: 'doc_status' } } }).writes.freezeWhen).toBeNull();
		expect(resolvePolicy({ writes: { freeze_when: { values: ['confirmed'] } } }).writes.freezeWhen).toBeNull();
		expect(
			resolvePolicy({ writes: { freeze_when: { field: 'doc_status', values: [5 as unknown as string] } } }).writes.freezeWhen,
		).toBeNull();
	});

	it('merges a per-collection search patch over the defaults', () => {
		// Prefix mode becomes index-backed only when it names the fields to search.
		expect(resolvePolicy({ search: { mode: 'prefix', fields: ['serial_no'] } }).search).toEqual({ mode: 'prefix', fields: ['serial_no'] });
		// A bare mode patch keeps the default (empty) field list.
		expect(resolvePolicy({ search: { mode: 'prefix' } }).search).toEqual({ mode: 'prefix', fields: [] });
		// Non-string entries are dropped so a malformed list can never reach the engine.
		expect(resolvePolicy({ search: { fields: ['ok', 5 as unknown as string] } }).search.fields).toEqual(['ok']);
	});

	it('leaves offline reads OFF by default — device persistence is opt-in', () => {
		expect(resolvePolicy(undefined).offlineReads).toEqual({ enabled: false, maxAgeS: 86_400 });
		expect(DEFAULT_POLICY.offlineReads).toEqual({ enabled: false, maxAgeS: 86_400 });
	});

	it('merges a per-collection offline_reads patch over the defaults', () => {
		expect(resolvePolicy({ offline_reads: { enabled: true, max_age_s: 3_600 } }).offlineReads).toEqual({
			enabled: true,
			maxAgeS: 3_600,
		});
		// Enabling without a window keeps the default window (not undefined/0).
		expect(resolvePolicy({ offline_reads: { enabled: true } }).offlineReads).toEqual({ enabled: true, maxAgeS: 86_400 });
	});

	it('keeps offline_reads independent of the server response cache', () => {
		// Turning the server cache off must not silently grant device persistence,
		// and vice versa — they live in different trust boundaries.
		const p = resolvePolicy({ cache: { enabled: false }, offline_reads: { enabled: true } });
		expect(p.cache.enabled).toBe(false);
		expect(p.offlineReads.enabled).toBe(true);
	});

	it('advertises every discoverable feature', () => {
		expect(policyFeatures()).toEqual([
			'auto_index',
			'cache',
			'offline_reads',
			'writes',
			'search',
			'integrity',
			'actor_fields',
			'audit',
			'hooks',
		]);
	});

	it('leaves integrity OFF by default and clamps the rule limit', () => {
		expect(resolvePolicy(undefined).integrity).toEqual({ enabled: false, limit: 100, rules: [] });
		const p = resolvePolicy({
			integrity: { enabled: true, limit: 5000, rules: [{ type: 'duplicate', fields: ['code'] }] },
		});
		expect(p.integrity.enabled).toBe(true);
		expect(p.integrity.limit).toBe(1000); // clamped to the ceiling
		expect(p.integrity.rules).toHaveLength(1);
	});

	it('drops malformed integrity rules during resolution', () => {
		const rules = resolvePolicy({
			integrity: { enabled: true, rules: [{ type: 'stale', max_age_days: 7 }, null as never, { nope: 1 } as never] },
		}).integrity.rules;
		expect(rules).toEqual([{ type: 'stale', max_age_days: 7 }]);
	});
});
