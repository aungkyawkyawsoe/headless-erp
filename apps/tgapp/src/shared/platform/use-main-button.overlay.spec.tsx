// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { useTelegramMainButton } from './use-main-button';

/**
 * End-to-end (jsdom) pin of the maintenance-form bug: a REAL design-system
 * bottom sheet must drive the native MainButton away. The DS `Sheet` holds the
 * shared scroll lock; the hook reads its overlay signal — so this proves the
 * two halves are actually wired, not just each in isolation. The user-visible
 * symptom was the client's native Save button floating ON TOP of the Job /
 * Started / Ended sheets on Android Telegram.
 */
const calls = {
	setParams: vi.fn(),
	show: vi.fn(),
	hide: vi.fn(),
	showProgress: vi.fn(),
	hideProgress: vi.fn(),
	onClick: vi.fn(),
	offClick: vi.fn(),
};

beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
	}
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
	(window as unknown as { Telegram: unknown }).Telegram = {
		WebApp: {
			version: '8.0',
			platform: 'android',
			MainButton: calls,
			onEvent: vi.fn(),
			offEvent: vi.fn(),
		},
	};
});

beforeEach(() => {
	vi.clearAllMocks();
});

// No config `globals` in this app → RTL does not auto-cleanup; do it explicitly.
afterEach(cleanup);

function Harness() {
	useTelegramMainButton({ text: 'Save log', onClick: () => {} });
	const [open, setOpen] = useState(false);
	return (
		<>
			<button type="button" onClick={() => setOpen((value) => !value)}>
				Toggle sheet
			</button>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom">
					<SheetHeader>
						<SheetTitle>Select a maintenance job</SheetTitle>
					</SheetHeader>
				</SheetContent>
			</Sheet>
		</>
	);
}

describe('useTelegramMainButton — a real bottom sheet hides the native button', () => {
	it('hides on open and restores on close', () => {
		render(<Harness />);
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: true }));
		expect(calls.hide).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', { name: 'Toggle sheet' }));
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: false }));
		expect(calls.hide).toHaveBeenCalled();

		// The open sheet traps focus and inerts the page behind it, so close via
		// the sheet's own control rather than the background toggle.
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: true }));
	});
});
