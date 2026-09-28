/// Headless ERP client — the typed face of the headless entity engine.
/// 1:1 Dart port of `packages/sdk/src/client.ts`.
///
/// Pipeline (zero-waste by construction):
///   1. Expired stored token → rotated through the stored refresh token when
///      one exists, else cleared — never a doomed request + 401 + retry.
///   2. Transient failures (408/429/502/503) → automatic retry with backoff.
///   3. 401 on an authenticated call → refresh-token rotation once (or the
///      `refreshSession()` hook when no refresh token is stored), then retry.
///   4. Success envelope `{ success, data }` unwrapped; errors become typed
///      [ErpHttpException]/[ErpNetworkException] instances.
///
/// Runtime-agnostic: the HTTP transport and token storage are injected.
library;

import 'dart:async';
import 'dart:convert';

import 'auth.dart';
import 'conditional_cache.dart';
import 'errors.dart';
import 'files.dart';
import 'items.dart';
import 'jwt.dart';
import 'log.dart';
import 'meta.dart';
import 'offline.dart';
import 'permissions.dart';
import 'query.dart';
import 'requester.dart';
import 'transport.dart';

/// The auth endpoints themselves — never carry a stale bearer, an idempotency
/// key, offline queuing, or 401 self-heal recursion. (The TS set also had
/// Telegram; a standalone app signs in by email/password only.)
const Set<String> _authPaths = {'/auth/login', '/auth/refresh', '/auth/logout'};
const Set<int> _transientStatus = {408, 429, 502, 503};

/// Paths that carry their OWN credential: the auth endpoints plus the
/// delegated media-upload redemption route — `/media/upload/<token>`, where
/// the signed single-use token IS the credential. Shaped like [_authPaths]
/// in every gate: no bearer, no pre-flight rotation, no 401 heal recursion.
bool _isSelfAuthPath(String path) =>
	_authPaths.contains(path) || path.startsWith('/media/upload/');

/// Hook/log-safe label — a delegated upload path EMBEDS its credential, so
/// it must never reach listeners or logs (the same rule that redacts the
/// `Authorization` header).
String _redactPath(String path) =>
	path.startsWith('/media/upload/') ? '/media/upload/<token>' : path;

/// Log a warning for any request slower than this — so a laggy screen is never
/// a mystery.
const int _slowRequestWarnMs = 1500;

/// Warn once per module load when queryMany truncates a batch to the server cap.
bool _queryManyWarned = false;

/// Per-collection field-restriction cache TTL (matches the permission TTL).
const int _permTtlMs = 60000;

/// Retry policy for transient failures — the TS `{ attempts = 1, delayMs = 250 }`.
class RetryPolicy {
	final int attempts;
	final int delayMs;

	const RetryPolicy({this.attempts = 1, this.delayMs = 250});
}

/// The engine's change envelope — the exact collections a write touched,
/// including server-side hook/cascade writes the client cannot see. Attached
/// to a write response's `meta.changed`; [rows] names the changed ids when the
/// server knew them (absent ⇒ invalidate the whole collection's reads).
class ChangeEnvelope {
	final List<String> collections;
	final Map<String, List<String>> rows;

	const ChangeEnvelope(this.collections, this.rows);
}

/// One keyed spec for [HeadlessErpClient.queryMany].
class QuerySpec {
	final String key;
	final String collection;
	final QueryParams? query;

	const QuerySpec({required this.key, required this.collection, this.query});
}

class HeadlessErpOptions {
	/// API prefix — default `'/api'`. Pass an absolute URL to talk to a remote
	/// instance.
	final String? baseUrl;

	final TokenStorage? tokenStorage;

	/// The HTTP transport (the `fetchImpl` seam). Defaults to a `dart:io`
	/// socket transport resolved LAZILY at request time.
	final HttpTransportFn? transport;

	/// Fallback 401 heal when NO refresh token is stored: called once to mint a
	/// fresh token; return null to surface the 401. With a refresh token the
	/// client rotates it instead (`auth.refresh`).
	final Future<String?> Function()? refreshSession;

