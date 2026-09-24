import { describe, expect, it } from 'vitest';

import {
	REQUISITION_APPROVAL_SCOPE,
	REQUISITION_FILTER_LABELS,
	REQUISITION_FILTER_OPTIONS,
	REQUISITION_STATUS_VALUES,
	requisitionStatusOf,
} from './status';

/**
 * The store-requests list groups the lifecycle into tabs (Requested / Completed /
 * Rejected). These pin the two things that grouping can break silently:
 *
 *   1. `requisitionStatusOf` still classifies every STORED value correctly — it
 *      is the card's status source, shared with the goods-issue readers, so the
 *      five-value vocabulary must survive the tab change intact.
 *   2. the tab set itself — three tabs, no `all` catch-all, no `approved` tab
 *      (merged into `requested`), and no `partially_issued`/`fulfilled` tab
 *      (merged into `completed`).
 */

describe('requisitionStatusOf', () => {
	it('passes through every stored lifecycle value verbatim', () => {
		for (const value of ['requested', 'approved', 'partially_issued', 'fulfilled', 'cancelled'] as const) {
			expect(requisitionStatusOf(value, 'draft')).toBe(value);
		}
	});

	it('classifies a legacy draft with no status as requested', () => {
		expect(requisitionStatusOf(null, 'draft')).toBe('requested');
	});

	it('classifies a pre-workflow confirmed doc as approved', () => {
		// Before the workflow column, "confirmed" on a requisition meant approved.
		expect(requisitionStatusOf(null, 'confirmed')).toBe('approved');
	});

	it('keeps a cancelled doc cancelled even with no status', () => {
		expect(requisitionStatusOf(null, 'cancelled')).toBe('cancelled');
	});

	it('ignores an unrecognised status and falls back to the doc_status rule', () => {
		expect(requisitionStatusOf('not_a_state', 'confirmed')).toBe('approved');
	});
});

describe('REQUISITION_FILTER_OPTIONS', () => {
	it('is exactly three tabs, in render order', () => {
		expect(REQUISITION_FILTER_OPTIONS.map((o) => o.value)).toEqual(['requested', 'completed', 'rejected']);
	});

	it('has no "all" catch-all tab', () => {
		expect(REQUISITION_FILTER_OPTIONS.map((o) => o.value)).not.toContain('all');
	});

	it('has no separate approved tab (merged into requested)', () => {
		expect(REQUISITION_FILTER_OPTIONS.map((o) => o.value) as string[]).not.toContain('approved');
	});

	it('has no separate partially_issued / fulfilled tab (merged into completed)', () => {
		const values = REQUISITION_FILTER_OPTIONS.map((o) => o.value) as string[];
		expect(values).not.toContain('partially_issued');
		expect(values).not.toContain('fulfilled');
	});

	it('labels Completed (not Partially Issued / Fulfilled)', () => {
		expect(REQUISITION_FILTER_LABELS.completed).toBe('Completed');
	});

	it('surfaces rejected requests (cancelled) in their own tab', () => {
		expect(REQUISITION_FILTER_LABELS.rejected).toBe('Rejected');
	});
});

/**
 * The approval center's three decision chips folded onto the lifecycle. These pin
 * the two ways that fold can go silently wrong: a chip that drops a state (a
 * request vanishes from the approval center), and a state covered by TWO chips (a
 * requester sees it in two places).
 */
describe('REQUISITION_APPROVAL_SCOPE', () => {
	it('maps pending to the decide queue and rejected to the close state', () => {
		expect(REQUISITION_APPROVAL_SCOPE.pending).toEqual(['requested']);
		expect(REQUISITION_APPROVAL_SCOPE.rejected).toEqual(['cancelled']);
	});

	it('keeps every decided-and-not-refused state under Approved', () => {
		expect(REQUISITION_APPROVAL_SCOPE.approved).toEqual(['approved', 'partially_issued', 'fulfilled']);
	});

	it('partitions the whole lifecycle — each value covered exactly once', () => {
		const covered = Object.values(REQUISITION_APPROVAL_SCOPE).flat();
		expect([...covered].sort()).toEqual([...REQUISITION_STATUS_VALUES].sort());
		expect(new Set(covered).size).toBe(covered.length);
	});
});
