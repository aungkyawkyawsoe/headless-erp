/// Session + identity providers — who is signed in and what the caller may
/// see per collection.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../errors.dart';
import 'client.dart';

/// The signed-in user (the `/auth/me` payload), or null when signed out.
///
/// `build()` is honest about its three outcomes: no stored token → null; a
/// stored token → `auth.me()` (which self-heals a lapsed session through
/// refresh-token rotation before answering); a 401 VERDICT → the local
/// session is ended (`auth.logout()`, local-first and never throwing) and
/// null is returned. Any other failure (offline, 5xx) surfaces as
/// [AsyncError] — an offline resume must not masquerade as signed-out.
///
/// Re-run it on app resume: `ref.invalidate(erpSessionProvider)`.
final erpSessionProvider = AsyncNotifierProvider<ErpSession, Map<String, dynamic>?>(ErpSession.new);

/// See [erpSessionProvider].
class ErpSession extends AsyncNotifier<Map<String, dynamic>?> {
	@override
	Future<Map<String, dynamic>?> build() async {
		final client = ref.watch(erpClientProvider);
		if (client.auth.token == null) return null;
		try {
			return await client.auth.me();
		} on ErpHttpException catch (err) {
			if (err.status != 401) rethrow;
			// The server's verdict — the stored chain is dead. Local-first
			// cleanup, then signed out.
			await client.auth.logout();
			return null;
		}
	}

	/// Sign in and swap the session, then bump [erpDataVersionProvider] so
	/// every bridged read refetches for the NEW identity — the previous
	/// account's rows must never render into the next session.
	Future<Map<String, dynamic>> login({
		required String email,
		required String password,
		String? deviceId,
	}) async {
		final client = ref.read(erpClientProvider);
		state = const AsyncLoading();
		try {
			final user = await client.auth.login(email: email, password: password, deviceId: deviceId);
			if (ref.mounted) {
				state = AsyncData(user);
				ref.read(erpDataVersionProvider.notifier).bump();
			}
			return user;
		} catch (err, stack) {
			if (ref.mounted) state = AsyncError(err, stack);
			Error.throwWithStackTrace(err, stack);
		}
	}

	/// End the session — local-first, so it is effective the moment it
	/// returns and works offline; the server-side chain is revoked
	/// best-effort ([all] revokes every device). Never throws. Bumps the data
	/// version: cached reads of the old session are dropped.
	Future<void> logout({bool all = false}) async {
		await ref.read(erpClientProvider).auth.logout(all: all);
		if (ref.mounted) {
			state = const AsyncData(null);
			ref.read(erpDataVersionProvider.notifier).bump();
		}
	}
}

/// The caller's field whitelist for a collection
/// (`GET /auth/me?collection=`): null = unrestricted, [] = deny all,
/// otherwise the visible fields. Cached 60s per collection inside the client;
/// refreshed on session changes (version bumps).
///
/// The server ENFORCES the same rules on every response — this only lets the
/// UI avoid asking for (and rendering placeholders for) hidden fields. Pair
/// it with `client.pruneFields` to intersect a projection.
final erpFieldRestrictionsProvider = FutureProvider.autoDispose.family<List<String>?, String>((ref, collection) {
	ref.watch(erpDataVersionProvider);
	final client = ref.watch(erpClientProvider);
	return client.fieldRestrictions(collection);
});