	final RetryPolicy? retry;

	/// Per-request timeout (ms). Default: none (except login calls, 10s).
	final int? timeoutMs;

	/// Offline write queue — a write that fails at the network level is enqueued
	/// for replay instead of surfacing as a plain network error. Reads and auth
	/// calls never queue.
	final OfflineQueue? offlineQueue;

	/// Fired after a successful non-auth write — the app invalidates caches and
	/// broadcasts change events from here.
	final void Function(String path, String method)? onWrite;

	/// Fired when a response carries a change ENVELOPE (`meta.changed`) — the
	/// exact collections the write touched (primary row + cascade parents +
	/// hook/denorm writes the client cannot see). Invalidate precisely from
	/// here instead of nuking a whole domain.
	final void Function(ChangeEnvelope change, String path, String method)? onChange;

	/// Fired when a write was enqueued for offline replay.
	final void Function(QueuedMutation item)? onQueued;

	/// Fired when a request failed with an HTTP/envelope error — drives the
	/// app's global error toast channel (dedup happens in the listener).
	final void Function(String path, String method, int status, String message)? onError;

	/// Fired on every request outcome: ok=true when the server answered at all
	/// (even 4xx/5xx — the API is reachable), ok=false on network-level
	/// failure. Drives connectivity state; idempotent per request phase.
	final void Function(String path, String method, bool ok)? onSettled;

	/// Conditional GETs — replay the last `ETag` as `If-None-Match` so an
	/// unchanged read costs a bodiless 304 instead of re-downloading it. Pass
	/// `false` to disable, or a [ConditionalResponseCache] to share/tune one.
	/// Enabled by default (memory-only unless the cache has a storage).
	final Object? conditionalGet;

	const HeadlessErpOptions({
		this.baseUrl,
		this.tokenStorage,
		this.transport,
		this.refreshSession,
		this.retry,
		this.timeoutMs,
		this.offlineQueue,
		this.onWrite,
		this.onChange,
		this.onQueued,
		this.onError,
		this.onSettled,
		this.conditionalGet,
	});
}

/// The engine client.
class HeadlessErpClient {
	TokenStorage _tokenStorage;
	final String _baseUrl;
	Future<String?> Function()? _refreshSession;
	final RetryPolicy _retry;
	final int? _timeoutMs;
	final OfflineQueue? _offlineQueue;
	final void Function(String path, String method)? _onWrite;
	final void Function(ChangeEnvelope change, String path, String method)? _onChange;
	final void Function(QueuedMutation item)? _onQueued;
	final void Function(String path, String method, int status, String message)? _onError;
	final void Function(String path, String method, bool ok)? _onSettled;

	/// Additive change-envelope subscribers (see [addChangeListener]) — a
	/// second consumer never has to chain the single [HeadlessErpOptions.onChange] slot.
	final Set<void Function(ChangeEnvelope change, String path, String method)> _changeListeners = {};

	/// Conditional-GET store — last `{ etag, data, meta }` per request URL.
	final ConditionalResponseCache? _conditionalCache;

	/// Optional custom transport — resolved LAZILY at request time so a fake
	/// installed after client creation is honored.
	final HttpTransportFn? _transport;

	/// Per-collection field-restriction cache (60s, matches the permission TTL).
	final Map<String, ({int at, List<String>? restrictions})> _permCache = {};

	/// In-flight coalescing — several mounts (form + list + edit) asking for the
	/// same collection share ONE `/auth/me` instead of firing duplicates.
	final Map<String, Future<List<String>?>> _permInflight = {};

	/// Page-size policy — mirrors the BACKEND's contract (`page-size.ts`,
	/// exposed via `GET /api/meta`). Static defaults match the server;
	/// [loadLimits] re-discovers it at runtime so a deployment with different
	/// limits is honored without a code change.
	PageSizePolicy _pageSizePolicy = defaultPageSizePolicy;

	/// In-flight [loadLimits] — concurrent callers share ONE `/api/meta`.
	Future<PageSizePolicy>? _limitsInflight;

