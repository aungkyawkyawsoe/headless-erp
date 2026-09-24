/**
 * ⚡ Permission Evaluator — Hybrid File + DB layer
 *
 * Layer 1 (File): System-level guards → evaluated in-memory, instant.
 * Layer 2 (DB):   Business-level permissions → cached with TTL invalidation.
 *
 * Evaluation order:
 *   1. Admin bypass → ALLOW (no further checks)
 *   2. System guard check → allowedRoles from file
 *   3. Business permission check → DB _role_permissions
 *
 * Cache strategy:
 *   - System rules: permanent (file-based, loaded once)
 *   - Business rules: TTL 60s + invalidation on permission change
 */

import { D1Client, QueryBuilder, cache } from '@mmbix/core';
import { SYSTEM_GUARDS, IMMUTABLE_ROLES, ADMIN_ROLE_NAMES, type SystemPolicy } from '@mmbix/config';
import type { AuthContext } from '@/lib/services/auth.service';
import type { RolePermissionRecord } from '@mmbix/types';
import { authzVersion, withAuthzVersion } from '@/lib/services/authz-version';

// ─── Evaluation Result ───────────────────────────────────

export type EvalResult = 'allowed' | 'denied' | 'delegate';

// ─── Permission Evaluator ────────────────────────────────

export class PermissionEvaluator {
	// System rules are file-based — loaded once, never invalidated
	private static _systemGuards: Map<string, SystemPolicy> | null = null;

	// Business rules cache with TTL + size cap
	// Uses centralized CacheLayer (FIX #7B — cross-layer invalidation)
	//
	// Kept SHORT (15s, not 60s) because the CacheLayer is per-isolate and a grant
	// applied through one isolate cannot purge another's entry. A longer TTL meant a
	// freshly-granted collection kept 403-ing its reads for up to a minute on a cold
	// isolate. Permission rows change only on rare admin actions and this is one
	// indexed lookup, so a short window is the right trade for "the grant works now".
	static BUSINESS_CACHE_TTL_MS = 15_000;

	// ── Initialization ───────────────────────────────────

	/** Load system guards from file into indexed map (one-time) */
	private static _ensureSystemGuards(): Map<string, SystemPolicy> {
		if (this._systemGuards) return this._systemGuards;

		const map = new Map<string, SystemPolicy>();
		for (const guard of SYSTEM_GUARDS) {
			for (const [op, policy] of Object.entries(guard.operations)) {
				map.set(`${guard.resource}:${op}`, policy);
			}
		}
		this._systemGuards = map;
		return map;
	}

	// ── Layer 1: System Check (File) ─────────────────────

	/**
	 * Check against system-level guards.
	 * Returns:
	 *   'allowed'  → system says YES (admin, or allowed role)
	 *   'denied'   → system says NO (wrong role)
	 *   'delegate' → no system guard for this resource — let DB decide
	 */
	static checkSystem(auth: AuthContext, resource: string, operation: string): EvalResult {
		// Admin bypass — all system operations
		if (auth.is_admin) return 'allowed';

		const guards = this._ensureSystemGuards();
		const key = `${resource}:${operation}`;
		const policy = guards.get(key);

		if (!policy) {
			// No system guard defined → delegate to business layer
			return 'delegate';
		}

		// Check role membership
		const roleName = auth.role_name || '';
		if (policy.allowedRoles.includes(roleName)) {
			// Check optional runtime condition
			if (policy.condition && !policy.condition(auth)) {
				return 'denied';
			}
			return 'allowed';
		}

		return 'denied';
	}

	// ── Layer 2: Business Check (DB) ─────────────────────

	/**
	 * Check collection-level business permissions from DB.
	 * Results are cached with TTL.
	 */
	static async checkBusiness(
		db: D1Client,
		auth: AuthContext,
		collectionSlug: string,
		action: 'read' | 'write' | 'create' | 'delete' | 'approve' | 'submit',
	): Promise<boolean> {
		// Admin bypass
		if (auth.is_admin) return true;

		// Version-keyed so a permission write in ANY isolate retires the entry on the
		// next read (the bare `perm:<role>:<slug>:<action>` key let a granted/revoked
		// collection keep its old answer across isolates for the whole TTL).
		const version = await authzVersion(db);
		const cacheKey = withAuthzVersion(`perm:${auth.role_id}:${collectionSlug}:${action}`, version);
		const cached = cache.get<boolean>(cacheKey);
		if (cached !== undefined) return cached;

		// DB lookup — via the shared per-(role, collection) row below, so this check
		// and the field/row-filter checks that follow a read do NOT each re-issue
		// the same `SELECT` on a cold/expired cache.
		const permKey = `can_${action}` as keyof RolePermissionRecord;
		const perm = await PermissionEvaluator._getPermissionRow(db, auth.role_id, collectionSlug);

		// If no permission row exists → deny
		const allowed = perm ? !!perm[permKey] : false;

		cache.set(cacheKey, allowed, PermissionEvaluator.BUSINESS_CACHE_TTL_MS);
		return allowed;
	}

