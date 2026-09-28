/// Typed query builder + wire serialization — the 1:1 Dart port of
/// `packages/sdk/src/query.ts`.
///
/// The SDK's query shapes mirror the entity engine's native contract:
///   filter[field][_op]=value       flat conditions
///   filter[_or][i][field][_op]     OR groups (AND-joined to the flat filters)
///   filter[_and][i][field][_op]    AND groups
///   fields=a,b,c                   projection (dot paths expand relations)
///   sort=-timestamp                +/- prefixed directions
///   `cursor=<keyset>`              stable cursor pagination (no OFFSET)
///
/// Footgun this module exists to prevent: the server SILENTLY drops an
/// unknown filter operator (`_startswith` misspelled as `_starts_with` gives
/// HTTP 200 with unfiltered data). The [F] factory helpers make a wrong
/// operator spelling unrepresentable — prefer them over hand-rolled maps.
library;

/// Page-size policy — canonical cross-package defaults, identical to the
/// server's `page-size.ts` (env-overridable at deploy time; the server exposes
/// the effective contract via `GET /api/meta` and the client re-discovers it
/// with `loadLimits()`).
const int defaultPageSize = 25;

/// The MOST rows a single read may return (raised from 100 to 500 so a
/// whole-set directory read is ONE round trip; only clients that explicitly
/// ask for a larger page get one — the default stays 25).
const int maxPageSize = 500;

/// The backend's per-batch cap for `POST /api/query` — the server SILENTLY
/// truncates at this many specs; the client mirrors it so both agree.
const int maxQueriesPerBatch = 12;

/// The backend-declared page-size contract (`GET /api/meta → data.pagination`).
class PageSizePolicy {
	final int defaultPageSize;
	final int maxPageSize;

	const PageSizePolicy(this.defaultPageSize, this.maxPageSize);
}

/// The SDK's built-in fallback — identical to the server's defaults.
const PageSizePolicy defaultPageSizePolicy =
	PageSizePolicy(defaultPageSize, maxPageSize);

/// Normalize a requested page size against a policy: missing/invalid → the
/// policy's default; larger than its max → clamped (the server truncates there
/// anyway).
int normalizePageSize(int? limit, [PageSizePolicy policy = defaultPageSizePolicy]) {
	if (limit == null || limit < 1) return policy.defaultPageSize;
	return limit > policy.maxPageSize ? policy.maxPageSize : limit;
}

/// An ordered multi-map of query-string parameters.
///
/// `Map<String, String>` would destroy REPEATED keys — the engine accepts
/// several `aggregate[op]` entries and reads `groupBy[]` as an array, so the
/// serializer keeps an ordered list of pairs, exactly like `URLSearchParams`.
class QueryParams {
	final List<MapEntry<String, String>> _pairs;

	QueryParams() : _pairs = [];

	/// Build from a plain map — escape-hatch shape for `request(query: …)`.
	/// Null values are skipped (the TS type excludes them).
	factory QueryParams.of(Map<String, Object?> values) {
		final params = QueryParams();
		for (final entry in values.entries) {
			final value = entry.value;
			if (value == null) continue;
			params.set(entry.key, value.toString());
		}
		return params;
	}

	/// `URLSearchParams.set` semantics — replace all occurrences of [key].
	void set(String key, String value) {
		_pairs.removeWhere((pair) => pair.key == key);
		_pairs.add(MapEntry(key, value));
	}

	/// `URLSearchParams.append` semantics — keep repeated keys.
	void add(String key, String value) {
		_pairs.add(MapEntry(key, value));
	}

	/// First value for [key], if any (`URLSearchParams.get`).
	String? get(String key) {
		for (final pair in _pairs) {
			if (pair.key == key) return pair.value;
		}
		return null;
	}

	Iterable<MapEntry<String, String>> get entries => List.unmodifiable(_pairs);

	int get length => _pairs.length;

