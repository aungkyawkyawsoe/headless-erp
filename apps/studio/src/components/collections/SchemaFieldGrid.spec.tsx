// @vitest-environment jsdom
/**
 * SchemaFieldGrid — the schema view's card grid. Beyond rendering the "⋯" menu,
 * each card STATES the field's place on the detail form, because the menu's
 * Hide/width entries change a fact this surface otherwise never showed — which
 * made every click look like a no-op:
 *
 *   - the width is the card's SPAN, not a label: the wide widths (Full / Fill)
 *     take both grid columns, Half (and a custom span) takes one,
 *   - a hidden field renders dimmed with an eye-off mark and KEEPS its span —
 *     hiding neither reflows the grid nor loses the placement,
 *   - a surface that holds no layout (the app workbench) gets no invented state.
 *
 * The menu keeps its own spec (FieldRowMenu.spec.tsx); here the point is that
 * the card reflects the SAME binding the menu acts on.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SchemaFieldGrid } from './SchemaFieldGrid';
import type { FieldLayoutBinding } from './FieldRowMenu';
import type { FieldDefinition } from '../../lib/api';

const fields: FieldDefinition[] = [
	{ name: 'title', type: 'string', label: 'Title' },
	{ name: 'body', type: 'text', label: 'Body' },
	{ name: 'tags', type: 'm2m', label: 'Tags' },
];

function binding(over: Partial<Pick<FieldLayoutBinding, 'hidden' | 'width'>> = {}): FieldLayoutBinding {
	return {
		hidden: over.hidden ?? false,
		width: over.width === undefined ? 'half' : over.width,
		onSetWidth: vi.fn(),
		onSetHidden: vi.fn(),
	};
}

/** The card element that carries `label` (the card's accessible text includes the label). */
function card(label: string): HTMLElement {
	const labelEl = screen.getByText(label);
	return labelEl.closest('[data-slot="card"]') as HTMLElement;
}

/** The span jsdom recorded — `grid-column` shorthand via either readback. */
function span(el: HTMLElement): string {
	return el.style.gridColumn || el.style.getPropertyValue('grid-column');
}

function mount(layoutOf?: (f: FieldDefinition) => FieldLayoutBinding) {
	return render(
		<SchemaFieldGrid fields={fields} onEditField={vi.fn()} onDuplicateField={vi.fn()} onRemoveField={vi.fn()} layoutOf={layoutOf} />,
	);
}

afterEach(() => cleanup());

describe('SchemaFieldGrid — the detail-form state on each card', () => {
	it('spans BOTH grid columns for the wide widths — Full and Fill take two, Half one', () => {
		mount((f) => binding({ width: f.name === 'title' ? 'full' : f.name === 'body' ? 'fill' : 'half' }));
		expect(span(card('Title'))).toBe('span 2');
		expect(span(card('Body'))).toBe('span 2');
		expect(span(card('Tags'))).toBe('span 1');
		// No width LABEL survives on the card — the span is the statement.
		expect(within(card('Title')).queryByText('Full')).toBeNull();
		expect(within(card('Tags')).queryByText('Half')).toBeNull();
	});

	it('takes one column for a custom span — there is no name for it, and no tooltip', () => {
		mount((f) => binding({ width: f.name === 'title' ? null : 'half' }));
		expect(span(card('Title'))).toBe('span 1');
		expect(card('Title').title).toBe('');
		// A named width does state itself in the tooltip — the fact a span cannot say is which width.
		expect(card('Body').title).toBe('Half width on the detail form');
	});

	it('dims a hidden field, marks it with an eye-off, and KEEPS its span', () => {
		mount((f) => binding({ hidden: f.name === 'body', width: 'full' }));
		const hiddenCard = card('Body');
		expect(hiddenCard.style.opacity).toBe('0.55');
		expect(within(hiddenCard).getByRole('img', { name: 'Hidden on the detail form' })).toBeTruthy();
		// Hiding does not reflow the grid — the placement showing it again restores is still there.
		expect(span(hiddenCard)).toBe('span 2');
		expect(hiddenCard.title).toBe('Hidden on the detail form');
		// A visible neighbour keeps its span and its full opacity.
		expect(card('Title').style.opacity).not.toBe('0.55');
		expect(span(card('Title'))).toBe('span 2');
	});

	it('invents no state on a surface that holds no layout', () => {
		mount(undefined);
		expect(screen.queryByRole('img', { name: 'Hidden on the detail form' })).toBeNull();
		for (const label of ['Title', 'Body', 'Tags']) {
			expect(span(card(label))).toBe('span 1');
			expect(card(label).title).toBe('');
		}
		// The menu still renders from the remaining capabilities.
		expect(screen.getAllByTitle('Field options')).toHaveLength(3);
	});

	it('holds the SAME binding the menu acts on — a width pick is the span the card shows', () => {
		const layouts = new Map([
			['title', binding({ hidden: false, width: 'half' })],
			['body', binding({ hidden: false, width: 'half' })],
			['tags', binding({ hidden: false, width: 'half' })],
		]);
		mount((f) => layouts.get(f.name)!);
		expect(span(card('Title'))).toBe('span 1');
		fireEvent.click(within(card('Title')).getByTitle('Field options'));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Fill width' }));
		expect(layouts.get('title')!.onSetWidth).toHaveBeenCalledWith('fill');
		fireEvent.click(within(card('Title')).getByTitle('Field options'));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Hide field on detail' }));
		expect(layouts.get('title')!.onSetHidden).toHaveBeenCalledWith(true);
	});
});
