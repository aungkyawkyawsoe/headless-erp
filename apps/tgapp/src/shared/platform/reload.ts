/**
 * The ONE full-app reload action.
 *
 * `window.location.reload` cannot be replaced on jsdom (the property is
 * unforgeable), so routing every reload through this helper keeps the
 * ErrorBoundary's chunk-recovery guard assertable in a unit test without touching
 * `location` itself.
 */
export function reloadApp(): void {
	window.location.reload();
}
