import { describe, expect, it } from 'vitest';

import { reduceTaskFacets, shouldShowTaskTabs, toEmployeeProfile } from './detail-query';

/**
 * The employee profile page's pure data boundaries.
 *
 * Every piece pinned here exists because of a real bug or a real contract:
 *  - `shouldShowTaskTabs` is the tab strip's ONE gate — a task-derived tab is
 *    painted only for a caller who may read `hrm_tasks` AND a person who has
 *    tasks (painting it otherwise was the "tab opens to an empty / erroring
 *    body" complaint).
 *  - `reduceTaskFacets` is the ONE walk that answers the Tasks tab and the
 *    Projects tab. It must filter on the `assignee` m2m (the engine cannot),
 *    bucket projects from the EXPANDED `project` relation, and order
 *    open-before-done then by nearest due date.
 *  - `toEmployeeProfile` normalizes the row the page's banner rides on. It reads
 *    the m2o relations from their expanded `name_mm`/`name_en` shapes and the
 *    `shifts` m2m array, and must survive a row where all of those are absent
 *    (a deep link to a barely-populated record).
 */

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';

/** A raw `hrm_tasks` row as the API returns it after a `project` expansion. */
function rawTask(over: {
	id: string;
	name?: string;
	state?: string;
	priority?: string;
	due_date?: string;
	project?: { id: string; name: string } | null;
	assignees?: string[];
}) {
	return {
		id: over.id,
		name: over.name ?? 'Task',
		state: over.state ?? 'todo',
		priority: over.priority ?? null,
		due_date: over.due_date ?? null,
		project: over.project ?? null,
		assignee: (over.assignees ?? [ME]).map((id) => ({ id })),
	};
}

describe('reduceTaskFacets — the assignee filter', () => {
	it('keeps only the rows this employee is assigned to', () => {
		const facets = reduceTaskFacets(
			[
				rawTask({ id: 't1', name: 'Mine', assignees: [ME, OTHER] }),
				rawTask({ id: 't2', name: 'Theirs', assignees: [OTHER] }),
				rawTask({ id: 't3', name: 'Also mine', assignees: [ME] }),
			],
			ME,
		);
		expect(facets.tasks.map((t) => t.id)).toEqual(['t1', 't3']);
	});

	it('drops rows with no assignee at all', () => {
		const facets = reduceTaskFacets([rawTask({ id: 't1', assignees: [] })], ME);
		expect(facets.tasks).toHaveLength(0);
	});

	it('tolerates a bare (unexpanded) assignee rather than throwing', () => {
		const facets = reduceTaskFacets([{ id: 't1', name: 'x', state: 'todo', assignee: ME }], ME);
		expect(facets.tasks).toHaveLength(0);
	});
});

describe('reduceTaskFacets — ordering', () => {
	it('lists open work before done work', () => {
		const facets = reduceTaskFacets(
			[
				rawTask({ id: 'done', state: 'done', due_date: '2026-01-01' }),
				rawTask({ id: 'open', state: 'in_progress', due_date: '2026-12-31' }),
			],
			ME,
		);
		expect(facets.tasks.map((t) => t.id)).toEqual(['open', 'done']);
	});

	it('orders open work by nearest due date, undated last', () => {
		const facets = reduceTaskFacets(
			[rawTask({ id: 'later', due_date: '2026-09-30' }), rawTask({ id: 'undated' }), rawTask({ id: 'soon', due_date: '2026-09-12' })],
			ME,
		);
		expect(facets.tasks.map((t) => t.id)).toEqual(['soon', 'later', 'undated']);
	});

	it('normalizes the stored capitalized priority to lowercase', () => {
		const facets = reduceTaskFacets([rawTask({ id: 't1', priority: 'Low' })], ME);
		expect(facets.tasks[0].priority).toBe('low');
	});
});

