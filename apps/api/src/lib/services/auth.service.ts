/**
 * Authentication & Authorization Service
 *
 * Handles:
 *   1. User management (CRUD)
 *   2. Password hashing (SHA-256 with salt)
 *   3. Token-based authentication (JWT-style with HMAC)
 *   4. Permission checking against roles
 *
 * Security:
 *   - Passwords never stored in plain text
 *   - Tokens use HMAC-SHA256 with secret from env
 *   - Permission checks are collection + action level
 */

import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { validators, assertValid } from '@mmbix/utils';
import { ValidationError, UnauthorizedError, ConflictError, InternalError } from '@mmbix/utils';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
// AuthContext is canonical in @mmbix/types — imported + re-exported here so
// this module's own code AND every call site that imported it from this
// module keep working unchanged.
import type { AuthContext } from '@mmbix/types';
export type { AuthContext };
import { cache } from '@mmbix/core';
import type { UserRecord, RoleRecord, RolePermissionRecord } from '@mmbix/types';
import { authzVersion, invalidateAuthzVersion, withAuthzVersion } from '@/lib/services/authz-version';
import { findDirectoryEmployee, findLiveEmployeeById, tgIdFromEmail } from '@/lib/services/telegram-gate.service';
import { initConfig, type AppConfig } from '@mmbix/config';

// ─── Helpers ────────────────────────────────────────────

/**
 * Coerce SQLite integer booleans (1/0) to proper JSON booleans (true/false).
 * D1 returns integers for boolean columns; this normalizes them.
 */
function coercePermissionBooleans<T extends Record<string, unknown>>(record: T): T {
	const boolFields = ['can_read', 'can_write', 'can_create', 'can_delete', 'can_approve', 'can_submit', 'is_system', 'is_active'];
	for (const field of boolFields) {
		if (field in record) {
			(record as Record<string, unknown>)[field] =
				(record as Record<string, unknown>)[field] === 1 || (record as Record<string, unknown>)[field] === true;
		}
	}
	return record;
}

/** `_roles.app_access` is stored as a JSON TEXT array; null/absent ⇒ open to every app. */
function parseAppAccess(raw: unknown): string[] | null {
	if (raw == null || raw === '') return null;
	if (Array.isArray(raw)) return raw.map(String);
	try {
		const parsed = JSON.parse(raw as string);
		return Array.isArray(parsed) ? parsed.map(String) : null;
	} catch {
		return null;
	}
}

/** Normalize a raw `_roles` row: coerce boolean columns (app_access stays raw TEXT). */
function decorateRole(raw: RoleRecord): RoleRecord {
	return coercePermissionBooleans(raw as unknown as Record<string, unknown>) as unknown as RoleRecord;
}

// ─── Types ─────────────────────────────────────────────

export interface CreateUserInput {
	email: string;
	password: string;
	full_name: string;
	role_id?: string;
	/** The employee this account signs in as (see `UpdateUserInput.employee_id`). */
	employee_id?: string | null;
}

export interface UpdateUserInput {
	email?: string;
	password?: string;
	full_name?: string;
	role_id?: string;
	status?: 'active' | 'disabled';
	/**
	 * The `hrm_employees` row a PASSWORD session acts as — the link that lets a
	 * web sign-in punch, file leave, or move stock. Unlike `role_id`, this one is
	 * nullable AND un-settable: `null`/`''` clears the link, `undefined` leaves it
	 * alone. That asymmetry is deliberate — an account with no employee is a
	 * legitimate state (the bootstrap admin), and "unlink" is the fix for a
	 * binding made to the wrong person.
	 */
	employee_id?: string | null;
}

export interface CreateRoleInput {
	name: string;
	description?: string;
	/** Optional mini-app launcher ids this role may open (Design-B app access). */
	app_access?: string[];
}

export interface SetPermissionInput {
	role_id: string;
	collection_slug: string;
	/** Internal — present when updating an existing permission row. */
	existing_id?: string;
	can_read?: boolean;
	can_write?: boolean;
	can_create?: boolean;
	can_delete?: boolean;
	can_approve?: boolean;
	can_submit?: boolean;
	field_restrictions?: string;
	row_filters?: string;
}

// ─── Auth Service ─────────────────────────────────────

