/**
 * Directus-style composable features for @mmbix/sdk.
 *
 * The client is rest-native, so `rest()` is a thin (but honest) adapter that
 * exposes the request surface exactly like Directus' `rest()` composable — and
 * it documents the slot where future opt-in features (`realtime()`, …) plug in
 * without bloating the core client.
 *
 * ```ts
 * const client = createClient<Schema>({ baseUrl: 'https://api.example.com' })
 *   .with(rest())
 *   .with(authenticate({ tokenStorage, refreshSession }));
 *
 * await client.login(initData);          // from authenticate()
 * const token = client.getToken();        // from authenticate()
 * const rows = await client.items('articles').list({ limit: 10 }); // from rest()
 * ```
 *
 * Everything here is optional — `createClient(options)` alone stays the
 * minimal entry point (anonymous or with auth wired through options).
 */
import type { TokenStorage } from './auth';
import type { ClientFeature, MmbixClient } from './client';

/** rest() — the REST request surface (this SDK is rest-native; the client
 *  already has these methods, this composable binds them for Directus parity). */
export function rest<Schema extends Record<string, Record<string, unknown>>>(): ClientFeature<
	Schema,
	{
		request: MmbixClient<Schema>['request'];
		queryMany: MmbixClient<Schema>['queryMany'];
		items: MmbixClient<Schema>['items'];
	}
> {
	return (client) => ({
		request: client.request.bind(client),
		queryMany: client.queryMany.bind(client),
		items: client.items.bind(client),
	});
}

/** staticToken(token) — a fixed bearer token (service accounts, cron workers).
 *  Adds getToken()/setToken() exactly like Directus' composable of the same name. */
export function staticToken<Schema extends Record<string, Record<string, unknown>>>(
	token: string,
): ClientFeature<Schema, { getToken: () => string | null; setToken: (t: string) => void }> {
	return (client) => {
		client.tokenStorage.set(token);
		return {
			getToken: () => client.auth.token,
			setToken: (t: string) => client.tokenStorage.set(t),
		};
	};
}

/** authenticate(options) — full auth wiring: token storage + 401 self-heal via
 *  refreshSession. Adds login/logout/getToken/setToken (Directus parity). */
export function authenticate<Schema extends Record<string, Record<string, unknown>>>(options: {
	tokenStorage?: TokenStorage;
	refreshSession?: () => Promise<string | null>;
}): ClientFeature<
	Schema,
	{
		login: MmbixClient<Schema>['auth']['login'];
		loginPassword: MmbixClient<Schema>['auth']['loginPassword'];
		logout: MmbixClient<Schema>['auth']['logout'];
		getToken: () => string | null;
		setToken: (t: string) => void;
	}
> {
	return (client) => {
		client.configureAuth({
			// Only swap storage when one is explicitly provided — a client created
			// with tokenStorage keeps it when the feature only adds refreshSession.
			...(options.tokenStorage ? { tokenStorage: options.tokenStorage } : {}),
			refreshSession: options.refreshSession,
		});
		return {
			login: client.auth.login.bind(client.auth),
			loginPassword: client.auth.loginPassword.bind(client.auth),
			logout: client.auth.logout.bind(client.auth),
			getToken: () => client.auth.token,
			setToken: (t: string) => client.tokenStorage.set(t),
		};
	};
}
