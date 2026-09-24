/** The directory's status filter — `'all'` shows every employee. */
export type EmployeeStatusFilterValue = 'all' | 'active' | 'inactive';

/** The filter sheet's options — the single source both the sheet rows and the
 *  bar's center label read (labels are derived, never re-typed). */
export const EMPLOYEE_STATUS_OPTIONS: ReadonlyArray<{ value: EmployeeStatusFilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'active', label: 'Active' },
	{ value: 'inactive', label: 'Inactive' },
];

/** Value → label — derived from the options so the two can never drift. */
export const EMPLOYEE_STATUS_LABELS = Object.fromEntries(EMPLOYEE_STATUS_OPTIONS.map((option) => [option.value, option.label])) as Record<
	EmployeeStatusFilterValue,
	string
>;
