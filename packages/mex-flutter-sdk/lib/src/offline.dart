/// Offline mutation queue — 1:1 port of `packages/sdk/src/offline.ts`.
///
/// Writes that fail at the network level are stashed here and replayed when
/// connectivity returns. Replays are idempotent by construction: POST bodies
/// carry a client-generated UUID (`id`), so a replayed create can never
/// duplicate a row (the API is idempotent on the primary key) — and a 409 on
/// replay means the row already landed, which is treated as success.
///
/// Storage + transport + token are injected, so the same queue runs in a
/// Flutter app (file/DB-backed storage) or in tests (memory storage).
library;

import 'dart:convert';
import 'dart:io';

import 'errors.dart';
import 'items.dart' show uuid;
import 'jwt.dart';
import 'log.dart';
import 'transport.dart';

class QueuedMutation {
	/// Client UUID — replay-safe identity (POST bodies carry it as `id`).
	final String id;
	final String method;

	/// Path relative to the API base, e.g. `/entities/records`.
	final String path;
	final Object? body;

	/// Optimistic-concurrency token captured when the write was queued.
	final String? ifMatch;

	/// Stable idempotency key captured when the write was queued — replays
	/// reuse it.
	final String? idempotencyKey;
	final int createdAt;

	const QueuedMutation({
		required this.id,
		required this.method,
		required this.path,
		this.body,
		this.ifMatch,
		this.idempotencyKey,
		required this.createdAt,
	});

	Map<String, Object?> toJson() => {
		'id': id,
		'method': method,
		'path': path,
		if (body != null) 'body': body,
		'ifMatch': ifMatch,
		'idempotencyKey': idempotencyKey,
		'createdAt': createdAt,
	};

	static QueuedMutation fromJson(Map<String, Object?> json) => QueuedMutation(
		id: json['id'] as String,
		method: json['method'] as String,
		path: json['path'] as String,
		body: json['body'],
		ifMatch: json['ifMatch'] as String?,
		idempotencyKey: json['idempotencyKey'] as String?,
		createdAt: (json['createdAt'] as num?)?.toInt() ?? 0,
	);
}

/// Stable dependency-free string hash (FNV-1a 32-bit) — used to fingerprint
/// the auth identity device-local state belongs to. NOT cryptographic: the
/// token it hashes already lives in the same storage, so this is an equality
/// check ("same user"), not a secret.
String fingerprint(String value) {
	var h = 0x811c9dc5;
	for (final unit in value.codeUnits) {
		h = h ^ unit;
		h = _mul32(h, 0x01000193);
	}
	return h.toRadixString(16).padLeft(8, '0');
}

/// `Math.imul(a, b)` for the low 32 bits — replicate JS semantics exactly so a
/// Dart fingerprint equals the TS one for the same input.
int _mul32(int a, int b) {
	final aLo = a & 0xffff;
	final bLo = b & 0xffff;
	final aHi = (a >> 16) & 0xffff;
	final bHi = (b >> 16) & 0xffff;
	final cross = (aLo * bHi + aHi * bLo) & 0xffff;
	return ((cross << 16) + aLo * bLo) & 0xffffffff;
}

/// Persistence seam for the queue.
abstract interface class QueueStorage {
	List<QueuedMutation> get();
	void set(List<QueuedMutation> items);

	/// Auth fingerprint of the user the stored items belong to
	/// (null = unclaimed/legacy).
	String? getFingerprint();
	void setFingerprint(String? fp);
}

class MemoryQueueStorage implements QueueStorage {
	List<QueuedMutation> _items = [];
	String? _fp;

	@override
	List<QueuedMutation> get() => _items;

	@override
	void set(List<QueuedMutation> items) => _items = items;

	@override
	String? getFingerprint() => _fp;

	@override
	void setFingerprint(String? fp) => _fp = fp;
}

/// File-backed queue — survives app restarts (the pure-Dart stand-in for the
/// TS `localStorageQueueStorage`; the Flutter adapter passes the docs dir).
/// Persisted shape is a versioned envelope `{ v: 2, fp, items }` where `fp` is
/// the auth fingerprint of the user who queued the writes (null = unclaimed).
/// A legacy bare-array file is read transparently and adopted on first write.
class FileQueueStorage implements QueueStorage {
	final File file;

	FileQueueStorage(this.file);

