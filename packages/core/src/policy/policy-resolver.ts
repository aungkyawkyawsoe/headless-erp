/**
 * PolicyResolver — the headless runtime control plane.
 *
 * Every engine subsystem (auto-index, cache, audit, hooks, status-machine) reads
 * its behavior through a RESOLVED policy, so a tenant can enable/configure/dispose
 * engine features per collection via REST — no code, no redeploy.
 *
 * Merge order (least → most specific, later wins):
 *   env defaults  ←  global defaults  ←  per-collection policies (schema_json)
 *
 * The resolver is pure and deterministic: given the same inputs it returns the
 * same policy, making feature behavior predictable across isolates.
 */

export interface AutoIndexPolicy {
	enabled: boolean;
	mode: 'auto' | 'propose';
	maxDynamic: number;
}

export interface CachePolicy {
	enabled: boolean;
	ttlS: number;
	layer: 'auto' | 'memory' | 'cache_api' | 'kv';
}

/**
 * Offline reads — may a CLIENT persist this collection's read bodies on the
 * device so the app works without the network?
 *
 * Deliberately a separate switch from `cache`: that one caches on the SERVER
 * (same trust boundary as D1), this one moves rows into the user's device — a
 * different trust boundary that logout/erasure cannot reach. Hence deny by
 * default, and `maxAgeS` bounds how long a stale copy may be served.
 */
export interface OfflineReadsPolicy {
	enabled: boolean;
	/** How long a persisted body may be served without revalidation. */
	maxAgeS: number;
}

/**
 * Write policy — who may mutate rows through the GENERIC entity API.
 * `mode: 'service'` marks a table whose only legitimate writer is a domain
 * service (the MRO stock engine, an IDP provisioner, …). Enforced in the item
 * mutation pipeline, so a generic REST write can never move live state without
 * going through the writer that also appends the matching ledger event.
 * `appendOnly` freezes a history table — update + delete + restore are rejected
 * and rows may only be inserted.
 */
export interface WritesPolicy {
	mode: 'any' | 'service';
	appendOnly: boolean;
	/** Fields only the owning service may write (stripped from generic writes). */
	frozenFields: string[];
	/**
	 * State-conditional immutability: while the row's `field` equals one of
	 * `values`, the generic entity API may not update/delete/restore it — only the
	 * owning service may. `null` means no state freeze. This is what makes a
	 * POSTED document immutable (the ERP rule: you reverse, you never edit).
	 */
	freezeWhen: { field: string; values: string[] } | null;
	/**
	 * Permit the generic `draft → confirmed` transition. `confirmed` is a posted
	 * state a domain service owns, so the engine refuses it generically unless a
	 * collection opts in (e.g. vehicle maintenance logs). Pair with `freezeWhen`
	 * on `doc_status=confirmed` for a server-enforced one-way lock.
	 */
	confirmable: boolean;
}

/**
 * Search policy — how a generic list read's `?search=` term matches, and over
 * which fields. Two modes, both first-class:
 *
 *   contains  FULL SUBSTRING (`LIKE '%term%'`) — the default and today's
 *             behavior. Correct for any collection, but a leading wildcard
 *             cannot use an index, so on a large table it is a full scan (the
 *             D1 `rows_read` drain).
 *   prefix    ANCHORED PREFIX (`LIKE 'term%'`) — the type-ahead shape ERP list
 *             screens use (SAP/Odoo style). An ordinary index on each declared
 *             field serves it, so the read becomes a bounded range seek.
 *
 * `fields` scopes `prefix` mode to the indexed columns a collection intends to
 * be searched by (e.g. a serial number). Empty `fields` = the collection's
 * text fields (contains-shaped). Deny-by-default: a collection that declares
 * nothing keeps the substring behavior, so enabling this never changes another
 * collection's reads.
 */
export interface SearchPolicy {
	mode: 'contains' | 'prefix';
	fields: string[];
}

/** What the engine actually applies for a collection (fully merged). */
export interface ResolvedPolicy {
	autoIndex: AutoIndexPolicy;
	cache: CachePolicy;
	offlineReads: OfflineReadsPolicy;
	writes: WritesPolicy;
	search: SearchPolicy;
	/** Fields stamped with the authenticated employee on create (see PolicyInput). */
	actorFields: string[];
	audit: boolean;
	hooks: boolean;
}

/** The per-collection shape stored in schema_json.policies (partial, optional). */
export interface PolicyInput {
	auto_index?: { enabled?: boolean; mode?: 'auto' | 'propose'; max_dynamic?: number };
	cache?: { enabled?: boolean; ttl_s?: number; layer?: 'auto' | 'memory' | 'cache_api' | 'kv' };
	offline_reads?: { enabled?: boolean; max_age_s?: number };
	writes?: {
		mode?: 'any' | 'service';
		append_only?: boolean;
		frozen_fields?: string[];
		freeze_when?: { field?: string; values?: string[] };
		/** Opt in to the generic `draft → confirmed` transition (see WritesPolicy). */
		confirmable?: boolean;
	};
	/** How `?search=` matches, and over which fields (see SearchPolicy). */
	search?: { mode?: 'contains' | 'prefix'; fields?: string[] };
	/** Creator-attribution fields forced to the session employee (e.g. `reported_by`). */
	actor_fields?: string[];
	audit?: { enabled?: boolean };
	hooks?: { enabled?: boolean };
}

