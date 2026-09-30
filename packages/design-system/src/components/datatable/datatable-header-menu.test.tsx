/**
 * The header's two column menus. A column that offers `menuOptions` (a relation
 * column's "which field of the related row do I show? — and which of them as a
 * column of their own?" picker) nests into its own submenu — show/hide first,
 * then the choices grouped under their section headings — while a column without
 * them keeps the flat show/hide checkbox it always had.
 *
 * The SAME entries are listed by the header-edge `+` (add column) menu, minus
 * the columns that opted out with `hideInAddMenu` (a derived relation column is
 * toggled inside its relation's picker, not by a second door of its own).
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
	{ id: 'region', accessorKey: 'region', header: 'Region', footer: 'Total' },
	{
		id: 'department',
		accessorKey: 'department',
		header: 'Department',
		menuOptions: [
			{ id: '', label: 'Default (automatic)', group: 'Display field', onSelect: () => onSelect('') },
			{ id: 'name_mm', label: 'Name (MM)', group: 'Display field', selected: true, onSelect: () => onSelect('name_mm') },
			{ id: 'column:code', label: 'Code', group: 'Show as column', onSelect: () => onSelect('column:code') },
			{ id: 'column:name_mm', label: 'Name (MM)', group: 'Show as column', selected: true, onSelect: () => onSelect('column:name_mm') },
		],
	},
];

/** A relation's related field shown as its OWN column — toggled inside the
 *  relation's picker, so it opts out of the `+` list. */
