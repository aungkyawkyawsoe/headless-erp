/// Token storage adapters + the auth sub-API — the Dart port of the
/// `TokenStorage` half of `packages/sdk/src/auth.ts` and the `client.auth`
/// sub-object of `client.ts`, adapted for a STANDALONE app: email/password
/// login only (the Telegram flows are deliberately absent).
///
/// Persistence is injected (Flutter apps back [TokenStorage] with
/// `flutter_secure_storage` in the `secure_token_storage.dart` adapter) — the core never
/// touches disk or platform APIs.
///
/// Expiry awareness: the server issues 24h JWTs (`exp` claim). The client
/// treats an already-expired token as absent — it rotates the stored refresh
/// token (when one is stored) or re-authenticates up front instead of paying
/// a doomed request + 401 + retry.
library;

import 'errors.dart';
import 'jwt.dart';
import 'requester.dart';

/// Token persistence seam. Implementations must be synchronous reads (the
/// request pipeline asks for the token on every call).
///
/// [getRefresh]/[setRefresh] carry the long-lived companion credential the
/// server rotates at `/auth/refresh`. They default to a TOKEN-ONLY session
/// (no rotation — the legacy 401 `refreshSession` hook remains the only
/// self-heal); override both to let the client rotate a lapsed session
/// without re-entering credentials. [clear] ends the WHOLE session: both
/// slots.
abstract class TokenStorage {
	String? get();
	void set(String token);
	void clear();

	/// The stored refresh token, or null.
	String? getRefresh() => null;

	/// Store the rotated refresh token; null clears the slot.
	void setRefresh(String? refresh) {}
}

/// In-memory storage — the default; survives navigation, dies with the process.
class MemoryTokenStorage implements TokenStorage {
	String? _token;
	String? _refresh;

	@override
	String? get() => _token;

	@override
	void set(String token) {
		_token = token;
	}

	@override
	String? getRefresh() => _refresh;

	@override
	void setRefresh(String? refresh) {
		_refresh = refresh;
	}

	@override
	void clear() {
		_token = null;
		_refresh = null;
	}
}

/// The auth sub-object (`client.auth`) — login, logout, refresh and token
/// accessors.
class AuthApi {
	final TokenStorage _storage;
	final RequestMetaFn _request;
	final void Function()? _onLogout;

	/// Single-flight rotation — racing rotations would present the SAME token
	/// twice, which the server reads as theft and answers by revoking the
	/// whole descendant chain. Concurrent callers must share ONE rotation.
	Future<bool>? _refreshInflight;

	AuthApi({
		required TokenStorage storage,
		required RequestMetaFn request,
		void Function()? onLogout,
	})  : _storage = storage,
		  _request = request,
		  _onLogout = onLogout;

	/// Email + password login (the only sign-in path for a standalone app).
	/// Stores the token and returns the session user. [deviceId] names the
	/// device the refresh chain is bound to (server-side).
	Future<Map<String, dynamic>> login({
		required String email,
		required String password,
		String? deviceId,
	}) async {
		final res = await _request<Map<String, dynamic>>(
			'/auth/login',
			RequestOptions(
				method: 'POST',
				body: {
					'email': email,
					'password': password,
					if (deviceId != null) 'device_id': deviceId,
				},
				timeoutMs: 10000,
			),
		);
		final token = res.data['token'];
		if (token is String) _storage.set(token);
		// A sign-in replaces the WHOLE session: store the issued chain, or clear
		// the slot when none was issued — a stale chain must never outlive the
		// session that carried it.
		final refresh = res.data['refresh_token'];
		_storage.setRefresh(refresh is String && refresh.isNotEmpty ? refresh : null);
		final user = res.data['user'];
		if (user is Map) return Map<String, dynamic>.from(user);
		return res.data;
	}

	/// The current session's identity (role, restrictions, granted collections,
	/// apps) — the resume-revalidation read (`GET /auth/me`).
	Future<Map<String, dynamic>> me() async {
		final res = await _request<Map<String, dynamic>>('/auth/me');
		return res.data;
	}

	/// End the session. Local state goes FIRST — token, refresh token and any
	/// device-persisted reads (a body kept for offline use must not outlive
	/// the session that was allowed to see it) — so logout is effective the
	/// moment it returns and works offline. The server-side chain is then
	/// revoked best-effort; [all] revokes every chain of the user, all devices
	/// included. Never throws.
	Future<void> logout({bool all = false}) async {
		final refresh = _storage.getRefresh();
		_endSession();
		if (refresh == null || refresh.isEmpty) return; // nothing to revoke — no network call
		try {
			await _request<Object?>(
				'/auth/logout',
				RequestOptions(
					method: 'POST',
					body: {'refresh_token': refresh, 'all': all},
					timeoutMs: 10000,
				),
			);
		} catch (_) {
			// best-effort — the local session is already gone
		}
	}

	/// Rotate the stored refresh token into a fresh JWT + successor token
	/// (single-flight). Resolves false — never a throw — when no token is
	/// stored, the rotation was refused (401 — the local session is ended
	/// first), or the network failed (the session is KEPT: the token may still
	/// be valid on a later try).
	Future<bool> refresh() {
		final existing = _refreshInflight;
		if (existing != null) return existing;
		final run = _refreshInner().whenComplete(() {
			_refreshInflight = null;
		});
		_refreshInflight = run;
		return run;
	}

	Future<bool> _refreshInner() async {
		final refreshToken = _storage.getRefresh();
		if (refreshToken == null || refreshToken.isEmpty) return false;
		try {
			// `/auth/refresh` is an auth path: no bearer (it authenticates by the
			// token itself), no idempotency key, no offline queue, no self-heal
			// recursion — and the pipeline never rotates on it: this call IS the
			// rotation.
			final res = await _request<Map<String, dynamic>>(
				'/auth/refresh',
				RequestOptions(
					method: 'POST',
					body: {'refresh_token': refreshToken},
					timeoutMs: 10000,
				),
			);
			final token = res.data['token'];
			if (token is String) _storage.set(token);
			final next = res.data['refresh_token'];
			_storage.setRefresh(next is String && next.isNotEmpty ? next : null);
			return true;
		} on ErpHttpException catch (err) {
			// A 401 is the server's VERDICT (expired, revoked, reused, dead
			// account) — end the local session. Anything else (network, 5xx) is
			// not: keep the session, the token may rotate later.
			if (err.status == 401) _endSession();
			return false;
		} catch (_) {
			return false;
		}
	}

	/// End the local session — token + refresh token + device-persisted reads
	/// (through the client's `onLogout` seam). The server-side chain is left
	/// to [logout] (or to its own expiry).
	void _endSession() {
		_storage.clear();
		_onLogout?.call();
	}

	/// The currently stored (unexpired) token, if any.
	String? get token {
		final t = _storage.get();
		return (t != null && !isTokenExpired(t)) ? t : null;
	}

	/// Directus-parity accessor — the stored (unexpired) token.
	String? getToken() => token;

	/// Directus-parity accessor — write a token straight into storage.
	void setToken(String token) => _storage.set(token);
}