export class AuthService {
	private db: D1Client;
	private users: Repository<UserRecord>;
	private roles: Repository<RoleRecord>;
	private permissions: Repository<RolePermissionRecord>;

	constructor(db: D1Client) {
		this.db = db;
		this.users = new Repository<UserRecord>(db, '_users');
		this.roles = new Repository<RoleRecord>(db, '_roles');
		this.permissions = new Repository<RolePermissionRecord>(db, '_role_permissions');
	}

	/** Validate that a secret is properly configured — throws if weak default */
	static validateSecret(secret: string): void {
		if (!secret || secret === 'admin' || secret === 'default-secret') {
			throw new InternalError('ADMIN_PASSWORD environment variable must be configured (not default) for security');
		}
	}

	/**
	 * Resolve the JWT signing secret from env.
	 *
	 * 🔒 Production requires an explicit JWT_SECRET. The ADMIN_PASSWORD fallback
	 * is dev-only: falling back in production would let anyone holding the admin
	 * password forge tokens (same credential tier), and rotating the password
	 * would invalidate every active session. In dev (IS_DEV=true) the fallback is
	 * kept for local tooling and the test harness.
	 */
	static resolveJwtSecret(env: { JWT_SECRET?: string; ADMIN_PASSWORD?: string; IS_DEV?: string }): string {
		const secret = env.JWT_SECRET || env.ADMIN_PASSWORD;
		if (!secret) {
			throw new InternalError('JWT_SECRET (or ADMIN_PASSWORD in dev) environment variable required');
		}
		if ((env.IS_DEV as string) !== 'true' && !env.JWT_SECRET) {
			throw new InternalError('JWT_SECRET must be configured in production — the ADMIN_PASSWORD fallback is disabled outside dev mode');
		}
		return secret;
	}

	// ── Password Hashing (PBKDF2) ────────────────────

	// 600k iterations (OWASP 2023+ guidance) by default. The format embeds the
	// iteration count (salt:iterations:hex), so existing hashes keep verifying
	// with their STORED count whatever the current cost; only NEW hashes use the
	// configured value. Workers charges CPU per request, so deployments on a
	// tight CPU budget may tune it down via configure() (PBKDF2_ITERATIONS env —
	// see index.ts). Telemetry/logins on the Workers runtime make 600k a
	// deliberate trade-off: strong, but ~50-200ms CPU per derivation.
	private static pbkdf2Iterations = 600_000;

	/** Boot-time tuning — idempotent, safe to re-apply per request; one value per
	 *  isolate. Mirrors env PBKDF2_ITERATIONS (see index.ts config middleware). */
	static configure(options: { pbkdf2Iterations?: number }): void {
		const n = options.pbkdf2Iterations;
		if (typeof n === 'number' && Number.isInteger(n) && n >= 10_000 && n <= 10_000_000) {
			AuthService.pbkdf2Iterations = n;
		}
	}

	/**
	 * Hash a password using PBKDF2-SHA256.
	 * Format: salt:iterations:hash_hex
	 * PBKDF2 provides key stretching — much harder to brute-force than simple SHA-256.
	 */
	async hashPassword(password: string, secret: string): Promise<string> {
		const salt = crypto.randomUUID();
		const encoder = new TextEncoder();

		// Import the password + secret as key material
		const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(`${password}:${secret}`), 'PBKDF2', false, ['deriveBits']);

