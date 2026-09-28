/// Files (media) sub-API — uploads into the engine's R2 media library.
/// 1:1 port of `packages/sdk/src/files.ts`.
///
/// Three paths, MECE:
///   - [upload]           direct multipart with the session bearer — a 401
///                        heals through refresh-token rotation like any call
///   - [presign]          mint a single-use, user-bound upload token (15 min)
///   - [uploadWithToken]  redeem that token with NO bearer — the delegated
///                        path for uploaders that never hold the session
///                        (background isolate, upload worker). The signed
///                        token IS the credential and burns on first use.
///
/// Deliberately NOT exposed here: the library list / delete / GC routes —
/// those are Studio admin surfaces, not app surfaces.
///
/// The multipart body is hand-rolled (boundary + CRLF + [BytesBuilder]) — no
/// extra dependency, and the transport seam carries it as bytes
/// (`ErpRequest.bodyBytes`). The file part's `Content-Type` is inferred from
/// the filename extension because the SERVER validates it against an
/// allowlist before sniffing the file's magic bytes.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'requester.dart';

/// Per-asset privacy. [public] (the server default) serves anonymously — a
/// stored URL is rendered as an image/audio widget, which cannot carry a
/// bearer. [private] serves only its uploader or an admin.
///
/// Named `MediaVisibility` (not `Visibility`) so it never collides with
/// Flutter's own `Visibility` widget in app code, and to match the TS SDK's
/// `MediaVisibility` type.
enum MediaVisibility {
	public('public'),
	private('private');

	const MediaVisibility(this.wire);

	/// The exact field value the server reads (`visibility`).
	final String wire;
}

/// Default upload timeout (ms) — large camera files over a slow link.
const int uploadTimeoutMs = 120000;

/// The files (media) sub-API (`client.files`). Responses stay maps (the Dart
/// SDK's convention alongside `erp.auth.login` / `erp.items.get`): an upload
/// answers `{ key, url, filename, size, mime_type }` and presign answers
/// `{ token, expires_at, upload_url, max_bytes }`.
class FilesApi {
	final RequestMetaFn _request;

	FilesApi({required RequestMetaFn request}) : _request = request;

	/// Direct multipart upload — the session bearer rides along and a 401
	/// heals (rotate + retry) exactly like any other authenticated call.
	/// [visibility] omitted ⇒ the server default (`public`).
	Future<Map<String, dynamic>> upload(
		File file, {
		MediaVisibility? visibility,
		String? filename,
		int? timeoutMs,
	}) =>
		_send('/media/upload', file, visibility: visibility, filename: filename, timeoutMs: timeoutMs);

	/// Mint a single-use upload token bound to the current user (15 min TTL).
	Future<Map<String, dynamic>> presign() async {
		final res = await _request<Map<String, dynamic>>(
			'/media/presign',
			const RequestOptions(
				method: 'POST',
				timeoutMs: 10000,
				// A replayed presign would mint a token nobody can consume (the
				// caller already saw the failure) — never enqueue it.
				noQueue: true,
			),
		);
		return res.data;
	}

	/// Redeem a presigned token with NO bearer — the token itself is the
	/// credential and is consumed on first use.
	Future<Map<String, dynamic>> uploadWithToken(
		File file,
		String token, {
		MediaVisibility? visibility,
		String? filename,
		int? timeoutMs,
	}) =>
		_send('/media/upload/$token', file, visibility: visibility, filename: filename, timeoutMs: timeoutMs);

	Future<Map<String, dynamic>> _send(
		String path,
		File file, {
		MediaVisibility? visibility,
		String? filename,
		int? timeoutMs,
	}) async {
		final body = await _multipartBody(file, visibility: visibility, filename: filename);
		final res = await _request<Map<String, dynamic>>(
			path,
			RequestOptions(
				method: 'POST',
				headers: {'Content-Type': body.contentType},
				bodyBytes: body.bytes,
				timeoutMs: timeoutMs ?? uploadTimeoutMs,
			),
		);
		return res.data;
	}
}

