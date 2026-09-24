/**
 * 🔒 RBAC System Policies — File-Based Layer (Immutable)
 *
 * Developer-defined structural guards. These CANNOT be changed
 * via admin UI — they define the framework's security boundaries.
 *
 * Design principle:
 *   "What can't change" → Code (this file)
 *   "What might change" → Database (_role_permissions)
 */
import type { AuthContext } from '@mmbix/types';

// ─── Types ───────────────────────────────────────────────

export interface SystemPolicy {
	/** Unique action identifier (e.g., 'system:manage-collections') */
	action: string;
	/** Role names allowed for this operation */
	allowedRoles: string[];
	/** Optional: runtime condition */
	condition?: (ctx: AuthContext) => boolean;
}

export interface ResourceGuard {
	/** Resource identifier */
	resource: string;
	/** Operations on this resource */
	operations: Record<string, SystemPolicy>;
}

// ─── System Guards ───────────────────────────────────────

export const SYSTEM_GUARDS: ResourceGuard[] = [
	// ── Collection Schema Management ──────────────────────
	{
		resource: 'entity-schema',
		operations: {
			create: {
				action: 'system:manage-collections',
				allowedRoles: ['Administrator', 'System'],
			},
			delete: {
				action: 'system:manage-collections',
				allowedRoles: ['Administrator', 'System'],
			},
		},
	},

	// ── User Management ───────────────────────────────────
	{
		resource: 'users',
		operations: {
			list: { action: 'system:manage-users', allowedRoles: ['Administrator'] },
			create: { action: 'system:manage-users', allowedRoles: ['Administrator'] },
			update: { action: 'system:manage-users', allowedRoles: ['Administrator'] },
			delete: { action: 'system:manage-users', allowedRoles: ['Administrator'] },
		},
	},

	// ── Role Management ───────────────────────────────────
	{
		resource: 'roles',
		operations: {
			list: { action: 'system:manage-roles', allowedRoles: ['Administrator'] },
			create: { action: 'system:manage-roles', allowedRoles: ['Administrator'] },
			delete: { action: 'system:manage-roles', allowedRoles: ['Administrator'] },
		},
	},

	// ── Permission Management ─────────────────────────────
	{
		resource: 'permissions',
		operations: {
			get: { action: 'system:manage-roles', allowedRoles: ['Administrator'] },
			set: { action: 'system:manage-roles', allowedRoles: ['Administrator'] },
		},
	},

	// ── Webhook Management ────────────────────────────────
	{
		resource: 'webhooks',
		operations: {
			create: { action: 'system:manage-webhooks', allowedRoles: ['Administrator'] },
			delete: { action: 'system:manage-webhooks', allowedRoles: ['Administrator'] },
		},
	},

	// ── Scheduler Management ──────────────────────────────
	{
		resource: 'scheduler',
		operations: {
			create: { action: 'system:manage-scheduler', allowedRoles: ['Administrator'] },
			delete: { action: 'system:manage-scheduler', allowedRoles: ['Administrator'] },
			trigger: { action: 'system:manage-scheduler', allowedRoles: ['Administrator'] },
		},
	},

	// ── Report Management ─────────────────────────────────
	{
		resource: 'reports',
		operations: {
			dashboard: { action: 'system:read-reports', allowedRoles: ['Administrator'] },
			generate: { action: 'system:generate-reports', allowedRoles: ['Administrator'] },
		},
	},

	// ── System Settings ───────────────────────────────────
	{
		resource: 'system-settings',
		operations: {
			read: { action: 'system:read-settings', allowedRoles: ['Administrator'] },
			update: { action: 'system:write-settings', allowedRoles: ['Administrator'] },
		},
	},
];

// ─── Immutable Roles ─────────────────────────────────────

/** Roles that CANNOT be deleted or renamed via admin API */
export const IMMUTABLE_ROLES = new Set(['Administrator', 'System']);

/** Role names that get admin bypass */
export const ADMIN_ROLE_NAMES = new Set(['Administrator', 'System']);