	/**
	 * The role's `_role_permissions` row for one collection, read ONCE per
	 * (role, collection) and shared by every check derived from it.
	 *
	 * `checkBusiness` (can_*), `getFieldRestrictions` and `getRowFilter` each used
	 * to run their OWN `SELECT` of the SAME row: a cold isolate — or any request
	 * past the 15s TTL — paid up to three D1 reads of one row. One row, one read.
	 *
	 * Version-keyed + TTL'd exactly like the derived entries, and named under the
	 * same `perm:<role>:…` prefix so `invalidateBusinessCache(roleId)` / `perm:*`
	 * retire it with everything else.
	 */
	private static async _getPermissionRow(db: D1Client, roleId: string, collectionSlug: string): Promise<RolePermissionRecord | null> {
		if (!roleId) return null;
		const version = await authzVersion(db);
		const cacheKey = withAuthzVersion(`perm:${roleId}:${collectionSlug}:row`, version);
		const cached = cache.get<RolePermissionRecord | null>(cacheKey);
		if (cached !== undefined) return cached;

		const row = await db.first<RolePermissionRecord>(
			QueryBuilder.from('_role_permissions').select('*').where('role_id', roleId).where('collection_slug', collectionSlug).toSelect(),
		);
		cache.set(cacheKey, row ?? null, PermissionEvaluator.BUSINESS_CACHE_TTL_MS);
		return row ?? null;
	}

	/**
	 * Get field restrictions for a role + collection.
	 * Returns:
	 *   null    → all fields visible
	 *   []      → no fields visible (deny all)
	 *   ['name'] → only these fields visible
	 *
	 * Cached under the same perm: prefix (invalidated by setPermission).
	 */
	static async getFieldRestrictions(db: D1Client, roleId: string, collectionSlug: string): Promise<string[] | null> {
		if (!roleId) return null;

		const version = await authzVersion(db);
		const cacheKey = withAuthzVersion(`perm:${roleId}:${collectionSlug}:fields`, version);
		const cached = cache.get<string[] | null>(cacheKey);
		if (cached !== undefined) return cached;

		// Shared row read — see `_getPermissionRow`.
		const perm = await PermissionEvaluator._getPermissionRow(db, roleId, collectionSlug);

		let result: string[] | null = null;
		if (perm && perm.field_restrictions) {
			try {
				const parsed = JSON.parse(perm.field_restrictions);
				if (parsed !== '*' && Array.isArray(parsed)) result = parsed;
			} catch {
				result = null;
			}
		}
		cache.set(cacheKey, result, PermissionEvaluator.BUSINESS_CACHE_TTL_MS);
		return result;
	}

	/**
	 * Get row filter for a role + collection.
	 * Returns JSON filter object or null (all rows visible).
	 *
	 * Cached under the same perm: prefix (invalidated by setPermission).
	 */
	static async getRowFilter(db: D1Client, roleId: string, collectionSlug: string): Promise<Record<string, unknown> | null> {
		if (!roleId) return null;

		const version = await authzVersion(db);
		const cacheKey = withAuthzVersion(`perm:${roleId}:${collectionSlug}:rowfilter`, version);
		const cached = cache.get<Record<string, unknown> | null>(cacheKey);
		if (cached !== undefined) return cached;

		// Shared row read — see `_getPermissionRow`.
		const perm = await PermissionEvaluator._getPermissionRow(db, roleId, collectionSlug);

		let result: Record<string, unknown> | null = null;
		if (perm && perm.row_filters) {
			try {
				const parsed = JSON.parse(perm.row_filters) as Record<string, unknown>;
				if (parsed && typeof parsed === 'object' && (parsed as { type?: string }).type !== 'all') result = parsed;
			} catch {
				result = null;
			}
		}
		cache.set(cacheKey, result, PermissionEvaluator.BUSINESS_CACHE_TTL_MS);
		return result;
	}

	// ── Cache Management ─────────────────────────────────

	/** Invalidate business cache for a specific role */
	static invalidateBusinessCache(roleId: string): void {
		cache.invalidatePattern(`perm:${roleId}:*`);
		this._dropPolicyDerivedPayloads();
	}

	/** Invalidate all business cache */
	static invalidateAllBusinessCache(): void {
		cache.invalidatePattern('perm:*');
		this._dropPolicyDerivedPayloads();
	}

	/**
	 * Role/policy changes alter which rows AND fields a user may see, so every
	 * payload that was computed under the previous policy must go: response
	 * cache (`readc:*`) and cached report results (`report:*`). Permission
	 * changes are rare admin actions; dropping these caches (per-isolate, short
	 * TTL) is the correct trade — a revoked row/field must not keep being
	 * served until the TTL expires.
	 */
	private static _dropPolicyDerivedPayloads(): void {
		cache.invalidatePattern('readc:*');
		cache.invalidatePattern('report:*');
	}

	/** Check if a role name is immutable (cannot be deleted/renamed) */
	static isImmutableRole(roleName: string): boolean {
		return IMMUTABLE_ROLES.has(roleName);
	}

	/** Check if a role is an admin role */
	static isAdminRole(roleName: string): boolean {
		return ADMIN_ROLE_NAMES.has(roleName);
	}

	/** Get cache stats for monitoring */
	static getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
		return cache.getStats();
	}

	/** Reset all internal state (useful for testing) */
	static reset(): void {
		this._systemGuards = null;
		cache.clear();
	}
}