	/// The auth sub-object (`login`, `logout`, token accessors), built in the
	/// constructor.
	late final AuthApi auth;

	/// The files (media) sub-object (`upload` / `presign` / `uploadWithToken`),
	/// built in the constructor.
	late final FilesApi files;

	HeadlessErpClient([HeadlessErpOptions options = const HeadlessErpOptions()])
		: _baseUrl = (options.baseUrl ?? '/api').replaceAll(RegExp(r'/+$'), ''),
		  _tokenStorage = options.tokenStorage ?? MemoryTokenStorage(),
		  _transport = options.transport,
		  _retry = options.retry ?? const RetryPolicy(),
		  _timeoutMs = options.timeoutMs,
		  _offlineQueue = options.offlineQueue,
		  _onWrite = options.onWrite,
		  _onChange = options.onChange,
		  _onQueued = options.onQueued,
		  _onError = options.onError,
		  _onSettled = options.onSettled,
		  _refreshSession = options.refreshSession,
		  _conditionalCache = _cacheFrom(options.conditionalGet) {
		auth = AuthApi(
			storage: _tokenStorage,
			request: _bindRequest,
			onLogout: () => _conditionalCache?.clear(),
		);
		files = FilesApi(request: _bindRequest);
	}

	static ConditionalResponseCache? _cacheFrom(Object? setting) {
		// On by default: revalidation is pure waste-cutting (headers instead of a
		// body) and is correct without any invalidation wiring.
		if (setting == false) return null;
		if (setting is ConditionalResponseCache) return setting;
		return ConditionalResponseCache();
	}

	/// The active token storage.
	TokenStorage get tokenStorage => _tokenStorage;

	/// The API base URL (e.g. `/api` or `https://api.example.com`).
	String get baseUrl => _baseUrl;

	/// The active page-size policy (defaults until [loadLimits] runs).
	PageSizePolicy get limits => _pageSizePolicy;

	/// Re-wire auth after construction.
	void configureAuth({
		TokenStorage? tokenStorage,
		Future<String?> Function()? refreshSession,
	}) {
		if (tokenStorage != null) _tokenStorage = tokenStorage;
		if (refreshSession != null) _refreshSession = refreshSession;
	}

	/// Subscribe to change ENVELOPES in addition to [HeadlessErpOptions.onChange]
	/// — for a SECOND consumer (a state manager's cache invalidator, a sync
	/// banner) that must not fight the app for the single option slot. Returns
	/// an unsubscribe callback. Listeners are fault-isolated: one throwing
	/// listener never disturbs the others, nor the request that dispatched it.
	/// (Dart-only extension — the TS SDK carries just the option.)
	void Function() addChangeListener(
		void Function(ChangeEnvelope change, String path, String method) listener,
	) {
		_changeListeners.add(listener);
		return () => _changeListeners.remove(listener);
	}

	Future<RequestResult<T>> _bindRequest<T>(String path, [RequestOptions options = const RequestOptions()]) =>
		requestMeta<T>(path, options);

	/// Bound CRUD API for one collection. The page-size policy is passed as a
	/// GETTER so an [ItemsApi] created before `loadLimits()` picks up the
	/// discovered policy instead of clamping against stale defaults.
	ItemsApi items(String collection) =>
		ItemsApi(collection, _bindRequest, () => _pageSizePolicy);

	/// Discover the BACKEND's page-size contract (`GET /api/meta`) and adopt it.
	/// The server is the single source of truth for how many rows one call may
	/// return — a client can only adjust within it. Falls back to the built-in
	/// defaults when the endpoint is unreachable or unparseable. Safe to call
	/// repeatedly.
	Future<PageSizePolicy> loadLimits() {
		final existing = _limitsInflight;
		if (existing != null) return existing;
		final run = _loadLimitsInner().whenComplete(() {
			_limitsInflight = null;
		});
		_limitsInflight = run;
		return run;
	}

	Future<PageSizePolicy> _loadLimitsInner() async {
		try {
			final data = await request<Object?>('/meta');
			final policy = parseMeta(data).policy;
			if (policy != null) _pageSizePolicy = policy;
		} catch (_) {
			// Unreachable/malformed — keep the built-in defaults.
		}
		return _pageSizePolicy;
	}

