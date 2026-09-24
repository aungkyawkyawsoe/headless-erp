/**
 * Telegram Mini App Authentication
 *
 * POST /api/auth/telegram — exchange the Telegram WebApp `initData` (or a dev
 * user when IS_DEV=true and no TELEGRAM_BOT_TOKEN is set) for access.
 *
 * Approval gate (directory-as-gate):
 *   - tg_id present in the directory collection ⇒ APPROVED: provisions the
 *     `_users` row (`tg-<id>@telegram.local`) + the configured role and
 *     returns a JWT — silent login, no screen.
 *   - tg_id NOT in the directory ⇒ PENDING: upserts a `telegram_requests` row
 *     (the admin-visible approval queue) and returns `{ status: 'pending' }` —
 *     no token, no `_users` row, no role. Admin approves by creating the
 *     directory record; the next login returns `approved`.
 *
 *   The gate runs in EVERY environment, dev included: the plain-browser dev
 *   login (a per-browser unique demo id minted by apps/tgapp) resolves
 *   `approved` only while that id is actually registered in the directory,
 *   otherwise it lands here as `pending` (the mini app's DevLoginScreen /
 *   PendingScreen show the copyable id) until it is registered. Removing the
 *   id later resumes `pending` / revokes the session — dev follows the same
 *   approval + revocation contract as production. `IS_DEV` /
 *   `TELEGRAM_BOT_TOKEN` still control how the payload is trusted (unsigned dev
 *   vs verified initData), but NEVER skip the directory check.
 *
 * Config-driven (env knobs, see @mmbix/config AppConfig.telegram) — the
 * directory + role are NOT hardcoded to hr_*:
 *   - TELEGRAM_DIRECTORY_COLLECTION / TELEGRAM_DIRECTORY_FIELD: which
 *     collection + field gate login (default `hr_employees` / `tg_id`).
 *   - TELEGRAM_ROLE_NAME / TELEGRAM_ROLE_COLLECTIONS: the role provisioned
 *     for approved users and the collections it may read/write/create
 *     (default `Employee` + the hr/vehicle/store set).
 *
 * Single identity table: every login path (Telegram, email/password, future
 * providers) resolves to `_users` — RBAC is uniform. `telegram_requests` is an
 * approval staging queue, NOT a user table.
 *
 * initData trust:
 *   - Production ALWAYS verifies the HMAC signature against TELEGRAM_BOT_TOKEN
 *     (and the 24h auth_date window). Missing token → explicit 500, never a
 *     misleading "invalid signature" 401.
 *   - Local dev WITH a token: same strict verification (tests use this).
 *   - Local dev WITHOUT a token (the default .dev.vars): the signature cannot
 *     be verified (the token IS the secret) — the payload is trusted instead,
 *     both the plain-browser body.user AND a real Telegram session's initData
 *     (user parsed from it; auth_date freshness still enforced). IS_DEV is
 *     local-only, so this never runs in production.
 */

