// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginScreen } from './login-screen';
import { loginWithPassword } from '@/shared/auth';

vi.mock('@/shared/auth', () => ({ loginWithPassword: vi.fn() }));

const login = vi.mocked(loginWithPassword);

/**
 * The browser (non-Telegram) sign-in screen — the OS-style email + password form
 * a plain-browser visitor lands on. These pin the CONTRACT (what it submits, how
 * it fails, the password toggle); the visual shape is not asserted (jest-dom
 * matchers are deliberately not installed in this app).
 */
describe('LoginScreen', () => {
	beforeEach(() => {
		login.mockReset();
	});

	afterEach(cleanup);

	/** Fill both fields, then press the form's submit button. */
	function signIn(email: string, password: string) {
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
		fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
	}

	it('leads with the heading alone — no explanatory copy — then both fields and the submit', () => {
		render(<LoginScreen onSignedIn={vi.fn()} />);

		expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
		// The heading stands ALONE: the screen must not explain browser/Telegram
		// mechanics back to the user (that sentence was deliberately deleted).
		expect(screen.queryByText(/no Telegram session/i)).toBeNull();
		expect(screen.getByLabelText('Email')).toBeTruthy();
		expect(screen.getByLabelText('Password')).toBeTruthy();
		expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy();
		// …and nothing BELOW the form either. The "Employees sign in from the Telegram
		// app" note described a screen only admins and HR could use — once employees
		// sign in here too, it understated the form it sat under.
		expect(screen.queryByText(/Employees sign in from the Telegram app/i)).toBeNull();
	});

	it('refuses a blank submission without calling the API', () => {
		const { container } = render(<LoginScreen onSignedIn={vi.fn()} />);

		// A `required` field blocks the CLICK natively (the browser's own bubble), so
		// the form is submitted directly to reach the handler's guard — the path a
		// form-submitting Enter press (or a future `required` removal) takes.
		fireEvent.submit(container.querySelector('form') as HTMLFormElement);

		expect(screen.getByRole('alert').textContent).toBe('Enter your email and password.');
		expect(login).not.toHaveBeenCalled();
	});

	it('refuses a whitespace-only email (non-empty for `required`, blank once trimmed)', () => {
		const { container } = render(<LoginScreen onSignedIn={vi.fn()} />);
		fireEvent.change(screen.getByLabelText('Email'), { target: { value: '   ' } });
		fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });

		fireEvent.submit(container.querySelector('form') as HTMLFormElement);

		expect(screen.getByRole('alert').textContent).toBe('Enter your email and password.');
		expect(login).not.toHaveBeenCalled();
	});

	it('submits the TRIMMED email and the password, then reports success', async () => {
		login.mockResolvedValue({} as never);
		const onSignedIn = vi.fn();
		render(<LoginScreen onSignedIn={onSignedIn} />);

		signIn('  me@company.com  ', 'secret');

		// The button reads "Signing in…" while the call is in flight, so the signal
		// to wait on is the success callback, not the label.
		await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
		expect(login).toHaveBeenCalledWith('me@company.com', 'secret');
	});

	it("surfaces the API's message and re-enables the button", async () => {
		login.mockRejectedValue(new Error('Invalid email or password'));
		const onSignedIn = vi.fn();
		render(<LoginScreen onSignedIn={onSignedIn} />);

		signIn('me@company.com', 'wrong');

		expect((await screen.findByRole('alert')).textContent).toBe('Invalid email or password');
		// The failure must not leave the form stuck in its busy state.
		expect((screen.getByRole('button', { name: /sign in/i }) as HTMLButtonElement).disabled).toBe(false);
		expect(onSignedIn).not.toHaveBeenCalled();
	});

	it('toggles the password between hidden and visible', () => {
		render(<LoginScreen onSignedIn={vi.fn()} />);

		const password = screen.getByLabelText('Password') as HTMLInputElement;
		expect(password.type).toBe('password');

		fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
		expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');

		fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
		expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
	});
});
