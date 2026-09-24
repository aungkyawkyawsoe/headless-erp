/**
 * Shared Cloudflare credential resolver for the ops scripts
 * (`push-local-d1`, `d1-export-via-api`, `push-local-r2`, `sync-r2-to-local`).
 *
 * The scripts talk to `api.cloudflare.com` directly (no presigned URLs), so they
 * need a bearer token. They used to read `oauth_token` straight out of wrangler's
 * config file — which silently breaks the moment that token expires, because the
 * wrangler CLI refreshes its own copy in memory but the file keeps the stale one.
 * Every script then failed with an opaque `Authentication error` (code 10000).
 *
 * This module resolves a *live* token, in order:
 *   1. `CLOUDFLARE_API_TOKEN`        — CI / service tokens (never refreshed here).
 *   2. wrangler config `api_token`   — legacy v1 API token, if present.
 *   3. wrangler config `oauth_token` — reused while still unexpired.
 *   4. OAuth `refresh_token` grant   — otherwise refreshed, then persisted back
 *      to the config (atomic, 0600) so rotation is not lost and the next run
 *      reuses the fresh token.
 *
 * The refresh contract mirrors wrangler's own implementation
 * (`wrangler/wrangler-dist/cli.js`): form-encoded POST to
 * `https://dash.cloudflare.com/oauth2/token` with
 * `grant_type=refresh_token` + `client_id`, replying
 * `{ access_token, expires_in, refresh_token, scope }`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Public OAuth client id wrangler ships with (WRANGLER_CLIENT_ID overrides).
const CLIENT_ID = process.env.WRANGLER_CLIENT_ID || '54d11594-84e4-41aa-b438-e81b8fa78ee7';
const AUTH_DOMAIN = process.env.WRANGLER_AUTH_DOMAIN || 'dash.cloudflare.com';
const TOKEN_URL = process.env.WRANGLER_TOKEN_URL || `https://${AUTH_DOMAIN}/oauth2/token`;

// Refresh slightly before the real expiry so a long-running script cannot start
// with a token that dies mid-flight.
const EXPIRY_SKEW_MS = 60_000;

export function wranglerConfigPath() {
	const home = os.homedir();
	const candidates = [
		path.join(home, 'Library/Preferences/.wrangler/config/default.toml'),
		path.join(home, '.config/.wrangler/config/default.toml'),
	];
	return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/** Minimal reader for the four flat scalars wrangler keeps in its config TOML. */
function parseConfig(text) {
	const str = (key) => text.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm'))?.[1] ?? null;
	const scopesRaw = text.match(/^scopes\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
	const scopes = scopesRaw
		.split(',')
		.map((s) => s.trim().replace(/^"|"$/g, ''))
		.filter(Boolean);
	return {
		oauth_token: str('oauth_token'),
		api_token: str('api_token'),
		refresh_token: str('refresh_token'),
		expiration_time: str('expiration_time'),
		scopes,
	};
}

/** True when the stored access token is present and comfortably unexpired. */
function isFresh(cfg) {
	if (!cfg.oauth_token) return false;
	// No expiry recorded → treat as stale; the refresh is cheap and safe.
	if (!cfg.expiration_time) return false;
	const expiry = Date.parse(cfg.expiration_time);
	if (Number.isNaN(expiry)) return false;
	return expiry - EXPIRY_SKEW_MS > Date.now();
}

/** Replace-or-append the OAuth keys, leaving everything else in the file intact. */
function persistConfig(tomlPath, { oauth_token, refresh_token, expiration_time, scopes }) {
	let text = fs.readFileSync(tomlPath, 'utf8');
	const set = (key, line) => {
		const re = new RegExp(`^${key}\\s*=.*$`, 'm');
		text = re.test(text) ? text.replace(re, line) : `${text.replace(/\n*$/, '')}\n${line}\n`;
	};
	set('oauth_token', `oauth_token = "${oauth_token}"`);
	set('expiration_time', `expiration_time = "${expiration_time}"`);
	set('refresh_token', `refresh_token = "${refresh_token}"`);
	set('scopes', `scopes = [ ${scopes.map((s) => `"${s}"`).join(', ')} ]`);

	// Atomic + owner-only: never leave a half-written credential file behind.
	const tmp = `${tomlPath}.tmp-${process.pid}`;
	fs.writeFileSync(tmp, text, { mode: 0o600 });
	fs.renameSync(tmp, tomlPath);
}

async function refreshAccessToken(refreshToken) {
	const res = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'refresh_token',
			refresh_token: refreshToken,
			client_id: CLIENT_ID,
		}),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.access_token) {
		const detail = JSON.stringify(json?.error ?? json ?? {}).slice(0, 200);
		throw new Error(
			`Cloudflare OAuth refresh failed (HTTP ${res.status})${detail && detail !== '{}' ? `: ${detail}` : ''}. ` +
				'Run `npx wrangler login` (or set CLOUDFLARE_API_TOKEN) and retry.',
		);
	}
	return {
		oauth_token: json.access_token,
		refresh_token: json.refresh_token ?? refreshToken,
		expiration_time: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000).toISOString(),
		scopes: typeof json.scope === 'string' && json.scope ? json.scope.split(' ') : [],
	};
}

