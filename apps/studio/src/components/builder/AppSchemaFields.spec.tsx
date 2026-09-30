// @vitest-environment jsdom
/**
 * AppSchemaFields — the App workbench's schema grid. Its field menu is
 * DELETE-only: this surface carries no field-editing flow, so the shared
 * FieldRowMenu must render a single "Delete field" entry — no dead Edit /
 * Duplicate. (The Collections workbench passes all three; FieldRowMenu.spec
 * pins which entries render for a given capability set.)
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSchemaFields } from './AppSchemaFields';

afterEach(() => cleanup());

describe('AppSchemaFields', () => {
	it('offers a delete-only menu, and the entry names the field it was given', () => {
		const onRemoveField = vi.fn();
		render(<AppSchemaFields fields={[{ name: 'item_name', type: 'text', label: 'Item Name' }]} onRemoveField={onRemoveField} />);

		expect(screen.getByText('Item Name')).toBeTruthy();
		fireEvent.click(screen.getByTitle('Field options'));
		expect(screen.queryByRole('menuitem', { name: 'Edit field' })).toBeNull();
		expect(screen.queryByRole('menuitem', { name: 'Duplicate field' })).toBeNull();
		fireEvent.click(screen.getByRole('menuitem', { name: 'Delete field' }));
		expect(onRemoveField).toHaveBeenCalledWith('item_name');
	});
});
