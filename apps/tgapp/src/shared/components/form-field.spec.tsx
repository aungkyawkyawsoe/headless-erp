// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { FormField } from './form-field';

afterEach(cleanup);

/**
 * The a11y contract the field exists for.
 *
 * Every form used to hand-roll `<label>Text</label>` + an un-`id`ed control, so
 * the input had NO accessible name (a placeholder is not a label — WCAG 3.3.2 /
 * 4.1.2) and a validation failure had nowhere to attach. These assertions pin
 * the wiring so a future refactor cannot quietly drop it.
 */
describe('FormField — label association + inline error', () => {
	it('associates the label with the control and names it', () => {
		render(<FormField label="Policy no">{(f) => <input {...f} />}</FormField>);

		const input = screen.getByLabelText('Policy no');
		expect(input).toBeTruthy();
		// The visible label IS the accessible name — not the placeholder.
		expect((input as HTMLInputElement).id).toBeTruthy();
		expect(screen.getByText('Policy no').getAttribute('for')).toBe((input as HTMLInputElement).id);
	});

	it('marks a required field visually AND programmatically', () => {
		render(
			<FormField label="Provider" required>
				{(f) => <input {...f} />}
			</FormField>,
		);

		expect(screen.getByRole('textbox').getAttribute('aria-required')).toBe('true');
		// The asterisk stays decorative (the label already names the field).
		expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
	});

	it('attaches an inline error to the control it belongs to', () => {
		render(
			<FormField label="Expiry date" error="Expiry date must be after the issue date">
				{(f) => <input {...f} />}
			</FormField>,
		);

		const input = screen.getByLabelText('Expiry date');
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toBe('Expiry date must be after the issue date');
		// The control says it is invalid AND points at the message.
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe(alert.id);
	});

	it('hides the hint while an error is shown, so the two never stack', () => {
		const { rerender } = render(
			<FormField label="Note" hint="Optional — visible to the store keeper">
				{(f) => <input {...f} />}
			</FormField>,
		);
		expect(screen.getByText('Optional — visible to the store keeper')).toBeTruthy();

		rerender(
			<FormField label="Note" hint="Optional — visible to the store keeper" error="Too long">
				{(f) => <input {...f} />}
			</FormField>,
		);
		expect(screen.queryByText('Optional — visible to the store keeper')).toBeNull();
		expect(screen.getByRole('alert').textContent).toBe('Too long');
	});

	it('renders a labelled GROUP (no dangling htmlFor) for a non-input control', () => {
		render(
			<FormField label="Betterment" group>
				{() => (
					<div>
						<button type="button">Yes</button>
						<button type="button">No</button>
					</div>
				)}
			</FormField>,
		);

		const group = screen.getByRole('group');
		const caption = screen.getByText('Betterment');
		expect(group.getAttribute('aria-labelledby')).toBe(caption.id);
		// No `for` pointing at nothing — that was the bug this mode avoids.
		expect(caption.getAttribute('for')).toBeNull();
	});

	it('gives two fields distinct ids (one form, no collisions)', () => {
		render(
			<>
				<FormField label="A">{(f) => <input {...f} />}</FormField>
				<FormField label="B">{(f) => <input {...f} />}</FormField>
			</>,
		);
		const a = screen.getByLabelText('A') as HTMLInputElement;
		const b = screen.getByLabelText('B') as HTMLInputElement;
		expect(a.id).toBeTruthy();
		expect(a.id).not.toBe(b.id);
	});
});

/**
 * A field whose value can be read elsewhere shares its caption's row with an
 * action (“Balance” beside “Photo”). The action must be the caption's SIBLING:
 * folded into the caption it would join the field's accessible name, so a group
 * would answer to “Photo Balance” and a screen reader would announce the button
 * twice. These pin the structure, not the wording.
 */
describe('FormField — a right-edge action on the caption row', () => {
	it('shares the caption’s row without joining its accessible name', () => {
		render(
			<FormField label="Photo" group action={<button type="button">Balance</button>}>
				{() => <button type="button">Add photo</button>}
			</FormField>,
		);

		const caption = screen.getByText('Photo');
		const action = screen.getByRole('button', { name: 'Balance' });
		// One row: the two are siblings
		expect(caption.parentElement).toBe(action.parentElement);
		// …and the caption alone still names the group.
		expect(screen.getByRole('group').getAttribute('aria-labelledby')).toBe(caption.id);
		expect(caption.textContent).toBe('Photo');
	});

	it('keeps a labelled field’s association intact with an action on the row', () => {
		render(
			<FormField label="Policy no" action={<button type="button">Look up</button>}>
				{(f) => <input {...f} />}
			</FormField>,
		);
		const input = screen.getByLabelText('Policy no') as HTMLInputElement;
		expect(input.id).toBeTruthy();
		expect(screen.getByText('Policy no').getAttribute('for')).toBe(input.id);
	});

	it('renders no extra element when there is no action', () => {
		render(<FormField label="Note">{(f) => <input {...f} />}</FormField>);
		// The caption is the field container's first child — no wrapper row was added.
		const caption = screen.getByText('Note');
		expect(caption.parentElement?.firstElementChild).toBe(caption);
	});
});
