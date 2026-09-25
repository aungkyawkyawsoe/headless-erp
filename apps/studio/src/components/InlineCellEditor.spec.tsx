// @vitest-environment jsdom
/**
 * InlineCellEditor — in-place cell editing, driven through a real DOM.
 *
 * Pins the interaction contract the task asks for: the cell shows the value,
 * double-click / Enter open the editor, Enter commits (the save call fires with
 * the new value), Esc cancels (no save), and a rejected save ROLLS BACK to the
 * previous value and surfaces the error — the cell never shows an unpersisted
 * value. Also pins the two safety fallbacks: an unsupported type and a
 * permission-denied field both stay read-only.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../lib/api', () => ({ updateItem: vi.fn() }));

import { updateItem } from '../lib/api';
import { InlineCellEditor, type InlineCellEditorProps } from './InlineCellEditor';

const mockUpdate = vi.mocked(updateItem) as unknown as Mock;

const TEXT_FIELD = { name: 'name_en', type: 'text', label: 'Name' };

function renderCell(overrides: Partial<InlineCellEditorProps> = {}) {
	return render(<InlineCellEditor field={TEXT_FIELD} value="Old" recordId="42" collectionSlug="items" token="tk" {...overrides} />);
}

const cell = () => screen.getByRole('button', { name: /Edit Name/i });
const input = () => screen.getByRole('textbox') as HTMLInputElement;
const openEditor = () => fireEvent.doubleClick(cell());

beforeEach(() => {
	mockUpdate.mockReset();
	mockUpdate.mockResolvedValue({} as never);
});

afterEach(() => cleanup());

describe('InlineCellEditor — display and activation', () => {
	it('renders the value read-only until activated', () => {
		renderCell();
		expect(screen.getByText('Old')).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('opens the editor on double-click', () => {
		renderCell();
		openEditor();
		expect(input().value).toBe('Old');
	});

	it('opens the editor on Enter when the cell is focused (keyboard accessible)', () => {
		renderCell();
		fireEvent.keyDown(cell(), { key: 'Enter' });
		expect(input().value).toBe('Old');
	});
});

describe('InlineCellEditor — committing and cancelling', () => {
	it('commits on Enter with the new value', async () => {
		renderCell();
		openEditor();
		fireEvent.change(input(), { target: { value: 'New' } });
		fireEvent.keyDown(input(), { key: 'Enter' });

		await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('tk', 'items', '42', { name_en: 'New' }));
		await waitFor(() => expect(screen.getByText('New')).toBeTruthy());
	});

	it('commits on blur when the editor loses focus', async () => {
		renderCell();
		openEditor();
		fireEvent.change(input(), { target: { value: 'Blurred' } });
		fireEvent.focusOut(input(), { relatedTarget: document.body });

		await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('tk', 'items', '42', { name_en: 'Blurred' }));
	});

	it('cancels on Escape without saving', () => {
		renderCell();
		openEditor();
		fireEvent.change(input(), { target: { value: 'New' } });
		fireEvent.keyDown(input(), { key: 'Escape' });

		expect(mockUpdate).not.toHaveBeenCalled();
		expect(screen.getByText('Old')).toBeTruthy();
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	it('does not save when the value is unchanged', async () => {
		renderCell();
		openEditor();
		fireEvent.keyDown(input(), { key: 'Enter' });

		await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});

describe('InlineCellEditor — failure handling', () => {
	it('rolls back and shows the error when the save is rejected', async () => {
		mockUpdate.mockRejectedValue(new Error('Nope'));
		renderCell();
		openEditor();
		fireEvent.change(input(), { target: { value: 'New' } });
		fireEvent.keyDown(input(), { key: 'Enter' });

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('Nope');
		// Rolled back to the previous value — no unpersisted value left on screen.
		expect(screen.getByText('Old')).toBeTruthy();
		expect(screen.queryByText('New')).toBeNull();
		expect(screen.queryByRole('textbox')).toBeNull();
	});
});

describe('InlineCellEditor — safety fallbacks', () => {
	it('falls back to the read-only cell for a type it cannot edit safely', () => {
		renderCell({ field: { name: 'owner', type: 'm2o', label: 'Owner' }, value: { id: 'x', name: 'Aung' } });
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.getByText('Aung')).toBeTruthy();
	});

	it('stays read-only when the page denies write access', () => {
		renderCell({ readOnly: true });
		expect(screen.queryByRole('button')).toBeNull();
		expect(screen.getByText('Old')).toBeTruthy();
	});
});
