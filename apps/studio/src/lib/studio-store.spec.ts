import { describe, expect, it, beforeEach } from 'vitest';
import { studioUiStore, setRegistryQuery, setRolesSearch, setShowHiddenCollections, resetStudioUi } from './studio-store';

// The UI store is Studio CLIENT state (URL state and server state live elsewhere).
// Pin the two things that matter: a setter produces a NEW object (so `useStore`
// selectors re-render once), and `resetStudioUi` returns the exact initial shape
// so a logout can never leak the previous session's filters.
//
// Both registry filters live here (collections and roles), and they are separate
// slices on purpose: the two panels are never on screen together, so one shared
// term would silently pre-filter the other's list.
describe('studioUiStore', () => {
	beforeEach(() => resetStudioUi());

	it('starts empty and hidden-off', () => {
		expect(studioUiStore.state).toEqual({ registryQuery: '', showHiddenCollections: false, rolesSearch: '' });
	});

	it('setRegistryQuery replaces the state object (structural change → selector fires)', () => {
		const before = studioUiStore.state;
		setRegistryQuery('emp');
		expect(studioUiStore.state.registryQuery).toBe('emp');
		expect(studioUiStore.state).not.toBe(before);
	});

	it('keeps the two registry filters independent of the hidden toggle', () => {
		setRegistryQuery('emp');
		setRolesSearch('admin');
		setShowHiddenCollections(true);
		expect(studioUiStore.state).toEqual({ registryQuery: 'emp', showHiddenCollections: true, rolesSearch: 'admin' });
	});

	it('resetStudioUi clears every slice', () => {
		setRegistryQuery('emp');
		setRolesSearch('admin');
		setShowHiddenCollections(true);
		resetStudioUi();
		expect(studioUiStore.state).toEqual({ registryQuery: '', showHiddenCollections: false, rolesSearch: '' });
	});
});
