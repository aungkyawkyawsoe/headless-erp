// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { canReadCollection, isAppAllowed, useAppAccess, APP_COLLECTIONS } from './app-access';
import type { MeUser } from './auth';

vi.mock('./auth', () => ({
	fetchMe: vi.fn(),
	getCachedMe: vi.fn(() => null),
	subscribeMe: vi.fn(() => () => {}),
}));

import { fetchMe, getCachedMe, subscribeMe } from './auth';

const me = (over: Partial<MeUser> = {}): MeUser => ({ user_id: 'u', email: 'tg-1@telegram.local', ...over });

describe('isAppAllowed', () => {
	it('allows every app for an admin', () => {
		expect(isAppAllowed(me({ is_admin: true, apps: [] }), 'projects')).toBe(true);
	});

	it('unrestricted when apps is absent (uncurated role / pre-migration API)', () => {
		expect(isAppAllowed(me(), 'projects')).toBe(true);
	});

	it('allows only the listed app ids', () => {
		const user = me({ apps: ['attendance', 'hr'], granted_collections: '*' });
		expect(isAppAllowed(user, 'attendance')).toBe(true);
		expect(isAppAllowed(user, 'projects')).toBe(false);
	});

	it('allows nothing when the allow-list is empty', () => {
		expect(isAppAllowed(me({ apps: [] }), 'attendance')).toBe(false);
	});

	// Gate 2 — `app_access` alone must NOT open an app whose collections the role
	// cannot read, or the app opens onto a 403 on every screen (the real bug:
	// `projects` in `apps`, no `hrm_projects`/`hrm_tasks` read grant).
	describe('collection read grant (gate 2)', () => {
		it('denies an app whose collections are not read-granted', () => {
			const user = me({ apps: ['attendance', 'projects'], granted_collections: ['hrm_attendances'] });
			expect(isAppAllowed(user, 'attendance')).toBe(true);
			expect(isAppAllowed(user, 'projects')).toBe(false);
		});

		it('allows an app once EVERY backing collection is read-granted', () => {
			const user = me({ apps: ['projects'], granted_collections: ['hrm_projects', 'hrm_tasks'] });
			expect(isAppAllowed(user, 'projects')).toBe(true);
		});

		it('still denies when only SOME backing collections are granted', () => {
			const user = me({ apps: ['projects'], granted_collections: ['hrm_projects'] });
			expect(isAppAllowed(user, 'projects')).toBe(false);
		});

		it('treats the "*" sentinel as every collection', () => {
			expect(isAppAllowed(me({ apps: ['projects'], granted_collections: '*' }), 'projects')).toBe(true);
		});

		it('treats a null grant list as unknown, not denied (pre-migration API)', () => {
			expect(isAppAllowed(me({ apps: ['projects'], granted_collections: null }), 'projects')).toBe(true);
		});

		it('leaves apps with no mapped collections unconstrained', () => {
			// `settings` reads nothing, so gate 2 must not exclude it for a role whose
			// granted list is unrelated (and empty).
			expect(APP_COLLECTIONS.settings).toBeUndefined();
			expect(isAppAllowed(me({ apps: ['settings'], granted_collections: [] }), 'settings')).toBe(true);
		});
	});
});

describe('canReadCollection', () => {
	it('passes for an admin and for the "*" sentinel', () => {
		expect(canReadCollection(me({ is_admin: true, granted_collections: [] }), 'hrm_tasks')).toBe(true);
		expect(canReadCollection(me({ granted_collections: '*' }), 'hrm_tasks')).toBe(true);
	});

	it('is an exact-membership test against the granted list', () => {
		const user = me({ granted_collections: ['hrm_projects'] });
		expect(canReadCollection(user, 'hrm_projects')).toBe(true);
		expect(canReadCollection(user, 'hrm_tasks')).toBe(false);
	});
});

describe('useAppAccess', () => {
	beforeEach(() => {
		vi.mocked(getCachedMe).mockReturnValue(null);
		vi.mocked(fetchMe).mockReset();
		vi.mocked(subscribeMe).mockReset();
		vi.mocked(subscribeMe).mockReturnValue(() => {});
	});

	it('resolves to the session app access and gates by id', async () => {
		vi.mocked(fetchMe).mockResolvedValue(me({ apps: ['attendance'] }));
		const { result } = renderHook(() => useAppAccess());
		await waitFor(() => expect(result.current.resolved).toBe(true));
		expect(result.current.canOpen('attendance')).toBe(true);
		expect(result.current.canOpen('projects')).toBe(false);
	});

	it('hides app-dependent UI when the read fails', async () => {
		vi.mocked(fetchMe).mockRejectedValue(new Error('offline'));
		const { result } = renderHook(() => useAppAccess());
		await waitFor(() => expect(result.current.resolved).toBe(true));
		expect(result.current.canOpen('projects')).toBe(false);
	});

	it('repaints from a published /auth/me without issuing its own request', async () => {
		// The AuthGate owns the resume re-read; this hook must react to its publish
		// (the fix for two independent `visibilitychange` handlers each firing a
		// duplicate refreshMe).
		let listener: ((me: MeUser) => void) | null = null;
		vi.mocked(subscribeMe).mockImplementation((l) => {
			listener = l;
			return () => {};
		});
		vi.mocked(fetchMe).mockResolvedValue(me({ apps: ['attendance'], granted_collections: '*' }));
		const { result } = renderHook(() => useAppAccess());
		await waitFor(() => expect(result.current.resolved).toBe(true));
		expect(result.current.canOpen('projects')).toBe(false);

		act(() => listener!(me({ apps: ['projects'], granted_collections: '*' })));
		expect(result.current.canOpen('projects')).toBe(true);
		expect(fetchMe).toHaveBeenCalledTimes(1);
	});

	it('paints the resolved state immediately from the memoized /auth/me', () => {
		vi.mocked(getCachedMe).mockReturnValue(me({ apps: ['projects'], granted_collections: '*' }));
		const { result } = renderHook(() => useAppAccess());
		expect(result.current.resolved).toBe(true);
		expect(result.current.canOpen('projects')).toBe(true);
		expect(fetchMe).not.toHaveBeenCalled();
	});
});
