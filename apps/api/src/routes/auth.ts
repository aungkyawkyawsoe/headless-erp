/**
 * Authentication Routes
 *
 * POST /api/auth/login   → Login with email + password → token
 * GET  /api/auth/me       → Get current user info (requires auth)
 */

import { Hono, type Context } from 'hono';
import { ConflictError } from '@mmbix/utils';
import { D1Client, QueryBuilder } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';
import type { AuthContext } from '@/lib/services/auth.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { findDirectoryEmployee, tgIdFromEmail } from '@/lib/services/telegram-gate.service';
import { ensureProvisionedTelegramRole, syncDirectoryRole } from '@/lib/services/telegram-role.service';
import { initConfig } from '@mmbix/config';
import { sha256Hex } from '@/lib/services/api-key.service';
import { createMiddleware } from 'hono/factory';
import { MigrationRunner } from '@mmbix/core';
import { rateLimiter } from '@/middleware/rate-limiter';
import { isLocalDevRequest } from '@/middleware/rate-limit-tiers';
import { securityAudit, SECURITY_COLLECTIONS } from '@/lib/services/security-audit';
import { success, fail } from '@/lib/api/response';

type AV = {
	Variables: { auth: AuthContext };
	Bindings: {
		DB: D1Database;
		ADMIN_USERNAME: string;
		ADMIN_PASSWORD: string;
		JWT_SECRET?: string;
		IS_DEV?: string;
		TELEGRAM_BOT_TOKEN?: string;
	};
};

const app = new Hono<AV>();

function getAuth(c: Context): AuthService {
	return new AuthService(new D1Client(c.env.DB));
}

// ─── Token Auth Middleware ────────────────────────────

/** Strictly-typed version for auth routes */
export const requireAuth = createMiddleware<AV>(async (c, next) => {
	const header = c.req.header('Authorization');
	const isDev = (c.env.IS_DEV as string) === 'true';

	if (!header || !header.startsWith('Bearer ')) {
		return fail(c, 'Authentication required. Use Authorization: Bearer <token>', 401);
	}

	const token = header.slice(7);

	// Dev mode: accept 'dev-token' for quick testing without login — ONLY for
	// requests that look local (wrangler dev binds localhost); a non-local Host
	// means the dev-token bypass would be reachable from the internet.
	if (isDev && token === 'dev-token' && isLocalDevRequest(c)) {
		c.set('auth', {
			user_id: '00000000-0000-4000-8000-000000000000',
			role_id: '',
			role_name: 'Administrator',
			email: 'dev',
			is_admin: true,
		});
		return next();
	}

	// Machine API keys — mmk_ prefixed tokens resolved via _api_keys (SHA-256 hash only).
	if (token.startsWith('mmk_')) {
		const db = new D1Client(c.env.DB);
		const keyHash = await sha256Hex(token);
		const key = await db.first<{
			id: string;
			user_id: string;
			role_id: string | null;
			is_active: number;
			scope: string | null;
			expires_at: string | null;
		}>(QueryBuilder.from('_api_keys').select('*').where('key_hash', keyHash).toSelect());
		if (!key || key.is_active !== 1) return fail(c, 'Invalid API key', 401);
		// 🔒 Expiry (deny-by-default). A machine key MAY carry an `expires_at` (an ISO
		// timestamp; NULL = never expires). Once the clock passes it — or the stamp is
		// unreadable — the key is refused HERE, before it can act. The rejection is the
		// SAME canonical 401 the other key failures return, so a caller cannot tell an
		// expired key from any other invalid one (no enumeration oracle); visibility
		// comes from the audit event instead of the response body.
		if (key.expires_at) {
			const expiresAt = Date.parse(key.expires_at);
			if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
				securityAudit(c, {
					collection: SECURITY_COLLECTIONS.auth,
					action: 'login_failed',
					document_id: key.id,
					changes: { reason: 'api_key_expired', key_id: key.id, expires_at: key.expires_at },
				});
				return fail(c, 'Invalid API key', 401);
			}
		}
		const user = await db.first<{ id: string; email: string; full_name: string; role_id: string | null }>(
			QueryBuilder.from('_users').select('*').where('id', key.user_id).toSelect(),
		);
		if (!user) return fail(c, 'API key owner not found', 401);
		const roleId = key.role_id ?? user.role_id ?? '';
		const role = roleId
			? await db.first<{ name: string }>(QueryBuilder.from('_roles').select('name').where('id', roleId).toSelect())
			: null;
		const roleName = role?.name ?? '';
		// Touch last_used_at (best effort, non-blocking).
		await db.run(QueryBuilder.from('_api_keys').where('id', key.id).toUpdate({ last_used_at: new Date().toISOString() })).catch(() => {});
		c.set('auth', {
			user_id: user.id,
			role_id: roleId,
			role_name: roleName,
			email: user.email,
			is_admin: roleName === 'Administrator',
			// PoLP: a scoped key is limited to its scope. A key with a missing/legacy
			// scope is treated as READ (deny-by-default) — never escalated to admin; an
			// un-scoped integration can be widened explicitly, one key at a time.
			api_key_scope: key.scope === 'write' || key.scope === 'admin' ? key.scope : 'read',
		} satisfies AuthContext);
		return next();
	}

	// The request-level pre-auth middleware (index.ts) already verified this exact
	// bearer ONCE and stored the context. Reuse it: re-verifying here meant a second
	// JWT check plus another uncached `_healActingEmployee` point read.
	const preAuthed = c.get('auth') as AuthContext | undefined;
	if (preAuthed?.user_id) {
		// Already verified once for this request (index.ts pre-auth middleware).
		await next();
		return;
	}

	// Token provided — validate it via JWT
	const auth = getAuth(c);
	const jwtSecret = AuthService.resolveJwtSecret(c.env);
	const ctx = await auth.verifyToken(token, jwtSecret, true, c.env);
	if (!ctx) {
		// v0.7: Try external auth providers (Clerk, Auth0, Supabase, OIDC)
		const external = await tryExternalAuth(c, token);
		if (external) {
			c.set('auth', external);
			return next();
		}
		return fail(c, 'Invalid or expired token', 401);
	}
	c.set('auth', ctx);
	await next();
});

