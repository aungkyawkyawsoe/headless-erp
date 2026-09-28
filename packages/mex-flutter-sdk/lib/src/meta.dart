/// `GET /api/meta` — the deployment's runtime contract discovery.
///
/// The server is the single source of truth for its page-size policy and its
/// error-code catalog; a client discovers both from here instead of hardcoding
/// them (`client.loadLimits()` / `client.fetchServerErrorCodes()`). The
/// built-in defaults in [query.dart] and [errors.dart] mirror the server's, so
/// an unreachable `/api/meta` degrades to identical behavior.
library;

import 'query.dart';

/// The parsed `/api/meta` payload (raw map kept for forward-compatible reads).
class MetaInfo {
	final PageSizePolicy? policy;

	/// The API-only error catalog this deployment emits
	/// (`error_codes` — the 12 server codes, no SDK-only ones).
	final List<String>? errorCodes;

	final Map<String, Object?> raw;

	const MetaInfo({this.policy, this.errorCodes, this.raw = const {}});
}

/// Parse a `/api/meta` response body. Never throws — malformed sections simply
/// come back null and callers keep their built-in defaults.
MetaInfo parseMeta(Object? data) {
	if (data is! Map) return const MetaInfo();
	final raw = Map<String, Object?>.from(data);
	return MetaInfo(policy: _policyOf(raw), errorCodes: _errorCodesOf(raw), raw: raw);
}

PageSizePolicy? _policyOf(Map<String, Object?> data) {
	final pagination = data['pagination'];
	if (pagination is! Map) return null;
	final d = _asNum(pagination['default_page_size']);
	final m = _asNum(pagination['max_page_size']);
	if (d == null || m == null || d < 1 || m < 1 || m < d) return null;
	return PageSizePolicy(d.toInt(), m.toInt());
}

List<String>? _errorCodesOf(Map<String, Object?> data) {
	final codes = data['error_codes'];
	if (codes is! List) return null;
	return codes.whereType<String>().toList();
}

/// `Number(value)` equivalent for the finite cases that matter — numbers pass
/// through, numeric strings parse, everything else (incl. NaN/∞) is null.
num? _asNum(Object? value) {
	if (value is num) return value.isFinite ? value : null;
	if (value is String) {
		final parsed = num.tryParse(value);
		return (parsed != null && parsed.isFinite) ? parsed : null;
	}
	return null;
}
