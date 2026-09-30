// @vitest-environment jsdom
/**
 * SchemaFieldGrid — the schema view's card grid. Beyond rendering the "⋯" menu,
 * each card STATES the field's place on the detail form, because the menu's
 * Hide/width entries change a fact this surface otherwise never showed — which
 * made every click look like a no-op:
 *
 *   - a hidden field renders dimmed with an eye-off mark and no width chip,
 *   - a visible field states its named width as a chip (Half / Full / Fill),
 *   - a custom span (no named width) states no width — there is no name for it,
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

function mount(layoutOf?: (f: FieldDefinition) => FieldLayoutBinding) {
	return render(
		<SchemaFieldGrid fields={fields} onEditField={vi.fn()} onDuplicateField={vi.fn()} onRemoveField={vi.fn()} layoutOf={layoutOf} />,
	);
}

afterEach(() => cleanup());

describe('SchemaFieldGrid — the detail-form state on each card', () => {
	it('states a named width as a chip — Half / Full / Fill', () => {
		mount((f) => binding({ width: f.name === 'title' ? 'full' : f.name === 'body' ? 'fill' : 'half' }));
		expect(within(card('Title')).getByText('Full')).toBeTruthy();
		expect(within(card('Body')).getByText('Fill')).toBeTruthy();
		expect(within(card('Tags')).getByText('Half')).toBeTruthy();
	});

	it('states a custom span as nothing — there is no name for it', () => {
		mount((f) => binding({ width: f.name === 'title' ? null : 'half' }));
		expect(within(card('Title')).queryByTitle('Width on the detail form')).toBeNull();
	});

	it('dims a hidden field, marks it with an eye-off, and states no width', () => {
		mount((f) => binding({ hidden: f.name === 'body', width: 'full' }));
		const hiddenCard = card('Body');
		expect(hiddenCard.style.opacity).toBe('0.55');
		expect(within(hiddenCard).getByRole('img', { name: 'Hidden on the detail form' })).toBeTruthy();
		expect(within(hiddenCard).queryByTitle('Width on the detail form')).toBeNull();
		// A visible neighbour keeps its chip and its full opacity.
		expect(card('Title').style.opacity).not.toBe('0.55');
		expect(within(card('Title')).getByText('Full')).toBeTruthy();
	});

	it('invents no state on a surface that holds no layout', () => {
		mount(undefined);
		expect(screen.queryByRole('img', { name: 'Hidden on the detail form' })).toBeNull();
		expect(screen.queryByTitle('Width on the detail form')).toBeNull();
		// The menu still renders from the remaining capabilities.
		expect(screen.getAllByTitle('Field options')).toHaveLength(3);
	});

	it('holds the SAME binding the menu acts on — a width pick is the one the card shows', () => {
		const layouts = new Map([
			['title', binding({ hidden: false, width: 'half' })],
			['body', binding({ hidden: false, width: 'half' })],
			['tags', binding({ hidden: false, width: 'half' })],
		]);
		mount((f) => layouts.get(f.name)!);
		expect(within(card('Title')).getByText('Half')).toBeTruthy();
		fireEvent.click(within(card('Title')).getByTitle('Field options'));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Fill width' }));
		expect(layouts.get('title')!.onSetWidth).toHaveBeenCalledWith('fill');
		fireEvent.click(within(card('Title')).getByTitle('Field options'));
		fireEvent.click(screen.getByRole('menuitem', { name: 'Hide field on detail' }));
		expect(layouts.get('title')!.onSetHidden).toHaveBeenCalledWith(true);
	});
});