	bool get isEmpty => _pairs.isEmpty;

	/// Percent-encoded `k=v&k2=v2` — same bytes as `URLSearchParams.toString()`
	/// (space → `+`, brackets → `%5B`, comma → `%2C`).
	String toQueryString() => _pairs
		.map((pair) =>
			'${Uri.encodeQueryComponent(pair.key)}=${Uri.encodeQueryComponent(pair.value)}')
		.join('&');

	@override
	String toString() => toQueryString();
}

/// The aggregate measures the engine understands (`aggregate[<op>]=<field>`).
enum AggregateOp {
	count('count'),
	countDistinct('count_distinct'),
	sum('sum'),
	avg('avg'),
	min('min'),
	max('max');

	/// The wire spelling the server matches on.
	final String wire;

	const AggregateOp(this.wire);
}

/// One aggregate measure — `AggregateMeasure(AggregateOp.sum, 'qty_on_hand')`
/// → `aggregate[sum]=qty_on_hand`.
class AggregateMeasure {
	final AggregateOp op;
	final String field;

	const AggregateMeasure(this.op, this.field);
}

/// The column name the engine returns an aggregate under: `${op}_${field}`
/// (e.g. `sum_qty_on_hand`, `count_id`). The alias is a SERVER contract, so it
/// is spelled ONCE here — inline the string and a server-side rename becomes a
/// silent null (the same failure class as a misspelled filter operator).
String aggregateAlias(AggregateOp op, String field) => '${op.wire}_$field';

/// A typed list query — the Dart port of the TS `ListQuery`.
class ListQuery {
	final Map<String, Object?>? filter;

	/// Column projection — `String` (`'a,b'` or `'*'`) or `List<String>`;
	/// dot paths (`author.name`) expand relations. Keep it to what the UI
	/// renders: the server skips relation resolution and decryption for
	/// unselected columns.
	final Object? fields;

	/// `-field` = descending; `List` for multi-column order.
	final Object? sort;

	final int? limit;

	/// Keyset cursor from a previous page's `meta.next_cursor`.
	final String? cursor;

	/// Global OR search across text-ish fields.
	final String? search;

	/// Include `total` in meta (runs a COUNT with the same WHERE).
	final bool? count;

	/// Only the total — skips the page SELECT entirely.
	final bool? countOnly;

	/// Aggregate measures — REPLACES the row projection; pair with [groupBy]
	/// for one row per bucket, or omit it for a single totals row.
	final List<AggregateMeasure>? aggregate;

	/// Group aggregate rows by plain columns or date buckets
	/// (`month(created_at)`). A grouped aggregate is NOT page-limited — the
	/// server fails loudly past a ceiling instead of truncating silently.
	final List<String>? groupBy;

	const ListQuery({
		this.filter,
		this.fields,
		this.sort,
		this.limit,
		this.cursor,
		this.search,
		this.count,
		this.countOnly,
		this.aggregate,
		this.groupBy,
	});
}

/// The entity engine's flat list contract: `{ data, meta }`.
class ListResult {
	final List<Map<String, dynamic>> data;
	final Map<String, Object?> meta;

	const ListResult(this.data, this.meta);
}

/// Filter factory helpers — a wrong operator spelling becomes unrepresentable.
///
/// Mirrors the TS `FilterCondition` operator set exactly (including the
/// server's `_startswith`/`_endswith` spelling, the `_in` comma-joined list
/// and boolean `_null`/`_empty` operators). A relation filter is expressed by
/// nesting: `{'issues_type': {'category': F.eq('id', x)}}` serializes to
/// `filter[issues_type][category][_eq]=x`.
abstract final class F {
	static Map<String, Object?> eq(String field, Object? value) => {field: {'_eq': value}};
	static Map<String, Object?> neq(String field, Object? value) => {field: {'_neq': value}};
	static Map<String, Object?> gt(String field, Object value) => {field: {'_gt': value}};
	static Map<String, Object?> gte(String field, Object value) => {field: {'_gte': value}};
	static Map<String, Object?> lt(String field, Object value) => {field: {'_lt': value}};
	static Map<String, Object?> lte(String field, Object value) => {field: {'_lte': value}};

