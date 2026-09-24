/**
 * Auth TypeScript Interfaces
 *
 * Authentication and authorization context types shared across API, UI, and plugins.
 */

export interface AuthContext {
	user_id: string;
	role_id: string;
	role_name: string;
	email: string;
	is_admin: boolean;
	/**
	 * The `hrm_employees` row this session acts as, when the identity is a
	 * directory-provisioned employee (Telegram login). Embedded in the signed JWT
	 * at login, so it is tamper-proof and costs no DB read to trust — this is what
	 * makes an audit actor (`by_user` / `approved_by` / `issued_by`) un-forgeable.
	 * Absent for admin / password / external-provider identities.
	 */
	employee_id?: string | null;
	/**
	 * The Telegram user id this session belongs to, DERIVED from the
	 * `tg-<id>@telegram.local` email on every request (never a token claim). It
	 * lets a row filter scope a personal inbox (`hr_notifications.tg_id`) to the
	 * signed session without exposing another employee's rows. Absent for
	 * password / admin / external identities.
	 */
	tg_id?: string | null;
}

// ─── v0.7: Auth Provider Pattern ────────────────────────

/**
 * Auth provider interface.
 * Each provider (JWT, Clerk, Auth0, Supabase, OIDC) verifies tokens
 * and returns a VerifiedUser. Headless acts as an OAuth **consumer**,
 * not an OAuth server — tokens are verified, not issued.
 */
export interface AuthProvider {
	/** Provider name for logs and selection */
	name: string;

	/** Verify a token and return verified user info, or null if invalid */
	verify(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null>;
}

/** User info returned by an auth provider after successful verification */
export interface VerifiedUser {
	/** External user ID from the provider */
	external_id: string;
	/** Email address */
	email: string;
	/** Display name */
	name?: string;
	/** True when the IdP asserts the email is verified (used to gate auto-provisioning). */
	emailVerified?: boolean;
	/** Provider-specific metadata */
	metadata?: Record<string, unknown>;
}