	({String? fp, List<QueuedMutation> items}) _readEnvelope() {
		try {
			if (!file.existsSync()) return (fp: null, items: []);
			final raw = file.readAsStringSync();
			if (raw.trim().isEmpty) return (fp: null, items: []);
			final parsed = jsonDecode(raw);
			if (parsed is List) {
				// Legacy v1 — a bare array.
				return (
					fp: null,
					items: parsed
						.whereType<Map>()
						.map((m) => QueuedMutation.fromJson(Map<String, Object?>.from(m)))
						.toList(),
				);
			}
			if (parsed is Map && parsed['items'] is List) {
				final items = (parsed['items'] as List)
					.whereType<Map>()
					.map((m) => QueuedMutation.fromJson(Map<String, Object?>.from(m)))
					.toList();
				return (fp: parsed['fp'] is String ? parsed['fp'] as String : null, items: items);
			}
			return (fp: null, items: []);
		} catch (_) {
			return (fp: null, items: []);
		}
	}

	void _write(String? fp, List<QueuedMutation> items) {
		try {
			file.parent.createSync(recursive: true);
			file.writeAsStringSync(jsonEncode({
				'v': 2,
				'fp': fp,
				'items': items.map((item) => item.toJson()).toList(),
			}));
		} catch (_) {
			/* storage unavailable — the in-memory copy still works this session */
		}
	}

	@override
	List<QueuedMutation> get() => _readEnvelope().items;

	@override
	void set(List<QueuedMutation> items) => _write(_readEnvelope().fp, items);

	@override
	String? getFingerprint() => _readEnvelope().fp;

	@override
	void setFingerprint(String? fp) => _write(fp, _readEnvelope().items);
}

class OfflineQueueOptions {
	final QueueStorage? storage;

	/// API base prefix — default `/api`.
	final String? baseUrl;

	/// Supplies the bearer token used when replaying (may have rotated).
	final String? Function()? getToken;

	/// Stable per-user identity used to scope the queue (defaults to a hash of
	/// the token's ACCOUNT subject — see [tokenSubjectOf]). The stored queue is
	/// tagged with this fingerprint so writes queued by one account are never
	/// replayed under another.
	final String? Function()? fingerprint;

	/// The HTTP transport used for replay (defaults to a real socket transport).
	final HttpTransportFn? transport;

	/// Called after each successful replay.
	final void Function(QueuedMutation item)? onReplayed;

	/// Called when a replay attempt fails — the item stays queued.
	final void Function(QueuedMutation item, Object error)? onFailed;

	const OfflineQueueOptions({
		this.storage,
		this.baseUrl,
		this.getToken,
		this.fingerprint,
		this.transport,
		this.onReplayed,
		this.onFailed,
	});
}

/// The queue API `HeadlessErpClient` consumes.
class OfflineQueue {
	final OfflineQueueOptions _options;
	final QueueStorage _storage;
	final String _baseUrl;
	final Set<void Function()> _listeners = {};

	OfflineQueue([OfflineQueueOptions options = const OfflineQueueOptions()])
		: _options = options,
		  _storage = options.storage ?? MemoryQueueStorage(),
		  _baseUrl = (options.baseUrl ?? '/api').replaceAll(RegExp(r'/+$'), '');

	/// Create a queue (mirrors the TS `createOfflineQueue` factory).
	static OfflineQueue create([OfflineQueueOptions options = const OfflineQueueOptions()]) =>
		OfflineQueue(options);

	void _emit() {
		for (final listener in List.of(_listeners)) {
			listener();
		}
	}

	/// Current user's fingerprint (null when no token — e.g. public/anon
	/// writes). Hashes the token's ACCOUNT subject, never the token bytes: the
	/// server mints a fresh token on every login/refresh, so a byte-wise hash
	/// would read the same human as a different account and strand their
	/// pending writes.
	String? _currentFingerprint() {
		final custom = _options.fingerprint;
		if (custom != null) return custom();
		final token = _options.getToken?.call();
		return token != null ? fingerprint(tokenSubjectOf(token)) : null;
	}

	QueuedMutation enqueue(
		String method,
		String path, [
		Object? body,
		String? ifMatch,
		String? idempotencyKey,
	]) {
		final fp = _currentFingerprint();
		final stored = _storage.getFingerprint();
		if (stored != null && fp != null && stored != fp) {
			// A different account's session — never mix accounts in one queue.
			// Any pending writes are dropped (they can never be replayed by the
			// right account from this device) and the tag moves to the writing
			// identity. An EMPTY queue has nothing to drop, so it just adopts
			// the new identity instead of warning about writes that do not exist.
			if (_storage.get().isNotEmpty) {
				sdkWarn(
					'[mmbix-sdk] offline queue: auth identity changed — discarding queued mutations from the previous session',
				);
				_storage.set([]);
			}
			_storage.setFingerprint(fp);
		} else if (stored == null && fp != null) {
			// Unclaimed/legacy queue — adopt it for this identity.
			_storage.setFingerprint(fp);
		}
		final item = QueuedMutation(
			id: uuid(),
			method: method,
			path: path,
			body: body,
			ifMatch: ifMatch,
			idempotencyKey: idempotencyKey,
			createdAt: DateTime.now().millisecondsSinceEpoch,
		);
		_storage.set([..._storage.get(), item]);
		_emit();
		return item;
	}

