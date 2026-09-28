/// Permission-aware field pruning — the client half of "ask only what you may
/// see" (the server always ENFORCES the same rules; this avoids even asking).
/// 1:1 port of `packages/sdk/src/permissions.ts`.
///
/// `allowed` semantics match `/auth/me?collection=`:
///   null      → no restrictions (role sees every field)
///   []        → deny all (only `id` survives)
///   string[]  → whitelist of visible fields
library;

/// Normalize a fields projection (`String | List<String> | null`) to a plain
/// `List<String>` (null = not specified).
List<String>? fieldsToArray(Object? fields) {
	if (fields == null) return null;
	if (fields is String) {
		if (fields == '*') return ['*'];
		return fields
			.split(',')
			.map((s) => s.trim())
			.where((s) => s.isNotEmpty)
			.toList();
	}
	if (fields is List) return fields.map((f) => f.toString()).toList();
	return null;
}

/// Intersect a requested projection with the caller's field whitelist.
/// Returns the projection to actually send — never larger than allowed.
List<String>? restrictFields(List<String>? requested, List<String>? allowed) {
	if (allowed == null) return requested; // no restrictions
	if (allowed.isEmpty) return ['id']; // deny all
	if (requested == null || requested.isEmpty) return allowed; // no projection → whitelist caps it
	if (requested.contains('*')) return allowed; // "everything" → whitelist caps it
	final allowedSet = allowed.toSet();
	return requested.where(allowedSet.contains).toList(); // intersect named fields
}