		// Derive bits using PBKDF2
		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: encoder.encode(salt),
				iterations: AuthService.pbkdf2Iterations,
				hash: 'SHA-256',
			},
			keyMaterial,
			256, // 256 bits = 32 bytes
		);

		const hex = Array.from(new Uint8Array(derivedBits))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		return `${salt}:${AuthService.pbkdf2Iterations}:${hex}`;
	}

	async verifyPassword(password: string, storedHash: string, secret: string): Promise<boolean> {
		const parts = storedHash.split(':');

		// Handle legacy SHA-256 hashes (2 parts: salt:hex)
		if (parts.length === 2) {
			const [salt] = parts;
			const encoder = new TextEncoder();
			const data = encoder.encode(`${salt}:${password}:${secret}`);
			const computed = await crypto.subtle.digest('SHA-256', data);
			const hex = Array.from(new Uint8Array(computed))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
			return `${salt}:${hex}` === storedHash;
		}

		// PBKDF2 hash (3 parts: salt:iterations:hex)
		const [salt, iterationsStr, expectedHex] = parts;
		if (!salt || !iterationsStr || !expectedHex) return false;

		const iterations = parseInt(iterationsStr);
		if (isNaN(iterations)) return false;

		const encoder = new TextEncoder();
		const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(`${password}:${secret}`), 'PBKDF2', false, ['deriveBits']);

		const derivedBits = await crypto.subtle.deriveBits(
			{
				name: 'PBKDF2',
				salt: encoder.encode(salt),
				iterations,
				hash: 'SHA-256',
			},
			keyMaterial,
			256,
		);

		const computedHex = Array.from(new Uint8Array(derivedBits))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return computedHex === expectedHex;
	}

	// ── Token Generation ──────────────────────────────

	async generateToken(userId: string, jwtSecret: string, employeeId?: string | null): Promise<string> {
		const payload = JSON.stringify({
			jti: crypto.randomUUID(),
			user_id: userId,
			// The acting employee (directory row) — signed into the token so every
			// downstream audit actor is bound to the session, not a client field.
			...(employeeId ? { employee_id: employeeId } : {}),
			iat: Date.now(),
			exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
		});
		const encoder = new TextEncoder();
		const signature = await crypto.subtle.sign(
			{ name: 'HMAC', hash: 'SHA-256' },
			await crypto.subtle.importKey('raw', encoder.encode(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
			encoder.encode(payload),
		);
		const sigHex = Array.from(new Uint8Array(signature))
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');
		return btoa(`${payload}.${sigHex}`);
	}

	async verifyToken(token: string, jwtSecret: string, skipWeakCheck?: boolean, env?: unknown): Promise<AuthContext | null> {
		if (!skipWeakCheck) AuthService.validateSecret(jwtSecret);
		try {
			const decoded = atob(token);
			const lastDot = decoded.lastIndexOf('.');
			if (lastDot === -1) return null;
			const payload = decoded.slice(0, lastDot);
			const sigHex = decoded.slice(lastDot + 1);

			// VERIFY HMAC signature
			const encoder = new TextEncoder();
			const key = await crypto.subtle.importKey('raw', encoder.encode(jwtSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
			const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
			const valid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(payload));
			if (!valid) return null;

			const parsed = JSON.parse(payload);
			if (Date.now() > parsed.exp) return null; // Expired

			// ONE version stamp per request — both lookups below key off it, so an
			// authz write in ANY isolate retires these entries on the next read
			// (see `authz-version.ts`). The stamp itself is cached ~1s.
			const version = await authzVersion(this.db);
			// Get user from DB (cached — the limiter's tier resolution and requireAuth
			// both verify the SAME token per request; without a cache that is 2
			// uncached `_users` reads per authenticated request).
			const user = await this._getCachedUser(parsed.user_id, version);
			if (!user || user.status !== 'active') return null;

			// Check if user is admin — role lookup cached, version-keyed like the user.
			const role = await this._getCachedRole(user.role_id, version);
			const isAdmin = role?.name === 'Administrator' || role?.is_system === true;

			return this._healActingEmployee(
				{
					user_id: user.id,
					role_id: user.role_id,
					role_name: role?.name || '',
					email: user.email,
					is_admin: isAdmin,
					employee_id: typeof parsed.employee_id === 'string' ? parsed.employee_id : null,
					// Derived from the email, not a token claim — the same rule the
					// directory gate uses, so a Telegram session's personal inbox can be
					// row-filtered to its own `tg_id`.
					tg_id: tgIdFromEmail(user.email),
				},
				user,
				env,
			);
		} catch {
			return null;
		}
	}

	/**
	 * Re-validate the acting employee against the LIVE directory — every authorized
	 * request pays at most ONE indexed point read so a session can never act under
	 * a dead identity. The JWT carries the directory id it was minted with; when the
	 * directory link was re-pointed (an employee was deleted/re-created, or the
	 * link moved rows — the migrated-directory case), the OLD token still binds
	 * its writes/stamps to the row the engine filters out: the affected screen
	 * then never sees its own work ("punch failed / the card stays --:--").
	 *
	 * - admin sessions keep their caller's override (admins may act for others).
	 * - a TELEGRAM session (`tg-<id>@telegram.local`) resolves through the
	 *   directory by that id: a live row passes through unchanged, a dead one is
	 *   HEALED in place to the row the directory now names, so a re-pointed
	 *   directory re-binds the employee instead of logging them out.
	 * - a PASSWORD session resolves through the account's OWN link
	 *   (`_users.employee_id`) — the durable binding, and the strongest of the two:
	 *   a live row passes through (or heals the token to it), while a link whose
	 *   employee is gone returns `null`, which REVOKES the session at its next
	 *   request. Offboarding has to kill a web session, and this is the only place
	 *   that can be enforced for every route at once.
	 * - a session with NO link at all (bootstrap admin, machine key, row-scope
	 *   probe) may embed an employee id the directory does not own — an external id
	 *   or a scope marker. Those pass through untouched; re-resolving them would
	 *   break a contract this method does not own.
	 */
	private async _healActingEmployee(ctx: AuthContext, user: UserRecord, env?: unknown): Promise<AuthContext | null> {
		if (ctx.is_admin) return ctx;
		const tgId = tgIdFromEmail(ctx.email);
		if (tgId) {
			if (!ctx.employee_id) return ctx;
			const live = await findLiveEmployeeById(this.db, ctx.employee_id);
			if (live?.id) return ctx;
			try {
				const cfg: AppConfig = initConfig((env ?? {}) as Record<string, unknown>);
				const healed = await findDirectoryEmployee(this.db, tgId, cfg);
				return { ...ctx, employee_id: healed?.id ?? null };
			} catch {
				// A broken config must not 401 an existing directory session — the
				// identity just stays unpinned for this request (writes that require an
				// employee then answer their own clear error).
				return { ...ctx, employee_id: null };
			}
		}
		// Password / external-provider session — the account's link is the authority.
		const linked = user.employee_id ?? null;
		if (!linked) return ctx;
		const live = await findLiveEmployeeById(this.db, linked);
		return live?.id ? { ...ctx, employee_id: live.id } : null;
	}

	/** Role lookup, keyed by the authz version so any role write retires it. */
	private async _getCachedRole(roleId: string, version: string): Promise<RoleRecord | null> {
		if (!roleId) return null;
		const cacheKey = withAuthzVersion(`role:${roleId}`, version);
		const cached = cache.get<RoleRecord | null>(cacheKey);
		if (cached !== undefined) return cached;
		const role = await this.roles.findOne({ id: roleId });
		cache.set(cacheKey, role, 60_000);
		return role;
	}

	/** User lookup, keyed by the authz version so a status/role change retires it in
	 *  EVERY isolate (not just the one that handled the write). (The record holds
	 *  password_hash — it stays in the same isolate memory it was already queried
	 *  into, never returned or logged.) */
	private async _getCachedUser(userId: string, version: string): Promise<UserRecord | null> {
		if (!userId) return null;
		const cacheKey = withAuthzVersion(`user:${userId}`, version);
		const cached = cache.get<UserRecord | null>(cacheKey);
		if (cached !== undefined) return cached;
		const user = await this.users.findOne({ id: userId });
		cache.set(cacheKey, user, 60_000);
		return user;
	}

	// ── Sanitization ───────────────────────────────────

	/** Safe user fields that may be exposed in API responses */
	private static readonly SAFE_USER_FIELDS: (keyof UserRecord)[] = [
		'id',
		'email',
		'full_name',
		'role_id',
		'status',
		'employee_id',
		'last_login',
		'created_at',
	];

	/** Strip sensitive fields (password_hash) from a user record before returning to caller */
	private static _sanitizeUser(user: UserRecord): Omit<UserRecord, 'password_hash'> {
		const safe: Record<string, unknown> = {};
		for (const field of AuthService.SAFE_USER_FIELDS) {
			if (field in user) safe[field] = user[field];
		}
		return safe as unknown as Omit<UserRecord, 'password_hash'>;
	}

	/**
	 * Refuse an employee link that could never sign in.
	 *
	 * The login gate resolves the link against the LIVE directory, so binding an
	 * account to a missing or soft-deleted row silently produces an account whose
	 * correct password always answers "Invalid email or password" — a support
	 * ticket with no visible cause. Better to refuse the write and say why.
	 */
	private async _assertLinkableEmployee(employeeId: string): Promise<string> {
		const live = await findLiveEmployeeById(this.db, employeeId);
		if (!live) throw new ValidationError('That employee does not exist (or is no longer active)');
		return live.id;
	}

	// ── User Management ───────────────────────────────

	async createUser(input: CreateUserInput, secret: string): Promise<UserRecord> {
		assertValid(validators.email(input.email, 'email'));
		if (!input.password || input.password.length < 6) {
			throw new ValidationError('Password must be at least 6 characters');
		}

		// Validate required fields
		if (!input.full_name || typeof input.full_name !== 'string' || input.full_name.trim().length === 0) {
			throw new ValidationError('full_name is required');
		}
		if (!input.email || typeof input.email !== 'string' || input.email.trim().length === 0) {
			throw new ValidationError('email is required');
		}
		if (!input.password || typeof input.password !== 'string' || input.password.length < 6) {
			throw new ValidationError('password is required (min 6 characters)');
		}

		// Check for duplicate email
		const existing = await this.users.findOne({ email: input.email });
		if (existing) {
			throw new ConflictError(`User with email "${input.email}" already exists`);
		}

		const user = await this.users.create({
			email: input.email.toLowerCase(),
			password_hash: await this.hashPassword(input.password, secret),
			full_name: input.full_name,
			role_id: input.role_id || null,
			status: 'active',
			employee_id: input.employee_id ? await this._assertLinkableEmployee(input.employee_id) : null,
		} as Partial<UserRecord>);

		// A new user row shifts the authz stamp — refresh this isolate's view now.
		invalidateAuthzVersion();
		// Never return password_hash to the caller
		return AuthService._sanitizeUser(user) as unknown as UserRecord;
	}

	async getUser(id: string): Promise<UserRecord> {
		return this.users.findById(id, ['id', 'email', 'full_name', 'role_id', 'status', 'employee_id', 'last_login', 'created_at']);
	}

	/** Find a user by email (v0.7: external auth integration) */
	async findUserByEmail(email: string): Promise<UserRecord | null> {
		return this.users.findOne({ email: email.toLowerCase() });
	}

	async listUsers(): Promise<UserRecord[]> {
		return this.users
			.findMany({
				fields: ['id', 'email', 'full_name', 'role_id', 'status', 'employee_id', 'last_login', 'created_at'],
				orderBy: { created_at: 'desc' },
			})
			.then((r) => r.data);
	}

	async updateUser(id: string, input: UpdateUserInput, secret: string): Promise<Partial<UserRecord>> {
		// If role is changing, invalidate both old and new role caches
		if (input.role_id) {
			const oldUser = await this.users.findOne({ id }, ['role_id']);
			if (oldUser?.role_id) {
				const { PermissionEvaluator } = await import('@/lib/services/permission-evaluator');
				PermissionEvaluator.invalidateBusinessCache(oldUser.role_id);
			}
		}
		const update: Record<string, unknown> = {};
		if (input.email) {
			// Check for duplicate email (excluding current user)
			const existing = await this.users.findOne({ email: input.email.toLowerCase() }, ['id']);
			if (existing && existing.id !== id) {
				throw new ConflictError(`Email "${input.email}" is already in use`);
			}
			update.email = input.email.toLowerCase();
		}
		if (input.full_name) update.full_name = input.full_name;
		if (input.password) update.password_hash = await this.hashPassword(input.password, secret);
		if (input.role_id) update.role_id = input.role_id;
		if (input.status) update.status = input.status;
		// Null-aware, unlike the fields above: `undefined` means "leave it", while an
		// explicit `null`/`''` UNLINKS. A truthiness test here would make an
		// account's employee binding impossible to remove once made — the wrong
		// binding would be permanent and every web sign-in would act as the wrong
		// person.
		if (input.employee_id !== undefined) {
			const raw = typeof input.employee_id === 'string' ? input.employee_id.trim() : '';
			update.employee_id = raw ? await this._assertLinkableEmployee(raw) : null;
		}
		await this.users.update(id, update as Partial<UserRecord>);
		// A cached auth snapshot (status/role/email) must not outlive the change —
		// drop this user's entry so the next verifyToken reads fresh, and retire the
		// stamp so other isolates stop serving the old role too.
		cache.invalidatePattern(`user:${id}:*`);
		invalidateAuthzVersion();
		// Invalidate new role cache if role changed
		if (input.role_id) {
			const { PermissionEvaluator } = await import('@/lib/services/permission-evaluator');
			PermissionEvaluator.invalidateBusinessCache(input.role_id);
		}
		// Return safe fields only — never expose password_hash
		return this.getUser(id);
	}

	async login(email: string, password: string, passwordSecret: string, jwtSecret?: string): Promise<{ token: string; user: UserRecord }> {
		const user = await this.users.findOne({ email: email.toLowerCase() });
		// Same message for missing/disabled/wrong-password — no account-state enumeration.
		// A disabled account must not be minted a token at all: `verifyToken` already
		// rejects `status !== 'active'`, so signing one here handed the client a token
		// that died on its very next request (a silent bounce back to the login screen).
		if (!user || user.status !== 'active') throw new UnauthorizedError('Invalid email or password');

		const valid = await this.verifyPassword(password, user.password_hash, passwordSecret);
		if (!valid) throw new UnauthorizedError('Invalid email or password');

		// The account is directory-gated exactly like a Telegram session, so
		// offboarding revokes web access too: a password account may only sign in
		// while the employee it is LINKED to is still live in the directory
		// (not soft-deleted, not `active: false`). Without this, an employee's
		// access survived their termination — the one thing the Telegram `etg_id`
		// gate had always guaranteed and the web path silently did not.
		//
		// The message is specific here — unlike the generic "Invalid email or
		// password" above — because this branch is only reachable AFTER the password
		// verified, so it tells the account's own owner something actionable without
		// answering any question an attacker could ask about someone else's account.
		const linked = user.employee_id ?? null;
		if (linked && !(await findLiveEmployeeById(this.db, linked))) {
			throw new UnauthorizedError('Your account is no longer linked to an active employee — contact HR to restore access');
		}

		// Transparent upgrade: legacy unsalted SHA-256 hashes (salt:hex) are
		// re-hashed with PBKDF2 on first successful login so the weak scheme is
		// phased out.
		const isLegacyHash = user.password_hash.split(':').length === 2;
		if (isLegacyHash) {
			await this.users
				.update(user.id, { password_hash: await this.hashPassword(password, passwordSecret) } as Partial<UserRecord>)
				.catch(() => {});
		}

		// Touch last_login WITHOUT bumping updated_at: the authz version stamp derives
		// from MAX(updated_at) across the authz tables, and a login must not evict
		// every isolate's user/role/permission caches. Raw SQL keeps the change
		// invisible to the stamp.
		await this.db.run({
			sql: 'UPDATE _users SET last_login = ? WHERE id = ?',
			bindings: [new Date().toISOString(), user.id],
		});

		// 🔒 Never fall back to the password secret for signing — callers must
		// resolve JWT_SECRET explicitly (see AuthService.resolveJwtSecret).
		if (!jwtSecret) {
			throw new InternalError('JWT_SECRET (or ADMIN_PASSWORD in dev) environment variable required');
		}
		const token = await this.generateToken(user.id, jwtSecret, linked);
		// Never return password_hash to the caller
		return { token, user: AuthService._sanitizeUser(user) as unknown as UserRecord };
	}

	// ── Role Management ───────────────────────────────

	async createRole(input: CreateRoleInput): Promise<RoleRecord> {
		assertValid(validators.roleName(input.name, 'role name'));

		// Check for duplicate role name
		const existing = await this.roles.findOne({ name: input.name });
		if (existing) {
			throw new ConflictError('A role with this name already exists');
		}

		const created = (await this.roles.create({
			name: input.name,
			description: input.description || null,
			is_system: false,
			...(input.app_access ? { app_access: JSON.stringify(input.app_access) } : {}),
		} as Partial<RoleRecord>)) as unknown as RoleRecord;
		invalidateAuthzVersion();
		return decorateRole(created);
	}

	async listRoles(): Promise<RoleRecord[]> {
		const records = await this.roles.findAll({ orderBy: { created_at: 'asc' } });
		return records.map((r) => decorateRole(r as unknown as RoleRecord));
	}

	/** A single role (coerced booleans + parsed app_access), or null. */
	async getRole(roleId: string): Promise<RoleRecord | null> {
		const record = await this.roles.findOne({ id: roleId });
		if (!record) return null;
		return decorateRole(record as unknown as RoleRecord);
	}

	/** Update a role's display description (name stays immutable). */
	async updateRoleDescription(roleId: string, description: string): Promise<RoleRecord> {
		const record = await this.roles.update(roleId, { description: description || null } as Partial<RoleRecord>);
		cache.invalidatePattern(`role:${roleId}:*`);
		invalidateAuthzVersion();
		return decorateRole(record as unknown as RoleRecord);
	}

	// ── Permission Management ─────────────────────────

	async setPermission(input: SetPermissionInput): Promise<RolePermissionRecord> {
		// Look up existing permission ID so we can do an atomic upsert
		const existing = input.existing_id
			? await this.permissions.findOne({ id: input.existing_id }, ['id'])
			: await this.permissions.findOne({ role_id: input.role_id, collection_slug: input.collection_slug }, ['id']);

		const permId = existing?.id || crypto.randomUUID();

		// Delete existing first (if found), then create — race-safe via retry
		if (existing) {
			await this.permissions.delete(existing.id);
		}

		try {
			const record = await this.permissions.create({
				id: permId,
				role_id: input.role_id,
				collection_slug: input.collection_slug,
				can_read: input.can_read ?? true,
				can_write: input.can_write ?? false,
				can_create: input.can_create ?? false,
				can_delete: input.can_delete ?? false,
				can_approve: input.can_approve ?? false,
				can_submit: input.can_submit ?? false,
				field_restrictions: input.field_restrictions ?? null,
				row_filters: input.row_filters ?? null,
			} as Partial<RolePermissionRecord>);

			PermissionEvaluator.invalidateBusinessCache(input.role_id);
			invalidateAuthzVersion();
			return coercePermissionBooleans(record as unknown as Record<string, unknown>) as unknown as RolePermissionRecord;
		} catch (err) {
			// Race: another request deleted or changed the record between our
			// lookup and insert. Retry with a fresh lookup.
			const msg = err instanceof Error ? err.message : '';
			if (msg.includes('UNIQUE') || msg.includes('already exists')) {
				const fresh = await this.permissions.findOne({ role_id: input.role_id, collection_slug: input.collection_slug }, ['id']);
				if (fresh) await this.permissions.delete(fresh.id);
				const retryId = fresh?.id || crypto.randomUUID();
				const record = await this.permissions.create({
					id: retryId,
					role_id: input.role_id,
					collection_slug: input.collection_slug,
					can_read: input.can_read ?? true,
					can_write: input.can_write ?? false,
					can_create: input.can_create ?? false,
					can_delete: input.can_delete ?? false,
					can_approve: input.can_approve ?? false,
					can_submit: input.can_submit ?? false,
					field_restrictions: input.field_restrictions ?? null,
					row_filters: input.row_filters ?? null,
				} as Partial<RolePermissionRecord>);
				PermissionEvaluator.invalidateBusinessCache(input.role_id);
				invalidateAuthzVersion();
				return coercePermissionBooleans(record as unknown as Record<string, unknown>) as unknown as RolePermissionRecord;
			}
			throw err;
		}
	}

	async getPermissions(roleId: string): Promise<RolePermissionRecord[]> {
		const records = await this.permissions.findAll({ where: { role_id: roleId } });
		return records.map((r) => coercePermissionBooleans(r as unknown as Record<string, unknown>) as unknown as RolePermissionRecord);
	}

	/**
	 * The mini-app launcher ids this role may open (`_roles.app_access`, parsed
	 * from its JSON TEXT form). null ⇒ the role may open every app (uncurated).
	 */
	async roleAppAccess(roleId: string): Promise<string[] | null> {
		if (!roleId) return null;
		const role = await this.roles.findOne({ id: roleId });
		return parseAppAccess(role?.app_access ?? null);
	}

	/**
	 * A role's full `GET /auth/me` authorization payload — the collection slugs the
	 * role can READ (`granted_collections`) plus the mini-app launcher ids it may
	 * OPEN (`apps`). Both come from `_role_permissions` / `_roles.app_access`.
	 *
	 * NOT cached, on purpose. This feeds the mini-app's client-side app gate
	 * (`isAppAllowed`), where a stale answer is user-VISIBLE and reads as broken: an
	 * admin grants an app and reloads, and the tile/panel stays missing for a whole
	 * cache window. The `CacheLayer` is per-isolate and Workers reuse many isolates,
	 * so no write in one isolate can invalidate an entry in another — ANY TTL here
	 * lets a role/app change lag a reload by up to that TTL. The two reads below are
	 * indexed lookups that only change on rare admin actions, and `/auth/me` runs
	 * about once per app load, so always-fresh is cheap enough.
	 */
	async roleAuthSummary(roleId: string): Promise<{ granted: string[] | '*'; apps: string[] | null }> {
		const perms = await this.getPermissions(roleId);
		const granted = perms.filter((p) => p.can_read).map((p) => p.collection_slug) as string[] | '*';
		const apps = await this.roleAppAccess(roleId);
		return { granted, apps };
	}

	/** Persist a role's mini-app launcher allow-list (Design-B app access). */
	async setRoleAppAccess(roleId: string, apps: string[] | null): Promise<'ok'> {
		const existing = await this.roles.findOne({ id: roleId });
		if (!existing) throw new Error('Role not found');
		await this.roles.update(roleId, {
			app_access: apps && apps.length > 0 ? JSON.stringify(apps) : null,
		} as Partial<RoleRecord>);
		// Invalidate the cached role row so a changed launcher allow-list lands
		// immediately. `/auth/me`'s composed profile is NOT cached (see
		// `roleAuthSummary`), so it already reflects this write on the next load —
		// and the version bump retires every OTHER isolate's role entry too.
		cache.invalidatePattern(`role:${roleId}:*`);
		invalidateAuthzVersion();
		return 'ok';
	}

	/**
	 * Get the admin role ID (or create if missing).
	 */
	async getAdminRoleId(): Promise<string> {
		const existing = await this.roles.findOne({ name: 'Administrator' }, ['id']);
		if (existing) return existing.id;

		// Use createRole() for consistency — it provides input validation (role name format)
		// and uses the same public API path as other role creation.
		// We use a type assertion because createRole() returns RoleRecord with is_system: false
		// by default, but we need is_system: true for the admin bootstrap role.
		const created = await this.createRole({ name: 'Administrator', description: 'Full system access' });
		return created.id;
	}

	/**
	 * Ensure a default admin user exists.
	 * Uses ADMIN_USERNAME/ADMIN_PASSWORD/ADMIN_NAME env vars.
	 *
	 * Dev mode (IS_DEV=true): if the stored password hash does NOT match the
	 * current ADMIN_PASSWORD env value, re-hash and update — so local dev
	 * always stays in sync with .dev.vars even after D1 state persists.
	 * Production: never touches an existing admin (password only via secret).
	 */
	async ensureAdminUser(
		username: string,
		password: string,
		secret: string,
		isDev = false,
		fullName = 'Administrator',
	): Promise<UserRecord> {
		const email = (username || 'admin').toLowerCase();
		const existing = await this.users.findOne({ email });

		if (existing) {
			// Dev-only: re-sync password hash when env password changed
			if (isDev && password && existing.password_hash) {
				const matches = await this.verifyPassword(password, existing.password_hash, secret).catch(() => false);
				if (!matches) {
					await this.users.update(existing.id, {
						password_hash: await this.hashPassword(password, secret),
					} as Partial<UserRecord>);
				}
			}
			// Dev-only: keep the display name in sync with ADMIN_NAME
			if (isDev && fullName && existing.full_name !== fullName) {
				await this.users.update(existing.id, { full_name: fullName } as Partial<UserRecord>);
			}
			return AuthService._sanitizeUser(existing) as unknown as UserRecord;
		}

		const adminRoleId = await this.getAdminRoleId();
		const user = await this.users.create({
			email,
			password_hash: await this.hashPassword(password || 'admin', secret),
			full_name: fullName || 'Administrator',
			role_id: adminRoleId,
			status: 'active',
		} as Partial<UserRecord>);

		// Never return password_hash to the caller
		return AuthService._sanitizeUser(user) as unknown as UserRecord;
	}
}
