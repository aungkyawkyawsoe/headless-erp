/**
 * Telegram session gate — the directory is the source of truth for "approved".
 *
 * Shared by the login route (auth-telegram.ts), the REST `/auth/me` handler and
 * the tRPC `auth.me` mirror: a Telegram-provisioned session (email
 * `tg-<id>@telegram.local`) is valid only while a directory row matches the
 * tg_id (config-driven TELEGRAM_DIRECTORY_COLLECTION / TELEGRAM_DIRECTORY_FIELD,
 * default `hrm_employees.etg_id`). Removing the employee's etg_id REVOKES the
 * session — session-status endpoints 401, and the mini app (which validates on
 * every load) logs the user out.
 *
 * The gate runs in EVERY environment, dev included: a Telegram-provisioned
 * login is approved only while its tg_id is actually registered in the
 * directory (see the note in auth-telegram.ts re the dev demo id).
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import type { AppConfig } from '@mmbix/config';
import { collectionTable } from '@/lib/utils/table-name';

const TG_EMAIL_RE = /^tg-([^@]+)@telegram\.local$/;

/** The tg_id carried by a Telegram-provisioned session email, or null for any
 *  other identity (admin, password, external provider). */
export function tgIdFromEmail(email?: string | null): string | null {
	return email ? (TG_EMAIL_RE.exec(email)?.[1] ?? null) : null;
}

/**
 * A directory row matched by tg_id — its id plus the employee's RBAC role value
 * (`cfg.telegram.roleField`, a role name or id; null when unset/absent).
 */
export interface DirectoryEmployee {
	id: string;
	role: string | null;
}

/**
 * The directory is the source of truth for "approved": a row whose
 * `directoryField` matches the tg_id exists in `directoryCollection`
 * (config-driven — TELEGRAM_DIRECTORY_COLLECTION / TELEGRAM_DIRECTORY_FIELD,
 * default `hrm_employees.etg_id`) ⇔ the Telegram user may sign in. The
 * collection may not exist on a fresh DB — treat that as "nothing is
 * approved" (null), never 500.
 *
 * The same row carries the employee's `roleField` (default `role`) so the login
 * route can grant THAT employee's role instead of one hardcoded role for all
 * Telegram users. A deployment whose directory predates the field must not be
 * locked out — a query naming a missing column throws, so that case falls back
 * to the id-only lookup (role null ⇒ the configured default role applies).
 *
 * A row only counts while it is LIVE: `deleted_at IS NULL` (a soft-deleted
 * employee is gone — the row survives for audit, so matching on tg_id alone kept
 * the session approved and the mini app kept showing the launcher) and not
 * explicitly deactivated (`active === false`; null/absent ⇒ active). Both checks
 * run in SQL/JS on the SAME row the old lookup read, so the login route, the
 * REST `/auth/me` handler and the tRPC mirror all revoke identically.
 */
export async function findDirectoryEmployee(db: D1Client, tgId: number | string, cfg: AppConfig): Promise<DirectoryEmployee | null> {
	const table = collectionTable(cfg.telegram.directoryCollection);
	const roleField = cfg.telegram.roleField;

	// Richest selection first; a column an older deployment never created throws,
	// so we retry narrower instead of treating the schema gap as "not approved".
	// `active` is tried independently of `role`, so a directory with the flag but
	// no role column still enforces deactivation.
	const withRole = roleField ? ['id', roleField] : ['id'];
	const candidates: string[][] = [[...withRole, 'active'], ['id', 'active'], withRole, ['id']];
	const seen = new Set<string>();
	const selections = candidates.filter((cols) => {
		const key = cols.join(',');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	for (const cols of selections) {
		try {
			const row = await db.first<{ id: string; active?: unknown } & Record<string, unknown>>(
				QueryBuilder.from(table)
					.select(...cols)
					.where(cfg.telegram.directoryField, String(tgId))
					.whereNull('deleted_at')
					.toSelect(),
			);
			if (!row) return null;
			// A terminated employee is not approved even though the row survives.
			if (row.active === 0 || row.active === '0' || row.active === false || row.active === 'false') return null;
			const raw = roleField ? row[roleField] : undefined;
			return { id: row.id, role: raw == null || raw === '' ? null : String(raw) };
		} catch {
			// Column absent on this deployment — try the next, narrower selection.
		}
	}
	return null;
}

/**
 * The LIVE directory row by its OWN id — the mirror of the tg_id gate for an
 * identity the JWT already names. A session whose embedded `employee_id` points
 * at a soft-deleted (or deactivated) row must not act under that dead identity:
 * every server-scoped write stamps the actor from this id, so a stale token
 * would bind punches / decisions / horizontal scopes to a deleted row the
 * engine's own reads filter out (the affected screen then never sees its own
 * writes). Returns null when the row is gone or explicitly `active: false` —
 * the same revoke semantics the tg gate applies.
 */
export async function findLiveEmployeeById(db: D1Client, employeeId: string): Promise<{ id: string } | null> {
	const table = collectionTable('hrm_employees');
	// Richest selection first — `active` may predate a deployment's directory.
	try {
		const row = await db.first<{ id: string; active?: unknown }>(
			QueryBuilder.from(table).select('id', 'active').where('id', employeeId).whereNull('deleted_at').toSelect(),
		);
		if (!row) return null;
		if (row.active === 0 || row.active === '0' || row.active === false || row.active === 'false') return null;
		return { id: row.id };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!/no such column/i.test(message)) return null;
	}
	// `active` is not a column on this directory — the soft-delete filter only.
	try {
		const row = await db.first<{ id: string }>(
			QueryBuilder.from(table).select('id').where('id', employeeId).whereNull('deleted_at').toSelect(),
		);
		return row ? { id: row.id } : null;
	} catch {
		return null;
	}
}