let cached = null;

/** Resolve a usable Cloudflare API token, refreshing the OAuth grant if needed. */
export async function loadCfToken() {
	if (cached) return cached;
	if (process.env.CLOUDFLARE_API_TOKEN) {
		cached = process.env.CLOUDFLARE_API_TOKEN;
		return cached;
	}
	const tomlPath = wranglerConfigPath();
	if (!tomlPath) {
		throw new Error('No CLOUDFLARE_API_TOKEN set and no wrangler config found — run `npx wrangler login` or export CLOUDFLARE_API_TOKEN.');
	}
	const cfg = parseConfig(fs.readFileSync(tomlPath, 'utf8'));
	if (cfg.api_token) {
		cached = cfg.api_token;
		return cached;
	}
	if (isFresh(cfg)) {
		cached = cfg.oauth_token;
		return cached;
	}
	if (!cfg.refresh_token) {
		throw new Error(
			'Cloudflare OAuth token is missing/expired and no refresh_token is stored — run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.',
		);
	}
	const refreshed = await refreshAccessToken(cfg.refresh_token);
	persistConfig(tomlPath, refreshed);
	cached = refreshed.oauth_token;
	return cached;
}

/**
 * Preload the token once so a script's existing synchronous `getToken()` call
 * sites keep working:
 *
 *   const TOKEN = await loadCfToken();
 *   function getToken() { return TOKEN; }
 */
/**
 * Force a fresh token, ignoring the cached/in-config value — for long-running
 * ops scripts that outlive a short-lived access token (a mid-run HTTP 401).
 * Mirrors the normal resolution but always goes through the refresh grant.
 */
export async function reloadCfToken() {
	cached = null;
	if (process.env.CLOUDFLARE_API_TOKEN) {
		cached = process.env.CLOUDFLARE_API_TOKEN;
		return cached;
	}
	const tomlPath = wranglerConfigPath();
	if (!tomlPath) throw new Error('No CLOUDFLARE_API_TOKEN set and no wrangler config found — run `npx wrangler login`.');
	const cfg = parseConfig(fs.readFileSync(tomlPath, 'utf8'));
	if (cfg.api_token) {
		cached = cfg.api_token;
		return cached;
	}
	if (!cfg.refresh_token) throw new Error('No refresh_token stored — run `npx wrangler login` or set CLOUDFLARE_API_TOKEN.');
	const refreshed = await refreshAccessToken(cfg.refresh_token);
	persistConfig(tomlPath, refreshed);
	cached = refreshed.oauth_token;
	return cached;
}

export default loadCfToken;
