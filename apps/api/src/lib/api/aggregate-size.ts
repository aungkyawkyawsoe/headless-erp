import { MAX_AGGREGATE_GROUPS } from '@mmbix/config';
import { ValidationError } from '@mmbix/utils';

/**
 * Aggregate-size policy — the sibling of the page-size policy (`page-size.ts`)
 * for reads that are NOT paged.
 *
 * A grouped aggregate deliberately ignores `?limit=` (a chart needs EVERY
 * bucket), so the page-size contract does not bound it. That leaves one hole: an
 * unbounded `GROUP BY` on a high-cardinality column (e.g. `groupBy=id`) could
 * stream a response that threatens the worker. The engine therefore probes ONE
 * bucket past this ceiling and fails LOUDLY — a truncated chart that silently
 * lies is worse than an error that tells the caller to narrow the query.
 *
 * The ceiling itself lives in `@mmbix/config` (the same constant `GET /api/meta`
 * advertises as `data.aggregate.max_groups`), so the server and every client
 * read the SAME number.
 */
export { MAX_AGGREGATE_GROUPS };

/**
 * Enforce the bucket ceiling on a probe result fetched with
 * `LIMIT <ceiling> + 1`. More rows than the ceiling ⇒ the query overflowed it.
 */
export function assertGroupCeiling(observed: number, ceiling = MAX_AGGREGATE_GROUPS): void {
	if (observed > ceiling) {
		throw new ValidationError(`Aggregate exceeds ${ceiling} groups — narrow the query with filters or group by a lower-cardinality field`);
	}
}
