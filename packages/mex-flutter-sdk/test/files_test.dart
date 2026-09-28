/// Files (media) sub-API — pins the wire contract of the three upload paths
/// and the deliberate deviations from the ordinary pipeline:
///   - `upload`          multipart + bearer, heals a 401 like any call, but is
///                       exempt from Idempotency-Key and offline queuing
///   - `presign`         an ordinary authenticated POST (noQueue)
///   - `uploadWithToken` self-authenticating: NO bearer even when a session is
///                       stored, NO heal/refresh on 401, and the token that
///                       rides the path is REDACTED from every hook/log.
///
/// 1:1 mirror of `packages/sdk/test/files.test.ts`.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

/// The upload response shape (`MediaUploadResult` on the wire).
const Map<String, Object?> asset = {
	'key': 'e4f1c2a8-9b3d-4c7e-8f1a-2d6b0e5c9a11.jpg',
	'url': '/api/media/e4f1c2a8-9b3d-4c7e-8f1a-2d6b0e5c9a11.jpg',
	'filename': 'photo.jpg',
	'size': 3,
	'mime_type': 'image/jpeg',
};

/// A single-use delegated token — colons included, exactly what presign issues.
const String token = 'n0nce:1700000000:user-1:sig';

late Directory _dir;

/// A real temp file — the client reads it asynchronously, so a fake cannot
/// stand in for [File].
Future<File> photo(String name, [List<int> bytes = const [1, 2, 3]]) async {
	final file = File('${_dir.path}/$name');
	await file.writeAsBytes(bytes);
	return file;
}

