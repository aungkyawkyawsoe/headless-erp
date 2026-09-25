/**
 * Studio test setup — jsdom gaps the design system needs.
 *
 * jsdom implements the DOM but not a few browser APIs the design-system
 * components touch on mount. The DataTable (and its custom scrollbar) observe
 * element size with `ResizeObserver`, and responsive components read
 * `matchMedia`; jsdom provides neither, so rendering a real DataTable in a
 * component test throws `ResizeObserver is not defined`. These are minimal,
 * inert stubs — they make the component MOUNT, they do not simulate layout.
 *
 * Guarded so the node-environment (pure-logic) suite, which has no `window`,
 * is unaffected.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
	class ResizeObserverStub {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	}
	globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
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