describe('reduceTaskFacets — project buckets', () => {
	it('derives one bucket per project with this employee’s done/total', () => {
		const facets = reduceTaskFacets(
			[
				rawTask({ id: 'a', project: { id: 'p1', name: 'Safety' }, state: 'done' }),
				rawTask({ id: 'b', project: { id: 'p1', name: 'Safety' }, state: 'todo' }),
				rawTask({ id: 'c', project: { id: 'p2', name: 'Website' }, state: 'in_progress' }),
			],
			ME,
		);
		expect(facets.projects).toEqual([
			{ id: 'p1', name: 'Safety', total: 2, done: 1 },
			{ id: 'p2', name: 'Website', total: 1, done: 0 },
		]);
	});

	it('excludes tasks with no project from the buckets but keeps them as tasks', () => {
		const facets = reduceTaskFacets([rawTask({ id: 'orphan', project: null })], ME);
		expect(facets.projects).toHaveLength(0);
		expect(facets.tasks.map((t) => t.id)).toEqual(['orphan']);
	});

	it('breaks a total tie by name so the order is stable', () => {
		const facets = reduceTaskFacets(
			[rawTask({ id: 'a', project: { id: 'p1', name: 'Zeta' } }), rawTask({ id: 'b', project: { id: 'p2', name: 'Alpha' } })],
			ME,
		);
		expect(facets.projects.map((p) => p.name)).toEqual(['Alpha', 'Zeta']);
	});

	it('counts a project only through this employee’s own rows', () => {
		const facets = reduceTaskFacets(
			[
				rawTask({ id: 'a', project: { id: 'p1', name: 'Safety' }, state: 'done' }),
				rawTask({ id: 'b', project: { id: 'p1', name: 'Safety' }, state: 'done', assignees: [OTHER] }),
			],
			ME,
		);
		expect(facets.projects).toEqual([{ id: 'p1', name: 'Safety', total: 1, done: 1 }]);
	});
});

describe('shouldShowTaskTabs — the tab strip gate', () => {
	const oneTask = { id: 't1', name: 'x', state: 'todo', priority: null, dueDate: null, projectName: null };

	it('needs BOTH the read grant and at least one task', () => {
		// A caller who may not read hrm_tasks never sees the tabs (the read is off).
		expect(shouldShowTaskTabs(false, { tasks: [oneTask], projects: [] })).toBe(false);
		// A person with no tasks has nothing to open — the reported empty/erroring tab.
		expect(shouldShowTaskTabs(true, { tasks: [], projects: [] })).toBe(false);
		// The facets read has not resolved yet — stay on Overview, do not flash tabs.
		expect(shouldShowTaskTabs(true, undefined)).toBe(false);
		expect(shouldShowTaskTabs(true, { tasks: [oneTask], projects: [] })).toBe(true);
	});
});

describe('toEmployeeProfile — relation + boolean normalization', () => {
	it('reads the expanded m2o names and the shifts m2m array', () => {
		const profile = toEmployeeProfile({
			id: 'e1',
			name_mm: 'ဦးလှထွန်း',
			name_en: 'U Hla Htun',
			eid: 'MFF-009',
			active: 1,
			gender: 'male',
			department: { id: 'd1', name_mm: 'Safety & Store', name_en: 'Safety & Store' },
			designation: { id: 'g1', name_en: 'Safety Supervisor' },
			shifts: [{ id: 's1', name: 'Shift for Safety', time_in: '07:00:00', working_hours: 8 }],
		});
		expect(profile.departmentName).toBe('Safety & Store');
		expect(profile.designationName).toBe('Safety Supervisor');
		expect(profile.active).toBe(true);
		expect(profile.shifts).toEqual([{ id: 's1', name: 'Shift for Safety', timeIn: '07:00', workingHours: 8 }]);
	});

	it('normalizes the stored INTEGER 0 to a real false', () => {
		expect(toEmployeeProfile({ id: 'e1', active: 0 }).active).toBe(false);
	});

	it('degrades an empty row to nulls instead of throwing', () => {
		const profile = toEmployeeProfile({ id: 'e1' });
		expect(profile.departmentName).toBeNull();
		expect(profile.designationName).toBeNull();
		expect(profile.gender).toBeNull();
		expect(profile.active).toBeNull();
		expect(profile.shifts).toEqual([]);
	});

	it('drops shift rows that carry no id (nothing to key or link on)', () => {
		const profile = toEmployeeProfile({ id: 'e1', shifts: [{ name: 'ghost' }, { id: 's2', name: 'real' }] });
		expect(profile.shifts.map((s) => s.id)).toEqual(['s2']);
	});

	it('rejects an unknown gender value rather than passing it through', () => {
		expect(toEmployeeProfile({ id: 'e1', gender: 'other' }).gender).toBeNull();
	});
});
