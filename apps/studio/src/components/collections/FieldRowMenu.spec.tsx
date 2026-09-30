// @vitest-environment jsdom
/**
 * FieldRowMenu — the ONE per-field "⋯" menu both schema surfaces render.
 *
 * Two contracts matter and are pinned here:
 *
 *   1. an entry exists ONLY when its handler was passed — a surface that cannot
 *      duplicate a field must not show a dead "Duplicate field" (the app
 *      workbench passes delete alone), and a menu with NO capabilities renders
 *      no trigger at all,
 *   2. every entry that IS shown actually RUNS the handler it was given (the
 *      base-ui `onSelect`-vs-`onClick` mistake is exactly how entries went dead
 *      elsewhere in this repo), and
 *   3. the layout group follows Directus: the hide/show toggle is always offered
 *      where the host holds a layout, the width trio only for a field that is ON
 *      the form (a width for a field that renders nowhere has nothing to set),
 *      and the width the form already renders with is DISABLED.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldRowMenu, type FieldLayoutBinding } from './FieldRowMenu';
import type { FieldDefinition } from '../../lib/api';

const field: FieldDefinition = { name: 'item_name', type: 'string', label: 'Item Name' };

/** A layout binding whose handlers record what the menu ran. */
function binding(over: Partial<FieldLayoutBinding> = {}) {
	return {
		placed: over.placed ?? true,
		width: over.width === undefined ? ('half' as const) : over.width,
		onSetWidth: vi.fn(),
		onSetPlaced: vi.fn(),
	};
}

/** A menu item by name — the rendered text, including a leading icon. */
function item(name: string): HTMLElement {
	return screen.getByRole('menuitem', { name });
}

function isDisabled(el: HTMLElement): boolean {
	return el.hasAttribute('data-disabled');
}

/** Open the kebab and hand back the rendered menu items. */
function openMenu() {
	fireEvent.click(screen.getByTitle('Field options'));
}

afterEach(() => cleanup());

