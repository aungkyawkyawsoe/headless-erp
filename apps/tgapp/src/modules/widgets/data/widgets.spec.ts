import { describe, expect, it } from 'vitest';

import { anyWidgetVisible, grantsOf } from './api';
import { buildWidgetsModel, type FleetWidgetRow } from './model';
import type { MyTask } from '@/modules/projects/data/types';

/** Deterministic date anchors make the day math assertable. */
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const PAST = iso(-2);
const FUTURE = iso(10);

const fleet = (over: Partial<FleetWidgetRow> & { id: string }): FleetWidgetRow => ({
	plate_no: 'P-1',
	last_odo: 10_000,
	last_engine_oil: 40_000,
	last_gear_oil: 40_000,
	last_license: null,
	last_insurance: null,
	...over,
});

const task = (over: Partial<MyTask> & { id: string }): MyTask => ({
	name: 'Task',
	state: 'in_progress',
	priority: 'medium',
	dueDate: null,
	assignees: [],
	number: null,
	projectId: 'p1',
	projectName: 'Fleet Ops',
	...over,
});

const noFeeds = { tasks: [] };

describe('widgets model — lineage + bounds', () => {
	it('counts care alerts from the master pointers only (no child reads)', () => {
		const model = buildWidgetsModel({
			fleets: [fleet({ id: 'ok' }), fleet({ id: 'due', last_engine_oil: 10_400 }), fleet({ id: 'past', last_engine_oil: 9_000 })],
			...noFeeds,
		});
		expect(model.alerts.find((cell) => cell.key === 'oil')).toMatchObject({ count: 2, tone: 'alert' });
		// Exactly the fleet cells the Fleet & Operations grid renders — no
		// implied "Approvals" tile (its feed is not read).
		expect(model.alerts.map((cell) => cell.key)).toEqual(['oil', 'license', 'insurance']);
	});

	it('counts documents EXPIRED or inside the warn window, escalating the tile tone', () => {
		const model = buildWidgetsModel({
			fleets: [
				// An expired license, and an insurance policy expiring inside 30 days.
				fleet({ id: 'l1', last_license: { expiry_date: PAST }, last_insurance: { expiry_date: FUTURE } }),
				// Nothing on file — neither cell may count it.
				fleet({ id: 'l2' }),
				// Well clear of the window on both.
				fleet({ id: 'l3', last_license: { expiry_date: iso(90) }, last_insurance: { expiry_date: iso(90) } }),
			],
			...noFeeds,
		});
		// Expired ⇒ alert; inside the window ⇒ warn — the registers' own rule.
		expect(model.alerts.find((cell) => cell.key === 'license')).toMatchObject({ count: 1, tone: 'alert' });
		expect(model.alerts.find((cell) => cell.key === 'insurance')).toMatchObject({ count: 1, tone: 'warn' });
	});

	it('leaves the document cells at zero when nothing is due', () => {
		const model = buildWidgetsModel({
			fleets: [fleet({ id: 'a', last_license: { expiry_date: iso(60) }, last_insurance: { expiry_date: iso(60) } })],
			...noFeeds,
		});
		expect(model.alerts.find((cell) => cell.key === 'license')).toMatchObject({ count: 0, tone: 'ok' });
		expect(model.alerts.find((cell) => cell.key === 'insurance')).toMatchObject({ count: 0, tone: 'ok' });
	});
});

describe('the to-do list — open tasks, most urgent first', () => {
	it('drops finished tasks and orders overdue → today → upcoming → undated', () => {
		const model = buildWidgetsModel({
			fleets: [],
			tasks: [
				task({ id: 'done', state: 'done', dueDate: PAST }),
				task({ id: 'undated', name: 'Zeta' }),
				task({ id: 'later', name: 'Bravo', dueDate: FUTURE }),
				task({ id: 'over', name: 'Alpha', dueDate: PAST }),
				task({ id: 'today', name: 'Charlie', dueDate: iso(0) }),
			],
		});
		expect(model.todos.map((row) => row.key)).toEqual(['task:over', 'task:today', 'task:later', 'task:undated']);
		expect(model.todos[0]).toMatchObject({ badge: 'Overdue 2d', tone: 'alert', subtitle: 'Fleet Ops', to: '/app/projects/task/over' });
		expect(model.todos[1]).toMatchObject({ badge: 'Due today', tone: 'warn' });
		// Undated tasks are still to-dos — no badge, calm tone.
		expect(model.todos[3]).toMatchObject({ badge: null, tone: 'ok' });
	});

	it('is empty (not fabricated) when the feed is empty', () => {
		const model = buildWidgetsModel({ fleets: [], ...noFeeds });
		expect(model.todos).toEqual([]);
	});
});

describe('widget grants — visibility rides the API read grants', () => {
	it('nothing renders without a session', () => {
		expect(anyWidgetVisible(grantsOf(null))).toBe(false);
	});

	it('a task-only role sees the to-do widget and nothing else', () => {
		const grants = grantsOf({ is_admin: false, granted_collections: ['hrm_tasks'] } as never);
		expect(grants.tasks).toBe(true);
		expect(grants.fleet).toBe(false);
	});

	it('an admin sees everything (the "*" sentinel)', () => {
		expect(anyWidgetVisible(grantsOf({ is_admin: true } as never))).toBe(true);
	});
});