	/// All pending mutations, oldest first.
	List<QueuedMutation> pending() => _storage.get();

	/// Drop everything (e.g. after logout).
	void clear() {
		_storage.set([]);
		_storage.setFingerprint(null);
		_emit();
	}

	/// Subscribe to queue changes (drives sync banners). Returns unsubscribe.
	void Function() subscribe(void Function() listener) {
		_listeners.add(listener);
		return () => _listeners.remove(listener);
	}

	/// Replay all pending mutations in order. Resolves with the replayed count.
	Future<int> flush() async {
		final items = _storage.get();
		// Cross-account guard: a queue left by ANOTHER user must never replay
		// under the current token. Keep the items intact (no data loss — the
		// owning user may return) and surface the mismatch instead. With nothing
		// queued there is nothing to protect: adopt the current identity
		// silently, or a re-minted token would warn on every boot forever.
		final fp = _currentFingerprint();
		final stored = _storage.getFingerprint();
		if (stored != null && fp != null && stored != fp) {
			if (items.isEmpty) {
				_storage.setFingerprint(fp);
				return 0;
			}
			sdkWarn(
				'[mmbix-sdk] offline queue: stored mutations belong to a different account — skipping replay; call clearQueue() to discard',
			);
			return 0;
		}
		if (stored == null && fp != null) _storage.setFingerprint(fp);
		final remaining = <QueuedMutation>[];
		var replayed = 0;
		final transport = _options.transport ?? defaultTransport;

		for (final item in items) {
			try {
				final headers = <String, String>{'Content-Type': 'application/json'};
				// Read the token PER ITEM — it may rotate mid-flush.
				final token = _options.getToken?.call();
				if (token != null) headers['Authorization'] = 'Bearer $token';
				if (item.ifMatch != null) headers['If-Match'] = item.ifMatch!;
				// A keyed replay that already landed gets the middleware's cached
				// 2xx instead of a duplicate write — never a double-apply on
				// reconnect.
				if (item.idempotencyKey != null) {
					headers['Idempotency-Key'] = item.idempotencyKey!;
				}

				final res = await transport(ErpRequest(
					method: item.method,
					url: Uri.parse('$_baseUrl${item.path}'),
					headers: headers,
					body: item.body != null ? jsonEncode(item.body) : null,
				));
				// 2xx = applied now; 409 = the write already landed (duplicate
				// replay of an idempotent create) — both are success. EXCEPT a
				// 409 on a queued write that carried `ifMatch`: that is a REAL
				// optimistic-concurrency rejection — the record moved while
				// offline, the server refused the stale write. Permanent: drop it
				// (surfaced via onFailed), never count it as replayed. Other 4xx
				// (non-409) are permanent client errors too: retrying can never
				// help, so the item is DROPPED instead of retried forever.
				// 5xx/network stay queued for the next attempt.
				if (item.ifMatch != null && res.status == 409) {
					_options.onFailed?.call(
						item,
						const ErpException(
							'Replay conflict: the record changed while offline (If-Match mismatch)',
							409,
							'REPLAY_CONFLICT',
						),
					);
				} else if (res.status >= 200 && res.status < 300 || res.status == 409) {
					replayed++;
					_options.onReplayed?.call(item);
				} else if (res.status < 500) {
					_options.onFailed?.call(
						item,
						ErpException(
							'Replay dropped: permanent client error ${res.status}',
							res.status,
							'REPLAY_DROPPED',
						),
					);
				} else {
					remaining.add(item);
					_options.onFailed?.call(
						item,
						ErpException(
							'Replay failed with ${res.status}',
							res.status,
							'REPLAY_FAILED',
						),
					);
				}
			} catch (err) {
				// Still offline — keep the item and stop trying the rest this pass.
				remaining.add(item);
				_options.onFailed?.call(item, err);
			}
		}

		if (remaining.length != items.length) {
			_storage.set(remaining);
			_emit(); // something was replayed or dropped
		}
		return replayed;
	}
}
