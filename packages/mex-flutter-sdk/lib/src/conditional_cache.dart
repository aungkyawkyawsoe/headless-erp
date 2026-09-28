/// Conditional-GET cache — revalidation for read requests, optionally
/// persisted. 1:1 port of `packages/sdk/src/conditional-cache.ts`.
///
/// The API stamps a weak `ETag` on every successful GET. Replaying that tag as
/// `If-None-Match` lets an unchanged read answer `304 Not Modified`: no body
/// crosses the wire and the client keeps exactly what it already had. To honour
/// a 304 the client must still hold the previous body, so this store keeps the
/// tag together with the last `{ data, meta }` for that URL.
///
/// Correctness needs no invalidation logic: the server decides equality, and a
/// matching tag is a hash of the very body it would send — so a hit is proof
/// the cached body is current.
///
/// ── Persistence (offline reads) ──────────────────────────────────────────────
/// An entry is written to [ResponseCacheStorage] ONLY when the server blessed
/// the response with `X-Offline-Max-Age` (the collection's
/// `policies.offline_reads`), and only for that many seconds — deny-by-default,
/// with the allowlist living in the schema and enforced per response.
///
/// A persisted body is a copy the server can no longer reach, so the envelope
/// is tagged with the auth fingerprint that wrote it: [hydrate] discards a copy
/// that belongs to another account rather than serving it to this session.
library;

import 'dart:convert';
import 'dart:io';

class CachedResponse {
	/// The `ETag` the server sent with this body.
	final String etag;

	/// The parsed `data` of the last 200 for this URL.
	final Object? data;

	/// The `meta` that accompanied it (pagination/count), if any.
	final Map<String, Object?>? meta;

	/// Epoch ms the entry was stored — the clock the offline window runs on.
	final int? storedAt;

	/// Server-granted offline window in seconds (`X-Offline-Max-Age`).
	/// Absent ⇒ the server did not authorize persisting this response.
	final num? maxAgeS;

	const CachedResponse({
		required this.etag,
		required this.data,
		this.meta,
		this.storedAt,
		this.maxAgeS,
	});

	Map<String, Object?> toJson() => {
		'etag': etag,
		'data': data,
		if (meta != null) 'meta': meta,
		if (storedAt != null) 'storedAt': storedAt,
		if (maxAgeS != null) 'maxAgeS': maxAgeS,
	};

	static CachedResponse fromJson(Map<String, Object?> json) => CachedResponse(
		etag: json['etag'] as String,
		data: json['data'],
		meta: json['meta'] is Map ? Map<String, Object?>.from(json['meta'] as Map) : null,
		storedAt: (json['storedAt'] as num?)?.toInt(),
		maxAgeS: json['maxAgeS'] as num?,
	);
}

class PersistedResponse {
	final String key;
	final CachedResponse entry;

	const PersistedResponse(this.key, this.entry);

	Map<String, Object?> toJson() => {'key': key, 'entry': entry.toJson()};

	static PersistedResponse fromJson(Map<String, Object?> json) => PersistedResponse(
		json['key'] as String,
		CachedResponse.fromJson(Map<String, Object?>.from(json['entry'] as Map)),
	);
}

/// Device-persistence seam for offline reads. All four members are required —
/// unlike the TS optional-method interface, Dart adapters implement the whole
/// contract (the TS optionality existed for legacy JS adapters only).
abstract interface class ResponseCacheStorage {
	List<PersistedResponse> get();
	void set(List<PersistedResponse> entries);
	String? getFingerprint();
	void setFingerprint(String? fp);
}

/// In-memory storage — the default; nothing survives the process.
class MemoryResponseCacheStorage implements ResponseCacheStorage {
	List<PersistedResponse> _entries = [];
	String? _fp;

	@override
	List<PersistedResponse> get() => _entries;

	@override
	void set(List<PersistedResponse> entries) => _entries = entries;

	@override
	String? getFingerprint() => _fp;

	@override
	void setFingerprint(String? fp) => _fp = fp;
}

/// File-backed response store — survives app restarts (the pure-Dart stand-in
/// for the TS `localStorageResponseStorage`; the Flutter adapter passes the
/// app-support dir). Persisted shape is a versioned envelope
/// `{ v: 1, fp, entries }` where `fp` is the auth fingerprint of the account
/// whose rows these are (null = unclaimed) — a device shared between two
/// accounts never serves one user's cached rows to the other.
class FileResponseCacheStorage implements ResponseCacheStorage {
	final File file;

	FileResponseCacheStorage(this.file);

