/**
 * Auth Providers — "Bring Your Own Auth" Pattern
 *
 * Headless is an OAuth **consumer**, not an OAuth server.
 * Each provider verifies tokens; no dependency needed.
 *
 * Bundle: ~1KB, zero npm dependencies
 */

import type { AuthProvider, VerifiedUser } from '@mmbix/types';

// ─── Built-in JWT Provider ──────────────────────────────

export const jwtAuthProvider: AuthProvider = {
	name: 'jwt',
	async verify(_token: string, _env: Record<string, unknown>): Promise<VerifiedUser | null> {
		// JWT verification is handled separately by AuthService
		// This provider just signals that JWT mode is active
		return null; // Handled by existing JWT auth flow
	},
};

// ─── Clerk Provider (Edge-compatible, no SDK needed) ────

export const clerkAuthProvider: AuthProvider = {
	name: 'clerk',
	async verify(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null> {
		try {
			const secretKey = env.CLERK_SECRET_KEY as string;
			if (!secretKey) return null;

			// Verify Clerk session using their API
			const res = await fetch('https://api.clerk.com/v1/tokens/verify', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${secretKey}`,
				},
				body: JSON.stringify({ token }),
			});

			if (!res.ok) return null;

			const data = (await res.json()) as {
				status: string;
				user_id?: string;
				email_address?: string;
				first_name?: string;
				last_name?: string;
			};

			if (data.status !== 'verified' || !data.user_id) return null;

			return {
				external_id: data.user_id,
				email: data.email_address || '',
				name: [data.first_name, data.last_name].filter(Boolean).join(' ') || undefined,
				// Clerk verifies email ownership at signup for most configurations — read
				// the claim when the API exposes it (undefined = unknown, allowed with a
				// warning by the auto-provisioning gate).
				emailVerified: (data as { email_verified?: boolean }).email_verified === true,
			};
		} catch {
			return null;
		}
	},
};

// ─── Auth0 Provider ─────────────────────────────────────

export const auth0AuthProvider: AuthProvider = {
	name: 'auth0',
	async verify(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null> {
		try {
			const domain = env.AUTH0_DOMAIN as string;
			if (!domain) return null;

			// Fetch JWKS
			const jwksRes = await fetch(`https://${domain}/.well-known/jwks.json`);
			if (!jwksRes.ok) return null;
			const jwks = (await jwksRes.json()) as { keys: Array<{ kid: string; n: string; e: string }> };

			// Decode JWT header to get kid
			const headerB64 = token.split('.')[0];
			const header = JSON.parse(atob(headerB64)) as { kid: string; alg: string };
			const key = jwks.keys.find((k) => k.kid === header.kid);
			if (!key) return null;

			// Verify JWT using Web Crypto — alg pinned to RS256 (the only RSA alg
			// this verifier can actually validate) and `iss` is mandatory so a
			// token minted for a DIFFERENT Auth0 tenant/custom domain is rejected
			// even when its signature verifies against the same JWKS.
			const payload = await verifyJwtWithWebCrypto(token, key, 'RS256');
			if (!payload) return null;
			const expectedIss = `https://${domain}`;
			if (String(payload.iss || '').replace(/\/$/, '') !== expectedIss) return null;
			// Audience pinning when configured — a token for another application
			// (API audience) in the same tenant must not be accepted.
			const audience = env.AUTH0_AUDIENCE as string | undefined;
			if (audience) {
				const aud = payload.aud;
				const auds = Array.isArray(aud) ? aud.map(String) : [String(aud || '')];
				if (!auds.includes(audience)) return null;
			}

			return {
				external_id: String(payload.sub || ''),
				email: String(payload.email || ''),
				name: payload.name ? String(payload.name) : undefined,
				emailVerified: payload.email_verified === true,
			};
		} catch {
			return null;
		}
	},
};

// ─── Supabase Auth Provider ─────────────────────────────

export const supabaseAuthProvider: AuthProvider = {
	name: 'supabase',
	async verify(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null> {
		try {
			const jwtSecret = env.SUPABASE_JWT_SECRET as string;
			if (!jwtSecret) return null;

			const payload = await verifyJwtWithHMAC(token, jwtSecret, 'HS256');
			if (!payload) return null;
			// When the project URL is configured, pin iss/aud to Supabase's standard
			// claims so a token minted for a different Supabase project is rejected.
			const projectUrl = env.SUPABASE_URL as string | undefined;
			if (projectUrl) {
				const expectedIss = `${String(projectUrl).replace(/\/$/, '')}/auth/v1`;
				if (String(payload.iss || '').replace(/\/$/, '') !== expectedIss) return null;
				if (payload.aud !== 'authenticated') return null;
			}

			const meta = payload.user_metadata as Record<string, unknown> | undefined;
			return {
				external_id: String(payload.sub || ''),
				email: String(payload.email || ''),
				name: meta && meta.full_name ? String(meta.full_name) : undefined,
				emailVerified: payload.email_verified === true,
			};
		} catch {
			return null;
		}
	},
};

// ─── Generic OIDC Provider ──────────────────────────────

export const oidcAuthProvider: AuthProvider = {
	name: 'oidc',
	async verify(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null> {
		try {
			const issuer = env.OIDC_ISSUER as string;
			if (!issuer) return null;

			// Fetch OpenID configuration
			const configRes = await fetch(`${issuer}/.well-known/openid-configuration`);
			if (!configRes.ok) return null;
			const config = (await configRes.json()) as { jwks_uri: string };

			// Fetch JWKS
			const jwksRes = await fetch(config.jwks_uri);
			if (!jwksRes.ok) return null;
			const jwks = (await jwksRes.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string }> };

			// Decode JWT header
			const headerB64 = token.split('.')[0];
			const header = JSON.parse(atob(headerB64)) as { kid: string; alg: string };
			const key = jwks.keys.find((k) => k.kid === header.kid);
			if (!key) return null;

			const payload = await verifyJwtWithWebCrypto(token, key, 'RS256');
			if (!payload) return null;
			// OIDC spec: `iss` MUST match the configured issuer exactly (trailing
			// slash normalized). A token from a different issuer that happens to
			// verify (e.g. reusing the same JWKS) must be rejected.
			const expectedIss = String(issuer).replace(/\/$/, '');
			if (String(payload.iss || '').replace(/\/$/, '') !== expectedIss) return null;
			// Audience pinning when configured (OIDC_CLIENT_ID = the client this
			// API is registered as).
			const clientId = env.OIDC_CLIENT_ID as string | undefined;
			if (clientId) {
				const aud = payload.aud;
				const auds = Array.isArray(aud) ? aud.map(String) : [String(aud || '')];
				if (!auds.includes(clientId)) return null;
			}

			return {
				external_id: String(payload.sub || ''),
				email: String(payload.email || ''),
				name: payload.name ? String(payload.name) : payload.preferred_username ? String(payload.preferred_username) : undefined,
				emailVerified: payload.email_verified === true,
			};
		} catch {
			return null;
		}
	},
};

// ─── Provider Registry ──────────────────────────────────

const PROVIDERS: Map<string, AuthProvider> = new Map();

export function registerAuthProvider(provider: AuthProvider): void {
	PROVIDERS.set(provider.name, provider);
}

export function getAuthProvider(name: string): AuthProvider | undefined {
	return PROVIDERS.get(name);
}

export function getAllAuthProviders(): AuthProvider[] {
	return [...PROVIDERS.values()];
}

// Register built-in providers
registerAuthProvider(jwtAuthProvider);
registerAuthProvider(clerkAuthProvider);
registerAuthProvider(auth0AuthProvider);
registerAuthProvider(supabaseAuthProvider);
registerAuthProvider(oidcAuthProvider);

// ─── Auto-Detect & Verify ───────────────────────────────

/**
 * Auto-detect which provider a token belongs to.
 * Tries each registered provider until one succeeds.
 */
export async function autoVerifyToken(token: string, env: Record<string, unknown>): Promise<VerifiedUser | null> {
	for (const provider of PROVIDERS.values()) {
		if (provider.name === 'jwt') continue; // Skip JWT — handled separately
		try {
			const user = await provider.verify(token, env);
			if (user) return user;
		} catch {
			continue;
		}
	}
	return null;
}

// ─── Web Crypto JWT Helpers ─────────────────────────────

async function verifyJwtWithWebCrypto(
	token: string,
	jwk: { kid: string; n: string; e: string; kty?: string },
	alg: string,
): Promise<Record<string, unknown> | null> {
	try {
		const [headerB64, payloadB64, signatureB64] = token.split('.');
		if (!headerB64 || !payloadB64 || !signatureB64) return null;

		// Decode payload
		const payload = JSON.parse(atob(payloadB64)) as Record<string, unknown>;

		// Pin the algorithm — the verifier below only implements RSASSA-
		// PKCS1-v1_5/SHA-256, so any other declared alg is rejected rather than
		// silently coerced (alg-confusion hardening).
		const header = JSON.parse(atob(headerB64)) as { alg?: string };
		if (header.alg !== alg) return null;

		// Check expiration + not-before
		if (payload.exp && Date.now() > (payload.exp as number) * 1000) return null;
		if (payload.nbf && Date.now() < (payload.nbf as number) * 1000) return null;

		// Import public key
		const keyData: JsonWebKey = {
			kty: jwk.kty || 'RSA',
			n: jwk.n,
			e: jwk.e,
			alg: alg.startsWith('RS') ? `RSASSA-PKCS1-v1_5` : alg,
		};

		const key = await crypto.subtle.importKey('jwk', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, false, ['verify']);

		// Verify signature
		const sigBytes = base64UrlToBytes(signatureB64);
		const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

		const valid = await crypto.subtle.verify({ name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } }, key, sigBytes, dataBytes);

		return valid ? payload : null;
	} catch {
		return null;
	}
}

async function verifyJwtWithHMAC(token: string, secret: string, alg: string): Promise<Record<string, unknown> | null> {
	try {
		const [headerB64, payloadB64, signatureB64] = token.split('.');
		if (!headerB64 || !payloadB64 || !signatureB64) return null;

		const payload = JSON.parse(atob(payloadB64)) as Record<string, unknown>;

		// Pin the algorithm (see verifyJwtWithWebCrypto) — only HS256 is verifiable here.
		const header = JSON.parse(atob(headerB64)) as { alg?: string };
		if (header.alg !== alg) return null;

		// Check expiration + not-before
		if (payload.exp && Date.now() > (payload.exp as number) * 1000) return null;
		if (payload.nbf && Date.now() < (payload.nbf as number) * 1000) return null;

		const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: { name: 'SHA-256' } }, false, [
			'verify',
		]);

		const sigBytes = base64UrlToBytes(signatureB64);
		const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

		const valid = await crypto.subtle.verify({ name: 'HMAC', hash: { name: 'SHA-256' } }, key, sigBytes, dataBytes);

		return valid ? payload : null;
	} catch {
		return null;
	}
}

function base64UrlToBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
	const padLen = (4 - (base64.length % 4)) % 4;
	const padded = base64 + '='.repeat(padLen);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
