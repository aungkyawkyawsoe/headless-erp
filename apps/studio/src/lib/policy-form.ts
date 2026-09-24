/**
 * Runtime-policy form logic — the pure half of `PolicyPanel`.
 *
 * Kept out of the component so the part that can actually be wrong (mapping the
 * API's raw snake_case policy into form state, and back into a PUT body the API
 * accepts) is testable without a DOM. `PolicyPanel` only renders this state and
 * calls these helpers.
 *
 * ⚠️ The defaults below MIRROR `DEFAULT_POLICY` in
 * `packages/core/src/policy/policy-resolver.ts`. That file is the engine's
 * source of truth; this one is only the form's opening position before the GET
 * returns (and the fallback when a key is absent). `policy-form.spec.ts` pins
 * the values, so a change there that is not mirrored here fails a test.
 */

export type PolicyMode = 'auto' | 'propose';

export interface PolicyFormState {
	autoIndex: { enabled: boolean; mode: PolicyMode };
	/** Server-side response cache (rows stay in Cloudflare memory). */
	cache: { enabled: boolean; ttlS: number };
	/** Device-side persistence (rows land on the user's phone). */
	offlineReads: { enabled: boolean; maxAgeS: number };
}

/** The raw policy as `GET /api/collections/:slug/policies` returns it. */
export interface RawPolicy {
	auto_index?: { enabled?: boolean; mode?: PolicyMode };
	cache?: { enabled?: boolean; ttl_s?: number };
	offline_reads?: { enabled?: boolean; max_age_s?: number };
}

/** The PUT body — always fully specified so one save writes all three features. */
export interface PolicyPayload {
	auto_index: { enabled: boolean; mode: PolicyMode };
	cache: { enabled: boolean; ttl_s: number };
	offline_reads: { enabled: boolean; max_age_s: number };
}

export const POLICY_DEFAULTS: PolicyFormState = {
	autoIndex: { enabled: true, mode: 'auto' },
	cache: { enabled: true, ttlS: 60 },
	// Deny by default — persisting rows on a device is an operator decision.
	offlineReads: { enabled: false, maxAgeS: 86_400 },
};

/**
 * A duration in whole seconds, never below 1.
 *
 * Two distinct repairs, because they mean different things:
 *   - ABSENT / non-numeric (`undefined`, `NaN`, `''`) → the caller's fallback.
 *     A missing key in a stored policy means "use the engine default".
 *   - PRESENT but out of range (`0`, `-5`, `0.4`) → clamp up to 1. An operator
 *     who typed `0` should not silently get 24 hours back.
 *
 * Either way the result is always a finite integer >= 1, which is what the API
 * requires (`routes/policies.ts`): it rejects `offline_reads.max_age_s` that is
 * not finite or < 1. An emptied number input (`Number('') === 0`) is the real
 * path into this function.
 */
export function clampSeconds(value: unknown, fallback: number): number {
	if (value === null || value === undefined || value === '') return positiveInt(fallback);
	const n = Number(value);
	if (!Number.isFinite(n)) return positiveInt(fallback);
	return Math.max(1, Math.floor(n));
}

function positiveInt(n: number): number {
	return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
}

/** Raw API policy (possibly `{}` or absent) → form state, filling in defaults. */
export function policyFormFrom(raw: RawPolicy | null | undefined): PolicyFormState {
	return {
		autoIndex: {
			enabled: raw?.auto_index?.enabled ?? POLICY_DEFAULTS.autoIndex.enabled,
			mode: raw?.auto_index?.mode ?? POLICY_DEFAULTS.autoIndex.mode,
		},
		cache: {
			enabled: raw?.cache?.enabled ?? POLICY_DEFAULTS.cache.enabled,
			ttlS: clampSeconds(raw?.cache?.ttl_s ?? POLICY_DEFAULTS.cache.ttlS, POLICY_DEFAULTS.cache.ttlS),
		},
		offlineReads: {
			enabled: raw?.offline_reads?.enabled ?? POLICY_DEFAULTS.offlineReads.enabled,
			maxAgeS: clampSeconds(raw?.offline_reads?.max_age_s ?? POLICY_DEFAULTS.offlineReads.maxAgeS, POLICY_DEFAULTS.offlineReads.maxAgeS),
		},
	};
}

/** Form state → PUT body, clamped so the API never answers 400. */
export function policyPayload(state: PolicyFormState): PolicyPayload {
	return {
		auto_index: { enabled: state.autoIndex.enabled, mode: state.autoIndex.mode },
		cache: { enabled: state.cache.enabled, ttl_s: clampSeconds(state.cache.ttlS, POLICY_DEFAULTS.cache.ttlS) },
		offline_reads: {
			enabled: state.offlineReads.enabled,
			max_age_s: clampSeconds(state.offlineReads.maxAgeS, POLICY_DEFAULTS.offlineReads.maxAgeS),
		},
	};
}

/**
 * How many of the collection's fields are encrypted at rest.
 *
 * The schema is the only reliable warning signal available in the panel: an
 * encrypted field is decrypted before the response leaves the API, so an
 * offline read would put that plaintext back on the device that encryption was
 * meant to protect.
 */
export function countEncryptedFields(schemaJson: unknown): number {
	const fields = (schemaJson as { fields?: Array<{ encrypted?: boolean }> } | null | undefined)?.fields;
	if (!Array.isArray(fields)) return 0;
	return fields.filter((f) => f?.encrypted === true).length;
}

/** Show the encrypted-fields warning only when it is actually actionable. */
export function warnsAboutEncryptedOffline(state: PolicyFormState, encryptedCount: number): boolean {
	return state.offlineReads.enabled && encryptedCount > 0;
}
