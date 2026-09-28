/**
 * Mmbix client — the typed face of the headless entity engine.
 *
 * Pipeline (zero-waste by construction):
 *   1. Expired stored token → rotated through the stored refresh token when
 *      one exists, else cleared — never a doomed request + 401 + retry.
 *   2. Transient failures (408/429/502/503) → automatic retry with backoff.
 *   3. 401 on an authenticated call → refresh-token rotation once (or the
 *      `refreshSession()` hook when no refresh token is stored), then retry.
 *   4. Success envelope `{ success, data }` unwrapped; errors become typed
 *      `HttpError`/`NetworkError` instances.
 *
 * Runtime-agnostic: `fetch`-based, token storage injected (browser, worker,
 * node all work).
 */
import { isTokenExpired, memoryTokenStorage, tokenSubjectOf, type TokenStorage } from './auth';
import { ConditionalResponseCache } from './conditional-cache';
import { HttpError, NetworkError } from './errors';
import { createFilesApi, type FilesApi } from './files';
import { createItemsApi, type ItemsApi, uuid } from './items';
import { fingerprint, type OfflineQueue, type QueuedMutation } from './offline';
import { fieldsToArray, restrictFields } from './permissions';
import { DEFAULT_PAGE_SIZE_POLICY, MAX_QUERIES_PER_BATCH, normalizePageSize, type PageSizePolicy } from './query';

/** The auth endpoints themselves — never carry a stale bearer, an
 *  Idempotency-Key, offline queuing, or 401 self-heal recursion. */
const AUTH_PATHS = new Set(['/auth/telegram', '/auth/login', '/auth/refresh', '/auth/logout']);

/** Paths that carry their OWN credential: the auth endpoints plus the
 *  delegated media-upload redemption route — `/media/upload/<token>`, where
 *  the signed single-use token IS the credential. Shaped like `AUTH_PATHS` in
 *  every gate: no bearer, no pre-flight rotation, no 401 heal recursion. */
function isSelfAuthPath(path: string): boolean {
	return AUTH_PATHS.has(path) || path.startsWith('/media/upload/');
}

/** Hook/log-safe label — a delegated upload path EMBEDS its credential, so it
 *  must never reach listeners or logs (the same rule that redacts the
 *  `Authorization` header). */
function redactPath(path: string): string {
	return path.startsWith('/media/upload/') ? '/media/upload/<token>' : path;
}

const TRANSIENT_STATUS = new Set([408, 429, 502, 503]);

/** Log a warning for any request slower than this — with the browser's own
 *  breakdown so a slow call can be told apart from a slow NETWORK (server time =
 *  responseStart − requestStart; queue + connect = requestStart − startTime). */
const SLOW_REQUEST_WARN_MS = 1500;

/** The slice of the browser's Resource Timing we read — declared locally so this
 *  module needs no DOM lib (it also runs under Node in tests). */
type ResourceTiming = {
	startTime: number;
	requestStart: number;
	responseStart: number;
	responseEnd: number;
	transferSize?: number;
};

/** Emit a one-line breakdown of a slow request from the browser's Resource
 *  Timing, so "slow API" is attributed to the SERVER vs the NETWORK vs the
 *  download. Total = queue + net + request + response. */
function logSlowRequest(method: string, path: string, url: string, elapsedMs: number, startedAt: number): void {
	let detail = '';
	try {
		const perf = performance as unknown as { getEntriesByName?: (name: string, type: string) => ResourceTiming[] };
		const entries = perf.getEntriesByName?.(url, 'resource');
		const entry = entries?.[entries.length - 1];
		if (entry && entry.startTime >= startedAt - 5) {
			const server = Math.round(entry.responseStart - entry.requestStart);
			const net = Math.round(entry.requestStart - entry.startTime);
			const download = Math.round(entry.responseEnd - entry.responseStart);
			detail = ` (server ${server}ms · net ${net}ms · download ${download}ms · ${entry.transferSize ?? 0}B)`;
		}
	} catch {
		/* Resource Timing unavailable — the total is still worth logging. */
	}
	console.warn(`[api-slow] ${method} ${path} ${Math.round(elapsedMs)}ms${detail}`);
}
// Warn once per module load when queryMany truncates a batch to the server cap.
let queryManyWarned = false;

export interface SessionUser {
	id: string;
	email: string;
	full_name: string;
	/** Only present when the route includes it (the Telegram route adds it;
	 *  `/auth/login` does NOT — treat it as optional). */
	role_name?: string;
}

export type TelegramLoginResult =
	| { status: 'approved'; token: string; user: SessionUser }
	// `username` — the Telegram @handle, only when the user has one set (null otherwise).
	| { status: 'pending'; tg_id: string; full_name: string; username?: string | null };