// ─── POST /api/auth/login ─────────────────────────────

// Login rate limit: 5/min in production, 50/min in dev (for testing).
// Hoisted to a module-level const — instantiating the limiter per request (as
// it was) allocated a FRESH counter namespace every call, so the 5/min limit
// never actually triggered.
const loginLimiter = rateLimiter({
	defaults: { anonymous: { max: 5, window: 60 }, authenticated: { max: 5, window: 60 }, admin: { max: 5, window: 60 } },
});

app.use(
	'/login',
	createMiddleware(async (c, next) => {
		const dev = (c.env.IS_DEV as string) === 'true';
		if (dev) {
			// Skip rate limiting in dev mode for testing
			await next();
			return;
		}
		await loginLimiter(c, next);
	}),
);

app.post('/login', async (c) => {
	const auth = getAuth(c);
	await new MigrationRunner(new D1Client(c.env.DB)).runPending();
	const { email, password } = await c.req.json();
	if (!email || !password) {
		return fail(c, 'Email and password required', 400);
	}
	const adminPassword = c.env.ADMIN_PASSWORD;
	// Validate secret strength at login time (skip in dev)
	const isDev = (c.env.IS_DEV as string) === 'true';
	if (!isDev && adminPassword) AuthService.validateSecret(adminPassword);
	if (!adminPassword) {
		return fail(c, 'Server misconfigured: set ADMIN_PASSWORD environment variable', 500);
	}
	// 🔒 Production requires an explicit JWT_SECRET — never sign tokens with the
	// admin password outside dev (anyone holding it could forge tokens, and
	// rotating the password would invalidate all sessions).
	let jwtSecret: string;
	try {
		jwtSecret = AuthService.resolveJwtSecret(c.env);
	} catch (err) {
		return fail(c, err instanceof Error ? err.message : 'Server misconfigured: set JWT_SECRET environment variable', 500);
	}
	// Ensure admin user exists on first run (ADMIN_NAME → full_name)
	await auth.ensureAdminUser(
		c.env.ADMIN_USERNAME,
		c.env.ADMIN_PASSWORD,
		adminPassword,
		(c.env.IS_DEV as string) === 'true',
		((c.env as Record<string, unknown>).ADMIN_NAME as string) || 'Administrator',
	);
	const result = await auth.login(email, password, adminPassword, jwtSecret).catch((err) => {
		// A refused sign-in is exactly the event a brute-force run makes invisible
		// (STRIDE: Repudiation). Record the ATTEMPTED email + outcome — never the
		// attempted password — then rethrow so the 401 response is unchanged.
		const attempted = String(email).toLowerCase();
		securityAudit(c, {
			collection: SECURITY_COLLECTIONS.auth,
			action: 'login_failed',
			document_id: attempted,
			changes: { email: attempted, outcome: 'failure', reason: err instanceof Error ? err.message : 'unknown' },
		});
		throw err;
	});
	// A successful sign-in is attributable: WHO signed in (user id) and with WHICH
	// address. `changes` deliberately omits the password (and the masker is a second
	// line of defence, not the first).
	securityAudit(c, {
		collection: SECURITY_COLLECTIONS.auth,
		action: 'login',
		document_id: result.user.id,
		user_id: result.user.id,
		changes: { email: result.user.email, outcome: 'success' },
	});
	return success(c, {
		token: result.token,
		user: { id: result.user.id, email: result.user.email, full_name: result.user.full_name },
	});
});

