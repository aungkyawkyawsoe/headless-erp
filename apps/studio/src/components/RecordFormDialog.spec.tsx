// @vitest-environment jsdom
/**
 * RecordFormDialog — inline validation on blur + blocked submit.
 *
 * Covers the behaviour under test: blurring an empty required field shows the
 * message with `aria-invalid=true`, typing clears it, submit is blocked while it
 * stands, and linkage still governs (a hidden required field never blocks; a
 * linkage-visible required field does).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../lib/api')>();
	return { ...actual, createItem: vi.fn(), updateItem: vi.fn() };
});

import { createItem, type EntitySchema } from '../lib/api';
import RecordFormDialog from './RecordFormDialog';

const mockCreate = vi.mocked(createItem);

function schemaWith(fields: EntitySchema['schema_json']['fields']): EntitySchema {
	return {
		id: 'c1',
		name: 'Widget',
		slug: 'widgets',
		table_name: 'widgets',
		schema_json: { fields },
	} as EntitySchema;
}

function renderDialog(schema: EntitySchema, initialValues?: Record<string, unknown>) {
	return render(
		<RecordFormDialog
			token="tk"
			open
			onOpenChange={() => {}}
			collection={{ slug: 'widgets', name: 'Widget' }}
			schema={schema}
			initialValues={initialValues}
			onSaved={() => {}}
		/>,
	);
}

const titleField: EntitySchema['schema_json']['fields'][number] = { name: 'title', type: 'text', label: 'Title', required: true };

beforeEach(() => {
	mockCreate.mockReset();
	mockCreate.mockResolvedValue({ id: 'r1', title: 'Hello' } as never);
});

afterEach(() => cleanup());

describe('RecordFormDialog — validate on blur, clear on change', () => {
	it('shows the message and aria-invalid after blurring an empty required field, without scolding while typing', () => {
		renderDialog(schemaWith([titleField]));
		const input = screen.getByRole('textbox');

		// Not validated on keystrokes alone.
		fireEvent.change(input, { target: { value: '' } });
		expect(screen.queryByRole('alert')).toBeNull();

		fireEvent.blur(input);

		expect(screen.getByRole('alert').textContent).toBe('Title is required');
		expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
	});

	it('clears the error as soon as the value changes', () => {
		renderDialog(schemaWith([titleField]));
		fireEvent.blur(screen.getByRole('textbox'));
		expect(screen.getByRole('alert')).toBeTruthy();

		fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello' } });

		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBeNull();
	});

	it('blocks submit while an error stands (no write is attempted)', () => {
		renderDialog(schemaWith([titleField]));
		fireEvent.blur(screen.getByRole('textbox'));
		expect(screen.getByRole('alert')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('submits once the error is resolved', async () => {
		renderDialog(schemaWith([titleField]));
		const input = screen.getByRole('textbox');
		fireEvent.change(input, { target: { value: 'Hello' } });

		fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
		expect(mockCreate.mock.calls[0][2]).toEqual({ title: 'Hello' });
	});
});

describe('RecordFormDialog — linkage governs validation', () => {
	const kindField: EntitySchema['schema_json']['fields'][number] = { name: 'kind', type: 'text', label: 'Kind' };
	const noteField: EntitySchema['schema_json']['fields'][number] = {
		name: 'note',
		type: 'text',
		label: 'Note',
		required: true,
		visible_when: { field: 'kind', op: 'eq', value: 'other' },
	};

	it('does not validate or block submit for a linkage-HIDDEN required field', async () => {
		renderDialog(schemaWith([kindField, noteField]));

		// Note is hidden (kind is empty) — only Kind renders.
		expect(screen.queryByText('Note')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
	});

	it('blocks submit when linkage makes a required field visible and it is empty', async () => {
		renderDialog(schemaWith([kindField, noteField]), { kind: 'other' });

		// The condition holds, so Note is now on screen and required.
		expect(screen.getByText('Note')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Create' }));

		expect((await screen.findByRole('alert')).textContent).toBe('Note is required');
		expect(mockCreate).not.toHaveBeenCalled();
	});
});