export interface RequestOptions {
	method?: string;
	query?: URLSearchParams | Record<string, string | number | boolean | undefined>;
	body?: unknown;
	headers?: Record<string, string>;
	idempotencyKey?: string;
	ifMatch?: string;
	signal?: AbortSignal;
	/** Per-request timeout (ms) — overrides the client default. */
	timeoutMs?: number;
	/** Runtime response validation (typegen-generated Zod schema, e.g.). */
	validate?: { parse(data: unknown): unknown };
	/** Never enqueue this request for offline replay when it fails at the network
	 *  level — for read-encoded POSTs (e.g. `/reports/execute` GROUP-BY aggregates)
	 *  where a replayed run would re-execute expensive server work for zero benefit. */
	noQueue?: boolean;
}

/**
 * The engine's change envelope — the exact collections a write touched, including
 * server-side hook/cascade writes the client cannot see. Attached to a write
 * response's `meta.changed`; `rows` names the changed ids when the server knew
 * them (absent ⇒ invalidate the whole collection's reads).
 */
export interface ChangeEnvelope {
	collections: string[];
	rows: Record<string, string[]>;
}

export interface ClientOptions {
	/** API prefix — default `'/api'` (same-origin via Vite proxy / worker
	 *  service binding). Pass an absolute URL to talk to a remote instance. */
	baseUrl?: string;
	tokenStorage?: TokenStorage;
	fetchImpl?: typeof fetch;
	/** Fallback 401 heal when NO refresh token is stored: called once to mint a
	 *  fresh token; return null to surface the 401. With a refresh token the
	 *  client rotates it instead (`auth.refresh`). */
	refreshSession?: () => Promise<string | null>;
	/** Transient-failure retry. */
	retry?: { attempts?: number; delayMs?: number };
	/** Per-request timeout (ms). Default: 10s for auth calls, none otherwise. */
	timeoutMs?: number;
	/** Offline write queue — a write that fails at the network level is enqueued
	 *  for replay instead of surfacing as a plain network error. Reads and auth
	 *  calls never queue. FormData bodies (media uploads) never queue. */
	offlineQueue?: OfflineQueue;
	/** Fired after a successful non-auth write — the app invalidates caches and
	 *  broadcasts change events from here. */
	onWrite?: (path: string, method: string) => void;
	/** Fired when a response carries a change ENVELOPE (`meta.changed`) — the exact
	 *  collections the write touched (primary row + cascade parents + hook/denorm
	 *  writes the client cannot see). Invalidate precisely from here instead of
	 *  nuking a whole domain. */
	onChange?: (change: ChangeEnvelope, path: string, method: string) => void;
	/** Fired when a write was enqueued for offline replay. */
	onQueued?: (item: QueuedMutation) => void;
	/** Fired when a request failed with an HTTP/envelope error — drives the app's
	 *  global error toast channel (dedup happens in the listener). */
	onError?: (path: string, method: string, status: number, message: string) => void;
	/** Fired on every request outcome: ok=true when the server answered at all
	 *  (even 4xx/5xx — the API is reachable), ok=false on network-level failure.
	 *  Drives connectivity state; idempotent per request phase. */
	onSettled?: (path: string, method: string, ok: boolean) => void;
	/** Conditional GETs — replay the last `ETag` as `If-None-Match` so an unchanged
	 *  read costs a bodiless 304 instead of re-downloading it. Pass `false` to
	 *  disable, or a `ConditionalResponseCache` to share/tune one. Enabled by
	 *  default (memory-only; the response body is never persisted). */
	conditionalGet?: boolean | ConditionalResponseCache;
}

function toSearchParams(query: RequestOptions['query']): URLSearchParams {
	if (query instanceof URLSearchParams) return query;
	const params = new URLSearchParams();
	if (query) {
		for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
	}
	return params;
}

/**
 * The server's offline-read window for a response, or undefined when it did not
 * authorize persisting one (`X-Offline-Max-Age` absent) — the deny-by-default
 * case. Reading it per response is what keeps the allowlist in `schema_json`
 * instead of duplicated in the client.
 */