	/// Comma-joined inclusive pair `"2024-01-01,2024-12-31"` — the backend
	/// splits on ',' into [a, b].
	static Map<String, Object?> between(String field, String range) => {field: {'_between': range}};

	/// `_in` (renamed because `in` is a Dart keyword).
	static Map<String, Object?> in_(String field, List<Object?> values) => {field: {'_in': values}};
	static Map<String, Object?> nin(String field, List<Object?> values) => {field: {'_nin': values}};

	static Map<String, Object?> contains(String field, String value) => {field: {'_contains': value}};
	static Map<String, Object?> icontains(String field, String value) => {field: {'_icontains': value}};
	static Map<String, Object?> ncontains(String field, String value) => {field: {'_ncontains': value}};

	/// The backend spells these `_startswith`/`_endswith` (NOT `_starts_with`).
	static Map<String, Object?> startswith(String field, String value) => {field: {'_startswith': value}};
	static Map<String, Object?> endswith(String field, String value) => {field: {'_endswith': value}};

	/// `= ''` — the backend ignores the value; serialized as true/false.
	static Map<String, Object?> empty(String field) => {field: {'_empty': true}};
	static Map<String, Object?> nempty(String field) => {field: {'_nempty': true}};

	static Map<String, Object?> isNull(String field) => {field: {'_null': true}};
	static Map<String, Object?> isNotNull(String field) => {field: {'_nnull': true}};

	/// OR group — `filter[_or][i][field][_op]` (AND-joined to flat filters).
	static Map<String, Object?> or(List<Map<String, Object?>> groups) => {'_or': groups};

	/// AND group — `filter[_and][i][field][_op]`.
	static Map<String, Object?> and(List<Map<String, Object?>> groups) => {'_and': groups};
}

const Set<String> _arrayOps = {'_in', '_nin'};
const Set<String> _boolOps = {'_null', '_nnull', '_empty', '_nempty'};

/// Serialize a single filter value for the wire (`_in` joins with commas).
String stringifyFilterValue(String op, Object? value) {
	if (value is DateTime) return _isoUtc(value);
	if (_boolOps.contains(op)) return _jsTruthy(value) ? 'true' : 'false';
	if (_arrayOps.contains(op)) {
		final list = value as List;
		return list.map(_jsString).join(',');
	}
	return _jsString(value);
}

/// Serialize a typed filter into `filter[...]` search params (flat + nested
/// relation paths + groups).
///
/// A relation filter recurses one level per hop: `{'issues_type': {'category':
/// {'_eq': id}}}` → `filter[issues_type][category][_eq]=id` (the engine's
/// `filter[parent.field][_op]` contract). The discriminator is the KEY SHAPE —
/// every operator is `_`-prefixed, so an object whose keys are NOT is a nested
/// relation, not a condition.
QueryParams serializeFilter(Map<String, Object?> filter, [QueryParams? params]) {
	final out = params ?? QueryParams();
	void walk(Map<String, Object?> f, String? groupPrefix) {
		for (final entry in f.entries) {
			final field = entry.key;
			if (field == '_or' || field == '_and') continue;
			final cond = entry.value;
			if (cond is! Map) continue;
			final condition = Map<String, Object?>.from(cond);
			// Nested relation filter — recurse, extending the path.
			if (!condition.keys.any((key) => key.startsWith('_'))) {
				walk(condition, groupPrefix != null ? '$groupPrefix[$field]' : 'filter[$field]');
				continue;
			}
			for (final opEntry in condition.entries) {
				final key = groupPrefix != null
					? '$groupPrefix[$field][${opEntry.key}]'
					: 'filter[$field][${opEntry.key}]';
				out.set(key, stringifyFilterValue(opEntry.key, opEntry.value));
			}
		}
		final ors = f['_or'];
		if (ors is List) {
			for (var i = 0; i < ors.length; i++) {
				final group = ors[i];
				if (group is Map) walk(Map<String, Object?>.from(group), 'filter[_or][$i]');
			}
		}
		final ands = f['_and'];
		if (ands is List) {
			for (var i = 0; i < ands.length; i++) {
				final group = ands[i];
				if (group is Map) walk(Map<String, Object?>.from(group), 'filter[_and][$i]');
			}
		}
	}

	walk(filter, null);
	return out;
}

