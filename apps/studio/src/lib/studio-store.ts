import { Store } from '@tanstack/store';

/**
 * Studio CLIENT state — the third kind of state, kept out of both other homes.
 *
 * The Studio has exactly three state shapes, and each gets one home (MECE):
 *   1. SERVER state  (collections, schemas, rows, hooks) → TanStack Query.
 *   2. URL state     (focused collection, view, open row) → `useViewState`
 *      — it must survive reload/back, so it belongs in history.
 *   3. CLIENT state  (this store) — UI ephemera that is neither persisted nor
 *      addressable, but SHOULD survive a component remount / route change
 *      (dev-mode StrictMode remounts everything, so `useState` loses it today).
 *
 * Keep it a flat object of primitives; the store is read with `useStore(store,
 * selector)` so a component only re-renders for the slice it selected.
 */
export interface StudioUiState {
	/** Left-pane collection-registry search. */
	registryQuery: string;
	/** Reveal collections flagged `meta.hidden` in the registry list. */
	showHiddenCollections: boolean;
}

export const studioUiStore = new Store<StudioUiState>({
	registryQuery: '',
	showHiddenCollections: false,
});

export function setRegistryQuery(registryQuery: string): void {
	studioUiStore.setState((s) => ({ ...s, registryQuery }));
}

export function setShowHiddenCollections(showHiddenCollections: boolean): void {
	studioUiStore.setState((s) => ({ ...s, showHiddenCollections }));
}

/** Reset UI state on logout / token change so the next session starts clean. */
export function resetStudioUi(): void {
	studioUiStore.setState(() => ({ registryQuery: '', showHiddenCollections: false }));
}