/// One multipart body alongside the `Content-Type` header value (boundary
/// included) that announces it.
class _MultipartBody {
	final List<int> bytes;
	final String contentType;

	const _MultipartBody(this.bytes, this.contentType);
}

/// Encode `file` (+ the optional `visibility` field) as `multipart/form-data`:
/// the file part first, exactly the `FormData.append('file', …)` shape the TS
/// SDK sends.
Future<_MultipartBody> _multipartBody(File file, {MediaVisibility? visibility, String? filename}) async {
	final boundary = '----mmbix${_randomHex(16)}';
	final buffer = BytesBuilder(copy: false);
	void crlf() => buffer.add(const [13, 10]);
	void header(String line) {
		buffer.add(utf8.encode(line));
		crlf();
	}

	final rawName = filename ?? _fileNameOf(file);
	buffer.add(ascii.encode('--$boundary'));
	crlf();
	header('Content-Disposition: form-data; name="file"; filename="${_escapedFilename(rawName)}"');
	header('Content-Type: ${_mimeTypeFor(rawName)}');
	crlf();
	buffer.add(await file.readAsBytes());
	crlf();
	if (visibility != null) {
		buffer.add(ascii.encode('--$boundary'));
		crlf();
		header('Content-Disposition: form-data; name="visibility"');
		crlf();
		buffer.add(utf8.encode(visibility.wire));
		crlf();
	}
	buffer.add(ascii.encode('--$boundary--'));
	crlf();
	return _MultipartBody(buffer.takeBytes(), 'multipart/form-data; boundary=$boundary');
}

/// The file's own name — the server derives the stored key's extension from
/// it (`file.uri.pathSegments.last`; a name-less path falls back to 'upload').
String _fileNameOf(File file) {
	final segments = file.uri.pathSegments;
	final name = segments.isEmpty ? '' : segments.last;
	return name.isEmpty ? 'upload' : name;
}

/// Multipart filename escaping — the Fetch spec's rules (what a browser's
/// `FormData` serialization applies): `"` → `%22`, CR → `%0D`, LF → `%0A`,
/// so a crafted filename can never forge a header line.
String _escapedFilename(String name) =>
	name.replaceAll('"', '%22').replaceAll('\r', '%0D').replaceAll('\n', '%0A');

/// Extension → MIME. Load-bearing, not cosmetic: the SERVER checks the
/// declared type against its allowlist before magic-byte sniffing, so an
/// unmapped extension must fall back to `application/octet-stream` — the
/// allowlist refuses it and the caller gets the server's own clear error.
const Map<String, String> _mimeByExtension = {
	'jpg': 'image/jpeg',
	'jpeg': 'image/jpeg',
	'png': 'image/png',
	'gif': 'image/gif',
	'webp': 'image/webp',
	'avif': 'image/avif',
	'pdf': 'application/pdf',
	'txt': 'text/plain',
	'csv': 'text/csv',
	'json': 'application/json',
	'mp4': 'video/mp4',
	'webm': 'video/webm',
	'mov': 'video/quicktime',
	'mp3': 'audio/mpeg',
	'ogg': 'audio/ogg',
	'oga': 'audio/ogg',
	'wav': 'audio/wav',
	'zip': 'application/zip',
	'gz': 'application/gzip',
};

String _mimeTypeFor(String fileName) {
	final dot = fileName.lastIndexOf('.');
	if (dot < 1 || dot == fileName.length - 1) return 'application/octet-stream';
	return _mimeByExtension[fileName.substring(dot + 1).toLowerCase()] ?? 'application/octet-stream';
}

/// 128-bit hex nonce for the boundary (the same CSPRNG source as [uuid]).
String _randomHex(int byteCount) {
	final rng = Random.secure();
	return List<int>.generate(byteCount, (_) => rng.nextInt(256))
		.map((b) => b.toRadixString(16).padLeft(2, '0'))
		.join();
}
