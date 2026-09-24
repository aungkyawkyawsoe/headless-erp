// @vitest-environment jsdom
/**
 * Pins the ONE identity read the attendance module mounts.
 *
 * The bug this guards: identity used to be keyed on the TELEGRAM id, so a
 * WEB sign-in (which has none) resolved as nobody — the dashboard header read
 * `----` where the name belongs, the punch sheet's shift picker came up empty
 * (shift reads were filtered by `etg_id`), and every request form's submit
 * button could never enable. Resolution therefore has to try the session's own
 * `employee_id` FIRST and only fall back to the Telegram id.
 *
 * The assertions below are the contract, not an implementation detail:
 *   • a web session reads NO Telegram id at all and still names its employee;
 *   • a Telegram session with no linked employee still resolves through the tg id;
 *   • a session that names nobody SETTLES (no eternal shimmer) as "no employee";
 *   • a failed directory read for a session that DID name an employee is never
 *     reported as "no employee".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/shared/auth', () => ({ getCachedMe: vi.fn(() => null), fetchMe: vi.fn() }));
vi.mock('../data/api', () => ({ fetchCurrentEmployee: vi.fn(), fetchCurrentTgId: vi.fn() }));

import { getCachedMe } from '@/shared/auth';
import { fetchCurrentEmployee, fetchCurrentTgId, type CurrentEmployee } from '../data/api';
import { qk } from '../data/query-keys';
import { useActingEmployee } from './use-acting-employee';

const STORE_EMPLOYEE: CurrentEmployee = {
	id: 'e-store',
	name: 'Aung Kyaw',
	name_mm: 'အောင်ကျော်',
	name_en: 'Aung Kyaw',
	eid: 'MFF-009',
	photo_url: null,
};

let qc: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

/** `/auth/me` as the AuthGate's boot would have cached it. */
function cachedMe(employee_id: string | null) {
	vi.mocked(getCachedMe).mockReturnValue({ user_id: 'u', email: 'aung@mfflogistics.com', employee_id });
}

beforeEach(() => {
	qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	vi.mocked(fetchCurrentEmployee).mockReset();
	vi.mocked(fetchCurrentTgId).mockReset();
});

afterEach(cleanup);

describe('useActingEmployee — session employee first, Telegram id only as fallback', () => {
	it('names a WEB sign-in from the session alone — and never reads a Telegram id', async () => {
		cachedMe('e-store');
		vi.mocked(fetchCurrentEmployee).mockResolvedValue(STORE_EMPLOYEE);

		const { result } = renderHook(() => useActingEmployee(), { wrapper });

		await waitFor(() => expect(result.current.loading).toBe(false));

		// The reported bug: the header renders `name_mm ?? name_en`, so a null row
		// painted `----`. The employee must be the row the session named.
		expect(result.current.employee?.name_mm).toBe('အောင်ကျော်');
		expect(result.current.employeeId).toBe('e-store');
		expect(result.current.hasNoEmployee).toBe(false);

		// A browser session has no Telegram id, so asking for one is pure waste —
		// the lookup that used to make every web sign-in resolve as nobody.
		expect(fetchCurrentTgId).not.toHaveBeenCalled();
	});

	it('keys the resolved row on the session employee id (the key the pages read)', async () => {
		cachedMe('e-store');
		vi.mocked(fetchCurrentEmployee).mockResolvedValue(STORE_EMPLOYEE);

		const { result } = renderHook(() => useActingEmployee(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(qc.getQueryData(qk.actingEmployee('e-store'))).toEqual(STORE_EMPLOYEE);
		// The tg-id key must stay empty on this path, or the two identity paths
		// would collide in one cache entry.
		expect(qc.getQueryData(qk.tgId())).toBeUndefined();
	});

	it('falls back to the Telegram id for a session with no employee link', async () => {
		cachedMe(null);
		vi.mocked(fetchCurrentTgId).mockResolvedValue('12345');
		vi.mocked(fetchCurrentEmployee).mockResolvedValue(STORE_EMPLOYEE);

		const { result } = renderHook(() => useActingEmployee(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(fetchCurrentTgId).toHaveBeenCalledTimes(1);
		expect(result.current.employeeId).toBe('e-store');
		expect(result.current.hasNoEmployee).toBe(false);
	});

	it('settles as NO EMPLOYEE when neither source names one (no eternal shimmer)', async () => {
		cachedMe(null);
		vi.mocked(fetchCurrentTgId).mockResolvedValue(null);

		const { result } = renderHook(() => useActingEmployee(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.hasNoEmployee).toBe(true);
		expect(result.current.employeeId).toBeNull();
		// Nothing to look up — the directory read must not be issued at all.
		expect(fetchCurrentEmployee).not.toHaveBeenCalled();
	});

	it('never reports "no employee" for a session that DID name one, even if the row read fails', async () => {
		cachedMe('e-store');
		vi.mocked(fetchCurrentEmployee).mockRejectedValue(new Error('offline'));

		const { result } = renderHook(() => useActingEmployee(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(result.current.hasNoEmployee).toBe(false);
		expect(result.current.employeeId).toBe('e-store');
	});

	it('stays deferred while disabled — the Team scope must not read identity', async () => {
		cachedMe('e-store');
		vi.mocked(fetchCurrentEmployee).mockResolvedValue(STORE_EMPLOYEE);

		const { result } = renderHook(() => useActingEmployee(false), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(fetchCurrentEmployee).not.toHaveBeenCalled();
		expect(result.current.hasNoEmployee).toBe(false);
	});
});