	/// The deployment's error-code catalog (`GET /api/meta → error_codes`) — the
	/// CI contract test compares it against the compiled [errorCodes] list.
	Future<List<String>> fetchServerErrorCodes() async {
		final data = await request<Object?>('/meta');
		return parseMeta(data).errorCodes ?? const [];
	}

	/// The caller's field whitelist for a collection (`GET /auth/me?collection=`).
	/// null = unrestricted, [] = deny all, otherwise visible fields. Cached 60s
	/// per collection. The server STILL enforces the same rules on every
	/// response — this only lets the client avoid asking for hidden fields.
	Future<List<String>?> fieldRestrictions(String collection) {
		final hit = _permCache[collection];
		if (hit != null && DateTime.now().millisecondsSinceEpoch - hit.at < _permTtlMs) {
			return Future.value(hit.restrictions);
		}
		// Concurrent callers (several mounts at once) collapse into one fetch.
		final existing = _permInflight[collection];
		if (existing != null) return existing;
		final run = _fieldRestrictionsInner(collection).whenComplete(() {
			_permInflight.remove(collection);
		});
		_permInflight[collection] = run;
		return run;
	}

	Future<List<String>?> _fieldRestrictionsInner(String collection) async {
		final data = await request<Object?>(
			'/auth/me',
			query: QueryParams.of({'collection': collection}),
		);
		final raw = data is Map ? data['field_restrictions'] : null;
		final restrictions = raw is List ? raw.whereType<String>().toList() : null;
		_permCache[collection] = (
			at: DateTime.now().millisecondsSinceEpoch,
			restrictions: restrictions,
		);
		return restrictions;
	}

	/// Prune a fields projection against the caller's whitelist (no-op without
	/// restrictions). Convenience for callers that fetch restrictions manually.
	Future<Object?> pruneFields(String collection, Object? fields) async {
		final allowed = await fieldRestrictions(collection);
		final restricted = restrictFields(fieldsToArray(fields), allowed);
		if (restricted == null) return fields;
		if (fields is List) return restricted;
		return restricted.join(',');
	}

	/// One-view-one-round-trip reads: `POST /api/query` executes keyed
	/// `{ collection, params }` specs in PARALLEL server-side and returns one
	/// keyed payload. Per-key `ok:false` isolation means a failing source never
	/// kills the view.
	Future<Map<String, dynamic>> queryMany(List<QuerySpec> queries) async {
		var specs = queries;
		// The server caps batches at [maxQueriesPerBatch] and SILENTLY truncates
		// — mirror that client-side so both agree. Warn once about the truncation.
		if (specs.length > maxQueriesPerBatch) {
			specs = specs.sublist(0, maxQueriesPerBatch);
			if (!_queryManyWarned) {
				_queryManyWarned = true;
				sdkWarn(
					'[mmbix-sdk] queryMany: batch truncated to $maxQueriesPerBatch specs (the server\'s cap)',
				);
			}
		}
		final bodyQueries = <Map<String, Object?>>[];
		for (final spec in specs) {
			final params = <String, String>{};
			// Duplicate keys collapse (JS object semantics) — same as TS.
			for (final entry in spec.query?.entries ?? const <MapEntry<String, String>>[]) {
				params[entry.key] = entry.value;
			}
			// Same page-size policy as items().list(): always send an explicit
			// limit (the policy default), clamped to the policy max.
			final raw = params['limit'];
			final parsed = raw != null ? num.tryParse(raw)?.toInt() : null;
			params['limit'] = normalizePageSize(parsed, _pageSizePolicy).toString();
			bodyQueries.add({
				'key': spec.key,
				'collection': spec.collection,
				'params': params,
			});
		}
		return request<Map<String, dynamic>>(
			'/query',
			method: 'POST',
			body: {'queries': bodyQueries},
			timeoutMs: 15000,
		);
	}

	// ── Low-level request (raw paths, business endpoints) ─────