function offlineMaxAge(res: Response): number | undefined {
	const seconds = Number(res.headers.get('X-Offline-Max-Age') ?? '');
	return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** A Directus-style client feature: receives the client, returns the methods it
 *  adds (and may wire client state). Compose via `client.with(feature)`. */
export type ClientFeature<Schema extends Record<string, Record<string, unknown>>, T> = (client: MmbixClient<Schema>) => T;

export class MmbixClient<Schema extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>> {
	private _tokenStorage: TokenStorage;
	/** The active token storage. Swap it post-construction via `configureAuth`
	 *  (the Directus-style `.with(authenticate(...))` composable does exactly that). */
	get tokenStorage(): TokenStorage {
		return this._tokenStorage;
	}
	private readonly _baseUrl: string;
	/** The API base URL (e.g. `/api` or `https://api.example.com`). */
	get baseUrl(): string {
		return this._baseUrl;
	}
	private _refreshSession?: ClientOptions['refreshSession'];
	/** Single-flight refresh rotation — racing rotations would present the SAME
	 *  token twice, which the server treats as theft and answers by revoking the
	 *  whole descendant chain. Concurrent callers must share ONE rotation. */
	private _refreshInflight: Promise<boolean> | null = null;
	private readonly retry: { attempts: number; delayMs: number };
	private readonly timeoutMs?: number;
	private readonly offlineQueue?: OfflineQueue;
	private readonly onWrite?: ClientOptions['onWrite'];
	private readonly onChange?: ClientOptions['onChange'];
	private readonly onQueued?: ClientOptions['onQueued'];
	private readonly onError?: ClientOptions['onError'];
	private readonly onSettled?: ClientOptions['onSettled'];
	/** Conditional-GET store — last `{ etag, data, meta }` per request URL. */
	private readonly conditionalCache?: ConditionalResponseCache;
	/** Optional custom fetch — resolved LAZILY at request time so a fetch
	 *  polyfill/stub installed after client creation is honored. */
	private readonly fetchImpl?: typeof fetch;
	/** Per-collection field-restriction cache (60s, matches the permission TTL). */
	private readonly permCache = new Map<string, { at: number; restrictions: string[] | null }>();
	/** In-flight coalescing — several mounts (form + list + edit) asking for the
	 *  same collection share ONE /auth/me instead of firing duplicates. */
	private readonly permInflight = new Map<string, Promise<string[] | null>>();
	private static readonly PERM_TTL_MS = 60_000;

	/**
	 * Page-size policy — mirrors the BACKEND's contract (page-size.ts, exposed
	 * via GET /api/meta). Static defaults match the server; `loadLimits()`
	 * re-discovers it at runtime so a deployment with different limits is
	 * honored without a code change. The frontend can only ADJUST its page size
	 * within this policy — it can never exceed the server ceiling.
	 */
	private pageSizePolicy: PageSizePolicy = DEFAULT_PAGE_SIZE_POLICY;
	/** In-flight `loadLimits` — StrictMode/HMR double-mounts share ONE `/api/meta`. */
	private limitsInflight: Promise<PageSizePolicy> | null = null;
	/** The active page-size policy (defaults until loadLimits() runs). */
	get limits(): PageSizePolicy {
		return this.pageSizePolicy;
	}

	/** Auth sub-object — built in the constructor (see below). */
	auth!: {
		login(initData: string): Promise<TelegramLoginResult>;
		devLogin(user: { id: number; first_name: string }): Promise<TelegramLoginResult>;
		loginPassword(email: string, password: string, deviceId?: string): Promise<SessionUser>;
		/** Rotate the stored refresh token into a fresh JWT + successor token
		 *  (single-flight). True on success; false — never a throw — when the
		 *  rotation was refused (the local session is ended first) or the
		 *  network failed (the session is kept: a later try may succeed). */
		refresh(): Promise<boolean>;
		/** End the session. Local state (token, refresh token, device-persisted
		 *  reads) goes first, so logout is effective the moment it returns and
		 *  works offline; the server-side chain is revoked best-effort —
		 *  `all: true` kills every chain of the user, all devices included.
		 *  Never throws. */
		logout(options?: { all?: boolean }): Promise<void>;
		readonly token: string | null;
		getToken(): string | null;
		setToken(token: string): void;
	};

	/** Files (media) sub-object — built in the constructor (see below). */
	files!: FilesApi;

	constructor(options: ClientOptions = {}) {
		this._baseUrl = (options.baseUrl ?? '/api').replace(/\/+$/, '');
		this._tokenStorage = options.tokenStorage ?? memoryTokenStorage();
		this.fetchImpl = options.fetchImpl;
		this._refreshSession = options.refreshSession;
		this.retry = { attempts: options.retry?.attempts ?? 1, delayMs: options.retry?.delayMs ?? 250 };
		this.timeoutMs = options.timeoutMs;
		this.offlineQueue = options.offlineQueue;
		this.onWrite = options.onWrite;
		this.onChange = options.onChange;
		this.onQueued = options.onQueued;
		this.onError = options.onError;
		this.onSettled = options.onSettled;
		// On by default: revalidation is pure waste-cutting (headers instead of a
		// body) and is correct without any invalidation wiring — see the class docs.
		this.conditionalCache =
			options.conditionalGet === false
				? undefined
				: options.conditionalGet instanceof ConditionalResponseCache
					? options.conditionalGet
					: new ConditionalResponseCache();

		// Auth sub-object — built in the constructor so every method (including
		// the `token` getter) closes over the instance via `self`.
		const self = this;
		this.auth = {
			/** Telegram login — POST /auth/telegram with the raw initData. The server
			 *  answers HTTP 200 with `{ status: 'pending' }` (no token) until the user
			 *  is approved — never fabricate an error, let the caller branch on it. */
			login: async (initData: string): Promise<TelegramLoginResult> => {
				const res = await self.request<TelegramLoginResult>('/auth/telegram', {
					method: 'POST',
					body: { initData },
					timeoutMs: 10_000,
				});
				if (res.status === 'approved') {
					self.tokenStorage.set(res.token);
					// The Telegram route issues no refresh chain — a fresh sign-in must
					// never carry a previous one.
					self.tokenStorage.setRefresh?.(null);
				}
				return res;
			},

			/** Dev-only fallback login (IS_DEV worker). Never call in production. */
			devLogin: async (user: { id: number; first_name: string }): Promise<TelegramLoginResult> => {
				const res = await self.request<TelegramLoginResult>('/auth/telegram', {
					method: 'POST',
					body: { user },
					timeoutMs: 10_000,
				});
				if (res.status === 'approved') {
					self.tokenStorage.set(res.token);
					// Dev mirror of `login` — same session-replacement rule.
					self.tokenStorage.setRefresh?.(null);
				}
				return res;
			},

			/** Browser (non-Telegram) login — email + password. `deviceId` names
			 *  the device the refresh chain is bound to (server-side). */
			loginPassword: async (email: string, password: string, deviceId?: string): Promise<SessionUser> => {
				const res = await self.request<{ token: string; refresh_token?: string; user: SessionUser }>('/auth/login', {
					method: 'POST',
					body: deviceId ? { email, password, device_id: deviceId } : { email, password },
					timeoutMs: 10_000,
				});
				self.tokenStorage.set(res.token);
				// A sign-in replaces the WHOLE session: store the issued chain, or
				// clear the slot when none was issued — a stale chain must never
				// outlive the session that carried it.
				self.tokenStorage.setRefresh?.(typeof res.refresh_token === 'string' && res.refresh_token ? res.refresh_token : null);
				return res.user;
			},

			/** End the session. Local state goes FIRST — token, refresh token and
			 *  device-persisted reads (a body kept for offline use must not outlive
			 *  the session that was allowed to see it) — so logout is effective the
			 *  moment it returns and works offline. The server-side chain is then
			 *  revoked best-effort (`all: true` → every chain of the user, all
			 *  devices included). Never throws. */
			logout: async (options?: { all?: boolean }): Promise<void> => {
				const refresh = self.tokenStorage.getRefresh?.() ?? null;
				self._endSession();
				if (!refresh) return; // nothing to revoke server-side — no network call
				try {
					await self.request('/auth/logout', {
						method: 'POST',
						body: { refresh_token: refresh, all: options?.all === true },
						timeoutMs: 10_000,
					});
				} catch {
					/* best-effort — the local session is already gone */
				}
			},

			/** Rotate the stored refresh token (single-flight) — see the `auth` type
			 *  docs for the resolve semantics. */
			refresh: (): Promise<boolean> => self.rotateRefreshToken(),

			/** The currently stored (unexpired) token, if any. */
			get token(): string | null {
				const t = self._tokenStorage.get();
				return t && !isTokenExpired(t) ? t : null;
			},

			/** Directus-parity accessor — the stored (unexpired) token. */
			getToken: (): string | null => self.auth.token,
			/** Directus-parity accessor — write a token straight into storage. */
			setToken: (token: string): void => {
				self._tokenStorage.set(token);
			},
		};

		// Files sub-object — no state of its own; uploads ride the same request
		// pipeline (bearer, 401 heal, slow-call telemetry). The delegated
		// `uploadWithToken` route is self-authenticating — see `isSelfAuthPath`.
		this.files = createFilesApi(<T>(path: string, options?: RequestOptions) => this.request<T>(path, options));
	}

	// ── Refresh-token rotation ───────────────────────────────

	/** End the local session — token + refresh token + device-persisted reads.
	 *  The server-side chain is left to `auth.logout` (or to its own expiry). */
	private _endSession(): void {
		this._tokenStorage.clear();
		this.conditionalCache?.clear();
	}

	/** Rotate the stored refresh token into a fresh JWT + successor token.
	 *  SINGLE-FLIGHT: concurrent callers share one POST — a correctness
	 *  requirement, not an optimization, because the server reads a second use
	 *  of an already-rotated token as theft and revokes the descendant chain.
	 *  Resolves false (never throws) when no token is stored, the rotation was
	 *  refused (401 — the local session is ended first), or the network failed
	 *  (the session is KEPT: the token may still be valid on a later try). */
	private rotateRefreshToken(): Promise<boolean> {
		if (this._refreshInflight) return this._refreshInflight;
		const run = this._rotateRefreshTokenInner().finally(() => {
			this._refreshInflight = null;
		});
		this._refreshInflight = run;
		return run;
	}

	private async _rotateRefreshTokenInner(): Promise<boolean> {
		const storage = this._tokenStorage;
		const refresh = storage.getRefresh?.() ?? null;
		if (!refresh) return false;
		try {
			// `/auth/refresh` is an auth path: no bearer (it authenticates by the
			// token itself), no Idempotency-Key, no offline queue, no self-heal
			// recursion — and the pre-flight never rotates on it: this call IS
			// the rotation.
			const res = await this.request<{ token: string; refresh_token?: string }>('/auth/refresh', {
				method: 'POST',
				body: { refresh_token: refresh },
				timeoutMs: 10_000,
			});
			storage.set(res.token);
			storage.setRefresh?.(typeof res.refresh_token === 'string' && res.refresh_token ? res.refresh_token : null);
			return true;
		} catch (err) {
			// A 401 is the server's VERDICT (expired, revoked, reused, dead
			// account) — end the local session. Anything else (network, 5xx) is
			// not: keep the session, the token may still rotate later.
			if (err instanceof HttpError && err.status === 401) this._endSession();
			return false;
		}
	}

	// ── Typed CRUD ───────────────────────────────────────────

	/** Compose a feature onto this client — Directus-style `.with()`. Each
	 *  feature receives the client and returns the methods it adds; features may
	 *  also wire client state (e.g. `authenticate()` swaps the token storage).
	 *  Composition is order-independent and type-safe: the return type is the
	 *  client intersected with whatever the feature added. */
	with<T>(feature: ClientFeature<Schema, T>): MmbixClient<Schema> & T {
		return Object.assign(this, feature(this)) as MmbixClient<Schema> & T;
	}

	/** Re-wire auth after construction — used by `.with(authenticate(...))`. */
	configureAuth(options: { tokenStorage?: TokenStorage; refreshSession?: ClientOptions['refreshSession'] }): void {
		if (options.tokenStorage) this._tokenStorage = options.tokenStorage;
		if (options.refreshSession !== undefined) this._refreshSession = options.refreshSession;
	}

	items<K extends keyof Schema & string>(collection: K): ItemsApi<Schema[K]> {
		// Pass the policy as a GETTER so an ItemsApi created before loadLimits()
		// picks up the discovered policy instead of clamping against stale 25/100.
		return createItemsApi<Schema[K]>(
			collection,
			(path, opts) => this.requestMeta(path, opts ?? {}),
			() => this.pageSizePolicy,
		);
	}

	/**
	 * Discover the BACKEND's page-size contract (GET /api/meta) and adopt it.
	 * The server is the single source of truth for how many rows one call may
	 * return — a frontend can only adjust within it. Falls back to the SDK's
	 * built-in defaults (25/100) when the endpoint is unreachable or unparseable.
	 * Safe to call repeatedly (idempotent; cheap).
	 */
	async loadLimits(): Promise<PageSizePolicy> {
		// Concurrent callers (e.g. a StrictMode/HMR double-mount asking during boot)
		// collapse into ONE `/api/meta` request — see `fieldRestrictions`.
		if (this.limitsInflight) return this.limitsInflight;
		const run = (async () => {
			try {
				const data = await this.request<{
					pagination?: { default_page_size?: number; max_page_size?: number };
				}>('/meta');
				const d = Number(data?.pagination?.default_page_size);
				const m = Number(data?.pagination?.max_page_size);
				if (Number.isFinite(d) && Number.isFinite(m) && d >= 1 && m >= 1 && m >= d) {
					this.pageSizePolicy = { defaultPageSize: d, maxPageSize: m };
				}
			} catch {
				// Unreachable/malformed — keep the built-in defaults.
			}
			return this.pageSizePolicy;
		})().finally(() => {
			this.limitsInflight = null;
		});
		this.limitsInflight = run;
		return run;
	}

	/**
	 * The caller's field whitelist for a collection (GET /auth/me?collection=).
	 * null = unrestricted, [] = deny all, string[] = visible fields.
	 * Cached 60s per collection. The server STILL enforces the same rules on
	 * every response — this only lets the client avoid asking for hidden fields.
	 */
	async fieldRestrictions(collection: string): Promise<string[] | null> {
		const hit = this.permCache.get(collection);
		if (hit && Date.now() - hit.at < MmbixClient.PERM_TTL_MS) return hit.restrictions;
		// Concurrent callers (several mounts at once) collapse into one fetch.
		const existing = this.permInflight.get(collection);
		if (existing) return existing;
		const run = (async () => {
			const data = await this.request<{ field_restrictions?: string[] | null }>('/auth/me', { query: { collection } });
			const restrictions = Array.isArray(data?.field_restrictions) ? data.field_restrictions : null;
			this.permCache.set(collection, { at: Date.now(), restrictions });
			return restrictions;
		})().finally(() => {
			this.permInflight.delete(collection);
		});
		this.permInflight.set(collection, run);
		return run;
	}

	/**
	 * Prune a fields projection against the caller's whitelist (no-op without
	 * restrictions). Convenience for callers that fetch restrictions manually.
	 */
	async pruneFields<T extends Record<string, unknown>>(
		collection: string,
		fields: import('./query').ListQuery<T>['fields'],
	): Promise<import('./query').ListQuery<T>['fields']> {
		const allowed = await this.fieldRestrictions(collection);
		const restricted = restrictFields(fieldsToArray(fields), allowed);
		if (restricted === undefined) return fields;
		if (Array.isArray(fields)) return restricted;
		return restricted.join(',');
	}

	/**
	 * One-view-one-round-trip reads: POST /api/query executes keyed
	 * { collection, params } specs in PARALLEL server-side (same entity engine,
	 * per-collection RBAC + response cache) and returns one keyed payload.
	 * Per-key `ok:false` isolation means a failing source never kills the view.
	 */
	async queryMany(
		queries: Array<{
			key: string;
			collection: string;
			query?: URLSearchParams | Record<string, string | number | boolean | undefined>;
		}>,
	): Promise<{
		results: Array<{ key: string; ok: boolean; data?: unknown; meta?: Record<string, unknown>; error?: string }>;
	}> {
		// The server caps batches at MAX_QUERIES_PER_BATCH and SILENTLY truncates —
		// mirror that client-side so both agree (a view needs a handful of specs,
		// never more). Warn once about the truncation.
		if (queries.length > MAX_QUERIES_PER_BATCH) {
			queries = queries.slice(0, MAX_QUERIES_PER_BATCH);
			if (!queryManyWarned) {
				queryManyWarned = true;
				console.warn(`[mmbix-sdk] queryMany: batch truncated to ${MAX_QUERIES_PER_BATCH} specs (the server's cap)`);
			}
		}
		const specs = queries.map((q) => {
			const params: Record<string, string> = {};
			const qs = q.query instanceof URLSearchParams ? q.query : new URLSearchParams();
			if (q.query && !(q.query instanceof URLSearchParams)) {
				for (const [k, v] of Object.entries(q.query)) if (v !== undefined) qs.set(k, String(v));
			}
			for (const [k, v] of qs.entries()) params[k] = v;
			// Same page-size policy as items().list(): always send an explicit limit
			// (the policy default), clamped to the policy max (the server ceiling).
			params.limit = String(normalizePageSize(params.limit !== undefined ? Number(params.limit) : undefined, this.pageSizePolicy));
			return { key: q.key, collection: q.collection, params };
		});
		return this.request('/query', { method: 'POST', body: { queries: specs }, timeoutMs: 15_000 });
	}

	// ── Low-level request (raw paths, business endpoints) ─────

	async request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
		const { data } = await this.requestMeta(path, options);
		return data as T;
	}

	/** Like `request`, but also returns the envelope `meta` (pagination/count). */
	async requestMeta<T = unknown>(
		path: string,
		options: RequestOptions = {},
		attempt = 0,
		idemKey?: string,
		/** Internal — a 304 we cannot serve re-asks without the conditional header. */
		conditional = true,
	): Promise<{ data: T; meta?: Record<string, unknown> }> {
		const method = (options.method ?? 'GET').toUpperCase();
		const isAuthPath = isSelfAuthPath(path);
		/** Hook/log-facing label — never the raw path when it embeds a token. */
		const hookPath = redactPath(path);
		const query = toSearchParams(options.query);
		const qs = query.toString();
		const target = `${this.baseUrl}${path}${qs ? `?${qs}` : ''}`;

		const headers: Record<string, string> = { ...(options.headers ?? {}) };
		const body = options.body;
		// Auto Idempotency-Key: every mutating request (POST/PUT/DELETE/PATCH) gets a
		// stable key so network retries / offline replays can never duplicate server
		// side effects (the backend's Stripe-style middleware dedupes on the key).
		// Auth calls and FormData bodies (media uploads) are exempt.
		const isMutation = method !== 'GET' && method !== 'HEAD';
		const shouldKey = isMutation && !isAuthPath && !(body instanceof FormData);
		const effectiveIdemKey = idemKey ?? options.idempotencyKey ?? (shouldKey ? uuid() : undefined);
		if (body !== undefined && !(body instanceof FormData) && !headers['Content-Type']) {
			headers['Content-Type'] = 'application/json';
		}
		if (effectiveIdemKey) headers['Idempotency-Key'] = effectiveIdemKey;
		if (options.ifMatch) headers['If-Match'] = options.ifMatch;

		// Expired token → never pay the doomed request: rotate the stored refresh
		// token first when one exists, else drop the dead token (legacy). Auth
		// paths are exempt from BOTH — `/auth/refresh` and `/auth/logout` must
		// still read the refresh token, and `/auth/login` replaces the session.
		let stored = this.tokenStorage.get();
		let usable = stored && !isTokenExpired(stored) ? stored : null;
		if (stored && !usable && !isAuthPath) {
			if (this.tokenStorage.getRefresh?.() ?? null) {
				await this.rotateRefreshToken();
				stored = this.tokenStorage.get();
				usable = stored && !isTokenExpired(stored) ? stored : null;
			} else {
				this.tokenStorage.clear();
			}
		}
		if (usable && !isAuthPath) headers['Authorization'] = `Bearer ${usable}`;

		// Offline reads: adopt device-persisted bodies for THIS account before the
		// lookup, so a cold start with no server can still serve what it holds. The
		// fingerprint matches the offline queue's (the token's ACCOUNT subject, not
		// its bytes — a re-minted token is the same account), so both are scoped
		// per account.
		this.conditionalCache?.hydrate(usable ? fingerprint(tokenSubjectOf(usable)) : null);

		// Conditional GET — replay the tag stored alongside the last body for this
		// exact URL. HEAD has no body to fall back on, so it never participates.
		const isRead = method === 'GET';
		const cached =
			isRead && conditional && this.conditionalCache && !headers['If-None-Match'] ? this.conditionalCache.get(target) : undefined;
		if (cached) headers['If-None-Match'] = cached.etag;

		const init: RequestInit = { method, headers, signal: options.signal };
		const timeoutMs = options.timeoutMs ?? this.timeoutMs;
		if (!init.signal && timeoutMs && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
			init.signal = AbortSignal.timeout(timeoutMs);
		}
		if (body !== undefined) init.body = body instanceof FormData ? body : JSON.stringify(body);

		let res: Response;
		const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
		try {
			const fetchFn = this.fetchImpl ?? (globalThis as { fetch: typeof fetch }).fetch;
			res = await fetchFn(target, init);
		} catch (err) {
			// Network-level failure — report connectivity, then serve a persisted read
			// if the server blessed one (offline reads), else queue replayable writes.
			this.onSettled?.(hookPath, method, false);
			if (isRead && cached && this.conditionalCache?.isFresh(cached)) {
				return { data: cached.data as T, meta: cached.meta };
			}
			if (this.offlineQueue && !isAuthPath && !options.noQueue && method !== 'GET' && method !== 'HEAD' && !(body instanceof FormData)) {
				const item = this.offlineQueue.enqueue(method as 'POST' | 'PUT' | 'DELETE', path, body, options.ifMatch ?? null, effectiveIdemKey);
				this.onQueued?.(item);
			}
			throw new NetworkError(err);
		}
		// A resolved response proves the API answers — connectivity is up even if
		// the machine's internet link is down (localhost dev). Idempotent.
		this.onSettled?.(hookPath, method, true);

		// Slow-call telemetry: name the cost so a laggy screen is never a mystery.
		const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
		if (elapsedMs >= SLOW_REQUEST_WARN_MS) logSlowRequest(method, hookPath, target, elapsedMs, startedAt);

		// Transient failures — retry with backoff.
		if (TRANSIENT_STATUS.has(res.status) && attempt < this.retry.attempts) {
			const backoff = this.retry.delayMs * 2 ** attempt;
			await new Promise((r) => setTimeout(r, backoff));
			return this.requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
		}

		// 401 self-heal — one refresh attempt, then surface the error. The
		// rotating refresh token is the session's own mechanism and wins; the
		// `refreshSession` hook stays as the fallback for token-only storages.
		if (res.status === 401 && !isAuthPath && attempt === 0) {
			if (this.tokenStorage.getRefresh?.() ?? null) {
				if (await this.rotateRefreshToken()) {
					return this.requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
				}
			} else if (this._refreshSession) {
				this.tokenStorage.clear();
				const fresh = await this._refreshSession();
				if (fresh) {
					this.tokenStorage.set(fresh);
					return this.requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
				}
			}
		}

		// 304 — the server confirms the body we hold is still current. No bytes to
		// read and nothing to parse: hand back what the last 200 returned, and slide
		// the offline window (a 304 is a fresh confirmation of the representation, so
		// a regularly-revalidated read must not silently fall out of its window).
		if (res.status === 304) {
			if (cached) {
				const refreshed = { ...cached, storedAt: Date.now(), maxAgeS: offlineMaxAge(res) };
				this.conditionalCache?.set(target, refreshed);
				return { data: refreshed.data as T, meta: refreshed.meta };
			}
			// Nothing to serve it from (evicted, or a proxy 304 we never asked for) —
			// re-ask unconditionally instead of surfacing a bogus "not modified" error.
			if (attempt < this.retry.attempts) return this.requestMeta<T>(path, options, attempt + 1, effectiveIdemKey, false);
		}

		const json = (await res.json().catch(() => null)) as {
			success?: boolean;
			data?: unknown;
			meta?: Record<string, unknown>;
			error?: unknown;
		} | null;

		if (!res.ok) {
			const message = errorMessageFrom(json, res.statusText);
			this.onError?.(hookPath, method, res.status, message);
			throw HttpError.fromResponse(res, json);
		}
		if (!json || json.success === false) {
			const message = json
				? JSON.stringify(json.error ?? 'The API returned an invalid response envelope')
				: 'The API returned an invalid response envelope';
			this.onError?.(hookPath, method, res.status, message);
			throw new HttpError('The API returned an invalid response envelope', res.status, 'BAD_ENVELOPE', json);
		}

		const data = json.data;
		// A successful write changed server state — the app invalidates its caches
		// and broadcasts change events (list reads, attendance, DATA_CHANGED).
		if (!isAuthPath && method !== 'GET' && method !== 'HEAD') this.onWrite?.(hookPath, method);

		// The precise change set, when the server attached one — the write's response
		// names every collection it touched, so the app can invalidate exactly those.
		if (!isAuthPath) {
			const change = parseChangeEnvelope(json.meta);
			if (change) this.onChange?.(change, hookPath, method);
		}
		const result = options.validate && data !== undefined ? (options.validate.parse(data) as T) : (data as T);
		// Remember the tag WITH the body it described, so a later 304 is servable
		// without a payload. Storing it under the resolved URL keeps query variants
		// (filters, fields, page) apart, exactly like the server's own ETag.
		if (isRead && this.conditionalCache) {
			const etag = res.headers.get('ETag');
			// `X-Offline-Max-Age` is the collection's offline-reads policy: present ⇒
			// this body may be persisted for that long, absent ⇒ never (the default).
			if (etag)
				this.conditionalCache.set(target, { etag, data: result, meta: json.meta, storedAt: Date.now(), maxAgeS: offlineMaxAge(res) });
		}
		return { data: result, meta: json.meta };
	}
}

