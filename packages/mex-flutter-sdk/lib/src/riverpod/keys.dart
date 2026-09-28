/// Family keys — value-equality wrappers around query arguments.
///
/// The SDK's [ListQuery] (and a filter map) carry no `==`, so a family keyed
/// on the raw objects would mint a NEW provider — and a new fetch — every
/// time a rebuild re-constructs an equal query. The keys here canonicalize
/// through the WIRE SERIALIZATION ([serializeQuery] / [serializeFilter]), so
/// two equal queries always land on one cache entry.
///
/// `invalidateOn` is the escape hatch for dot-path embeds: a change envelope
/// names the collections a write TOUCHED (its own row + cascade and hook
/// writes), not the collections others read FROM — a list embedding
/// `customer.name` refreshes on a `customers` write only when `customers` is
/// listed here.
library;

import '../permissions.dart';
import '../query.dart';

/// `x.length == y.length && x.containsAll(y)` — set equality without pulling
/// in `package:flutter/foundation.dart` for one call.
bool _sameSet(Set<String> x, Set<String> y) => x.length == y.length && x.containsAll(y);

/// Family key for `erpItemsProvider` — collection + typed query.
class ErpItemsKey {
	final String collection;
	final ListQuery? query;

	/// Additional collections whose writes must invalidate this read (see the
	/// library docstring).
	final Set<String> invalidateOn;

	ErpItemsKey(this.collection, [this.query, this.invalidateOn = const <String>{}]);

	late final String _canonicalQuery = serializeQuery(query ?? const ListQuery()).toQueryString();

	@override
	bool operator ==(Object other) =>
		other is ErpItemsKey &&
		other.collection == collection &&
		other._canonicalQuery == _canonicalQuery &&
		_sameSet(other.invalidateOn, invalidateOn);

	@override
	int get hashCode => Object.hash(collection, _canonicalQuery, Object.hashAllUnordered(invalidateOn));
}

/// Family key for `erpItemProvider` — collection + id + optional fields.
class ErpItemKey {
	final String collection;
	final String id;
	final Object? fields;
	final Set<String> invalidateOn;

	ErpItemKey(this.collection, this.id, {this.fields, this.invalidateOn = const <String>{}});

	late final String _canonicalFields = (fieldsToArray(fields) ?? const <String>[]).join(',');

	@override
	bool operator ==(Object other) =>
		other is ErpItemKey &&
		other.collection == collection &&
		other.id == id &&
		other._canonicalFields == _canonicalFields &&
		_sameSet(other.invalidateOn, invalidateOn);

	@override
	int get hashCode => Object.hash(collection, id, _canonicalFields, Object.hashAllUnordered(invalidateOn));
}

/// Family key for `erpCountProvider` — collection + filter + search.
class ErpCountKey {
	final String collection;
	final Map<String, Object?>? filter;
	final String? search;
	final Set<String> invalidateOn;

	ErpCountKey(this.collection, {this.filter, this.search, this.invalidateOn = const <String>{}});

	late final String _canonicalFilter = serializeFilter(filter ?? const <String, Object?>{}).toQueryString();

	@override
	bool operator ==(Object other) =>
		other is ErpCountKey &&
		other.collection == collection &&
		other._canonicalFilter == _canonicalFilter &&
		other.search == search &&
		_sameSet(other.invalidateOn, invalidateOn);

	@override
	int get hashCode => Object.hash(collection, _canonicalFilter, search, Object.hashAllUnordered(invalidateOn));
}

/// One keyed source of a one-view-one-round-trip read (`POST /api/query`).
class ErpViewSpec {
	final String key;
	final String collection;
	final ListQuery? query;

	ErpViewSpec(this.key, this.collection, [this.query]);

	late final String _canonicalQuery = serializeQuery(query ?? const ListQuery()).toQueryString();
}

/// Family key for `erpViewProvider` — the ordered spec list (order is part of
/// the request identity, so it is part of equality too) plus extra watched
/// collections.
class ErpViewKey {
	final List<ErpViewSpec> specs;
	final Set<String> invalidateOn;

	ErpViewKey(List<ErpViewSpec> specs, {this.invalidateOn = const <String>{}}) : specs = List.unmodifiable(specs);

	late final List<String> _canonicalSpecs = [
		for (final spec in specs) '${spec.key}\u0000${spec.collection}\u0000${spec._canonicalQuery}',
	];

	@override
	bool operator ==(Object other) {
		if (other is! ErpViewKey) return false;
		if (!_sameSet(other.invalidateOn, invalidateOn)) return false;
		if (other._canonicalSpecs.length != _canonicalSpecs.length) return false;
		for (var i = 0; i < _canonicalSpecs.length; i++) {
			if (other._canonicalSpecs[i] != _canonicalSpecs[i]) return false;
		}
		return true;
	}

	@override
	int get hashCode => Object.hash(Object.hashAll(_canonicalSpecs), Object.hashAllUnordered(invalidateOn));
}
