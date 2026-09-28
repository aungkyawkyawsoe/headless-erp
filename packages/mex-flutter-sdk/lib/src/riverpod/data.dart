/// Read providers — a paged list, one row, a count, one-view-one-round-trip
/// views, and the cursor-walking infinite list.
///
/// All reads are auto-dispose (a screen's worth of cache, dropped when the
/// screen leaves; wrap a read in `ref.keepAlive()` to upgrade one to
/// app-lifetime) and refresh through [watchErpData] — precise, not periodic:
/// a write's change envelope invalidates exactly the collections it touched.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../client.dart' show QuerySpec;
import '../query.dart';
import 'client.dart';
import 'keys.dart';

/// One page of `GET /entities/<collection>` — the [ListResult] (rows + meta).
/// Add `count: true` to the query when the UI shows a total.
final erpItemsProvider = FutureProvider.autoDispose.family<ListResult, ErpItemsKey>((ref, key) async {
	final client = watchErpData(ref, {key.collection, ...key.invalidateOn});
	return client.items(key.collection).list(key.query);
});

/// One row by id (`GET /entities/<collection>/<id>`).
final erpItemProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, ErpItemKey>((ref, key) async {
	final client = watchErpData(ref, {key.collection, ...key.invalidateOn});
	return client.items(key.collection).get(key.id, fields: key.fields);
});

/// The matching total (COUNT only — no page SELECT behind it).
final erpCountProvider = FutureProvider.autoDispose.family<int, ErpCountKey>((ref, key) async {
	final client = watchErpData(ref, {key.collection, ...key.invalidateOn});
	return client.items(key.collection).count(filter: key.filter, search: key.search);
});

/// One-view-one-round-trip reads (`POST /api/query`): every spec executes in
/// parallel server-side and the keyed payload comes back in one response.
/// Per-key failure isolation is the server's contract — a source that fails
/// reports `ok: false` inside the payload; it never kills the view.
///
/// Invalidated when ANY spec's collection (or an `invalidateOn` entry) is
/// written.
final erpViewProvider = FutureProvider.autoDispose.family<Map<String, dynamic>, ErpViewKey>((ref, key) async {
	final client = watchErpData(ref, {
		for (final spec in key.specs) spec.collection,
		...key.invalidateOn,
	});
	return client.queryMany([
		for (final spec in key.specs)
			QuerySpec(
				key: spec.key,
				collection: spec.collection,
				query: serializeQuery(spec.query ?? const ListQuery()),
			),
	]);
});

/// The accumulating state of [erpInfiniteItemsProvider].
class ErpInfiniteItems {
	/// Every row loaded so far, oldest page first.
	final List<Map<String, dynamic>> items;

	/// The LAST page's meta (pagination cursor, optional total).
	final Map<String, Object?> meta;

	/// `meta.next_cursor` — null means the end was reached.
	final String? nextCursor;

	/// True while [ErpInfiniteItemsNotifier.loadMore] is in flight — the rows
	/// above stay visible.
	final bool loadingMore;

	const ErpInfiniteItems({
		required this.items,
		required this.meta,
		required this.nextCursor,
		this.loadingMore = false,
	});

	bool get hasMore => nextCursor != null;

	ErpInfiniteItems copyWith({
		List<Map<String, dynamic>>? items,
		Map<String, Object?>? meta,
		String? nextCursor,
		bool? loadingMore,
	}) =>
		ErpInfiniteItems(
			items: items ?? this.items,
			meta: meta ?? this.meta,
			nextCursor: nextCursor ?? this.nextCursor,
			loadingMore: loadingMore ?? this.loadingMore,
		);
}

/// Cursor-walking list — `build()` fetches the first page, [loadMore] appends
/// `meta.next_cursor` pages. A change envelope (or version bump) that touches
/// the collection invalidates the notifier, which RESETS to a fresh first
/// page — accumulated pages are not patched row-by-row.
final erpInfiniteItemsProvider =
	AsyncNotifierProvider.autoDispose.family<ErpInfiniteItemsNotifier, ErpInfiniteItems, ErpItemsKey>(
	ErpInfiniteItemsNotifier.new,
);

/// See [erpInfiniteItemsProvider].
class ErpInfiniteItemsNotifier extends AsyncNotifier<ErpInfiniteItems> {
	ErpInfiniteItemsNotifier(this.key);

	final ErpItemsKey key;

	@override
	Future<ErpInfiniteItems> build() async {
		final client = watchErpData(ref, {key.collection, ...key.invalidateOn});
		final page = await client.items(key.collection).list(key.query);
		return ErpInfiniteItems(items: page.data, meta: page.meta, nextCursor: _cursorOf(page.meta));
	}

	/// Fetch the next page. No-op while loading, at the end, or before the
	/// first page resolved. On failure the loaded rows stay and the error is
	/// rethrown for the caller's snackbar.
	Future<void> loadMore() async {
		final current = state.value;
		if (current == null || current.nextCursor == null || current.loadingMore) return;
		state = AsyncData(current.copyWith(loadingMore: true));
		final cursor = current.nextCursor;
		try {
			final client = ref.read(erpClientProvider);
			final base = key.query ?? const ListQuery();
			final page = await client.items(key.collection).list(ListQuery(
				filter: base.filter,
				fields: base.fields,
				sort: base.sort,
				limit: base.limit,
				cursor: cursor,
				search: base.search,
				count: base.count,
			));
			if (!ref.mounted) return;
			state = AsyncData(ErpInfiniteItems(
				items: [...current.items, ...page.data],
				meta: page.meta,
				nextCursor: _cursorOf(page.meta),
			));
		} catch (err, stack) {
			if (ref.mounted) state = AsyncData(current.copyWith(loadingMore: false));
			Error.throwWithStackTrace(err, stack);
		}
	}
}

String? _cursorOf(Map<String, Object?> meta) {
	final cursor = meta['next_cursor'];
	return cursor is String && cursor.isNotEmpty ? cursor : null;
}