/** Engine-wide defaults (overridable via env). */
export interface PolicyDefaults {
	autoIndex: { enabled: boolean; mode: 'auto' | 'propose'; maxDynamic: number };
	cache: { enabled: boolean; ttlS: number; layer: 'auto' | 'memory' | 'cache_api' | 'kv' };
	offlineReads: { enabled: boolean; maxAgeS: number };
	writes: {
		mode: 'any' | 'service';
		appendOnly: boolean;
		frozenFields: string[];
		freezeWhen: { field: string; values: string[] } | null;
		confirmable: boolean;
	};
	search: { mode: 'contains' | 'prefix'; fields: string[] };
	actorFields: string[];
	audit: boolean;
	hooks: boolean;
}

/** Built-in default policy (sane for most collections). */
export const DEFAULT_POLICY: PolicyDefaults = {
	autoIndex: { enabled: true, mode: 'auto', maxDynamic: 4 },
	cache: { enabled: true, ttlS: 60, layer: 'auto' },
	// OFF by default: persisting rows on a device is a privacy decision an
	// operator makes per collection, never an implicit consequence of a deploy.
	offlineReads: { enabled: false, maxAgeS: 86_400 },
	// Any collection is normally writable through the generic entity API; only a
	// collection that declares `writes` opts into the service-only/append-only lock.
	writes: { mode: 'any', appendOnly: false, frozenFields: [], freezeWhen: null, confirmable: false },
	// Substring search by default (any collection); a large, searched collection
	// opts into the index-backed `prefix` shape with explicit `fields`.
	search: { mode: 'contains', fields: [] },
	// No field is actor-stamped unless the collection declares it.
	actorFields: [],
	audit: false,
	hooks: true,
};

/** Resolve a per-collection policy against the engine defaults. Deterministic. */
export function resolvePolicy(input: PolicyInput | undefined, defaults: PolicyDefaults = DEFAULT_POLICY): ResolvedPolicy {
	// State freeze — only a well-formed `{ field, values[] }` with at least one
	// non-empty value is honoured; anything else falls back to the default (null).
	const fw = input?.writes?.freeze_when;
	const freezeWhen =
		typeof fw?.field === 'string' &&
		fw.field.trim().length > 0 &&
		Array.isArray(fw.values) &&
		fw.values.some((v) => typeof v === 'string' && v.trim().length > 0)
			? { field: fw.field.trim(), values: fw.values.filter((v): v is string => typeof v === 'string').map((v) => v.trim()) }
			: defaults.writes.freezeWhen;
	return {
		autoIndex: {
			enabled: input?.auto_index?.enabled ?? defaults.autoIndex.enabled,
			mode: input?.auto_index?.mode ?? defaults.autoIndex.mode,
			maxDynamic: input?.auto_index?.max_dynamic ?? defaults.autoIndex.maxDynamic,
		},
		cache: {
			enabled: input?.cache?.enabled ?? defaults.cache.enabled,
			ttlS: input?.cache?.ttl_s ?? defaults.cache.ttlS,
			layer: input?.cache?.layer ?? defaults.cache.layer,
		},
		offlineReads: {
			enabled: input?.offline_reads?.enabled ?? defaults.offlineReads.enabled,
			maxAgeS: input?.offline_reads?.max_age_s ?? defaults.offlineReads.maxAgeS,
		},
		writes: {
			mode: input?.writes?.mode ?? defaults.writes.mode,
			appendOnly: input?.writes?.append_only ?? defaults.writes.appendOnly,
			frozenFields: Array.isArray(input?.writes?.frozen_fields)
				? input.writes.frozen_fields.filter((f): f is string => typeof f === 'string')
				: defaults.writes.frozenFields,
			freezeWhen,
			confirmable: input?.writes?.confirmable ?? defaults.writes.confirmable,
		},
		search: {
			mode: input?.search?.mode ?? defaults.search.mode,
			fields: Array.isArray(input?.search?.fields)
				? input.search.fields.filter((f): f is string => typeof f === 'string')
				: defaults.search.fields,
		},
		actorFields: Array.isArray(input?.actor_fields)
			? input.actor_fields.filter((f): f is string => typeof f === 'string')
			: defaults.actorFields,
		audit: input?.audit?.enabled ?? defaults.audit,
		hooks: input?.hooks?.enabled ?? defaults.hooks,
	};
}

/** The set of feature names a caller can discover for a collection (headless). */
export function policyFeatures(): string[] {
	return ['auto_index', 'cache', 'offline_reads', 'writes', 'search', 'actor_fields', 'audit', 'hooks'];
}