	Future<T> request<T>(
		String path, {
		String? method,
		QueryParams? query,
		Object? body,
		Map<String, String>? headers,
		String? idempotencyKey,
		String? ifMatch,
		int? timeoutMs,
		Object? Function(Object? data)? validate,
		bool noQueue = false,
	}) async {
		final res = await requestMeta<T>(
			path,
			RequestOptions(
				method: method,
				query: query,
				body: body,
				headers: headers,
				idempotencyKey: idempotencyKey,
				ifMatch: ifMatch,
				timeoutMs: timeoutMs,
				validate: validate,
				noQueue: noQueue,
			),
		);
		return res.data;
	}

	/// Like [request], but also returns the envelope `meta` (pagination/count).
	Future<RequestResult<T>> requestMeta<T>(
		String path, [
		RequestOptions options = const RequestOptions(),
		int attempt = 0,
		String? idemKey,
		/// Internal — a 304 we cannot serve re-asks without the conditional header.
		bool conditional = true,
	]) async {
		final method = (options.method ?? 'GET').toUpperCase();
		final isAuthPath = _isSelfAuthPath(path);
		// Hook/log-facing label — never the raw path when it embeds a token.
		final hookPath = _redactPath(path);
		final query = options.query ?? QueryParams();
		final qs = query.toQueryString();
		final target = Uri.parse('$_baseUrl$path${qs.isEmpty ? '' : '?$qs'}');

		final headers = <String, String>{...?options.headers};
		final body = options.body;
		final bodyBytes = options.bodyBytes;
		// Auto Idempotency-Key: every mutating request gets a stable key so
		// network retries / offline replays can never duplicate server side
		// effects (the backend's Stripe-style middleware dedupes on the key).
		// Auth calls and binary (multipart upload) bodies are exempt.
		final isMutation = method != 'GET' && method != 'HEAD';
		final shouldKey = isMutation && !isAuthPath && bodyBytes == null;
		final effectiveIdemKey = idemKey ?? options.idempotencyKey ?? (shouldKey ? uuid() : null);
		if (body != null && !headers.containsKey('Content-Type')) {
			headers['Content-Type'] = 'application/json';
		}
		if (effectiveIdemKey != null) headers['Idempotency-Key'] = effectiveIdemKey;
		if (options.ifMatch != null) headers['If-Match'] = options.ifMatch!;

		// Expired token → never pay the doomed request: rotate the stored refresh
		// token first when one exists, else drop the dead token (legacy). Auth
		// paths are exempt from BOTH — `/auth/refresh` and `/auth/logout` must
		// still read the refresh token, and `/auth/login` replaces the session.
		var stored = _tokenStorage.get();
		String? usable;
		if (stored != null && !isTokenExpired(stored)) {
			usable = stored;
		} else if (stored != null && !isAuthPath) {
			final refresh = _tokenStorage.getRefresh();
			if (refresh != null && refresh.isNotEmpty) {
				await auth.refresh();
				stored = _tokenStorage.get();
				if (stored != null && !isTokenExpired(stored)) usable = stored;
			} else {
				_tokenStorage.clear();
			}
		}
		if (usable != null && !isAuthPath) headers['Authorization'] = 'Bearer $usable';

		// Offline reads: adopt device-persisted bodies for THIS account before
		// the lookup, so a cold start with no server can still serve what it
		// holds. The fingerprint matches the offline queue's (the token's
		// ACCOUNT subject, not its bytes), so both are scoped per account.
		_conditionalCache?.hydrate(usable != null ? fingerprint(tokenSubjectOf(usable)) : null);

		// Conditional GET — replay the tag stored alongside the last body for
		// this exact URL. HEAD has no body to fall back on, so it never
		// participates.
		final isRead = method == 'GET';
		final cached = isRead && conditional && _conditionalCache != null && !headers.containsKey('If-None-Match')
			? _conditionalCache.get(target.toString())
			: null;
		if (cached != null) headers['If-None-Match'] = cached.etag;

		final timeoutMs = options.timeoutMs ?? _timeoutMs;
		final startedAt = DateTime.now().millisecondsSinceEpoch;

		ErpResponse res;
		try {
			final transport = _transport ?? defaultTransport;
			res = await transport(ErpRequest(
				method: method,
				url: target,
				headers: headers,
				body: body != null ? jsonEncode(body) : null,
				bodyBytes: bodyBytes,
				timeoutMs: timeoutMs,
			));
		} catch (err) {
			// Network-level failure — report connectivity, then serve a persisted
			// read if the server blessed one (offline reads), else queue
			// replayable writes.
			_onSettled?.call(hookPath, method, false);
			if (isRead && cached != null && _conditionalCache!.isFresh(cached)) {
				return RequestResult<T>(cached.data as T, cached.meta);
			}
			if (_offlineQueue != null &&
				!isAuthPath &&
				!options.noQueue &&
				method != 'GET' &&
				method != 'HEAD' &&
				bodyBytes == null) {
				final item = _offlineQueue.enqueue(method, path, body, options.ifMatch, effectiveIdemKey);
				_onQueued?.call(item);
			}
			throw ErpNetworkException(err);
		}
		// A resolved response proves the API answers — connectivity is up even if
		// the machine's internet link is down (localhost dev). Idempotent.
		_onSettled?.call(hookPath, method, true);

		// Slow-call telemetry: name the cost so a laggy screen is never a mystery.
		final elapsedMs = DateTime.now().millisecondsSinceEpoch - startedAt;
		if (elapsedMs >= _slowRequestWarnMs) {
			sdkWarn('[api-slow] $method $hookPath ${elapsedMs}ms');
		}

		// Transient failures — retry with backoff (never auth/refresh paths).
		if (_transientStatus.contains(res.status) && attempt < _retry.attempts) {
			final backoff = _retry.delayMs * (1 << attempt);
			await Future<void>.delayed(Duration(milliseconds: backoff));
			return requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
		}

		// 401 self-heal — one refresh attempt, then surface the error. The
		// rotating refresh token is the session's own mechanism and wins; the
		// `refreshSession` hook stays as the fallback for token-only storages.
		if (res.status == 401 && !isAuthPath && attempt == 0) {
			final storedRefresh = _tokenStorage.getRefresh();
			if (storedRefresh != null && storedRefresh.isNotEmpty) {
				if (await auth.refresh()) {
					return requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
				}
			} else {
				final refresh = _refreshSession;
				if (refresh != null) {
					_tokenStorage.clear();
					final fresh = await refresh();
					if (fresh != null && fresh.isNotEmpty) {
						_tokenStorage.set(fresh);
						return requestMeta<T>(path, options, attempt + 1, effectiveIdemKey);
					}
				}
			}
		}

		// 304 — the server confirms the body we hold is still current. No bytes
		// to read and nothing to parse: hand back what the last 200 returned, and
		// slide the offline window (a 304 is a fresh confirmation of the
		// representation, so a regularly-revalidated read must not silently fall
		// out of its window).
		if (res.status == 304) {
			if (cached != null) {
				final refreshed = CachedResponse(
					etag: cached.etag,
					data: cached.data,
					meta: cached.meta,
					storedAt: _conditionalCache!.clockMs(),
					maxAgeS: _offlineMaxAge(res),
				);
				_conditionalCache.set(target.toString(), refreshed);
				return RequestResult<T>(refreshed.data as T, refreshed.meta);
			}
			// Nothing to serve it from (evicted, or a proxy 304 we never asked
			// for) — re-ask unconditionally instead of surfacing a bogus "not
			// modified" error.
			if (attempt < _retry.attempts) {
				return requestMeta<T>(path, options, attempt + 1, effectiveIdemKey, false);
			}
		}

		Object? json;
		try {
			json = res.body.isEmpty ? null : jsonDecode(res.body);
		} catch (_) {
			json = null;
		}
		final envelope = json is Map ? Map<String, Object?>.from(json) : null;
		final meta = (envelope != null && envelope['meta'] is Map)
			? Map<String, Object?>.from(envelope['meta'] as Map)
			: null;

		if (res.status < 200 || res.status >= 300) {
			final message = _errorMessageFrom(json, res.statusText);
			_onError?.call(hookPath, method, res.status, message);
			throw ErpHttpException.fromResponse(res.status, res.statusText, json);
		}
		if (envelope == null || envelope['success'] == false) {
			final errorValue = envelope != null ? envelope['error'] : null;
			final message = json != null
				? jsonEncode(errorValue ?? 'The API returned an invalid response envelope')
				: 'The API returned an invalid response envelope';
			_onError?.call(hookPath, method, res.status, message);
			throw ErpHttpException(
				'The API returned an invalid response envelope',
				res.status,
				'BAD_ENVELOPE',
				json,
			);
		}

		final data = envelope['data'];
		// A successful write changed server state — the app invalidates its
		// caches and broadcasts change events from here.
		if (!isAuthPath && method != 'GET' && method != 'HEAD') {
			_onWrite?.call(hookPath, method);
		}

		// The precise change set, when the server attached one — the write's
		// response names every collection it touched.
		if (!isAuthPath) {
			final change = parseChangeEnvelope(meta);
			if (change != null) {
				_onChange?.call(change, hookPath, method);
				for (final listener in List.of(_changeListeners)) {
					try {
						listener(change, hookPath, method);
					} catch (err) {
						// One consumer's bug must not fail the request (or starve the
						// other listeners) — report and carry on.
						sdkWarn('[mmbix-sdk] change listener threw: $err');
					}
				}
			}
		}

		final validate = options.validate;
		final hasData = envelope.containsKey('data');
		final Object? result = (validate != null && hasData) ? validate(data) : data;

		// Remember the tag WITH the body it described, so a later 304 is
		// servable without a payload. Storing it under the resolved URL keeps
		// query variants (filters, fields, page) apart, exactly like the
		// server's own ETag.
		if (isRead && _conditionalCache != null) {
			final etag = res.header('ETag');
			// `X-Offline-Max-Age` is the collection's offline-reads policy:
			// present ⇒ this body may be persisted for that long, absent ⇒ never.
			if (etag != null) {
				_conditionalCache.set(
					target.toString(),
					CachedResponse(
						etag: etag,
						data: result,
						meta: meta,
						storedAt: _conditionalCache.clockMs(),
						maxAgeS: _offlineMaxAge(res),
					),
				);
			}
		}
		return RequestResult<T>(result as T, meta);
	}
}

