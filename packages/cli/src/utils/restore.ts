/**
 * Idempotent, non-destructive schema restore.
 *
 * Extracted from `db.ts` so the restore invariant can be unit-tested with fake
 * transport (no network): for each backed-up schema, PROBE whether the
 * collection already exists — if it does, KEEP it (never delete + recreate);
 * only CREATE absent collections. This is the fix that prevents data loss when
 * a create fails after the old code had already DELETEd the collection.
 */
export interface RestoreTransport {
	/** Resolve true when the collection already exists (e.g. GET detail 200), false otherwise. */
	exists(slug: string): Promise<boolean>;
	/** Create a collection from the unwrapped schema payload. */
	create(payload: Record<string, unknown>): Promise<void>;
}

export interface RestoreSchemaResult {
	/** Collections that did not exist and were created. */
	created: number;
	/** Collections that already existed and were kept untouched (never deleted). */
	kept: number;
	/** Collections whose create failed (recorded per slug, reported, no data lost). */
	failed: { slug: string; error: string }[];
}

/**
 * Restore schemas idempotently. Never deletes an existing collection. A
 * create failure is recorded (and, crucially, does not lose any data — the
 * collection was not deleted first).
 */
export async function restoreSchemasIdempotent(
	schemas: Record<string, unknown>[],
	unwrap: (schema: Record<string, unknown>) => Record<string, unknown>,
	transport: RestoreTransport,
): Promise<RestoreSchemaResult> {
	const result: RestoreSchemaResult = { created: 0, kept: 0, failed: [] };

	for (const schema of schemas) {
		const slug = String(schema.slug || schema.name || '');
		if (!slug) {
			result.failed.push({ slug: '<no-slug>', error: 'schema has no slug or name' });
			continue;
		}

		let existing = false;
		try {
			existing = await transport.exists(slug);
		} catch {
			// A transport error on the probe → safest default is to keep the
			// collection as-is (never risk deleting) and record the failure.
			result.failed.push({ slug, error: 'could not probe existence' });
			continue;
		}

		if (existing) {
			result.kept++;
			continue;
		}

		try {
			const payload = unwrap(schema);
			await transport.create(payload);
			result.created++;
		} catch (err) {
			result.failed.push({ slug, error: err instanceof Error ? err.message : String(err) });
		}
	}

	return result;
}
