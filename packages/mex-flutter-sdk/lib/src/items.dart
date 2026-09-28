/// Fluent typed CRUD over the entity engine: `client.items('records')`.
/// 1:1 port of `packages/sdk/src/items.ts`.
///
/// Write operations are replay-safe by design:
///   - `create` attaches a client-generated UUID — a retried/replayed POST can
///     never duplicate a row (the API is idempotent on the primary key).
///   - `idempotencyKey` rides along for server-side dedupe of whole batches.
///   - `ifMatch` (optimistic concurrency) makes the API 409 a stale overwrite.
library;

import 'dart:math';

import 'query.dart';
import 'requester.dart';

/// The header a guard-warning acknowledgement rides on — the wire name the API
/// reads (`apps/api` `lib/write-ack.ts`). Header names are case-insensitive.
const String writeAckHeader = 'X-Write-Ack';

/// RFC 4122 v4 UUID — `crypto.randomUUID()` equivalent, from a CSPRNG
/// (`Random.secure`), formatted exactly like the TS SDK's fallback.
String uuid() {
	final rng = Random.secure();
	final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
	bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
	final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
	return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
		'${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}

/// Options for [ItemsApi.create].
class CreateOptions {
	/// Client-generated UUID — replay-safe creates. Defaults to a random UUID.
	final String? id;

	/// Server-side idempotency key (Stripe-style replay protection).
	final String? idempotencyKey;

	/// Acknowledges a guard WARNING the server already showed the caller (e.g.
	/// the same-day duplicate requisition), letting the write proceed where the
	/// unacknowledged one is refused. The token comes from the guard's own
	/// pre-flight read — never hardcode one — and rides as the `X-Write-Ack`
	/// header, so it can never leak into the record.
	final String? ack;

	/// Runtime validation (e.g. a typegen-generated parser).
	final Object? Function(Object? data)? validate;

	const CreateOptions({this.id, this.idempotencyKey, this.ack, this.validate});
}

/// Options for [ItemsApi.update].
class UpdateOptions {
	final String? idempotencyKey;

	/// Expected `updated_at` — the API 409s when the row changed since.
	final String? ifMatch;

	final String? ack;
	final Object? Function(Object? data)? validate;

	const UpdateOptions({this.idempotencyKey, this.ifMatch, this.ack, this.validate});
}

/// Options for [ItemsApi.remove].
class RemoveOptions {
	final String? ifMatch;

	const RemoveOptions({this.ifMatch});
}

/// The headers ONE write needs — currently only a confirmed guard warning.
Map<String, String>? _ackHeaders(String? ack) =>
	ack != null ? {writeAckHeader: ack} : null;

/// The fluent CRUD API bound to one collection.
class ItemsApi {
	final String _collection;
	final RequestMetaFn _request;
	final PageSizePolicy Function() _policy;

	ItemsApi(this._collection, this._request, this._policy);

	String _entity(String id) => '/entities/$_collection/${Uri.encodeComponent(id)}';

	/// One cursor-paginated page.
	Future<ListResult> list([ListQuery? query]) async {
		// Page-size policy is resolved PER CALL — a getter can be passed so a
		// policy adopted later (client.loadLimits()) is honored by an ItemsApi
		// that was created before the policy changed. An unspecified limit
		// becomes the policy default (25); anything above the policy max is
		// clamped — the server truncates there anyway. Callers that need more
		// rows must cursor-walk.
		final limit = normalizePageSize(query?.limit, _policy());
		final q = query ?? const ListQuery();
		final params = serializeQuery(ListQuery(
			filter: q.filter,
			fields: q.fields,
			sort: q.sort,
			limit: limit,
			cursor: q.cursor,
			search: q.search,
			count: q.count,
			countOnly: q.countOnly,
			aggregate: q.aggregate,
			groupBy: q.groupBy,
		));
		// Wire contract: `{ success, data: T[], meta: { limit, has_more, cursor… } }`.
		final res = await _request<List<dynamic>>(
			'/entities/$_collection',
			RequestOptions(query: params),
		);
		return ListResult(
			res.data.cast<Map<String, dynamic>>(),
			res.meta ?? const <String, Object?>{},
		);
	}

	/// Total rows matching a filter (COUNT only — no page SELECT).
	Future<int> count({Map<String, Object?>? filter, String? search}) async {
		final params = serializeQuery(ListQuery(
			filter: filter,
			search: search,
			countOnly: true,
			limit: 1,
		));
		final res = await _request<List<dynamic>>(
			'/entities/$_collection',
			RequestOptions(query: params),
		);
		final total = res.meta?['total'];
		if (total is num) return total.toInt();
		if (total is String) return num.tryParse(total)?.toInt() ?? 0;
		return 0;
	}

	/// A single row by id (lean projection via [fields]).
	Future<Map<String, dynamic>> get(String id, {Object? fields}) async {
		final res = await _request<Map<String, dynamic>>(
			_entity(id),
			RequestOptions(
				query: fields != null
					? QueryParams.of({'fields': _fieldsString(fields)})
					: null,
			),
		);
		return res.data;
	}

	/// Create — client-generated UUID + optional idempotency key.
	Future<Map<String, dynamic>> create(
		Map<String, Object?> body, [
		CreateOptions? options,
	]) async {
		final res = await _request<Map<String, dynamic>>(
			'/entities/$_collection',
			RequestOptions(
				method: 'POST',
				body: {'id': options?.id ?? uuid(), ...body},
				headers: _ackHeaders(options?.ack),
				idempotencyKey: options?.idempotencyKey,
				validate: options?.validate,
			),
		);
		return res.data;
	}

	/// Update — pass `ifMatch` to guard against clobbering concurrent edits.
	Future<Map<String, dynamic>> update(
		String id,
		Map<String, Object?> body, [
		UpdateOptions? options,
	]) async {
		final res = await _request<Map<String, dynamic>>(
			_entity(id),
			RequestOptions(
				method: 'PUT',
				body: body,
				headers: _ackHeaders(options?.ack),
				idempotencyKey: options?.idempotencyKey,
				ifMatch: options?.ifMatch,
				validate: options?.validate,
			),
		);
		return res.data;
	}

	/// Soft delete.
	Future<Map<String, dynamic>> remove(String id, [RemoveOptions? options]) async {
		final res = await _request<Map<String, dynamic>>(
			_entity(id),
			RequestOptions(method: 'DELETE', ifMatch: options?.ifMatch),
		);
		return res.data;
	}
}

/// `String(fields)` equivalent — `List.join(',')` or the value itself.
String _fieldsString(Object fields) {
	if (fields is List) return fields.map((f) => f.toString()).join(',');
	return fields.toString();
}
