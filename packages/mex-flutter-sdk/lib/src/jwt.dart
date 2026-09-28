/// Custom JWT decode — the Dart port of the TS SDK's `decodeTokenPayload` /
/// `tokenExpiryMs` / `tokenSubjectOf` / `isTokenExpired`.
///
/// The server's token is NOT a standard 3-part JWT: it is
/// `base64(payload + '.' + signature)` — a single base64 part. `jwt_decoder`
/// and friends assume the 3-dot format and FAIL on this shape; that is why the
/// decode lives here, copied 1:1 from the TS SDK.
///
/// Nothing here is a security boundary: it decodes an UNVERIFIED payload. The
/// authority on identity is always the server, which re-verifies the signature
/// on every request. These helpers only answer local questions ("is this the
/// same account as before?", "has exp passed?") ahead of the request.
library;

import 'dart:convert';

/// Decode the JSON payload of a stored token. Returns null for anything
/// malformed: callers treat that as "cannot tell", never as a verdict.
Map<String, Object?>? decodeTokenPayload(String token) {
	try {
		// `atob` equivalent — `base64.normalize` papers over missing padding and
		// URL-safe characters, exactly the leniency `atob` has in browsers.
		final decoded = utf8.decode(base64.decode(base64.normalize(token)));
		final lastDot = decoded.lastIndexOf('.');
		if (lastDot == -1) return null;
		final parsed = jsonDecode(decoded.substring(0, lastDot));
		if (parsed is! Map) return null;
		return Map<String, Object?>.from(parsed);
	} catch (_) {
		return null;
	}
}

/// Decode the `exp` claim (epoch ms) from a stored token. Returns null for
/// malformed tokens; callers treat that as "cannot verify → not expired"
/// (never force-discard an unparseable token).
num? tokenExpiryMs(String token) {
	final exp = decodeTokenPayload(token)?['exp'];
	return exp is num && exp.isFinite ? exp : null;
}

/// The STABLE account a token speaks for — the signed `user_id` claim, falling
/// back to `sub`, and finally to the token itself.
///
/// The server MINTS A FRESH TOKEN on every login/refresh (new `jti` + `iat` +
/// `exp`), so two tokens for the SAME human never share a byte. Anything that
/// scopes device-local state per account (offline queue, persisted reads) must
/// key on this subject — hashing the token would read one user's re-login as a
/// different account and strand (or discard) their pending work.
///
/// NOT a security boundary: it decodes an unverified payload. An
/// opaque/legacy token is returned as-is so it degrades to per-token scoping
/// rather than to "everyone".
String tokenSubjectOf(String token) {
	final payload = decodeTokenPayload(token);
	final subject = payload?['user_id'] ?? payload?['sub'];
	if (subject is String && subject.isNotEmpty) return subject;
	return token;
}

/// True when the token's exp claim has passed (with skew tolerance). Considered
/// expired `skewMs` BEFORE the server rejects it so the app re-authenticates up
/// front — a small early login is harmless; a late one re-triggers the 401
/// self-heal.
bool isTokenExpired(String token, {int skewMs = 30000}) {
	final exp = tokenExpiryMs(token);
	if (exp == null) return false;
	return DateTime.now().millisecondsSinceEpoch > exp - skewMs;
}
