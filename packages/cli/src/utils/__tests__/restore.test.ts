import { describe, it, expect, vi } from 'vitest';
import { restoreSchemasIdempotent, type RestoreTransport } from '../restore.js';

/** Identity unwrap for tests. */
const unwrap = (s: Record<string, unknown>) => s;

function transport(overrides: Partial<Record<'exists' | 'create', unknown>> = {}) {
	const exists = typeof overrides.exists === 'function' ? (overrides.exists as (s: string) => Promise<boolean>) : async () => false;
	return {
		exists: vi.fn(exists),
		create: vi.fn(async () => {
			if (typeof overrides.create === 'function') await (overrides.create as () => Promise<void>)();
		}),
	};
}

const schema = (slug: string): Record<string, unknown> => ({ name: slug, slug, fields: [] });

describe('restoreSchemasIdempotent', () => {
	it('keeps existing collections untouched — never issues a create/delete', async () => {
		const t = transport({ exists: async () => true });
		const res = await restoreSchemasIdempotent([schema('a'), schema('b')], unwrap, t as unknown as RestoreTransport);

		expect(res).toEqual({ created: 0, kept: 2, failed: [] });
		// The invariant: an existing collection must not be created (and the old
		// delete-then-recreate path must not resurface) — create is never called.
		expect(t.create).not.toHaveBeenCalled();
		expect(t.exists).toHaveBeenCalledTimes(2);
	});

	it('creates collections that do not exist', async () => {
		const t = transport({ exists: async () => false });
		const res = await restoreSchemasIdempotent([schema('new1'), schema('new2')], unwrap, t as unknown as RestoreTransport);

		expect(res).toEqual({ created: 2, kept: 0, failed: [] });
		expect(t.create).toHaveBeenCalledTimes(2);
	});

	it('mixes kept + created based on existence', async () => {
		const t = transport({ exists: async (slug: string) => slug === 'existing' });
		const res = await restoreSchemasIdempotent([schema('existing'), schema('new')], unwrap, t as unknown as RestoreTransport);

		expect(res.created).toBe(1);
		expect(res.kept).toBe(1);
		expect(res.failed).toHaveLength(0);
	});

	it('a failed create is recorded and never deletes the (absent) collection — no data loss', async () => {
		// Collection is absent, so nothing existed to delete; create fails → failure
		// recorded, keep going. This is the data path the old code turned into
		// "delete → create fails → collection and rows lost".
		const t = transport({
			exists: async () => false,
			create: async () => {
				throw new Error('Field "x": unknown field "$" in expression');
			},
		});
		const res = await restoreSchemasIdempotent([schema('bad')], unwrap, t as unknown as RestoreTransport);

		expect(res).toEqual({ created: 0, kept: 0, failed: [{ slug: 'bad', error: 'Field "x": unknown field "$" in expression' }] });
		// create was attempted exactly once for the absent collection; the error path
		// never fell back to a destructive delete.
		expect(t.create).toHaveBeenCalledTimes(1);
	});

	it('a probe error keeps the collection as-is (safe default, never deletes)', async () => {
		const t = transport({
			exists: async () => {
				throw new Error('network');
			},
		});
		const res = await restoreSchemasIdempotent([schema('a')], unwrap, t as unknown as RestoreTransport);

		expect(res.kept).toBe(0);
		expect(res.created).toBe(0);
		expect(res.failed).toHaveLength(1);
		expect(t.create).not.toHaveBeenCalled();
	});
});