void main() {
	setUpAll(() async {
		_dir = await Directory.systemTemp.createTemp('mmbix-files-test');
	});
	tearDownAll(() async {
		await _dir.delete(recursive: true);
	});

	group('files.upload', () {
		test('POSTs multipart to /media/upload with the bearer — no Idempotency-Key, no JSON content-type', () async {
			final fake = FakeTransport();
			fake.onceOk(envelope(asset));
			final storage = MemoryTokenStorage();
			storage.set('jwt-abc');
			final writes = <List<String>>[];
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: storage,
				onWrite: (path, method) => writes.add([path, method]),
			));

			final result = await client.files.upload(await photo('photo.jpg'));

			expect(result, asset);
			final req = fake.last;
			expect(req.url.path, '/api/media/upload');
			expect(authOf(req), 'Bearer jwt-abc');
			// The caller announces the multipart type + boundary — never JSON.
			expect(headerOf(req, 'Content-Type'), startsWith('multipart/form-data; boundary='));
			expect(req.body, isNull);
			// Uploads are exempt from the automatic Idempotency-Key.
			expect(idempotencyKeyOf(req), isNull);
			final text = bodyTextOf(req);
			// The File's own name rides on the part (the server derives the
			// stored key's extension from it)…
			expect(text, contains('Content-Disposition: form-data; name="file"; filename="photo.jpg"'));
			// …with the declared type matching the extension (the server
			// validates it against its allowlist BEFORE magic-byte sniffing).
			expect(text, contains('Content-Type: image/jpeg\r\n\r\n'));
			// The exact file bytes sit between the part headers and the trailing
			// CRLF — nothing re-encoded them.
			final headEnd = text.indexOf('\r\n\r\n');
			expect(text.substring(headEnd + 4, headEnd + 7), '\u0001\u0002\u0003');
			expect(text, endsWith('--\r\n'));
			// No visibility field by default — the server default ('public') applies.
			expect(text, isNot(contains('name="visibility"')));
			// A direct upload is an ordinary write to the app's hooks.
			expect(writes, [
				['/media/upload', 'POST'],
			]);
		});

		test('honors the filename override and visibility=MediaVisibility.private', () async {
			final fake = FakeTransport();
			fake.onceOk(envelope(asset));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));

			await client.files.upload(await photo('original.jpg'), filename: 'scan.png', visibility: MediaVisibility.private);

			final text = bodyTextOf(fake.last);
			expect(text, contains('filename="scan.png"'));
			// The declared type is inferred from the OVERRIDE name.
			expect(text, contains('Content-Type: image/png\r\n\r\n'));
			expect(text, contains('name="visibility"\r\n\r\nprivate'));
		});

		test('defaults to the 120s upload timeout and honors a per-call override', () async {
			final fake = FakeTransport();
			fake.onceOk(envelope(asset));
			fake.onceOk(envelope(asset));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			final file = await photo('photo.jpg');

			await client.files.upload(file);
			expect(fake.last.timeoutMs, uploadTimeoutMs);

			await client.files.upload(file, timeoutMs: 5000);
			expect(fake.last.timeoutMs, 5000);
		});

		test('a 401 heals through refresh-token rotation, then retries exactly once', () async {
			final fake = FakeTransport();
			final storage = MemoryTokenStorage();
			storage.set('stale');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			fake.onceOk(errorEnvelope(401, 'Invalid or expired token'));
			fake.onceOk(envelope({'token': 'fresh', 'refresh_token': 'refresh-2'}));
			fake.onceOk(envelope(asset));

			final result = await client.files.upload(await photo('photo.jpg'));

			expect(result, asset);
			expect(
				fake.calls.map((r) => [r.url.path, authOf(r)]).toList(),
				[
					['/api/media/upload', 'Bearer stale'],
					['/api/auth/refresh', null],
					['/api/media/upload', 'Bearer fresh'],
				],
			);
			expect(storage.getRefresh(), 'refresh-2');
		});

		test('a network-failed upload or presign never enqueues for offline replay', () async {
			final fake = FakeTransport();
			fake.onceThrow(Exception('network down'));
			fake.onceThrow(Exception('network down'));
			fake.onceThrow(Exception('network down'));
			final queue = OfflineQueue.create(OfflineQueueOptions(storage: MemoryQueueStorage()));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, offlineQueue: queue));
			final file = await photo('photo.jpg');

			// Binary — a media body is unreplayable (file lifetime, size).
			await expectLater(client.files.upload(file), throwsA(isA<ErpNetworkException>()));
			// noQueue — a replayed presign would mint a token nobody consumes.
			await expectLater(client.files.presign(), throwsA(isA<ErpNetworkException>()));
			// Self-auth — the delegated redeem is unreplayable by shape.
			await expectLater(client.files.uploadWithToken(file, token), throwsA(isA<ErpNetworkException>()));

			expect(queue.pending(), isEmpty);
		});
	});

	group('files.presign', () {
		test('POSTs /media/presign with the bearer and returns the token envelope', () async {
			final presigned = {
				'token': token,
				'expires_at': '2026-09-28T12:15:00.000Z',
				'upload_url': '/api/media/upload/$token',
				'max_bytes': 50000000,
			};
			final fake = FakeTransport();
			fake.onceOk(envelope(presigned));
			final storage = MemoryTokenStorage();
			storage.set('jwt-abc');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));

			expect(await client.files.presign(), presigned);

			expect(fake.last.url.path, '/api/media/presign');
			expect(authOf(fake.last), 'Bearer jwt-abc');
			// An ordinary mutation — the automatic Idempotency-Key applies.
			expect(idempotencyKeyOf(fake.last), isNotNull);
		});
	});

	group('files.uploadWithToken (delegated redeem)', () {
		test('redeems with NO bearer even when a session token is stored', () async {
			final fake = FakeTransport();
			fake.onceOk(envelope(asset));
			final storage = MemoryTokenStorage();
			storage.set('jwt-abc'); // a full session is present — the redeem must still not use it
			final writes = <String>[];
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: storage,
				onWrite: (path, _) => writes.add(path),
			));

			expect(await client.files.uploadWithToken(await photo('photo.jpg'), token), asset);

			// The raw token rides the path — colons unencoded, exactly the server's route.
			expect(fake.last.url.path, '/api/media/upload/$token');
			expect(authOf(fake.last), isNull);
			expect(idempotencyKeyOf(fake.last), isNull);
			// A self-auth path is excluded from write hooks — the uploader is not
			// necessarily the session user (shaped like the auth paths in every gate).
			expect(writes, isEmpty);
		});

		test('a 401 surfaces immediately — one call, no refresh, no bearer fallback', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => errorEnvelope(401, 'Upload token has already been used');
			final storage = MemoryTokenStorage();
			storage.set('jwt-abc');
			storage.setRefresh('refresh-1'); // a rotatable session exists — still no rotation
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: storage,
				refreshSession: () async => 'fresh',
			));

			await expectLater(
				client.files.uploadWithToken(await photo('photo.jpg'), token),
				throwsA(isA<ErpHttpException>().having((e) => e.status, 'status', 401)),
			);

			expect(fake.calls, hasLength(1));
			expect(fake.last.url.path, '/api/media/upload/$token');
		});

		test('never leaks the token to hooks — every listener sees the redacted path', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => errorEnvelope(401, 'Upload token expired');
			final settled = <String>[];
			final errors = <List<Object?>>[];
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				onSettled: (path, _, __) => settled.add(path),
				onError: (path, _, status, __) => errors.add([path, status]),
			));

			await expectLater(client.files.uploadWithToken(await photo('photo.jpg'), token), throwsA(isA<ErpHttpException>()));

			expect(settled, ['/media/upload/<token>']);
			expect(errors, [
				['/media/upload/<token>', 401],
			]);
			// Belt and braces: no captured label contains the credential bytes.
			expect([...settled, ...errors.map((e) => e[0])].every((p) => !'$p'.contains(token)), isTrue);
		});
	});
}
