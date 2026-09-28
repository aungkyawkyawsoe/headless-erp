/// HTTP transport seam — the Dart replacement for the browser's `fetch`.
///
/// The client calls an injected [HttpTransportFn]; tests inject a recording
/// fake (the equivalent of `vi.stubGlobal('fetch', …)` in the TS suite), and
/// apps may inject their own (proxy, mTLS, logging). [defaultTransport] is a
/// `dart:io` socket implementation and is used when nothing is injected.
///
/// `timeoutMs` rides on the request so a transport can enforce it (the TS SDK
/// maps it to `AbortSignal.timeout`).
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

class ErpRequest {
	final String method;
	final Uri url;
	final Map<String, String> headers;

	/// A text body (the engine's JSON routes). Mutually exclusive with
	/// [bodyBytes].
	final String? body;

	/// A raw binary body (multipart media uploads) — sent via `req.add`,
	/// byte-for-byte, with an explicit `content-length` (no chunked framing).
	/// The caller supplies the matching `Content-Type` (boundary included)
	/// in [headers].
	final List<int>? bodyBytes;

	final int? timeoutMs;

	const ErpRequest({
		required this.method,
		required this.url,
		this.headers = const {},
		this.body,
		this.bodyBytes,
		this.timeoutMs,
	});
}

class ErpResponse {
	final int status;

	/// The reason phrase (`'OK'`, `'Not Found'`) — the fallback error message
	/// source, mirroring `res.statusText` in TS.
	final String statusText;

	/// Response headers. Look them up case-insensitively via [header].
	final Map<String, String> headers;
	final String body;

	const ErpResponse({
		required this.status,
		this.statusText = '',
		this.headers = const {},
		this.body = '',
	});

	/// Case-insensitive header lookup (HTTP header names are case-insensitive;
	/// `dart:io` lower-cases them, tests may not).
	String? header(String name) {
		final lower = name.toLowerCase();
		for (final entry in headers.entries) {
			if (entry.key.toLowerCase() == lower) return entry.value;
		}
		return null;
	}
}

typedef HttpTransportFn = Future<ErpResponse> Function(ErpRequest request);

/// The process-wide default transport — `dart:io` sockets (mobile/desktop;
/// the SDK core does not target the web).
Future<ErpResponse> defaultTransport(ErpRequest request) {
	final future = _send(request);
	final timeoutMs = request.timeoutMs;
	return timeoutMs != null
		? future.timeout(Duration(milliseconds: timeoutMs))
		: future;
}

Future<ErpResponse> _send(ErpRequest request) async {
	final client = HttpClient();
	try {
		final req = await client.openUrl(request.method, request.url);
		request.headers.forEach((name, value) {
			req.headers.set(name, value);
		});
		final body = request.body;
		if (body != null) req.write(body);
		// Raw bytes (multipart) go through `add` — never re-encoded — with an
		// explicit content-length so the request is not framed chunked.
		final bodyBytes = request.bodyBytes;
		if (bodyBytes != null) {
			req.contentLength = bodyBytes.length;
			req.add(bodyBytes);
		}
		final res = await req.close();
		final bytes = await res.fold<List<int>>(
			<int>[],
			(acc, chunk) => acc..addAll(chunk),
		);
		final headers = <String, String>{};
		res.headers.forEach((name, values) {
			// Multi-value headers join like `fetch`'s `Headers.get` (', ').
			headers[name.toLowerCase()] = values.join(', ');
		});
		return ErpResponse(
			status: res.statusCode,
			statusText: res.reasonPhrase,
			headers: headers,
			body: utf8.decode(bytes, allowMalformed: true),
		);
	} finally {
		client.close(force: true);
	}
}