// ─── GET /api/auth/me ─────────────────────────────────
// ?collection=:slug → also returns the caller's field_restrictions (whitelist)
// for that collection so the form UI can hide fields the role can't see.

app.get('/me', requireAuth, async (c) => {
	const ctx = c.get('auth');

	// Telegram sessions are directory-gated (same gate as POST /auth/telegram):
	// approved ⇔ a directory row still matches the tg_id (config-driven
	// collection/field). Removing the employee's tg link revokes
	// the session → 401 here, and the client (which validates on every load)
	// logs the user out. Runs in dev too, so dev demonstrates the same
	// approval/revocation contract as production.
	//
	// A PASSWORD session is gated as well, but at the bearer: `verifyToken`
	// re-validates the account's `_users.employee_id` link on EVERY request and
	// refuses the token outright when that employee is gone — so an offboarded
	// employee is logged out of the web app exactly like a Telegram user whose
	// tg link was removed. Nothing extra is needed here; this handler only has to
	// resolve the TELEGRAM directory row and report the employee the session acts as.
	const env = (c.env ?? {}) as Record<string, unknown>;
	const tgId = tgIdFromEmail(ctx.email);
	// The directory row IS the acting employee: surface its id so a dashboard can
	// start its employee-scoped reads without a second directory lookup
	// (the tg id → employee hop was a full serial round trip on every visit).
	let employeeId: string | null = null;
	// The role the response reports (and the grants it composes) — the directory
	// role when this is a Telegram session, so a role edited in the directory is
	// reflected by the very next `/auth/me` (see `syncDirectoryRole`).
	let effectiveRole: { id: string; name: string } | null = null;
	let effectiveIsAdmin = ctx.is_admin;
	if (tgId) {
		const cfg = initConfig(env);
		const db = new D1Client(c.env.DB);
		const directory = await findDirectoryEmployee(db, tgId, cfg);
		if (!directory) {
			return fail(c, 'Your Telegram account is no longer linked to the employee directory — contact HR to restore access', 401);
		}
		employeeId = directory.id;
		// Directory → `_users.role_id` sync. The session's long-lived JWT froze the
		// role at login; without this, changing the directory's role value (admin edit or
		// SQL) never reached the client — the launcher kept painting the old
		// role's tiles (e.g. a missing tile after a promotion to Administrator).
		const synced = await syncDirectoryRole(db, ctx, directory.role, cfg);
		effectiveRole = { id: synced.id, name: synced.name };
		effectiveIsAdmin = synced.name === 'Administrator' || synced.isSystem;
		// Re-apply the config-owned role grants here, not ONLY at login: the JWT is
		// long-lived and the client keeps it, so an existing session would never
		// re-run `POST /auth/telegram` and a grant added by a deploy (a collection
		// listed in TELEGRAM_ROLE_COLLECTIONS) would stay absent from
		// `_role_permissions` — the screen keeps its read-error state forever.
		// Like `roleAuthSummary` below, this is deliberately uncached: it runs about
		// once per app load, and a stale answer here looks exactly like a broken
		// grant. Best-effort, so a heal failure can never break the session read.
		//
		// ONE call only — this used to run twice (an identical uncached pass
		// immediately before it), which paid ~3 extra D1 round trips on the
		// boot-critical `/auth/me` for no additional effect.
		try {
			await ensureProvisionedTelegramRole(db, cfg);
		} catch (err) {
			console.warn('[auth/me] Telegram role provisioning failed (will retry on the next session check)', err);
		}
	}

	const collection = c.req.query('collection');
	let fieldRestrictions: string[] | null = null;
	if (collection && ctx.role_id && !ctx.is_admin) {
		fieldRestrictions = await PermissionEvaluator.getFieldRestrictions(new D1Client(c.env.DB), ctx.role_id, collection);
	}

	// The collection slugs this role can READ — the app launcher's app-access
	// gate (which apps the employee may open) is derived from these DB grants,
	// not a second hand-maintained role→app table (single version of the truth:
	// `_role_permissions`). The Mini App maps each launcher tile to the engine
	// collections it reads and keeps a tile ONLY when the role can read them.
	//   - a non-admin with a role → the read-granted slugs (per-role cache)
	//   - an admin (or someone whose role has NO permission rows at all, e.g.
	//     the dev-token path) → sees everything: sentinel '*' meaning "no filter"
	// The collection slugs this role can READ + the mini-app launcher ids this
	// role may OPEN. Both come from `_role_permissions` / `_roles.app_access`
	// (DB is the single source of truth — the client app never keeps its own
	// role→access table). Sentinel values: an admin (or a role with no curated
	// grants) sees everything → '*' for collections / null for apps.
	//
	// `roleAuthSummary` is deliberately UNCACHED: this drives the mini-app's
	// client-side app gate, where a stale answer looks like a broken grant (see
	// its doc). It runs about once per app load, so freshness wins over the two
	// indexed reads.
	let grantedCols: string[] | '*' | null = null;
	let apps: string[] | null = null;
	const roleForGrants = effectiveRole?.id ?? ctx.role_id;
	if (effectiveIsAdmin) {
		grantedCols = '*';
	} else if (roleForGrants) {
		const summary = await getAuth(c).roleAuthSummary(roleForGrants);
		grantedCols = summary.granted;
		apps = summary.apps;
	}
	return success(c, {
		...ctx,
		role_id: roleForGrants,
		role_name: effectiveRole?.name ?? ctx.role_name,
		is_admin: effectiveIsAdmin,
		employee_id: employeeId ?? ctx.employee_id ?? null,
		field_restrictions: fieldRestrictions,
		granted_collections: grantedCols,
		apps,
	});
});

