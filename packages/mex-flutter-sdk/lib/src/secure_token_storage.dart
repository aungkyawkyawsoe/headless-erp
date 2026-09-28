/// flutter_secure_storage-backed [TokenStorage] — the Flutter half of the
/// auth-persistence seam (iOS Keychain / Android Keystore; the plugin uses
/// EncryptedSharedPreferences on Android by default).
///
/// [TokenStorage] is synchronous — the request pipeline asks for the token on
/// every call — while the Keychain/Keystore is async, so both credential slots
/// (session token + refresh token) are mirrored in memory: [init] hydrates the
/// mirror once at startup; [set]/[setRefresh]/[clear] apply to the mirror
/// synchronously and persist asynchronously. Persistence is best-effort: a
/// failed device write is surfaced via `onPersistError` but never breaks the
/// session that is already running.
///
/// Security rules (design doc §7.1): the PASSWORD is never stored — the token
/// is the session, and "remember me" is the token's job. The default iOS
/// accessibility is `unlocked`; apps that need background sync pass
/// `FlutterSecureTokenStorage.forBackgroundSync()` (after-first-unlock).
library;

import 'dart:async';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'auth.dart';

class FlutterSecureTokenStorage implements TokenStorage {
	/// Keychain/Keystore item name for the session token.
	static const tokenKey = 'headless_erp.token';

	/// Keychain/Keystore item name for the refresh token — the rotating chain
	/// `/auth/refresh` consumes and replaces.
	static const refreshTokenKey = 'headless_erp.refresh';

	final FlutterSecureStorage _secure;
	final void Function(Object error)? onPersistError;
	String? _token;
	String? _refresh;
	bool _hydrated = false;
	bool _touched = false;

	FlutterSecureTokenStorage({
		FlutterSecureStorage? secureStorage,
		this.onPersistError,
	}) : _secure = secureStorage ?? const FlutterSecureStorage();

	/// The iOS preset for apps that sync in the background: the token stays
	/// readable after the first unlock following a reboot (`first_unlock`),
	/// instead of requiring the device to be unlocked.
	factory FlutterSecureTokenStorage.forBackgroundSync({
		void Function(Object error)? onPersistError,
	}) =>
		FlutterSecureTokenStorage(
			secureStorage: const FlutterSecureStorage(
				iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock),
			),
			onPersistError: onPersistError,
		);

	/// Hydrate the in-memory mirror from the Keychain/Keystore. Call once at
	/// startup, before constructing the client — reads before hydration see
	/// `null`. Idempotent: a second call is a no-op.
	Future<void> init() async {
		if (_hydrated) return;
		_hydrated = true;
		try {
			final storedToken = await _secure.read(key: tokenKey);
			final storedRefresh = await _secure.read(key: refreshTokenKey);
			// A set()/clear() that raced ahead of hydration is authoritative —
			// never resurrect a session the app already replaced or dropped
			// (both slots move together).
			if (!_touched) {
				_token = storedToken;
				_refresh = storedRefresh;
			}
		} catch (error) {
			onPersistError?.call(error);
		}
	}

	@override
	String? get() => _token;

	@override
	String? getRefresh() => _refresh;

	@override
	void set(String token) {
		_touched = true;
		_token = token;
		_persist(() => _secure.write(key: tokenKey, value: token));
	}

	@override
	void setRefresh(String? refresh) {
		_touched = true;
		_refresh = refresh;
		if (refresh == null) {
			_persist(() => _secure.delete(key: refreshTokenKey));
		} else {
			_persist(() => _secure.write(key: refreshTokenKey, value: refresh));
		}
	}

	@override
	void clear() {
		_touched = true;
		_token = null;
		_refresh = null;
		_persist(() async {
			await _secure.delete(key: tokenKey);
			await _secure.delete(key: refreshTokenKey);
		});
	}

	void _persist(Future<void> Function() op) {
		unawaited(op().catchError((Object error) {
			onPersistError?.call(error);
		}));
	}
}
