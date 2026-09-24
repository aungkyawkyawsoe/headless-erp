// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { DocStatusPill } from './doc-status-pill';

/**
 * The lifecycle pill of the four document pages — ONE badge, whose optional `kind`
 * (the document's own kind) rides INSIDE it.
 *
 * The rule this pins: with a kind the badge reads one joined line (`Purchase ·
 * Confirmed`), and the STATUS keeps its own text node, so the status name still
 * resolves exactly once on the page (the page specs assert that count). Without a
 * kind the badge is the bare status — a writable draft keeps its own kind control,
 * so nothing is stated twice.
 */
describe('DocStatusPill', () => {
	it('joins the kind to the status in ONE badge', () => {
		render(<DocStatusPill status="confirmed" kind="Purchase" />);
		const pill = screen.getByText('Confirmed').parentElement as HTMLElement;
		// The badge's whole text is the joined line — one badge, not two facts.
		expect(pill.textContent).toBe('Purchase·Confirmed');
		// …and the status is still findable by its own name (the page specs count it).
		expect(screen.getAllByText('Confirmed')).toHaveLength(1);
	});

	it('is the bare status while the document still has its own kind control', () => {
		render(<DocStatusPill status="draft" />);
		const pill = screen.getByText('Draft') as HTMLElement;
		expect(pill.textContent).toBe('Draft');
	});

	it('a cancelled document reads its own tone, with its kind if it was given one', () => {
		render(<DocStatusPill status="cancelled" kind="Return" />);
		expect(screen.getByText('Cancelled').parentElement?.textContent).toBe('Return·Cancelled');
	});

	afterEach(cleanup);
});