describe('FieldRowMenu', () => {
	it('renders no trigger when it has no capability — no dead control', () => {
		const { container } = render(<FieldRowMenu field={field} />);
		expect(container.querySelector('button')).toBeNull();
	});

	it('renders and RUNS each entry whose handler was passed', () => {
		const onEdit = vi.fn();
		const onDuplicate = vi.fn();
		const onRemove = vi.fn();
		render(<FieldRowMenu field={field} onEdit={onEdit} onDuplicate={onDuplicate} onRemove={onRemove} />);

		openMenu();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Edit field' }));
		expect(onEdit).toHaveBeenCalledWith(field);

		openMenu();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate field' }));
		expect(onDuplicate).toHaveBeenCalledWith(field);

		openMenu();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Delete field' }));
		expect(onRemove).toHaveBeenCalledWith('item_name');
	});

	it('omits the entries whose handler is absent — delete-only renders no Edit/Duplicate', () => {
		const onRemove = vi.fn();
		render(<FieldRowMenu field={field} onRemove={onRemove} />);
		openMenu();
		expect(screen.queryByRole('menuitem', { name: 'Edit field' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Duplicate field' })).toBeNull();
		expect(screen.getByRole('menuitem', { name: 'Delete field' })).toBeTruthy();
		// The destructive entry stands alone — no orphaned rule above it.
		expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).toBeNull();
	});

	it('separates the destructive entry from the rest when both are present', () => {
		render(<FieldRowMenu field={field} onEdit={vi.fn()} onRemove={vi.fn()} />);
		openMenu();
		expect(screen.getByRole('menuitem', { name: 'Edit field' })).toBeTruthy();
		expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).toBeTruthy();
	});

	it('hides Duplicate on a field a duplicate cannot be honest for, even when the handler is passed', () => {
		render(
			<FieldRowMenu
				field={{ name: 'tags', type: 'm2m', label: 'Tags', related_collection: 'hrm_employees' }}
				onEdit={vi.fn()}
				onDuplicate={vi.fn()}
				onRemove={vi.fn()}
			/>,
		);
		openMenu();
		expect(screen.queryByRole('menuitem', { name: 'Duplicate field' })).toBeNull();
		expect(screen.getByRole('menuitem', { name: 'Edit field' })).toBeTruthy();
		expect(screen.getByRole('menuitem', { name: 'Delete field' })).toBeTruthy();
	});
});

describe('FieldRowMenu — the layout group', () => {
	it('offers the width trio only for a field ON the form, with the current width disabled', () => {
		const layout = binding({ placed: true, width: 'half' });
		render(<FieldRowMenu field={field} layout={layout} />);
		openMenu();

		expect(item('Hide field on detail')).toBeTruthy();
		expect(isDisabled(item('Half width'))).toBe(true);
		expect(isDisabled(item('Full width'))).toBe(false);
		expect(isDisabled(item('Fill width'))).toBe(false);
		// The three widths live under one rule of their own.
		expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length).toBe(1);
	});

	it('omits the width trio for a field that is not on the form — but still offers to show it', () => {
		const layout = binding({ placed: false, width: null });
		render(<FieldRowMenu field={field} layout={layout} />);
		openMenu();

		expect(item('Show field on detail')).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: 'Half width' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Full width' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Fill width' })).toBeNull();
		// No orphaned rule where the trio would have been.
		expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).toBeNull();
	});

	it('enables all three widths for a custom span — no named width states the current shape', () => {
		render(<FieldRowMenu field={field} layout={binding({ placed: true, width: null })} />);
		openMenu();
		expect(isDisabled(item('Half width'))).toBe(false);
		expect(isDisabled(item('Full width'))).toBe(false);
		expect(isDisabled(item('Fill width'))).toBe(false);
	});

	it('RUNS the toggle in both directions', () => {
		const placed = binding({ placed: true, width: 'half' });
		const { unmount } = render(<FieldRowMenu field={field} layout={placed} />);
		openMenu();
		fireEvent.click(item('Hide field on detail'));
		expect(placed.onSetPlaced).toHaveBeenCalledWith(false);
		unmount();

		const hidden = binding({ placed: false, width: null });
		render(<FieldRowMenu field={field} layout={hidden} />);
		openMenu();
		fireEvent.click(item('Show field on detail'));
		expect(hidden.onSetPlaced).toHaveBeenCalledWith(true);
	});

	it('RUNS the width entries it offers', () => {
		const layout = binding({ placed: true, width: 'half' });
		render(<FieldRowMenu field={field} layout={layout} />);
		openMenu();
		fireEvent.click(item('Full width'));
		expect(layout.onSetWidth).toHaveBeenCalledWith('full');
		openMenu();
		fireEvent.click(item('Fill width'));
		expect(layout.onSetWidth).toHaveBeenCalledWith('fill');
		// The width the form already renders with is dead, not a re-write of the same value.
		openMenu();
		fireEvent.click(item('Half width'));
		expect(layout.onSetWidth).toHaveBeenCalledTimes(2);
	});

	it('renders the trigger for a layout-only menu — and nothing it was not handed', () => {
		render(<FieldRowMenu field={field} layout={binding({ placed: true, width: 'half' })} />);
		openMenu();
		expect(item('Hide field on detail')).toBeTruthy();
		expect(screen.queryByRole('menuitem', { name: 'Edit field' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Duplicate field' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Delete field' })).toBeNull();
	});

	it('leaves the menu untouched where the host holds no layout — no hidden state invented', () => {
		render(<FieldRowMenu field={field} onEdit={vi.fn()} onRemove={vi.fn()} />);
		openMenu();
		expect(screen.queryByRole('menuitem', { name: 'Hide field on detail' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Show field on detail' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Half width' })).toBeNull();
		expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]').length).toBe(1);
	});
});
