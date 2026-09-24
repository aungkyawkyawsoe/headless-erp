import { describe, expect, it } from 'vitest';
import {
	clampSeconds,
	countEncryptedFields,
	POLICY_DEFAULTS,
	policyFormFrom,
	policyPayload,
	warnsAboutEncryptedOffline,
	type PolicyFormState,
} from './policy-form';

describe('POLICY_DEFAULTS', () => {
	// These MIRROR DEFAULT_POLICY in packages/core/src/policy/policy-resolver.ts.
	// If the engine defaults move, this test fails and the form gets updated —
	// which is the point (a form that opens on a different position than the
	// engine would report is a lie in the UI).
	it('mirrors the engine defaults', () => {
		expect(POLICY_DEFAULTS).toEqual({
			autoIndex: { enabled: true, mode: 'auto' },
			cache: { enabled: true, ttlS: 60 },
			offlineReads: { enabled: false, maxAgeS: 86_400 },
		});
	});

	it('keeps offline reads deny-by-default', () => {
		expect(POLICY_DEFAULTS.offlineReads.enabled).toBe(false);
	});
});

describe('policyFormFrom', () => {
	it('fills every key from defaults for a collection with no policy', () => {
		expect(policyFormFrom({})).toEqual(POLICY_DEFAULTS);
		expect(policyFormFrom(null)).toEqual(POLICY_DEFAULTS);
		expect(policyFormFrom(undefined)).toEqual(POLICY_DEFAULTS);
	});

	it('reads the API snake_case shape', () => {
		const form = policyFormFrom({
			auto_index: { enabled: false, mode: 'propose' },
			cache: { enabled: false, ttl_s: 300 },
			offline_reads: { enabled: true, max_age_s: 3600 },
		});
		expect(form).toEqual({
			autoIndex: { enabled: false, mode: 'propose' },
			cache: { enabled: false, ttlS: 300 },
			offlineReads: { enabled: true, maxAgeS: 3600 },
		});
	});

	it('merges a partial policy over the defaults instead of blanking the rest', () => {
		// The PUT is a per-feature deep merge, so a stored policy is often partial.
		const form = policyFormFrom({ offline_reads: { enabled: true } });
		expect(form.offlineReads.enabled).toBe(true);
		expect(form.offlineReads.maxAgeS).toBe(POLICY_DEFAULTS.offlineReads.maxAgeS);
		expect(form.cache).toEqual(POLICY_DEFAULTS.cache);
		expect(form.autoIndex).toEqual(POLICY_DEFAULTS.autoIndex);
	});

	it('repairs a stored max age the API would now reject', () => {
		const form = policyFormFrom({ offline_reads: { enabled: true, max_age_s: 0 } });
		expect(form.offlineReads.maxAgeS).toBe(1);
	});
});

describe('clampSeconds', () => {
	it('keeps valid positive values, floored to whole seconds', () => {
		expect(clampSeconds(120, 60)).toBe(120);
		expect(clampSeconds(120.9, 60)).toBe(120);
		expect(clampSeconds('3600', 60)).toBe(3600);
	});

	it('never yields a value the API rejects (must be finite and >= 1)', () => {
		expect(clampSeconds(0, 60)).toBe(1);
		expect(clampSeconds(-5, 60)).toBe(1);
		expect(clampSeconds(undefined, 60)).toBe(60);
		expect(clampSeconds(null, 60)).toBe(60);
		expect(clampSeconds('', 60)).toBe(60);
		expect(clampSeconds('abc', 60)).toBe(60);
		expect(clampSeconds(Number.NaN, 60)).toBe(60);
		expect(clampSeconds(Number.POSITIVE_INFINITY, 60)).toBe(60);
	});

	it('falls back to 1 rather than 0 when the fallback itself is unusable', () => {
		expect(clampSeconds(Number.NaN, 0)).toBe(1);
		expect(clampSeconds(Number.NaN, Number.NaN)).toBe(1);
	});
});

describe('policyPayload', () => {
	const state: PolicyFormState = {
		autoIndex: { enabled: false, mode: 'propose' },
		cache: { enabled: false, ttlS: 300 },
		offlineReads: { enabled: true, maxAgeS: 3600 },
	};

	it('emits the API snake_case shape with all three features (so one save writes them all)', () => {
		expect(policyPayload(state)).toEqual({
			auto_index: { enabled: false, mode: 'propose' },
			cache: { enabled: false, ttl_s: 300 },
			offline_reads: { enabled: true, max_age_s: 3600 },
		});
	});

	it('never emits max_age_s that would 400 (the API requires finite >= 1)', () => {
		const payload = policyPayload({ ...state, offlineReads: { enabled: true, maxAgeS: Number.NaN } });
		expect(payload.offline_reads.max_age_s).toBeGreaterThanOrEqual(1);
		expect(Number.isFinite(payload.offline_reads.max_age_s)).toBe(true);

		// An emptied number input is the real-world path to this value.
		expect(policyPayload({ ...state, offlineReads: { enabled: true, maxAgeS: 0 } }).offline_reads.max_age_s).toBe(1);
	});

	it('round-trips through the form mapper unchanged', () => {
		expect(policyFormFrom(policyPayload(state))).toEqual(state);
	});

	it('writes offline reads as disabled without dropping the max age', () => {
		const payload = policyPayload({ ...state, offlineReads: { enabled: false, maxAgeS: 3600 } });
		expect(payload.offline_reads).toEqual({ enabled: false, max_age_s: 3600 });
	});
});

describe('countEncryptedFields', () => {
	it('counts only fields explicitly marked encrypted', () => {
		expect(countEncryptedFields({ fields: [{ encrypted: true }, { encrypted: false }, {}, { name: 'x' }] })).toBe(1);
		expect(countEncryptedFields({ fields: [{ encrypted: true }, { encrypted: true }] })).toBe(2);
	});

	it('returns 0 for a schema without fields or a malformed one', () => {
		expect(countEncryptedFields({})).toBe(0);
		expect(countEncryptedFields({ fields: [] })).toBe(0);
		expect(countEncryptedFields(null)).toBe(0);
		expect(countEncryptedFields(undefined)).toBe(0);
		expect(countEncryptedFields({ fields: 'nope' })).toBe(0);
	});
});

describe('warnsAboutEncryptedOffline', () => {
	const base = POLICY_DEFAULTS;

	it('warns only when offline reads are ON and the collection has encrypted fields', () => {
		expect(warnsAboutEncryptedOffline({ ...base, offlineReads: { enabled: true, maxAgeS: 60 } }, 2)).toBe(true);
	});

	it('stays quiet when offline reads are off, or nothing is encrypted', () => {
		expect(warnsAboutEncryptedOffline({ ...base, offlineReads: { enabled: false, maxAgeS: 60 } }, 2)).toBe(false);
		expect(warnsAboutEncryptedOffline({ ...base, offlineReads: { enabled: true, maxAgeS: 60 } }, 0)).toBe(false);
	});
});
