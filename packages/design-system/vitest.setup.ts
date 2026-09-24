/**
 * Vitest setup — jsdom lacks ResizeObserver (used by the DataTable's pinned
 * column-width sync). Minimal mock keeps the observe/disconnect lifecycle real.
 */
class ResizeObserverMock {
	observe() {}
	unobserve() {}
	disconnect() {}
}

// @ts-expect-error — assigning the mock to the global ResizeObserver
globalThis.ResizeObserver = globalThis.ResizeObserver ?? ResizeObserverMock;
