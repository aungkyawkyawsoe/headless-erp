import { afterEach, describe, expect, it } from 'vitest';
import { configureDbLiveness, dbVerifiedWithin, invalidateDbLiveness, markDbVerified } from '../db-liveness';

/**
 * The liveness probe is a `sqlite_master` round trip shared by both migration
 * runners. It exists to detect a TEST database reset between tests, so the
 * window MUST stay short in tests and may be widened in production — otherwise
 * it is one wasted D1 round trip on nearly every real request.
 */
describe('db liveness dedupe window', () => {
	afterEach(() => configureDbLiveness(200)); // restore the test default

	it('honours a configured window', () => {
		configureDbLiveness(0);
		markDbVerified();
		// A zero window can never contain a proof — the probe always runs.
		expect(dbVerifiedWithin()).toBe(false);

		configureDbLiveness(60_000);
		markDbVerified();
		expect(dbVerifiedWithin()).toBe(true);
	});

	it('ignores a non-finite/negative window (keeps the previous value)', () => {
		configureDbLiveness(60_000);
		configureDbLiveness(-5);
		configureDbLiveness(Number.NaN);
		markDbVerified();
		expect(dbVerifiedWithin()).toBe(true);
	});

	it('a wiped database (invalidate) forces the next probe regardless of window', () => {
		configureDbLiveness(60_000);
		markDbVerified();
		expect(dbVerifiedWithin()).toBe(true);
		invalidateDbLiveness();
		expect(dbVerifiedWithin()).toBe(false);
	});
});