const columnsWithDerived: ColumnDef<Employee>[] = [
	...columns,
	{
		id: 'department.code',
		accessorFn: (row) => row.department?.id,
		header: 'Department · Code',
		enableSorting: false,
		hideInAddMenu: true,
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
	const el = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')).find((e) => e.textContent?.trim() === label);
	if (!el) throw new Error(`No checkbox entry labelled "${label}"`);
	return el;
}

/** A checkbox entry by its section heading + label — the same label may appear
 *  in two groups (a related field is both a display pick and a column toggle). */
function menuCheckboxIn(group: string, label: string): HTMLElement {
	const heading = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')).find(
		(e) => e.textContent?.trim() === group,
	);
	if (!heading?.parentElement) throw new Error(`No menu group labelled "${group}"`);
	const el = Array.from(heading.parentElement.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')).find(
		(e) => e.textContent?.trim() === label,
	);
	if (!el) throw new Error(`No checkbox entry labelled "${label}" in "${group}"`);
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
	it('nests into its own submenu that keeps show/hide and lists the choices grouped by section', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openColumnPicker('department', 'Department');

		// The column's own visibility moved one level in, and the choices sit beside it.
		await waitFor(() => expect(menuCheckbox('Show column').getAttribute('aria-checked')).toBe('true'));
		// Section headings render in option order: the pick list, then the toggles.
		expect(
			Array.from(document.querySelectorAll<HTMLElement>('[data-slot="dropdown-menu-label"]')).map((e) => e.textContent?.trim()),
		).toEqual(['Display field', 'Show as column']);
		expect(menuCheckboxIn('Display field', 'Default (automatic)').getAttribute('aria-checked')).toBe('false');
		expect(menuCheckboxIn('Display field', 'Name (MM)').getAttribute('aria-checked')).toBe('true');
		expect(menuCheckboxIn('Show as column', 'Code').getAttribute('aria-checked')).toBe('false');
		expect(menuCheckboxIn('Show as column', 'Name (MM)').getAttribute('aria-checked')).toBe('true');
	});

	it('reports the picked display field to the column', async () => {
		onSelect.mockClear();
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openColumnPicker('department', 'Department');
		fireEvent.click(await waitFor(() => menuCheckboxIn('Display field', 'Name (MM)')));

		expect(onSelect).toHaveBeenCalledWith('name_mm');
	});

	it('reports a "Show as column" toggle without reporting it as a display pick', async () => {
		onSelect.mockClear();
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openColumnPicker('department', 'Department');
		fireEvent.click(await waitFor(() => menuCheckboxIn('Show as column', 'Code')));

		expect(onSelect).toHaveBeenCalledWith('column:code');
		expect(onSelect).toHaveBeenCalledTimes(1);
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

/** Is there a checkbox entry with this label? */
function hasCheckbox(label: string): boolean {
	return Array.from(document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')).some((e) => e.textContent?.trim() === label);
}

/** Open the header-edge `+` (add column) menu. */
async function openAddColumnMenu() {
	const trigger = document.querySelector<HTMLElement>('th[data-slot="datatable-add-column"] button');
	if (!trigger) throw new Error('No add-column (+) cell in the header');
	fireEvent.click(trigger);
	await waitFor(() => expect(hasCheckbox('Region')).toBe(true));
}

describe('DataTable header + menu — add a column from the table’s right edge', () => {
	it('sits in the header row’s trailing cell and lists every hideable column', async () => {
		render(<DataTable columns={columnsWithDerived} data={rows} defaultPageSize={10} />);

		const cell = document.querySelector<HTMLElement>('th[data-slot="datatable-add-column"]');
		expect(cell).not.toBeNull();
		// Last cell of the header row, preceded by the filler that takes the spare
		// width so the `+` lands on the table's right edge.
		expect(cell!.parentElement!.lastElementChild).toBe(cell);
		expect(cell!.previousElementSibling?.getAttribute('aria-hidden')).toBe('true');

		fireEvent.click(cell!.querySelector('button')!);
		await waitFor(() => expect(menuCheckbox('Region').getAttribute('aria-checked')).toBe('true'));
		// A relation nests into its own picker here too.
		expect(menuEntry('Department')).toBeTruthy();
		// The derived column is toggled inside that picker — never offered twice.
		expect(hasCheckbox('Department · Code')).toBe(false);
	});

	it('nests a relation into the same picker its own header menu shows, and reports the choices', async () => {
		onSelect.mockClear();
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openAddColumnMenu();
		fireEvent.click(menuEntry('Department'));

		await waitFor(() => expect(menuCheckbox('Show column').getAttribute('aria-checked')).toBe('true'));
		expect(menuCheckboxIn('Show as column', 'Code').getAttribute('aria-checked')).toBe('false');
		fireEvent.click(menuCheckboxIn('Show as column', 'Code'));

		expect(onSelect).toHaveBeenCalledWith('column:code');
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it('hides a column, and keeps the + (and the hidden column) reachable', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		await openAddColumnMenu();
		fireEvent.click(menuCheckbox('Region'));

		await waitFor(() => expect(document.querySelector('th[data-column-id="region"]')).toBeNull());
		// The menu stays open (a checkbox is not a command) and still lists the
		// column — unchecked — so the `+` is always a door back.
		expect(menuCheckbox('Region').getAttribute('aria-checked')).toBe('false');
		expect(document.querySelector('th[data-slot="datatable-add-column"]')).not.toBeNull();
	});

	it('mirrors the trailing cells in the body and the footer', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} showFooter />);

		expect(document.querySelectorAll('tbody tr[data-slot="datatable-row"] td[aria-hidden="true"]').length).toBe(2);
		expect(document.querySelectorAll('tfoot tr td[aria-hidden="true"]').length).toBe(2);
	});

	it('anchors the + at the scrollport’s right edge and keeps a right-pinned column OUTSIDE it', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);

		const rightOf = (selector: string) => document.querySelector<HTMLElement>(selector)?.style.right;
		// The `+` IS the outermost trailing cell…
		expect(rightOf('th[data-slot="datatable-add-column"]')).toBe('0px');

		fireEvent.click(document.querySelector<HTMLElement>('th[data-column-id="region"] button')!);
		fireEvent.click(await waitFor(() => menuEntry('Pin to right')));

		// …and a right-pinned column stops at its left edge — both at 32px would
		// stack the two sticky cells on top of each other, hiding the button.
		await waitFor(() => expect(rightOf('th[data-column-id="region"]')).toBe('32px'));
		expect(rightOf('th[data-slot="datatable-add-column"]')).toBe('0px');
		// Body and footer cells follow their header, so the gutter stays aligned.
		const bodyCells = Array.from(
			document.querySelectorAll<HTMLElement>('tbody tr[data-slot="datatable-row"] td[data-slot="datatable-cell"]'),
		);
		expect(bodyCells.some((td) => td.style.right === '32px')).toBe(true);
		expect(rightOf('tbody tr[data-slot="datatable-row"] td[aria-hidden="true"]:last-child')).toBe('0px');
	});

	it('control — no + when every column is unhideable', () => {
		render(
			<DataTable columns={columns.map((column) => ({ ...column, enableHiding: false }))} data={rows} defaultPageSize={10} showFooter />,
		);

		expect(document.querySelector('th[data-slot="datatable-add-column"]')).toBeNull();
		expect(document.querySelectorAll('tbody tr[data-slot="datatable-row"] td[aria-hidden="true"]').length).toBe(0);
		expect(document.querySelectorAll('tfoot tr td[aria-hidden="true"]').length).toBe(0);
	});
});