// ─── v0.7: External Auth Provider Integration ───────────

/**
 * Try to authenticate a token against configured external providers
 * (Clerk, Auth0, Supabase, OIDC). On success, creates an internal user record
 * (when none exists) and returns an AuthContext.
 *
 * 🔒 Account-takeover guard: `_users` has NO external-identity column
 * (migration 002 — no `external_provider`/`external_id`/`meta`), so an existing
 * row cannot be proven to be provisioned for this provider. Auto-logging-in on
 * email match alone would let anyone with a valid token from any configured IdP
 * take over an existing account (inheriting its role). Existing users are
 * therefore REJECTED (409 — link via admin) instead of logged in; only brand-new
 * emails get auto-provisioned. Linking existing accounts requires an explicit
 * admin flow that records the provider identity.
 */
async function tryExternalAuth(c: Context, token: string): Promise<AuthContext | null> {
	const env = c.env as unknown as Record<string, unknown>;
	// Only attempt if at least one provider is configured
	const hasProvider = env.CLERK_SECRET_KEY || env.AUTH0_DOMAIN || env.SUPABASE_JWT_SECRET || env.OIDC_ISSUER;
	if (!hasProvider) return null;

	let user: { email?: string; name?: string; emailVerified?: boolean } | null = null;
	try {
		const { autoVerifyToken } = await import('@/lib/services/auth-providers.service');
		user = await autoVerifyToken(token, env);
	} catch {
		return null;
	}
	if (!user || !user.email) return null;

	// 🔒 Pre-registration lockout guard: auto-provisioning an UNVERIFIED email
	// lets an attacker with an open-signup IdP account claim the victim's email
	// (locking the victim out of password login forever). Reject when the IdP
	// EXPLICITLY says the email is unverified. When the claim is missing we warn
	// and allow (provider contract may not expose it) — operators should enable
	// email verification at the IdP for auto-provisioning setups.
	if (user.emailVerified === false) {
		console.warn(`[auth] external login rejected — email ${user.email} is not verified at the IdP`);
		return null;
	}
	if (user.emailVerified === undefined) {
		console.warn(`[auth] external login for ${user.email} — IdP did not assert email_verified; enable verification at the provider`);
	}

	// Find or create an internal user record for the external identity
	const db = new D1Client(c.env.DB);
	const auth = getAuth(c);
	await new MigrationRunner(db).runPending();

	const internal = await auth.findUserByEmail(user.email);
	if (internal) {
		// Existing account + no recorded external identity → refuse auto-login.
		// The ConflictError propagates to the global error handler → 409.
		throw new ConflictError(
			'An account with this email already exists. Link it to your external provider via an administrator instead of logging in.',
		);
	}

	// No user exists → create with a random unusable password (password login not allowed)
	const randomPw = crypto.randomUUID().replace(/-/g, '');
	const created = await auth.createUser(
		{ email: user.email, password: randomPw, full_name: user.name || user.email },
		(c.env.ADMIN_PASSWORD || randomPw) as string,
	);

	return {
		user_id: created.id,
		role_id: created.role_id || '',
		role_name: created.role_id ? 'External' : '',
		email: created.email,
		is_admin: false,
	};
}

export { app as authRoutes };