import { Hono, type Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { D1Client, MigrationRunner, QueryBuilder } from '@mmbix/core';
import { initConfig } from '@mmbix/config';
import { AuthService } from '@/lib/services/auth.service';
import { CollectionService } from '@/lib/services/collection.service';
import { findDirectoryEmployee } from '@/lib/services/telegram-gate.service';
import { ensureProvisionedTelegramRole, resolveDirectoryRole } from '@/lib/services/telegram-role.service';
import { collectionTable } from '@/lib/utils/table-name';
import { fail, success } from '@/lib/api/response';
import { rateLimiter } from '@/middleware/rate-limiter';

const app = new Hono<{
	Bindings: {
		DB: D1Database;
		JWT_SECRET?: string;
		ADMIN_PASSWORD: string;
		IS_DEV?: string;
		TELEGRAM_BOT_TOKEN?: string;
	};
}>();

/** Effective config for this request — the directory + role are env-driven
 *  (TELEGRAM_DIRECTORY_* / TELEGRAM_ROLE_*), see @mmbix/config AppConfig. */
const cfgOf = (c: Context) => initConfig((c.env ?? {}) as Record<string, unknown>);

/** initData is only trusted within this window (Telegram recommendation: 24h). */
const TELEGRAM_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

interface TelegramUser {
	id: number | string;
	first_name?: string;
	last_name?: string;
	username?: string;
}

function fullName(u: TelegramUser): string {
	return [u.first_name, u.last_name].filter(Boolean).join(' ') || String(u.id);
}

/**
 * Why `validateInitData` rejected an initData string — logged (never returned to
 * the client) so a failing launch can be diagnosed from Workers Logs.
 */
type InitDataRejection = 'missing_hash' | 'hash_mismatch' | 'malformed';

interface VerifiedInitData {
	params: URLSearchParams;
	rejection?: undefined;
}
interface RejectedInitData {
	params?: undefined;
	rejection: InitDataRejection;
}

/**
 * Validate Telegram initData — HMAC-SHA256 over the sorted data-check-string,
 * keyed by SHA256(bot token) with the "WebAppData" secret. Returns the parsed
 * query params, or the rejection reason when the signature doesn't match.
 *
 * Deterministic by construction: the same initData + the same token always give
 * the same answer. An error that appears "sometimes" therefore means one of the
 * INPUTS changed between launches — almost always the signing bot (a launch
 * from a different/old bot than the token configured here), never the crypto.
 */
async function validateInitData(initData: string, botToken: string): Promise<VerifiedInitData | RejectedInitData> {
	try {
		const params = new URLSearchParams(initData);
		const hash = params.get('hash');
		if (!hash) return { rejection: 'missing_hash' };
		params.delete('hash');

		const checkString = [...params.entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${k}=${v}`)
			.join('\n');

		const encoder = new TextEncoder();
		const secretKey = await crypto.subtle.importKey('raw', encoder.encode('WebAppData'), { name: 'HMAC', hash: 'SHA-256' }, false, [
			'sign',
		]);
		const secret = await crypto.subtle.sign('HMAC', secretKey, encoder.encode(botToken));
		const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
		const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(checkString));
		const computed = Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return timingSafeHexEqual(computed, hash) ? { params } : { rejection: 'hash_mismatch' };
	} catch {
		return { rejection: 'malformed' };
	}
}

/**
 * Structured log for a rejected initData — the diagnostic trail for the
 * intermittent "Invalid Telegram initData signature" report. Safe fields ONLY:
 * param NAMES (never values — the user payload is PII), the auth_date age, and
 * the bot-id PREFIX of the configured token (the digits before ':' — not a
 * secret, and exactly what identifies the wrong-bot case). Watch it with
 * `npx wrangler tail mff-sys-api` (or Workers Logs) during a failing launch.
 */
function logInitDataRejection(reason: InitDataRejection, initData: string, botToken: string): void {
	let keys: string[] = [];
	let authDateAge: number | null = null;
	try {
		const params = new URLSearchParams(initData);
		keys = [...params.keys()];
		const authDate = Number(params.get('auth_date'));
		if (Number.isFinite(authDate) && authDate > 0) authDateAge = Math.round(Date.now() / 1000 - authDate);
	} catch {
		/* best-effort — the rejection reason is already logged */
	}
	const tokenBotId = botToken.includes(':') ? botToken.split(':')[0] : 'unknown';
	console.warn(
		`[auth/telegram] initData verification failed: ${reason} ${JSON.stringify({
			reason,
			keys,
			auth_date_age_s: authDateAge,
			token_bot_id: tokenBotId,
		})}`,
	);
}

/**
 * Constant-time hex-string comparison — prevents timing side channels on the
 * Telegram initData signature check (crypto.subtle has no timingSafeEqual).
 * Length mismatch short-circuits (lengths are public — both are 64-hex).
 */
function timingSafeHexEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/** Dev-only: parse the user payload from raw initData. The HMAC cannot be
 *  verified without the bot token (the token IS the secret), so the payload is
 *  trusted in dev exactly like the body.user fallback — freshness is still
 *  enforced by the caller. Never reachable in production (IS_DEV is local-only). */
function userFromInitData(initData: string): TelegramUser | null {
	try {
		const raw = new URLSearchParams(initData).get('user');
		return raw ? (JSON.parse(raw) as TelegramUser) : null;
	} catch {
		return null;
	}
}

/** Find or create the `_users` row for an approved Telegram user. The row's
 *  `role_id` / `full_name` are kept in sync with the directory on every login, so
 *  an admin changing an employee's role (or name) takes effect on the next
 *  sign-in instead of being frozen at first provisioning. */
async function findOrCreateUser(
	db: D1Client,
	tgUser: TelegramUser,
	roleId: string,
): Promise<{ id: string; email: string; full_name: string; role_id: string }> {
	const email = `tg-${tgUser.id}@telegram.local`;
	const name = fullName(tgUser);
	const existing = await db.first<{ id: string; email: string; full_name: string; role_id: string }>(
		QueryBuilder.from('_users').select('id', 'email', 'full_name', 'role_id').where('email', email).toSelect(),
	);
	if (existing) {
		if (existing.role_id !== roleId || existing.full_name !== name) {
			await db.run(
				QueryBuilder.from('_users')
					.where('id', existing.id)
					.toUpdate({ role_id: roleId, full_name: name, updated_at: new Date().toISOString() }),
			);
			return { id: existing.id, email: existing.email, full_name: name, role_id: roleId };
		}
		return existing;
	}

	const user = {
		id: crypto.randomUUID(),
		email,
		// Telegram IS the identity — no password ever exists for these rows.
		// `password_hash` is NOT NULL but only login() verifies hashes, and login
		// resolves non-telegram emails only, so a literal marker is stored. This
		// deliberately avoids a 600k PBKDF2 derivation (~50-200ms CPU on the
		// Workers runtime) per new Telegram sign-in for a hash nothing verifies.
		password_hash: 'telegram:no-password',
		full_name: name,
		role_id: roleId,
		status: 'active',
	};
	await db.run(QueryBuilder.from('_users').toInsert(user));
	return { id: user.id, email: user.email, full_name: user.full_name, role_id: roleId };
}

// ─── Approval gate ──────────────────────────────────────
// `findDirectoryEmployee` lives in lib/services/telegram-gate.service.ts — it is
// shared with the REST /auth/me handler and the tRPC auth.me mirror so the
// login gate and the session-status gate can never drift.

// ─── Approval queue (telegram_requests) ────────────────
/**
 * Ensure the `telegram_requests` approval queue collection exists.
 * Idempotent: no-op when already present; tolerant of a concurrent create
 * (the loser gets a conflict error and simply ignores it).
 */
async function ensureTelegramRequestsCollection(db: D1Client): Promise<void> {
	const svc = new CollectionService(db);
	try {
		await svc.getCollection('telegram_requests');
		return;
	} catch {
		// missing — create below
	}
	try {
		await svc.createCollection({
			name: 'Telegram Requests',
			slug: 'telegram_requests',
			description: 'Pending Telegram Mini App access requests — approve by creating the employee record with this tg_id',
			fields: [
				{ name: 'tg_id', type: 'text', label: 'Telegram ID', required: true },
				{ name: 'full_name', type: 'text', label: 'Full Name', required: false },
				{ name: 'username', type: 'text', label: 'Telegram Username', required: false },
				{ name: 'status', type: 'text', label: 'Status', required: false, default: 'pending' },
				{ name: 'requested_at', type: 'timestamp', label: 'Requested At', required: false },
			],
			system_field_options: {
				doc_status: false,
				display_number: false,
				_owner: false,
				created_by: false,
				updated_by: false,
				deleted_at: true,
				deleted_by: false,
			},
		});
	} catch {
		// Concurrent create from another isolate — the collection now exists.
	}
}

/** One row per Telegram user — upsert on each login attempt (refreshes requested_at). */
async function upsertTelegramRequest(db: D1Client, tgUser: TelegramUser): Promise<void> {
	const tgId = String(tgUser.id);
	const existing = await db.first<{ id: string }>(
		QueryBuilder.from(collectionTable('telegram_requests')).select('id').where('tg_id', tgId).toSelect(),
	);
	const now = new Date().toISOString();
	if (existing) {
		await db.run(
			QueryBuilder.from(collectionTable('telegram_requests'))
				.where('id', existing.id)
				.toUpdate({
					full_name: fullName(tgUser),
					username: tgUser.username ?? null,
					status: 'pending',
					requested_at: now,
					updated_at: now,
				}),
		);
		return;
	}
	await db.run(
		QueryBuilder.from(collectionTable('telegram_requests')).toInsert({
			id: crypto.randomUUID(),
			tg_id: tgId,
			full_name: fullName(tgUser),
			username: tgUser.username ?? null,
			status: 'pending',
			requested_at: now,
			created_at: now,
			updated_at: now,
		}),
	);
}

// ─── Route ──────────────────────────────────────────────

// Login rate limit: 5/min in production, skipped in dev (mirrors /api/auth/login).
// Hoisted — instantiating the limiter inside the per-request callback allocated
// a fresh counter namespace every call, so the limit never triggered.
const telegramLoginLimiter = rateLimiter({
	defaults: { anonymous: { max: 5, window: 60 }, authenticated: { max: 5, window: 60 }, admin: { max: 5, window: 60 } },
});

app.use(
	'/',
	createMiddleware(async (c, next) => {
		const dev = (c.env.IS_DEV as string) === 'true';
		if (dev) {
			await next();
			return;
		}
		await telegramLoginLimiter(c, next);
	}),
);

app.post('/', async (c) => {
	const isDev = (c.env.IS_DEV as string) === 'true';
	const botToken = (c.env.TELEGRAM_BOT_TOKEN as string) || '';
	// 🔒 Fail closed: resolveJwtSecret throws in production without an explicit
	// JWT_SECRET (never falls back to ADMIN_PASSWORD outside dev — anyone holding
	// the admin password could forge tokens).
	let jwtSecret: string;
	try {
		jwtSecret = AuthService.resolveJwtSecret(c.env);
	} catch {
		return fail(c, 'Server misconfigured: set JWT_SECRET or ADMIN_PASSWORD', 500);
	}
	// Production MUST have the bot token — without it no initData signature
	// can ever verify (the token IS the secret). Fail loudly so the
	// misconfiguration is obvious instead of a misleading 401.
	if (!isDev && !botToken) return fail(c, 'Server misconfigured: TELEGRAM_BOT_TOKEN is not set', 500);

	const body = (await c.req.json().catch(() => ({}))) as { initData?: string; user?: TelegramUser };
	if (!body) return fail(c, 'Invalid JSON body', 400);

	// Resolve the Telegram user:
	//  - dev WITHOUT a bot token: the HMAC can't be verified (the token IS the
	//    secret) — trust the payload, same trust level as the body.user dev
	//    fallback. Accepts the plain-browser body.user AND a real Telegram
	//    session's initData (user parsed out; auth_date freshness enforced).
	//  - otherwise (production, or dev WITH a token): the initData signature
	//    must verify against TELEGRAM_BOT_TOKEN and be fresh. An unsigned
	//    body.user is NEVER trusted once a token exists.
	let tgUser: TelegramUser | null = null;
	if (isDev && !botToken) {
		if (body.initData) {
			const params = new URLSearchParams(body.initData);
			const authDate = Number(params.get('auth_date'));
			if (!authDate || Number.isNaN(authDate)) return fail(c, 'initData auth_date is missing or invalid', 401);
			if (Date.now() / 1000 - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
				return fail(c, 'initData is stale — re-open the Mini App and try again', 401);
			}
			tgUser = userFromInitData(body.initData);
		} else {
			tgUser = body.user ?? null;
		}
		if (!tgUser || !tgUser.id) return fail(c, 'Telegram user id is required', 400);
	} else {
		if (!body.initData) {
			// Dev with a token set: the unsigned body.user dev login is disabled by
			// design (an unverified payload is never trusted once a token exists) —
			// say why, so a 400 doesn't read like a missing initData bug.
			return fail(
				c,
				isDev
					? 'initData is required — TELEGRAM_BOT_TOKEN in apps/api/.dev.vars disables the plain-browser dev login; remove it for dev, or sign in from Telegram'
					: 'initData is required',
				400,
			);
		}
		const verified = await validateInitData(body.initData, botToken);
		if (verified.rejection) {
			logInitDataRejection(verified.rejection, body.initData, botToken);
			// Keep the base phrase stable (the mini app matches on it to show the
			// right guidance) — the parenthetical only distinguishes a mangled /
			// truncated string (hash missing) from a genuine signature mismatch.
			return fail(
				c,
				verified.rejection === 'missing_hash'
					? 'Invalid Telegram initData signature (hash missing — session string was truncated)'
					: 'Invalid Telegram initData signature',
				401,
			);
		}
		const params = verified.params;

		// auth_date freshness — reject replayed initData older than 24h.
		const authDate = Number(params.get('auth_date'));
		if (!authDate || Number.isNaN(authDate)) return fail(c, 'initData auth_date is missing or invalid', 401);
		if (Date.now() / 1000 - authDate > TELEGRAM_AUTH_MAX_AGE_SECONDS) {
			return fail(c, 'initData is stale — re-open the Mini App and try again', 401);
		}

		const raw = params.get('user');
		if (raw) {
			try {
				tgUser = JSON.parse(raw) as TelegramUser;
			} catch {
				return fail(c, 'initData user payload is invalid', 400);
			}
		}
	}
	if (!tgUser || !tgUser.id) return fail(c, 'Telegram user id is required', 400);

	const db = new D1Client(c.env.DB);
	await new MigrationRunner(db).runPending();
	const auth = new AuthService(db);
	const cfg = cfgOf(c);

	// Directory gate: approved ⇔ a directory row (default hrm_employees.etg_id)
	// matches the tg_id — collection + field are config-driven. This runs in
	// EVERY environment, dev.demo included, so dev behaves exactly like
	// production: an unregistered id (e.g. a fresh dev browser's unique id)
	// lands here as `pending` until it is registered in the directory; and
	// REMOVING an id from the directory REVOKES the session on the next check,
	// so dev testing honors the same approval/revocation contract as prod.
	const directory = await findDirectoryEmployee(db, tgUser.id, cfg);
	if (!directory) {
		await ensureTelegramRequestsCollection(db);
		await upsertTelegramRequest(db, tgUser);
		return success(c, {
			status: 'pending',
			tg_id: String(tgUser.id),
			full_name: fullName(tgUser),
			username: tgUser.username ?? null,
		});
	}

	// Approved — resolve the employee's role from the directory (falling back to
	// the configured default), provision the identity + role, issue the JWT.
	// Idempotent: a returning id reuses its `_users` row, with role/name re-synced.
	const defaultRole = await ensureProvisionedTelegramRole(db, cfg);
	const employeeRole = await resolveDirectoryRole(db, directory.role);
	const role = employeeRole ?? defaultRole;
	const user = await findOrCreateUser(db, tgUser, role.id);
	// Bind the acting employee into the signed token (see AuthContext.employee_id).
	const token = await auth.generateToken(user.id, jwtSecret, directory.id);

	return success(c, {
		status: 'approved',
		token,
		user: { id: user.id, email: user.email, full_name: user.full_name, role_id: user.role_id, role_name: role.name },
	});
});

export default app;
