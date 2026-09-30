/**
 * Vitest setup — jsdom lacks ResizeObserver (used by the DataTable's pinned
 * column-width sync) and matchMedia (used by `useIsMobile`, i.e. every sidebar
 * test). Minimal mocks keep the observe/disconnect + listen/unlisten lifecycle
 * real. `matches: false` = a desktop viewport, so the sidebar renders in place
 * instead of as a mobile Sheet.
 */
class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

// @ts-expect-error — assigning the mock to the global ResizeObserver
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;

if (typeof window !== 'undefined' && !window.matchMedia) {
	window.matchMedia = (query: string): MediaQueryList =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => {},
			removeEventListener: () => {},
			addListener: () => {},
			removeListener: () => {},
			dispatchEvent: () => false,
		}) as MediaQueryList;
}
