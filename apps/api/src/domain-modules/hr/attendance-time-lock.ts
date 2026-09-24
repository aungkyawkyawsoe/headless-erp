/**
 * Attendance time lock — a punch's TIME is server-owned.
 *
 * The tgapp punches through `POST /api/hr/attendances/punch`, but a client could
 * still call the generic entity API directly with a backdated `check_in` /
 * `check_out` (Tampering / Repudiation: "I was on time"). The `employee` is
 * already session-bound by `policies.actor_fields`, but the TIMESTAMP was not.
 *
 * A stamp is the rule's natural home: it must fire on EVERY write path (tgapp,
 * Studio, CLI, import), which is exactly the compiled lifecycle-hook spine
 * (`plugin-hooks.ts`) — the same pattern as the early-leave day guard. The hook
 * overwrites `check_in` / `check_out` with the SERVER clock, so the value a
 * client sends is never the value that lands. A trusted-root admin (`auth.is_admin`
 * — a dev-token session or an Administrator) is exempt, so a genuine back-fill /
 * correction is still possible deliberately.
 */

import { pluginHookRegistry } from '@/core/plugin-hooks';

/** One shared plugin id — the Studio hook viewer groups the two events as one rule. */
export const ATTENDANCE_TIME_LOCK_PLUGIN = 'hr-attendance-time-lock' as const;

const COLLECTION = 'hrm_attendances';

let registered = false;

/** Register the lock — idempotent, called once at boot from `mountDomainModules`. */
export function registerAttendanceTimeLockHooks(): void {
	if (registered) return;
	registered = true;

	// Create: the day row's check-in (and any check-out present) is stamped NOW.
	pluginHookRegistry.register({
		collection: COLLECTION,
		event: 'before_insert',
		pluginId: ATTENDANCE_TIME_LOCK_PLUGIN,
		priority: 10, // ahead of any rule that inspects the stamp
		timeoutMs: 1_000,
		description: 'Stamp a punch time with the server clock — a client can never backdate check_in/check_out.',
		handler: async (doc, _db, auth) => {
			if (auth?.is_admin) return; // trusted root may back-fill / correct
			const now = new Date().toISOString();
			doc.check_in = now;
			if (doc.check_out !== undefined && doc.check_out !== null && doc.check_out !== '') doc.check_out = now;
			return doc;
		},
	});

	// Update: a client-supplied check-in/check-out is re-stamped (the check-out
	// write is the common case); an unrelated edit leaves both columns untouched.
	pluginHookRegistry.register({
		collection: COLLECTION,
		event: 'before_update',
		pluginId: ATTENDANCE_TIME_LOCK_PLUGIN,
		priority: 10,
		timeoutMs: 1_000,
		description: 'Re-stamp a punch time on update — only the server may set it.',
		handler: async (doc, _db, auth) => {
			if (auth?.is_admin) return;
			const now = new Date().toISOString();
			if ('check_in' in doc) doc.check_in = now;
			if ('check_out' in doc) doc.check_out = now;
			return doc;
		},
	});
}
