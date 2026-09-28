/// Shared call-shape types for the SDK's internal seams (client ↔ sub-APIs).
///
/// Mirrors `client.ts`'s `RequestOptions` / the `{ data, meta }` result that
/// `requestMeta` returns and `items.ts` consumes — so `ItemsApi` and `AuthApi`
/// can be constructed by the client without importing it (no cycle).
library;

import 'query.dart';

/// The options a single request carries — the Dart port of the TS
/// `RequestOptions` (minus browser-only `AbortSignal`; use `timeoutMs`).
class RequestOptions {
	final String? method;
	final QueryParams? query;
	final Object? body;

	/// A raw binary body (multipart media uploads) — the client forwards it
	/// byte-for-byte instead of JSON-encoding [body]; the caller sets the
	/// matching `Content-Type` (boundary included) in [headers].
	final List<int>? bodyBytes;
	final Map<String, String>? headers;
	/// Server-side idempotency key (Stripe-style replay protection).
	final String? idempotencyKey;
	/// Expected `updated_at` — the API 409s when the row changed since.
	final String? ifMatch;
	/// Per-request timeout in ms — overrides the client default.
	final int? timeoutMs;
	/// Runtime response validation (e.g. a typegen-generated parser). Receives
	/// the parsed `data` and returns the value the caller receives.
	final Object? Function(Object? data)? validate;
	/// Never enqueue this request for offline replay when it fails at the
	/// network level — for read-encoded POSTs (e.g. report aggregates) where a
	/// replayed run would re-execute expensive server work for zero benefit.
	final bool noQueue;

	const RequestOptions({
		this.method,
		this.query,
		this.body,
		this.bodyBytes,
		this.headers,
		this.idempotencyKey,
		this.ifMatch,
		this.timeoutMs,
		this.validate,
		this.noQueue = false,
	});
}

/// The unwrapped envelope a request resolves with: `data` plus the optional
/// `meta` (pagination/count) the entity engine attaches.
class RequestResult<T> {
	final T data;
	final Map<String, Object?>? meta;

	const RequestResult(this.data, [this.meta]);
}

/// The client's metadata-returning request core, as seen by sub-APIs.
typedef RequestMetaFn = Future<RequestResult<T>> Function<T>(
	String path, [
	RequestOptions options,
]);
