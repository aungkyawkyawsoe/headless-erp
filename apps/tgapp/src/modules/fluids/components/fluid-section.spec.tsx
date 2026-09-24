// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FluidFillForm, emptyFluidDraft } from './fluid-section';

const mocks = vi.hoisted(() => ({
	createFluidFill: vi.fn(async () => ({ id: 'fill-1' })),
	updateFluidFill: vi.fn(async () => ({ id: 'fill-1' })),
	useTelegramMainButton: vi.fn(() => true),
}));

vi.mock('../data/api', () => ({
	createFluidFill: mocks.createFluidFill,
	updateFluidFill: mocks.updateFluidFill,
}));
vi.mock('@/shared/platform/use-main-button', () => ({ useTelegramMainButton: mocks.useTelegramMainButton }));

// jsdom ships neither, and the design-system DatePicker touches both.
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
});

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
	mocks.useTelegramMainButton.mockReturnValue(true);
});

/**
 * The record view's submit is the native Telegram MainButton — the in-page
 * `FormSubmitBar` must NOT also render (never both, the app-wide rule). The
 * `visible: true` pins that the form always offers the native button, so the
 * full-page create view has a save action at the bottom.
 */
describe('FluidFillForm — the native MainButton is the submit affordance', () => {
	it('requests a visible native button and renders no in-page duplicate', () => {
		render(
			<FluidFillForm
				vehicleId="v1"
				kind="engine_oil"
				currentOdo={120000}
				previousIntervalKm={null}
				draft={emptyFluidDraft(120000)}
				onDraftChange={() => {}}
				onSaved={() => {}}
			/>,
		);

		expect(mocks.useTelegramMainButton).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, text: 'Save engine oil fill' }));
		// `isMainButton` true → the in-page save bar renders nothing.
		expect(screen.queryByRole('button', { name: /save engine oil fill/i })).toBeNull();
	});
});