/// Parse the engine's change envelope from a response `meta` (null when absent
/// or malformed).
ChangeEnvelope? parseChangeEnvelope(Map<String, Object?>? meta) {
	final raw = meta?['changed'];
	if (raw is! Map) return null;
	final collectionsRaw = raw['collections'];
	if (collectionsRaw is! List) return null;
	final collections = collectionsRaw.whereType<String>().toList();
	if (collections.isEmpty) return null;
	final rows = <String, List<String>>{};
	final rowsRaw = raw['rows'];
	if (rowsRaw is Map) {
		for (final entry in rowsRaw.entries) {
			final ids = entry.value;
			if (ids is List) {
				rows[entry.key.toString()] = ids.whereType<String>().toList();
			}
		}
	}
	return ChangeEnvelope(collections, rows);
}

/// The server's offline-read window for a response, or null when it did not
/// authorize persisting one (`X-Offline-Max-Age` absent) — the deny-by-default
/// case. Reading it per response keeps the allowlist in `schema_json` instead
/// of duplicated in the client.
num? _offlineMaxAge(ErpResponse res) {
	final raw = res.header('X-Offline-Max-Age');
	if (raw == null) return null;
	final seconds = num.tryParse(raw);
	return (seconds != null && seconds.isFinite && seconds > 0) ? seconds : null;
}

/// Best-effort human message from an error envelope (for onError / toasts).
String _errorMessageFrom(Object? json, String fallback) {
	if (json is! Map) return fallback;
	final error = json['error'];
	if (error is String && error.isNotEmpty) return error;
	if (error is Map) {
		final m = error['message'];
		if (m is String && m.isNotEmpty) return m;
	}
	return fallback;
}
