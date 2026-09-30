/**
 * The header menu's Columns list. A column that offers `menuOptions` (a relation
 * column's "which field of the related row do I show?" picker) nests into its own
 * submenu — show/hide first, then the choices — while a column without them keeps
 * the flat show/hide checkbox it always had.
 *
 * The nested picker opens on CLICK (its parent list opens on hover): a nested
 * hover chain would fire while the pointer sweeps past the entry, and base-ui's
 * hover machinery needs real pointer geometry a test cannot provide.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { DataTable } from '../datatable';
import type { ColumnDef } from './core/types';

interface Employee {
	id: string;
	region: string;
	department: { id: string; name_mm: string } | null;
}

const rows: Employee[] = [{ id: '1', region: 'North', department: { id: 'd1', name_mm: 'Ops' } }];

const onSelect = vi.fn();

const columns: ColumnDef<Employee>[] = [
	{ id: 'region', accessorKey: 'region', header: 'Region' },
	{
		id: 'department',
		accessorKey: 'department',
		header: 'Department',
		menuOptions: [
			{ id: '', label: 'Default (automatic)', onSelect: () => onSelect('') },
			{ id: 'name_mm', label: 'Name (MM)', selected: true, onSelect: () => onSelect('name_mm') },
		],
	},
];

/** A menu entry by its visible label — base-ui renders menu items as `<div role="menuitem">`. */
function menuEntry(label: string): HTMLElement {
	const el = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((e) => e.textContent?.trim() === label);
	if (!el) throw new Error(`No menu entry labelled "${label}"`);
	return el;
}

/** A checkbox entry (menu items with a checked state) by its visible label. */
function menuCheckbox(label: string): HTMLElement {
	const el = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')).find(
		(e) => e.textContent?.trim() === label,
	);
	if (!el) throw new Error(`No checkbox entry labelled "${label}"`);
	return el;
}

/** Open the header menu, the Columns list, then the given column's nested picker. */
async function openColumnPicker(columnId: string, columnLabel: string) {
	fireEvent.click(document.querySelector<HTMLElement>(`th[data-column-id="${columnId}"] button`)!);
	const columnsEntry = await waitFor(() => menuEntry('Columns'));
	// The Columns list itself opens on hover — arm it with a move, then enter.
	fireEvent.mouseMove(columnsEntry);
	fireEvent.mouseEnter(columnsEntry);
	const entry = await waitFor(() => menuEntry(columnLabel));
	fireEvent.click(entry);
}

describe('DataTable header menu — a column with menuOptions', () => {
	it('nests into its own submenu that keeps show/hide and lists the choices', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openColumnPicker('department', 'Department');

		// The column's own visibility moved one level in, and the choices sit beside it.
		await waitFor(() => expect(menuCheckbox('Show column').getAttribute('aria-checked')).toBe('true'));
		expect(menuCheckbox('Default (automatic)').getAttribute('aria-checked')).toBe('false');
		expect(menuCheckbox('Name (MM)').getAttribute('aria-checked')).toBe('true');
		expect(document.querySelector('[data-slot="dropdown-menu-label"]')?.textContent).toBe('Display field');
	});

	it('reports the picked display field to the column', async () => {
		onSelect.mockClear();
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openColumnPicker('department', 'Department');
		fireEvent.click(await waitFor(() => menuCheckbox('Name (MM)')));

		expect(onSelect).toHaveBeenCalledWith('name_mm');
	});

	it('control — a column without menuOptions keeps the flat checkbox', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		fireEvent.click(document.querySelector<HTMLElement>('th[data-column-id="region"] button')!);
		const columnsEntry = await waitFor(() => menuEntry('Columns'));
		fireEvent.mouseMove(columnsEntry);
		fireEvent.mouseEnter(columnsEntry);
		fireEvent.click(await waitFor(() => menuCheckbox('Region')));

		expect(document.querySelector('th[data-column-id="region"]')).toBeNull();
	});
});
