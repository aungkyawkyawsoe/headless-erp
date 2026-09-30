import { describe, expect, it, beforeEach } from 'vitest';
import { studioUiStore, setRegistryQuery, setShowHiddenCollections, resetStudioUi } from './studio-store';

// The UI store is Studio CLIENT state (URL state and server state live elsewhere).
// Pin the two things that matter: a setter produces a NEW object (so `useStore`
// selectors re-render once), and `resetStudioUi` returns the exact initial shape
// so a logout can never leak the previous session's filters.
describe('studioUiStore', () => {
	beforeEach(() => resetStudioUi());

	it('starts empty and hidden-off', () => {
		expect(studioUiStore.state).toEqual({ registryQuery: '', showHiddenCollections: false });
	});

	it('setRegistryQuery replaces the state object (structural change → selector fires)', () => {
		const before = studioUiStore.state;
		setRegistryQuery('emp');
		expect(studioUiStore.state.registryQuery).toBe('emp');
		expect(studioUiStore.state).not.toBe(before);
	});

	it('setShowHiddenCollections toggles independently of the search box', () => {
		setRegistryQuery('emp');
		setShowHiddenCollections(true);
		expect(studioUiStore.state).toEqual({ registryQuery: 'emp', showHiddenCollections: true });
	});

	it('resetStudioUi clears both slices', () => {
		setRegistryQuery('emp');
		setShowHiddenCollections(true);
		resetStudioUi();
		expect(studioUiStore.state).toEqual({ registryQuery: '', showHiddenCollections: false });
	});
});
