/// Shared test doubles + envelope builders — the Dart stand-in for the TS
/// suite's `vi.stubGlobal('fetch', …)` helpers.
///
/// [FakeTransport] records every [ErpRequest] and answers from a
/// `mockResolvedValueOnce`-style queue (with an optional fallback for later
/// calls), so each test scripts the exact response sequence it pins.
library;

import 'dart:async';
import 'dart:convert';

import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

/// Scripted transport: records calls, answers from a queue, falls back if any.
class FakeTransport {
	final List<ErpRequest> calls = [];
	final List<Future<ErpResponse> Function(ErpRequest)> _queue = [];
	Future<ErpResponse> Function(ErpRequest request)? fallback;

	/// Run [handler] for the next call only (`mockResolvedValueOnce`).
	void once(Future<ErpResponse> Function(ErpRequest request) handler) =>
		_queue.add(handler);

	/// Answer the next call with a fixed response.
	void onceOk(ErpResponse response) => _queue.add((_) => Future.value(response));

	/// Fail the next call at the network level.
	void onceThrow(Object error) => _queue.add((_) => Future.error(error));

	Future<ErpResponse> call(ErpRequest request) {
		calls.add(request);
		if (_queue.isNotEmpty) return _queue.removeAt(0)(request);
		final handler = fallback;
		if (handler != null) return handler(request);
		return Future.error(
			StateError('FakeTransport: no response queued for ${request.method} ${request.url}'),
		);
	}

	HttpTransportFn get handler => call;

	ErpRequest get last => calls.last;
}

/// Case-insensitive header lookup on a recorded request.
String? headerOf(ErpRequest request, String name) {
	final lower = name.toLowerCase();
	for (final entry in request.headers.entries) {
		if (entry.key.toLowerCase() == lower) return entry.value;
	}
	return null;
}

String? authOf(ErpRequest request) => headerOf(request, 'Authorization');
String? sentIfNoneMatch(ErpRequest request) => headerOf(request, 'If-None-Match');
String? idempotencyKeyOf(ErpRequest request) => headerOf(request, 'Idempotency-Key');

/// The decoded JSON body a recorded request carried.
Object? jsonBodyOf(ErpRequest request) =>
	request.body == null ? null : jsonDecode(request.body!);

/// The raw binary body a recorded request carried (multipart uploads),
/// decoded as LATIN-1 — the identity mapping: every byte these tests assert
/// on (boundary, CRLFs, ASCII headers, ASCII payloads) survives unchanged.
String bodyTextOf(ErpRequest request) => latin1.decode(request.bodyBytes!);

const Map<String, String> _jsonHeaders = {'Content-Type': 'application/json'};

/// The success envelope `{ success, data }`.
ErpResponse envelope(Object? data) => ErpResponse(
	status: 200,
	headers: _jsonHeaders,
	body: jsonEncode({'success': true, 'data': data}),
);

/// The success envelope with `meta` (pagination/count).
ErpResponse envelopeWithMeta(Object? data, Object? meta) => ErpResponse(
	status: 200,
	headers: _jsonHeaders,
	body: jsonEncode({'success': true, 'data': data, 'meta': meta}),
);

/// The entity engine's flat list contract: `{ success, data: T[], meta }`.
ErpResponse listEnvelope(List<Object?> rows, Object? meta) => envelopeWithMeta(rows, meta);

/// The count_only shape: `{ success, data: [], meta: { total } }`.
ErpResponse countEnvelope(int total) => envelopeWithMeta(
	const <Object?>[],
	{'limit': 0, 'has_more': false, 'total': total},
);

/// A non-2xx envelope: `{ success: false, error }`.
ErpResponse errorEnvelope(int status, Object? error) => ErpResponse(
	status: status,
	headers: _jsonHeaders,
	body: jsonEncode({'success': false, 'error': error}),
);

/// A 200 read response, optionally tagged + blessed for offline persistence.
ErpResponse ok(Object? data, {String? etag, num? offlineMaxAge}) {
	final headers = <String, String>{..._jsonHeaders};
	if (etag != null) headers['ETag'] = etag;
	if (offlineMaxAge != null) headers['X-Offline-Max-Age'] = '$offlineMaxAge';
	return ErpResponse(
		status: 200,
		headers: headers,
		body: jsonEncode({'success': true, 'data': data}),
	);
}

/// A bodiless `304 Not Modified`, optionally sliding the offline window.
ErpResponse notModified({String? offlineMaxAge}) => ErpResponse(
	status: 304,
	headers: offlineMaxAge == null ? const {} : {'X-Offline-Max-Age': offlineMaxAge},
);

/// A server-shaped token: `base64(payload + '.' + sig)` — the exact format
/// `makeToken(exp)` uses in the TS suite.
String makeToken(int exp) {
	final payload = jsonEncode({
		'jti': 'x',
		'user_id': 'u',
		'iat': exp - 86400000,
		'exp': exp,
	});
	return base64.encode(utf8.encode('$payload.deadbeef'));
}

/// A server-shaped token for a specific account — the payload carries the
/// subject the client scopes device-local state by.
String tokenFor(String userId, String jti) {
	final payload = jsonEncode({'jti': jti, 'user_id': userId, 'iat': 1, 'exp': 9999999999999});
	return base64.encode(utf8.encode('$payload.deadbeef'));
}

/// `/^[0-9a-f-]{36}$/` — the UUID shape (client id, auto idempotency key).
final RegExp uuidPattern = RegExp(r'^[0-9a-f-]{36}$');
