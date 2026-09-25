/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, expect, it } from 'vitest';
import { SEARCHABLE_FIELD_TYPES, VALID_FIELD_TYPES } from '@mmbix/utils';
import type { EntitySchema } from '@mmbix/types';
import { SearchService } from '@/lib/services/search.service';

/**
 * The searchable-type list is declared ONCE (`@mmbix/utils`) and imported by
 * every search surface. This pins the global-search consumer: `_getTextFields`
 * used to carry its OWN narrower copy (text/longtext/slug only), which silently
 * excluded `code`, `email`, … — a drift bug. It now derives from the shared set.
 */
describe('search field types — one source', () => {
	it('the shared set is a subset of the valid field-type SSOT', () => {
		for (const t of SEARCHABLE_FIELD_TYPES) expect(VALID_FIELD_TYPES.has(t), t).toBe(true);
	});

	it('global search derives its text fields from the shared set (code/email included)', () => {
		const svc = new SearchService({} as never, null);
		const getTextFields = (svc as unknown as { _getTextFields: (c: EntitySchema) => string[] })._getTextFields.bind(svc);

		const fields = getTextFields({
			schema_json: JSON.stringify({
				fields: [
					{ name: 'title', type: 'text' },
					{ name: 'code', type: 'code' },
					{ name: 'email', type: 'email' },
					{ name: 'qty', type: 'integer' },
					{ name: 'id', type: 'text' }, // system field — always excluded
				],
			}),
		} as unknown as EntitySchema);

		expect(fields).toEqual(expect.arrayContaining(['title', 'code', 'email']));
		expect(fields).not.toContain('qty'); // numeric — never searched
		expect(fields).not.toContain('id'); // system field excluded
	});
});