/** Parse the engine's change envelope from a response `meta` (undefined when absent or malformed). */
export function parseChangeEnvelope(meta: Record<string, unknown> | undefined): ChangeEnvelope | undefined {
	const raw = meta?.changed;
	if (!raw || typeof raw !== 'object') return undefined;
	const value = raw as { collections?: unknown; rows?: unknown };
	if (!Array.isArray(value.collections)) return undefined;
	const collections = value.collections.filter((entry): entry is string => typeof entry === 'string');
	if (collections.length === 0) return undefined;
	const rows: Record<string, string[]> = {};
	if (value.rows && typeof value.rows === 'object') {
		for (const [slug, ids] of Object.entries(value.rows as Record<string, unknown>)) {
			if (Array.isArray(ids)) rows[slug] = ids.filter((entry): entry is string => typeof entry === 'string');
		}
	}
	return { collections, rows };
}

/** Best-effort human message from an error envelope (for onError / toasts). */
function errorMessageFrom(json: { error?: unknown } | null, fallback: string): string {
	if (!json) return fallback;
	if (typeof json.error === 'string' && json.error) return json.error;
	if (json.error && typeof json.error === 'object') {
		const m = (json.error as { message?: unknown }).message;
		if (typeof m === 'string' && m) return m;
	}
	return fallback;
}

/**
 * Create a typed client. `Schema` is the typegen-generated collection map:
 *
 *   import { createClient } from '@mmbix/sdk';
 *   import type { Schema } from './generated/schema';
 *
 *   const client = createClient<Schema>({ baseUrl: '/api', tokenStorage: localStorageTokenStorage() });
 *   const rows = await client.items('records').list({ filter: { person_id: { _eq: personId } } });
 */
export function createClient<Schema extends Record<string, Record<string, unknown>> = Record<string, Record<string, unknown>>>(
	options: ClientOptions = {},
): MmbixClient<Schema> {
	return new MmbixClient<Schema>(options);
}
