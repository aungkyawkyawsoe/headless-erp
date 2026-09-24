import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';

import { EmployeeCard } from '../components/employee-card';
import { fetchEmployeesPage, fetchEmployeesSearch } from '../data/api';
import { DIRECTORY_STALE_MS, qk } from '../data/query-keys';
import { EMPLOYEE_STATUS_LABELS, EMPLOYEE_STATUS_OPTIONS, type EmployeeStatusFilterValue } from '../data/status';
import type { EmployeeRow } from '../data/types';
import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

/**
 * Browse all employees — the HR directory register at `/app/employees/browse`.
 *
 * The old `/app/employees` page, superseded at the route by the search-first
 * kiosk (`employees-page.tsx`): the kiosk answers the typical one-person
 * lookup (find MY board member / the driver whose ID I half-remember) with
 * ZERO idle reads, so the full directory moved behind the kiosk's "Browse all
 * employees" escape hatch.
 *
 * Cursor-paginated at `LIST_PAGE_SIZE` rows per page (see `fetchEmployeesPage`)
 * — page 1 renders immediately, further pages stream in as the list approaches
 * the bottom via `LoadMoreSentinel`, so a large company never loads in one
 * round trip. Cards carry a SCALAR-ONLY row — avatar, name (MM), eid, the
 * active-status dot and a corner gender glyph — with NO relation joins (see
 * `DIRECTORY_FIELDS` in `data/api.ts`), so paginating the whole company never
 * pulls related rows. A status filter in the bottom action bar narrows to
 * အလုပ်တက်နေ / ရပ်နား client-side over the loaded rows, and the bar's ↻ button
 * force-refetches the directory (spins while fetching).
 *
 * Tapping a card NAVIGATES to the employee's full profile
 * (`/app/employees/:id`, a real route with Overview / Belonging Assets / Tasks /
 * Projects tabs) — the profile fetches the tapped employee's own row, so a
 * detail read only happens for the single employee the user actually opens.
 */

// URL-driven status filter — `?status=` survives reloads; nuqs `replace`
// (default) keeps taps out of history. `'all'` shows every employee.
const EMPLOYEE_STATUS_FILTER = enumParam<EmployeeStatusFilterValue>(
	Object.keys(EMPLOYEE_STATUS_LABELS) as EmployeeStatusFilterValue[],
	'all',
);

/** The directory's whole URL view state — the status filter, in one container. */
const EMPLOYEES_VIEW = {
	[URL_PARAM.status]: EMPLOYEE_STATUS_FILTER,
} as const;

export default function EmployeesBrowsePage() {
	const navigate = useNavigate();
	const list = useCursorList({ queryKey: qk.employees(), fetcher: fetchEmployeesPage, staleTime: DIRECTORY_STALE_MS });
	const [view, setView] = useViewState(EMPLOYEES_VIEW);
	const { status: statusFilter } = view;

	// Tapping a card NAVIGATES to the profile route — the path is real navigation
	// (push), so the back arrow leaves the profile in one press.
	const openProfile = useCallback(
		(employee: EmployeeRow) => {
			hapticSelection();
			navigate(`/app/employees/${employee.id}`);
		},
		[navigate],
	);

	// One card per row — keyed + onOpen stable so the memoized card only
	// re-renders when its own row changes.
	const renderEmployee = useCallback(
		(employee: EmployeeRow) => <EmployeeCard key={employee.id} employee={employee} onOpen={openProfile} />,
		[openProfile],
	);

	const source: EmployeeRow[] = list.rows;

	return (
		<>
			<ListPage
				{...listPageErrorProps(list)}
				title="Employees"
				rows={source}
				isPending={list.isPending}
				skeletonVariant="employee"
				renderItem={renderEmployee}
				emptyState={{ title: 'No employees yet', hint: 'Check back later.' }}
				density="compact"
				pagination={{
					hasNextPage: list.hasNextPage,
					isFetchingNextPage: list.isFetchingNextPage,
					onLoadMore: () => void list.fetchNextPage(),
				}}
				searchPlaceholder="Search name / ID"
				fetchSearch={fetchEmployeesSearch}
				filter={{
					value: statusFilter,
					onChange: (value) => setView({ status: value }),
					options: EMPLOYEE_STATUS_OPTIONS,
					centerLabel: EMPLOYEE_STATUS_LABELS[statusFilter],
					sheetTitle: 'Filter by status',
					// The shell short-circuits `'all'`; `'active'` = working (`active ===
					// true`), `'inactive'` = everything else (false / null / undefined).
					matches: (employee, value) => (value === 'active') === (employee.active === true),
					emptyTitle: 'No employees match this filter',
				}}
				rightExtra={
					<button
						type="button"
						onClick={() => {
							hapticImpact('light');
							void list.refetch();
						}}
						disabled={list.isRefetching}
						aria-label="Refresh"
						className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE} disabled:opacity-50`}
					>
						<RefreshCw className={`size-4${list.isRefetching ? ' animate-spin' : ''}`} strokeWidth={2.2} aria-hidden />
					</button>
				}
			/>
		</>
	);
}
