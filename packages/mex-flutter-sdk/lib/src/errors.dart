/// Error hierarchy for the Headless ERP SDK — the 1:1 Dart port of
/// `packages/sdk/src/errors.ts`.
///
/// Every SDK failure is a typed error so callers can branch precisely:
///   - [ErpNetworkException] — the request never reached the server (offline, DNS, abort)
///   - [ErpHttpException]    — the server answered with a non-2xx
///   - [ErpException]        — base class (also used for malformed envelopes)
///
/// Error CODES come from the canonical catalog in `@mmbix/utils` (single source
/// of truth for `@mmbix/types` / the API worker / every client) — the list
/// below mirrors it exactly, and the CI contract test compares it against
/// `GET /api/meta → error_codes` so it can never silently drift.
library;

/// The complete canonical catalog (`ERROR_CODES` in `@mmbix/utils`).
const List<String> errorCodes = [
	// ── 4xx — client / resource ──────────────────────────
	'VALIDATION_ERROR', // 400 — invalid input / failed declarative validation
	'INVALID_JSON', // 400 — malformed request body
	'UNAUTHORIZED', // 401 — missing/invalid credentials
	'FORBIDDEN', // 403 — authenticated but denied (role / row / field)
	'NOT_FOUND', // 404 — collection or item missing
	'CONFLICT', // 409 — duplicate / state conflict / optimistic-concurrency
	'PAYLOAD_TOO_LARGE', // 413 — body exceeds the upload/body limit
	'UNSUPPORTED_MEDIA_TYPE', // 415 — bad Content-Type
	'RATE_LIMIT_EXCEEDED', // 429 — per-role quota exhausted
	// ── 5xx — server ─────────────────────────────────────
	'NOT_CONFIGURED', // 501 — a required provider/integration is not configured
	'DATABASE_ERROR', // 502 — D1 failed (never leaks raw internals)
	'INTERNAL_ERROR', // 500 — unexpected failure
	// ── SDK-side (never emitted by the API) ──────────────
	'NETWORK_ERROR', // the request never reached the server
	'SDK_ERROR', // generic client-side failure
	'API_ERROR', // unclassified API failure
	'BAD_ENVELOPE', // the server responded but with an unrecognized envelope
];

/// Distinct error codes the API worker can emit (no SDK-only codes) — what
/// `GET /api/meta → error_codes` returns.
const List<String> apiErrorCodes = [
	'VALIDATION_ERROR',
	'INVALID_JSON',
	'UNAUTHORIZED',
	'FORBIDDEN',
	'NOT_FOUND',
	'CONFLICT',
	'PAYLOAD_TOO_LARGE',
	'UNSUPPORTED_MEDIA_TYPE',
	'RATE_LIMIT_EXCEEDED',
	'NOT_CONFIGURED',
	'DATABASE_ERROR',
	'INTERNAL_ERROR',
];

/// Validate that a code is in the canonical API catalog.
bool isErrorCode(Object? candidate) =>
	candidate is String && apiErrorCodes.contains(candidate);

/// Base SDK error — the Dart port of the TS `SdkError`.
class ErpException implements Exception {
	final String message;
	final int status;

	/// The error code — the canonical [errorCodes] value when known, or the raw
	/// server/legacy code otherwise (kept for backward compat).
	final String code;

	const ErpException(this.message, [this.status = 0, this.code = 'SDK_ERROR']);

	@override
	String toString() => 'ErpException($code/$status): $message';
}

/// The server answered with a non-2xx response.
class ErpHttpException extends ErpException {
	final Object? body;

	/// The code narrowed to the canonical API surface when it matches one of the
	/// known [errorCodes]; otherwise `'API_ERROR'`. Use [apiErrorCodeOf] to
	/// branch without guessing at string literals.
	final String apiCode;

	final String? requestId;

	ErpHttpException(super.message, super.status, super.code, [this.body])
		: apiCode = isErrorCode(code) ? code : 'API_ERROR',
		  requestId = _requestIdOf(body);

	/// Build from a raw response (status + reason phrase) + parsed body.
	///
	/// The real backend envelope is `{ success: false, error: string, code:
	/// string, request_id? }` with `code` a TOP-LEVEL sibling of `error` — read
	/// it first so backend codes (NOT_FOUND / CONFLICT / UNAUTHORIZED /
	/// RATE_LIMIT_EXCEEDED / …) survive. Older envelopes may still nest the
	/// error object (`{ success: false, error: { message, code } }`) or pass
	/// the error object directly — the nested fallback keeps those working.
	static ErpHttpException fromResponse(int status, String statusText, [Object? body]) {
		String? topCode;
		if (body is Map && body['code'] is String) topCode = body['code'] as String;
		final Object? nested = (body is Map && body.containsKey('error')) ? body['error'] : body;
		final parsed = _envelopeParts(nested);
		final message = parsed.message != 'Request failed' ? parsed.message : '$status $statusText';
		final code = topCode ?? parsed.code;
		return ErpHttpException(message, status, code, body);
	}
}

/// The request never reached the server (offline, DNS failure, aborted).
class ErpNetworkException extends ErpException {
	final Object? cause;

	ErpNetworkException([this.cause])
		: super('Network error — the server could not be reached', 0, 'NETWORK_ERROR');
}

/// True when `e` is any SDK error.
bool isErpError(Object? e) => e is ErpException;

/// Narrow an SDK error to the canonical API error code when it matches one.
/// Returns null when the code isn't one of the known [errorCodes] (e.g. a
/// legacy/unknown server code) so callers can branch without literals.
String? apiErrorCodeOf(Object? e) {
	final c = e is ErpHttpException ? e.apiCode : null;
	return (c == null || c == 'API_ERROR') ? null : c;
}

/// Extract a human message + machine code from the API's error envelope.
({String message, String code}) _envelopeParts(Object? error) {
	if (error is String) return (message: error, code: 'API_ERROR');
	if (error is Map) {
		final m = error['message'];
		final e = error['error'];
		final String message;
		if (m is String) {
			message = m;
		} else if (_jsTruthy(e)) {
			message = e is String ? e : 'Request failed';
		} else {
			message = 'Request failed';
		}
		final code = error['code'] is String ? error['code'] as String : 'API_ERROR';
		return (message: message, code: code);
	}
	return (message: 'Request failed', code: 'API_ERROR');
}

String? _requestIdOf(Object? body) {
	if (body is Map && body['request_id'] is String) return body['request_id'] as String;
	return null;
}

/// JS truthiness for decoded-JSON values — the envelope fallbacks mirror the
/// TS `e.error ? … : …` branches exactly ('' / 0 / false / null are falsy).
bool _jsTruthy(Object? value) {
	if (value == null) return false;
	if (value is bool) return value;
	if (value is num) return !value.isNaN && value != 0;
	if (value is String) return value.isNotEmpty;
	return true;
}
