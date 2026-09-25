// @vitest-environment jsdom
/**
 * RecordFieldInput — the inline error surface.
 *
 * The dialog spec proves the blur→validate→clear flow; this one pins the
 * presentational contract `validateField` feeds: an `error` prop renders a
 * DS `FieldError` and marks the control `aria-invalid` + `aria-describedby`
 * (so it is announced), and an omitted prop renders none of that.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FieldDefinition } from '../lib/api';
import { RecordFieldInput } from './RecordFieldInput';

afterEach(() => cleanup());

const textField: FieldDefinition = { name: 'title', type: 'text', label: 'Title', required: true };

describe('RecordFieldInput — error prop', () => {
	it('renders nothing invalid when no error is supplied (backward compatible)', () => {
		render(<RecordFieldInput field={textField} value="" onChange={() => {}} />);

		const input = screen.getByRole('textbox');
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('renders the message, marks the control invalid and describes it by the message id', () => {
		render(<RecordFieldInput field={textField} value="" onChange={() => {}} error="Title is required" />);

		const input = screen.getByRole('textbox');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(screen.getByRole('alert').textContent).toBe('Title is required');

		const describedBy = input.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();
		expect(document.getElementById(describedBy as string)?.textContent).toBe('Title is required');
	});

	it('fires onBlur when focus leaves the field', () => {
		const onBlur = vi.fn();
		render(<RecordFieldInput field={textField} value="" onChange={() => {}} onBlur={onBlur} />);

		fireEvent.blur(screen.getByRole('textbox'));

		expect(onBlur).toHaveBeenCalledTimes(1);
	});
});
