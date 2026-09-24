import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { EmployeeCard } from '../components/employee-card';
import { fetchEmployeesSearch } from '../data/api';
import { DIRECTORY_STALE_MS, qk } from '../data/query-keys';
import { SearchKiosk } from '@/shared/components/search-kiosk';
import type { EmployeeRow } from '../data/types';

/**
 * ဝန်ထမ်းများ — the employee Lookup (`/app/employees`, launcher tile `hr`),
 * now the app's search-first KIOSK shape (same as Daily ODO): it opens BLANK
 * with one centred name search and runs ZERO reads while idle — the old
 * page-1 read of 25 directory rows per open is gone for a screen whose typical
 * job is to find ONE person. Once the operator types, a debounced server
 * `?search=` read runs (name MM/EN + eid, `fetchEmployeesSearch`) and matching
 * employees render as the SAME cards the browse register uses; a single match
 * opens the person's full profile directly, and a picked suggestion does the
 * same (an exact row costs no second read).
 *
 * The full directory is NOT gone — "Browse all employees" (the idle stage) opens
 * it at `/app/employees/browse`, where the old cursor list lives with its
 * status filter. Card taps navigate to `/app/employees/:id` (push) — the
 * profile fetches its own row, so a detail read happens only for the employee
 * the user actually opens.
 */
export default function EmployeesPage() {
	const navigate = useNavigate();

	// Card taps NAVIGATE to the profile route — real navigation (push), so the
	// back arrow leaves the profile in one press.
	const openProfile = useCallback(
		(employee: { id: string }) => {
			navigate(`/app/employees/${employee.id}`);
		},
		[navigate],
	);

	return (
		<SearchKiosk<EmployeeRow>
			title="Employees"
			heading="Find an employee"
			placeholder="Enter name / ID"
			inputLabel="Employee name or ID"
			search={fetchEmployeesSearch}
			queryKeyPrefix={qk.employees()}
			staleTime={DIRECTORY_STALE_MS}
			keyOf={(employee) => employee.id}
			primaryText={(employee) => employee.name_mm?.trim() || employee.name_en || '—'}
			secondaryText={(employee) => employee.eid || null}
			renderResult={(employee) => <EmployeeCard key={employee.id} employee={employee} onOpen={openProfile} />}
			onPick={openProfile}
			notFoundHint="Check the name / ID and try again — e.g. BOD-0002."
			skeletonVariant="employee"
			browse={{ to: '/app/employees/browse', label: 'Browse all employees' }}
		/>
	);
}