/// Serialize a full list query into search params (fields/sort/filter/cursor…).
QueryParams serializeQuery([ListQuery query = const ListQuery()]) {
	final params = QueryParams();
	if (query.fields != null) {
		final fields = _joinOf(query.fields!);
		if (fields.isNotEmpty) params.set('fields', fields);
	}
	if (query.sort != null) {
		final sort = _joinOf(query.sort!);
		if (sort.isNotEmpty) params.set('sort', sort);
	}
	if (query.limit != null) params.set('limit', query.limit!.toString());
	if (query.cursor != null && query.cursor!.isNotEmpty) params.set('cursor', query.cursor!);
	if (query.search != null && query.search!.isNotEmpty) params.set('search', query.search!);
	if (query.count == true) params.set('count', 'true');
	if (query.countOnly == true) params.set('count_only', 'true');
	if (query.filter != null) serializeFilter(query.filter!, params);
	// groupBy/aggregate ride LAST (they replace the SELECT server-side). `add`
	// (not `set`) keeps repeated keys — the engine accepts several
	// `aggregate[op]` entries and reads `groupBy[]` as an array.
	for (final group in query.groupBy ?? const <String>[]) {
		if (group.isNotEmpty) params.add('groupBy[]', group);
	}
	for (final measure in query.aggregate ?? const <AggregateMeasure>[]) {
		if (measure.field.isNotEmpty) params.add('aggregate[${measure.op.wire}]', measure.field);
	}
	return params;
}

/// Normalize a fields/sort value (`String or List<String>`) to its wire string —
/// `List.join(',')` or the string itself, matching `String(fields)` in TS.
String _joinOf(Object value) {
	if (value is List) return value.map((item) => item.toString()).join(',');
	return value.toString();
}

/// `String(value)` in JS for JSON-decoded values — numbers print without the
/// `.0` Dart adds for whole doubles, booleans as true/false, null as 'null'.
String _jsString(Object? value) {
	if (value == null) return 'null';
	if (value is String) return value;
	if (value is num) return _jsNumber(value);
	if (value is bool) return value ? 'true' : 'false';
	return value.toString();
}

String _jsNumber(num value) {
	if (value is int) return value.toString();
	final d = value.toDouble();
	if (d.isFinite && d == d.truncateToDouble() && d.abs() < 1e15) {
		return d.toInt().toString();
	}
	return d.toString();
}

bool _jsTruthy(Object? value) {
	if (value == null) return false;
	if (value is bool) return value;
	if (value is num) return !value.isNaN && value != 0;
	if (value is String) return value.isNotEmpty;
	return true;
}

/// `Date.toISOString()` equivalent — `YYYY-MM-DDTHH:mm:ss.sssZ`, exactly the
/// bytes the TS SDK sends (Dart's `toIso8601String` omits milliseconds when
/// zero, so it is rebuilt by hand).
String _isoUtc(DateTime value) {
	final utc = value.toUtc();
	String pad(int n, [int width = 2]) => n.toString().padLeft(width, '0');
	return '${pad(utc.year, 4)}-${pad(utc.month)}-${pad(utc.day)}'
		'T${pad(utc.hour)}:${pad(utc.minute)}:${pad(utc.second)}'
		'.${pad(utc.millisecond, 3)}Z';
}