	({String? fp, List<PersistedResponse> entries}) _readEnvelope() {
		try {
			if (!file.existsSync()) return (fp: null, entries: []);
			final raw = file.readAsStringSync();
			if (raw.trim().isEmpty) return (fp: null, entries: []);
			final parsed = jsonDecode(raw);
			if (parsed is Map && parsed['entries'] is List) {
				final entries = (parsed['entries'] as List)
					.whereType<Map>()
					.map((m) => PersistedResponse.fromJson(Map<String, Object?>.from(m)))
					.toList();
				return (fp: parsed['fp'] is String ? parsed['fp'] as String : null, entries: entries);
			}
			return (fp: null, entries: []);
		} catch (_) {
			return (fp: null, entries: []);
		}
	}

	void _write(String? fp, List<PersistedResponse> entries) {
		try {
			file.parent.createSync(recursive: true);
			file.writeAsStringSync(jsonEncode({
				'v': 1,
				'fp': fp,
				'entries': entries.map((entry) => entry.toJson()).toList(),
			}));
		} catch (_) {
			/* storage unavailable — the in-memory copy still works this session */
		}
	}

	@override
	List<PersistedResponse> get() => _readEnvelope().entries;

	@override
	void set(List<PersistedResponse> entries) => _write(_readEnvelope().fp, entries);

	@override
	String? getFingerprint() => _readEnvelope().fp;

	@override
	void setFingerprint(String? fp) => _write(fp, _readEnvelope().entries);
}

/// The ETag store: LRU-capped in memory, plus the persistable subset on a
/// device storage when one is injected.
class ConditionalResponseCache {
	/// Insertion-ordered map doubles as the LRU: [get] re-inserts on hit.
	final Map<String, CachedResponse> _store = {};
	final int maxEntries;
	final ResponseCacheStorage? storage;

	/// Cap on PERSISTED entries — a device store is far scarcer than memory.
	final int maxPersisted;
	bool _hydrated = false;
	String? _fp;
	final int Function() _now;

	ConditionalResponseCache({
		this.maxEntries = 200,
		this.storage,
		this.maxPersisted = 60,
		int Function()? now,
	}) : _now = now ?? _epochMs;

	/// The store's clock in epoch ms — the client timestamps entries with it so
	/// an injected test clock governs every timestamp the store sees.
	int clockMs() => _now();

	CachedResponse? get(String key) {
		final hit = _store.remove(key);
		if (hit == null) return null;
		_store[key] = hit;
		return hit;
	}

	void set(String key, CachedResponse entry) {
		_store.remove(key);
		_store[key] = entry;
		while (_store.length > maxEntries) {
			final oldest = _store.keys.first;
			_store.remove(oldest);
		}
		if (entry.maxAgeS != null) _persist();
	}

	bool delete(String key) {
		final removed = _store.remove(key) != null;
		if (removed && storage != null) _persist();
		return removed;
	}

	/// Drop everything, memory AND device. Called on logout.
	void clear() {
		_store.clear();
		storage?.set([]);
		storage?.setFingerprint(null);
		_hydrated = true;
		_fp = null;
	}

	int get size => _store.length;

	/// May this entry be served without the network?
	bool isFresh(CachedResponse entry, [int? now]) {
		final at = now ?? _now();
		return entry.maxAgeS != null &&
			entry.storedAt != null &&
			at - entry.storedAt! < entry.maxAgeS! * 1000;
	}

	/// Adopt device-persisted entries for [fingerprint]'s account. Idempotent
	/// per identity: a changed identity (login/logout/another account) drops
	/// the previous copy instead of letting it be replayed under the new
	/// session.
	void hydrate(String? fingerprint) {
		final storage = this.storage;
		if (storage == null) return;
		if (_hydrated && fingerprint == _fp) return;
		if (_hydrated) {
			_store.clear();
			storage.set([]);
			storage.setFingerprint(null);
		}
		_fp = fingerprint;
		_hydrated = true;

		final storedFp = storage.getFingerprint();
		if (storedFp != null && fingerprint != null && storedFp != fingerprint) {
			// Another account's device copy — never serve it to this session.
			storage.set([]);
			storage.setFingerprint(null);
			return;
		}
		if (storedFp == null && fingerprint != null) storage.setFingerprint(fingerprint);

		final now = _now();
		for (final persisted in storage.get()) {
			if (!isFresh(persisted.entry, now) || _store.containsKey(persisted.key)) {
				continue;
			}
			_store[persisted.key] = persisted.entry;
		}
	}

	/// Write the persistable (server-blessed, unexpired) entries to the device.
	void _persist() {
		final storage = this.storage;
		if (storage == null) return;
		final entries = <PersistedResponse>[];
		for (final entry in _store.entries) {
			if (entry.value.maxAgeS != null && isFresh(entry.value)) {
				entries.add(PersistedResponse(entry.key, entry.value));
			}
		}
		storage.set(
			entries.length > maxPersisted
				? entries.sublist(entries.length - maxPersisted)
				: entries,
		);
		storage.setFingerprint(_fp);
	}
}

int _epochMs() => DateTime.now().millisecondsSinceEpoch;
