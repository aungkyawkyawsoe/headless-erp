// @vitest-environment jsdom
/**
 * Column layout persistence — the remount contract. A layout the user arranged
 * (a hidden column, a pinned column, a dragged width) must come back on the next
 * mount under the SAME `persistStateKey`: that is what makes the header menu's
 * Columns list and the resize handles stick once the table remounts — a
 * collection switch, a trash toggle, a reload. Before a key is passed nothing is
 * written (the behavior every other table keeps).
 *
 * The second half pins the GEOMETRY those sizes render under: a resizable table
 * carries a definite `max(100%, <sizes + edge controls>px)` width with
 * `table-fixed` — without it the columns resolve content-based and a committed
 * size moves the table's edge while the column itself never follows.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { DataTable } from '../datatable';
import type { ColumnDef } from './core/types';

interface Row {
	id: string;
	region: string;
	department: string;
}

const rows: Row[] = [{ id: '1', region: 'North', department: 'Ops' }];

const columns: ColumnDef<Row>[] = [
	{ id: 'region', accessorKey: 'region', header: 'Region' },
	{ id: 'department', accessorKey: 'department', header: 'Department' },
];

const KEY = 'spec:grid';
const STORAGE_KEY = 'mmbix:datatable:' + KEY;

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

function headerCell(columnId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(`th[data-column-id="${columnId}"]`);
}

beforeEach(() => localStorage.removeItem(STORAGE_KEY));

describe('DataTable column layout persistence', () => {
	it('hides a column through the header menu and keeps it hidden across a remount', async () => {
		const first = render(<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} />);

		fireEvent.click(headerCell('region')!.querySelector('button')!);
		const columnsEntry = await waitFor(() => menuEntry('Columns'));
		// The Columns list opens on hover — arm it with a move, then enter.
		fireEvent.mouseMove(columnsEntry);
		fireEvent.mouseEnter(columnsEntry);
		fireEvent.click(await waitFor(() => menuCheckbox('Region')));
		await waitFor(() => expect(headerCell('region')).toBeNull());
		first.unmount();

		render(<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} />);
		expect(headerCell('region')).toBeNull();
		expect(headerCell('department')).not.toBeNull();
	});

	it('a persisted width is honored on mount — the resize handle adjusts a real px width', () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				visibility: {},
				order: ['region', 'department'],
				ids: ['region', 'department'],
				pinning: { start: [], end: [] },
				sizing: { region: 321 },
			}),
		);
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} enableColumnResizing />);

		expect(headerCell('region')!.style.width).toBe('321px');
		// The other column keeps its default width — only the persisted id is sized.
		expect(headerCell('department')!.style.width).toBe('150px');
		// A resize handle per column is what writes a width back to storage.
		expect(document.querySelectorAll('[role="separator"]').length).toBe(2);
	});

	it('a DRAGGED resize handle commits: the column width changes and the layout is stored', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} enableColumnResizing />);

		expect(headerCell('region')!.style.width).toBe('150px');
		const handle = headerCell('region')!.querySelector<HTMLElement>('[role="separator"]')!;
		// Drag the region column 60px wider. TanStack commits on every move
		// (`columnResizeMode: 'onChange'`), so the width must land mid-drag — the
		// whole point of the handle being a real resize and not a decoration.
		handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, clientY: 100, bubbles: true }));
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 100, bubbles: true }));
		await waitFor(() => expect(headerCell('region')!.style.width).toBe('210px'));

		document.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, clientY: 100, bubbles: true }));
		await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sizing.region).toBe(210));
	});

	it('a committed size survives the measure-sync — a resize is not reverted by the rendered layout', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				visibility: {},
				order: ['region', 'department'],
				ids: ['region', 'department'],
				pinning: { start: [], end: [] },
				sizing: { region: 321 },
			}),
		);
		const table = (extra?: { enableColumnResizing?: boolean }) => (
			<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} {...extra} />
		);
		const { rerender } = render(table({ enableColumnResizing: true }));
		expect(headerCell('region')!.style.width).toBe('321px');

		// A laid-out table whose measured widths CONTRADICT the committed sizing:
		// region measures as the pre-resize 150, department (never committed)
		// measures 180. jsdom reports 0×0 for everything, so the measure-sync —
		// which runs on every render — is otherwise inert in here.
		const mockWidth = (el: HTMLElement, width: number) => {
			el.getBoundingClientRect = () =>
				({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
		};
		mockWidth(headerCell('region')!, 150);
		mockWidth(headerCell('department')!, 180);

		rerender(table({ enableColumnResizing: true }));
		// The never-committed column is seeded from the layout — the pin-offset
		// correction still needs a numeric size per column…
		await waitFor(() => expect(headerCell('department')!.style.width).toBe('180px'));
		// …while the committed (dragged / persisted) width is NOT overwritten.
		expect(headerCell('region')!.style.width).toBe('321px');

		// Control: with resizing disabled the sync stays a pure mirror — there is
		// no committed-size notion to protect, so the measured layout wins.
		rerender(table());
		await waitFor(() => {
			const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
			expect(stored.sizing).toEqual({ region: 150, department: 180 });
		});
	});

	it('double-clicking the resize handle resets to the declared width — a committed size, not a deleted key', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				visibility: {},
				order: ['region', 'department'],
				ids: ['region', 'department'],
				pinning: { start: [], end: [] },
				sizing: { region: 321 },
			}),
		);
		const sizedColumns: ColumnDef<Row>[] = [
			{ id: 'region', accessorKey: 'region', header: 'Region', size: 200 },
			{ id: 'department', accessorKey: 'department', header: 'Department' },
		];
		render(<DataTable columns={sizedColumns} data={rows} defaultPageSize={10} persistStateKey={KEY} enableColumnResizing />);
		expect(headerCell('region')!.style.width).toBe('321px');

		// Reset region → its DECLARED size; department (no declared size) → the
		// 150 default. Committing a number is what makes the seed-only measure-sync
		// leave it alone (TanStack's own resetSize just deletes the id, and the
		// sync re-seeds it from the DOM → the double-click used to do nothing).
		fireEvent.doubleClick(headerCell('region')!.querySelector<HTMLElement>('[role="separator"]')!);
		await waitFor(() => expect(headerCell('region')!.style.width).toBe('200px'));
		fireEvent.doubleClick(headerCell('department')!.querySelector<HTMLElement>('[role="separator"]')!);
		await waitFor(() => expect(headerCell('department')!.style.width).toBe('150px'));

		await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sizing).toEqual({ region: 200, department: 150 }));
	});

	it('control — no resize handles while resizing is disabled, and no key means no storage write', async () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);
		expect(document.querySelectorAll('[role="separator"]').length).toBe(0);

		fireEvent.click(headerCell('region')!.querySelector('button')!);
		const columnsEntry = await waitFor(() => menuEntry('Columns'));
		fireEvent.mouseMove(columnsEntry);
		fireEvent.mouseEnter(columnsEntry);
		fireEvent.click(await waitFor(() => menuCheckbox('Region')));
		await waitFor(() => expect(headerCell('region')).toBeNull());

		// Without a persistStateKey the hide is session-only — nothing stored.
		expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
	});
});

describe('DataTable resizable geometry — the definite table width', () => {
	const table = () => document.querySelector<HTMLElement>('table[data-slot="datatable-table"]')!;
	/** The filler that precedes the add-column cell (the table's last header cell). */
	const filler = () => {
		const cells = document.querySelectorAll('[data-slot="datatable-header"] th');
		return cells[cells.length - 2] as HTMLElement;
	};

	it('carries a definite max(100%, …) width with table-fixed — never w-max', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} enableColumnResizing />);
		// 150 + 150 + the 32px add-column cell.
		expect(table().style.width).toBe('max(100%, 332px)');
		expect(table().className).toContain('table-fixed');
		expect(table().className).not.toContain('w-max');
		expect(table().className).not.toContain('min-w-max');
		// The filler renders bare — a w-full here is what blew the table up.
		expect(filler().className).not.toContain('w-full');
	});

	it('tracks the operator sizes: a persisted width and a live drag both move it', async () => {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({
				visibility: {},
				order: ['region', 'department'],
				ids: ['region', 'department'],
				pinning: { start: [], end: [] },
				sizing: { region: 321 },
			}),
		);
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} persistStateKey={KEY} enableColumnResizing />);
		// 321 + 150 + 32.
		expect(table().style.width).toBe('max(100%, 503px)');

		const handle = headerCell('region')!.querySelector<HTMLElement>('[role="separator"]')!;
		handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, clientY: 100, bubbles: true }));
		document.dispatchEvent(new MouseEvent('mousemove', { clientX: 560, clientY: 100, bubbles: true }));
		// 321 + 60 = 381 → 381 + 150 + 32.
		await waitFor(() => expect(table().style.width).toBe('max(100%, 563px)'));
		document.dispatchEvent(new MouseEvent('mouseup', { clientX: 560, clientY: 100, bubbles: true }));
	});

	it('counts the edge control cells that live outside the column model', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} enableColumnResizing enableRowSelection />);
		// 150 + 150 + 40 (selection) + 32 (add column).
		expect(table().style.width).toBe('max(100%, 372px)');
	});

	it('control — without resizing the table stays w-full auto layout and the filler keeps w-full', () => {
		render(<DataTable columns={columns} data={rows} defaultPageSize={10} />);
		expect(table().style.width).toBe('');
		expect(table().className).toContain('w-full');
		expect(table().className).toContain('min-w-max');
		expect(filler().className).toContain('w-full');
	});
});
